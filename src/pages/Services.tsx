import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Server,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Plus,
  FileText,
  Pencil,
  Search,
  RotateCcw,
  XCircle,
  Terminal,
  Cpu,
  MemoryStick,
} from "lucide-react";
import type { Service, ServiceLog } from "@/types";
import {
  listServices,
  createService,
  updateService,
  deleteService,
  startService,
  stopService,
  restartService,
  getServiceLogs,
} from "@/lib/api";

type ServiceStatus = "all" | "running" | "stopped" | "error" | "restarting";

interface LogEntry {
  content: string;
  level: string;
  created_at: string;
}

const restartPolicyLabels: Record<string, string> = {
  always: "始终重启",
  "on-failure": "失败时重启",
  never: "不重启",
};

const emptyFormData = {
  id: 0,
  name: "",
  description: "",
  command: "",
  cwd: "",
  env_vars: "{}",
  auto_start: false,
  restart_policy: "on-failure" as "always" | "on-failure" | "never",
  max_restarts: 5,
  port_auto_detect: true,
};

export default function Services() {
  // ─── State ────────────────────────────────────────────────
  const [services, setServices] = useState<Service[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ServiceStatus>("all");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ ...emptyFormData });

  // Log states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logService, setLogService] = useState<Service | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logTab, setLogTab] = useState("realtime");
  const [isListening, setIsListening] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // ─── Load services ────────────────────────────────────────
  const loadServices = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const data = await listServices();
      setServices(data);
    } catch (error) {
      console.error("Failed to load services:", error);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  // Auto refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => loadServices(), 5000);
    return () => clearInterval(interval);
  }, [loadServices]);

  // ─── Filtered services ────────────────────────────────────
  const filteredServices = services.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // ─── Log auto-scroll ──────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ─── Real-time log listener ───────────────────────────────
  useEffect(() => {
    if (!logDialogOpen || !logService) return;

    const setupListener = async () => {
      try {
        const unlisten = await listen(`service:log:${logService.id}`, (event) => {
          setLogs((prev) => [
            ...prev,
            {
              content: event.payload as string,
              level: "info",
              created_at: new Date().toISOString(),
            },
          ]);
        });
        unlistenRef.current = unlisten;
        setIsListening(true);
      } catch (e) {
        console.error("Failed to setup log listener:", e);
      }
    };

    setupListener();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setIsListening(false);
    };
  }, [logDialogOpen, logService]);

  // ─── CRUD handlers ────────────────────────────────────────
  const openCreateDialog = () => {
    setFormData({ ...emptyFormData });
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEditDialog = (service: Service) => {
    setFormData({
      id: service.id,
      name: service.name,
      description: service.description || "",
      command: service.command,
      cwd: service.cwd || "",
      env_vars: service.env_vars || "{}",
      auto_start: service.auto_start,
      restart_policy: service.restart_policy,
      max_restarts: service.max_restarts,
      port_auto_detect: service.port_auto_detect,
    });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.command.trim()) return;

    try {
      if (isEditing) {
        await updateService({
          id: formData.id,
          name: formData.name,
          description: formData.description,
          command: formData.command,
          cwd: formData.cwd,
          env_vars: formData.env_vars,
          auto_start: formData.auto_start,
          restart_policy: formData.restart_policy,
          max_restarts: formData.max_restarts,
          port_auto_detect: formData.port_auto_detect,
          status: "stopped",
          pid: null,
          ports: "",
          cpu_percent: 0,
          memory_mb: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        await createService({
          name: formData.name,
          description: formData.description,
          command: formData.command,
          cwd: formData.cwd,
          env_vars: formData.env_vars,
          auto_start: formData.auto_start,
          restart_policy: formData.restart_policy,
          max_restarts: formData.max_restarts,
          port_auto_detect: formData.port_auto_detect,
        });
      }
      setDialogOpen(false);
      loadServices();
    } catch (error) {
      console.error("Failed to save service:", error);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await startService(id);
      loadServices();
    } catch (error) {
      console.error("Failed to start service:", error);
    }
  };

  const handleStop = async (id: number) => {
    try {
      await stopService(id);
      loadServices();
    } catch (error) {
      console.error("Failed to stop service:", error);
    }
  };

  const handleRestart = async (id: number) => {
    try {
      await restartService(id);
      loadServices();
    } catch (error) {
      console.error("Failed to restart service:", error);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("确定要删除这个服务吗？此操作不可撤销。")) return;
    try {
      await deleteService(id);
      loadServices();
    } catch (error) {
      console.error("Failed to delete service:", error);
    }
  };

  // ─── Log handlers ─────────────────────────────────────────
  const openLogs = async (service: Service) => {
    setLogService(service);
    setLogs([]);
    setLogTab("realtime");
    setLogDialogOpen(true);

    // Load historical logs
    try {
      const historicalLogs = await getServiceLogs(service.id);
      const formatted = historicalLogs.map((l: { content: string; level: string; created_at: string }) => ({
        content: l.content,
        level: l.level as "info" | "warn" | "error" | "stdout" | "stderr",
        created_at: l.created_at,
      }));
      setLogs(formatted);
    } catch (error) {
      console.error("Failed to load historical logs:", error);
    }
  };

  const clearLogs = () => setLogs([]);

  // ─── Status badge helper ──────────────────────────────────
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge variant="success">运行中</Badge>;
      case "stopped":
        return <Badge variant="secondary">已停止</Badge>;
      case "error":
        return <Badge variant="destructive">错误</Badge>;
      case "restarting":
        return <Badge variant="warning">重启中</Badge>;
      default:
        return <Badge variant="outline">未知</Badge>;
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  };

  // Parse ports string into array
  const parsePorts = (portsStr: string): string[] => {
    if (!portsStr) return [];
    return portsStr.split(",").filter((p) => p.trim());
  };

  // ─── Filter tabs ──────────────────────────────────────────
  const statusTabs: { value: ServiceStatus; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "running", label: "运行中" },
    { value: "stopped", label: "已停止" },
    { value: "error", label: "错误" },
  ];

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">服务管理</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          添加服务
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索服务名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(tab.value)}
              className="text-xs"
            >
              {tab.label}
              {tab.value !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">
                  {services.filter((s) => s.status === tab.value).length}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Service Grid */}
      {services.length === 0 ? (
        <Card className="py-16">
          <CardContent className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-medium">还没有服务</p>
              <p className="text-sm text-muted-foreground mt-1">
                添加第一个服务来开始管理
              </p>
            </div>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              添加第一个服务
            </Button>
          </CardContent>
        </Card>
      ) : filteredServices.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              没有找到匹配的服务
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServices.map((service) => (
            <Card key={service.id} className="flex flex-col">
              <CardContent className="p-4 flex flex-col flex-1">
                {/* Top: Name + Status */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold truncate" title={service.name}>
                    {service.name}
                  </h3>
                  {getStatusBadge(service.status)}
                </div>

                {/* Description */}
                {service.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {service.description}
                  </p>
                )}

                {/* Command block */}
                <div className="mt-3 rounded bg-muted px-2.5 py-1.5 overflow-hidden">
                  <code className="text-xs font-mono text-muted-foreground truncate block">
                    {service.command || "无命令"}
                  </code>
                </div>

                {/* Ports */}
                {service.ports && parsePorts(service.ports).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {parsePorts(service.ports).map((port) => (
                      <Badge key={port} variant="outline" className="text-[10px] h-5 px-1.5">
                        {port.trim()}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* CPU / Memory */}
                {service.status === "running" && (
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      CPU {service.cpu_percent?.toFixed(1)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <MemoryStick className="h-3 w-3" />
                      内存 {service.memory_mb?.toFixed(0)} MB
                    </span>
                  </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Action buttons */}
                <div className="mt-3 pt-3 border-t flex items-center gap-1">
                  {service.status === "running" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                      title="停止"
                      onClick={() => handleStop(service.id)}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                      title="启动"
                      onClick={() => handleStart(service.id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="重启"
                    onClick={() => handleRestart(service.id)}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="查看日志"
                    onClick={() => openLogs(service)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="编辑"
                    onClick={() => openEditDialog(service)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="删除"
                    onClick={() => handleDelete(service.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Create/Edit Dialog ─────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? "编辑服务" : "添加服务"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-name">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="svc-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="如: frpc 内网穿透"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-desc">描述</Label>
              <Textarea
                id="svc-desc"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="服务的简要描述..."
                rows={2}
              />
            </div>

            {/* Command */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-cmd">
                启动命令 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="svc-cmd"
                value={formData.command}
                onChange={(e) =>
                  setFormData({ ...formData, command: e.target.value })
                }
                placeholder="如: /usr/local/bin/frpc -c ~/.frp/frpc.toml"
                rows={2}
              />
            </div>

            {/* Working Directory */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-cwd">工作目录</Label>
              <Input
                id="svc-cwd"
                value={formData.cwd}
                onChange={(e) =>
                  setFormData({ ...formData, cwd: e.target.value })
                }
                placeholder="如: /Users/xxx/projects"
              />
            </div>

            {/* Environment Variables */}
            <div className="space-y-1.5">
              <Label htmlFor="svc-env">环境变量 (JSON格式)</Label>
              <Textarea
                id="svc-env"
                value={formData.env_vars}
                onChange={(e) =>
                  setFormData({ ...formData, env_vars: e.target.value })
                }
                placeholder={`{"KEY": "value", "NODE_ENV": "production"}`}
                rows={2}
              />
            </div>

            {/* Restart Policy + Max Restarts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-policy">重启策略</Label>
                <select
                  id="svc-policy"
                  value={formData.restart_policy}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      restart_policy: e.target.value as
                        | "always"
                        | "on-failure"
                        | "never",
                    })
                  }
                  className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="always">{restartPolicyLabels.always}</option>
                  <option value="on-failure">
                    {restartPolicyLabels["on-failure"]}
                  </option>
                  <option value="never">{restartPolicyLabels.never}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-max">最大重启次数</Label>
                <Input
                  id="svc-max"
                  type="number"
                  min={0}
                  max={20}
                  value={formData.max_restarts}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      max_restarts: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.auto_start}
                  onChange={(e) =>
                    setFormData({ ...formData, auto_start: e.target.checked })
                  }
                  className="rounded border-border"
                />
                自动启动
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.port_auto_detect}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      port_auto_detect: e.target.checked,
                    })
                  }
                  className="rounded border-border"
                />
                自动检测端口
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleSave}
                disabled={!formData.name.trim() || !formData.command.trim()}
              >
                {isEditing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Logs Dialog ────────────────────────────────────── */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              服务日志 — {logService?.name}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={logTab} onValueChange={setLogTab}>
            <TabsList>
              <TabsTrigger value="realtime">
                实时日志 {isListening && "●"}
              </TabsTrigger>
              <TabsTrigger value="history">历史日志</TabsTrigger>
            </TabsList>

            <TabsContent value="realtime">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  {isListening ? (
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                      监听中
                    </span>
                  ) : (
                    "未连接"
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={clearLogs}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  清空日志
                </Button>
              </div>
              <div className="h-[400px] overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-20">
                    等待日志输出...
                  </p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground select-none">
                        {formatTime(log.created_at)}
                      </span>
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-400"
                            : log.level === "warn"
                            ? "text-yellow-400"
                            : "text-green-400"
                        }
                      >
                        {log.content}
                      </span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </TabsContent>

            <TabsContent value="history">
              <div className="h-[400px] overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-20">
                    没有历史日志
                  </p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground select-none">
                        {formatTime(log.created_at)}
                      </span>
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-400"
                            : log.level === "warn"
                            ? "text-yellow-400"
                            : "text-green-400"
                        }
                      >
                        {log.content}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
