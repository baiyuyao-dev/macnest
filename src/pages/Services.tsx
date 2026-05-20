import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Server,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Plus,
  Pencil,
  Search,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type { Service } from "@/types";
import {
  listServices,
  createService,
  updateService,
  deleteService,
  startService,
  stopService,
  restartService,
} from "@/lib/api";

type ServiceStatus = "all" | "running" | "stopped" | "error" | "restarting";

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

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);

  // Pending action states for visual feedback
  const [pendingActions, setPendingActions] = useState<Record<number, "starting" | "stopping" | "restarting">>({});

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
  const filteredServices = useMemo(() => services.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [services, searchQuery, statusFilter]);

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
    setPendingActions((prev) => ({ ...prev, [id]: "starting" }));
    try {
      await startService(id);
      await loadServices();
    } catch (error) {
      console.error("Failed to start service:", error);
    } finally {
      setPendingActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleStop = async (id: number) => {
    setPendingActions((prev) => ({ ...prev, [id]: "stopping" }));
    try {
      await stopService(id);
      await loadServices();
    } catch (error) {
      console.error("Failed to stop service:", error);
    } finally {
      setPendingActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleRestart = async (id: number) => {
    setPendingActions((prev) => ({ ...prev, [id]: "restarting" }));
    try {
      await restartService(id);
      await loadServices();
    } catch (error) {
      console.error("Failed to restart service:", error);
    } finally {
      setPendingActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const openDeleteConfirm = (service: Service) => {
    setServiceToDelete(service);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!serviceToDelete) return;
    try {
      await deleteService(serviceToDelete.id);
      setDeleteConfirmOpen(false);
      setServiceToDelete(null);
      loadServices();
    } catch (error) {
      console.error("Failed to delete service:", error);
    }
  };

  // ─── Status badge helper ──────────────────────────────────
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="badge-macos badge-macos-success rounded-full">运行中</Badge>;
      case "stopped":
        return <Badge variant="secondary" className="text-[10px] rounded-full">已停止</Badge>;
      case "error":
        return <Badge className="badge-macos badge-macos-danger rounded-full">错误</Badge>;
      case "restarting":
        return <Badge className="badge-macos badge-macos-warning rounded-full">重启中</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] rounded-full">未知</Badge>;
    }
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
    <div className="p-6 space-y-5 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">服务管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理本地进程服务的启动、停止与监控</p>
        </div>
        <Button className="btn-macos rounded-xl" onClick={openCreateDialog}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          添加服务
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索服务名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-macos pl-10"
          />
        </div>
        <div className="flex gap-1 p-0.5 rounded-xl bg-muted/50">
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(tab.value)}
              className={`text-xs rounded-lg transition-all duration-200 ${statusFilter === tab.value ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground hover:text-foreground"}`}
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
        <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-medium">还没有服务</p>
              <p className="text-xs text-muted-foreground mt-1">添加第一个服务来开始管理</p>
            </div>
            <Button className="btn-macos mt-2 rounded-xl" onClick={openCreateDialog}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              添加第一个服务
            </Button>
          </div>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的服务</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
          {filteredServices.map((service, index) => (
            <div
              key={service.id}
              className="card-macos p-4 flex flex-col group animate-slide-up"
              style={{ animationDelay: `${150 + index * 40}ms` }}
            >
              {/* Top: Name + Status */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-sm truncate" title={service.name}>{service.name}</h3>
                {getStatusBadge(service.status)}
              </div>

              {/* Description */}
              {service.description && (
                <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{service.description}</p>
              )}

              {/* Command block */}
              <div className="mt-3 rounded-lg bg-muted/60 px-2.5 py-1.5 overflow-hidden border border-[var(--glass-border)]">
                <code className="text-[11px] font-mono text-muted-foreground truncate block">{service.command || "无命令"}</code>
              </div>

              {/* Spacer */}
              <div className="flex-1 min-h-[8px]" />

              {/* Action buttons */}
              <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center gap-0.5">
                {service.status === "running" ? (
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-600" title="停止"
                    disabled={!!pendingActions[service.id]} onClick={() => handleStop(service.id)}
                  >
                    {pendingActions[service.id] === "stopping" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600" title="启动"
                    disabled={!!pendingActions[service.id]} onClick={() => handleStart(service.id)}
                  >
                    {pendingActions[service.id] === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" title="重启"
                  disabled={!!pendingActions[service.id]} onClick={() => handleRestart(service.id)}
                >
                  {pendingActions[service.id] === "restarting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60" title="编辑"
                  disabled={!!pendingActions[service.id]} onClick={() => openEditDialog(service)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10" title="删除"
                  disabled={!!pendingActions[service.id]} onClick={() => openDeleteConfirm(service)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Create/Edit Dialog ─────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[36rem] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{isEditing ? "编辑服务" : "添加服务"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="svc-name" className="text-xs">名称 <span className="text-destructive">*</span></Label>
              <Input id="svc-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="如: frpc 内网穿透" className="input-macos" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-desc" className="text-xs">描述</Label>
              <Textarea id="svc-desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="服务的简要描述..." rows={2} className="input-macos" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-cmd" className="text-xs">启动命令 <span className="text-destructive">*</span></Label>
              <Textarea id="svc-cmd" value={formData.command} onChange={(e) => setFormData({ ...formData, command: e.target.value })} placeholder="如: /usr/local/bin/frpc -c ~/.frp/frpc.toml" rows={2} className="input-macos" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="svc-cwd" className="text-xs">工作目录</Label>
                <Input id="svc-cwd" value={formData.cwd} onChange={(e) => setFormData({ ...formData, cwd: e.target.value })} placeholder="如: /Users/xxx/projects" className="input-macos" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-env" className="text-xs">环境变量 (JSON)</Label>
                <Input id="svc-env" value={formData.env_vars} onChange={(e) => setFormData({ ...formData, env_vars: e.target.value })} placeholder='{"KEY": "value"}' className="input-macos font-mono text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="svc-policy" className="text-xs">重启策略</Label>
                <select id="svc-policy" value={formData.restart_policy} onChange={(e) => setFormData({ ...formData, restart_policy: e.target.value as "always" | "on-failure" | "never" })}
                  className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all"
                >
                  <option value="always">{restartPolicyLabels.always}</option>
                  <option value="on-failure">{restartPolicyLabels["on-failure"]}</option>
                  <option value="never">{restartPolicyLabels.never}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-max" className="text-xs">最大重启次数</Label>
                <Input id="svc-max" type="number" min={0} max={20} value={formData.max_restarts} onChange={(e) => setFormData({ ...formData, max_restarts: parseInt(e.target.value) || 0 })} className="input-macos" />
              </div>
            </div>
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={formData.auto_start} onChange={(e) => setFormData({ ...formData, auto_start: e.target.checked })} className="rounded border-border" />
                自动启动
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={formData.port_auto_detect} onChange={(e) => setFormData({ ...formData, port_auto_detect: e.target.checked })} className="rounded border-border" />
                自动检测端口
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--glass-border)]">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleSave} disabled={!formData.name.trim() || !formData.command.trim()}>
                {isEditing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm Dialog ─────────────────────────── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除服务
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除服务 <span className="font-medium text-foreground">{serviceToDelete?.name}</span> 吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
