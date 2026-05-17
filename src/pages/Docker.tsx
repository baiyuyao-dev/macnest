import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import {
  Container,
  Play,
  Square,
  RefreshCw,
  Trash2,
  FileText,
  Search,
  RotateCcw,
  Box,
  ArrowRight,
} from "lucide-react";
import type { DockerContainer } from "@/types";
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerLogs,
  getContainerStats,
} from "@/lib/api";

type ContainerState = "all" | "running" | "stopped" | "paused";

interface ContainerStats {
  containerId: string;
  cpu_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
}

const stateTabs: { value: ContainerState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "stopped", label: "已停止" },
  { value: "paused", label: "暂停" },
];

export default function Docker() {
  // ─── State ────────────────────────────────────────────────
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("-");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ContainerState>("all");
  const [statsMap, setStatsMap] = useState<Map<string, ContainerStats>>(new Map());

  // Log dialog state
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<DockerContainer | null>(null);
  const [containerLogs, setContainerLogs] = useState<string>("");
  const [logTail, setLogTail] = useState(100);
  const [logLoading, setLogLoading] = useState(false);

  // ─── Load containers ──────────────────────────────────────
  const loadContainers = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await listContainers();
      setContainers(data);
      setLastRefresh(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (error) {
      console.error("Failed to load containers:", error);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers(true);
  }, [loadContainers]);

  // Auto refresh container list every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => loadContainers(), 5000);
    return () => clearInterval(interval);
  }, [loadContainers]);

  // ─── Load stats for running containers ────────────────────
  const refreshStats = useCallback(async () => {
    const runningContainers = containers.filter((c) => c.state === "running");
    if (runningContainers.length === 0) return;

    const newStatsMap = new Map(statsMap);

    await Promise.all(
      runningContainers.map(async (container) => {
        try {
          const stats = await getContainerStats(container.container_id);
          newStatsMap.set(container.container_id, {
            containerId: container.container_id,
            cpu_percent: stats.cpu_percent,
            memory_usage_mb: stats.memory_usage_mb,
            memory_limit_mb: stats.memory_limit_mb,
            memory_percent: stats.memory_percent,
          });
        } catch (error) {
          console.error(
            `Failed to get stats for ${container.name}:`
          );
        }
      })
    );

    setStatsMap(newStatsMap);
  }, [containers]);

  useEffect(() => {
    refreshStats();
  }, [containers]);

  // Refresh stats every 5 seconds for running containers
  useEffect(() => {
    const interval = setInterval(() => refreshStats(), 5000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  // ─── Filtered containers ──────────────────────────────────
  const filteredContainers = containers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.image.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.compose_project || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesState =
      stateFilter === "all"
        ? true
        : stateFilter === "stopped"
        ? c.state === "exited" || c.state === "stopped"
        : c.state === stateFilter;
    return matchesSearch && matchesState;
  });

  // ─── Action handlers ──────────────────────────────────────
  const handleStart = async (id: string) => {
    try {
      await startContainer(id);
      loadContainers();
    } catch (error) {
      console.error("Failed to start container:", error);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await stopContainer(id);
      loadContainers();
    } catch (error) {
      console.error("Failed to stop container:", error);
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await restartContainer(id);
      loadContainers();
    } catch (error) {
      console.error("Failed to restart container:", error);
    }
  };

  const handleRemove = async (id: string, state: string) => {
    if (state === "running") {
      window.alert("请先停止容器再删除");
      return;
    }
    if (!window.confirm("确定要删除这个容器吗？此操作不可撤销。")) return;
    try {
      await removeContainer(id);
      loadContainers();
    } catch (error) {
      console.error("Failed to remove container:", error);
    }
  };

  // ─── Log handlers ─────────────────────────────────────────
  const openLogs = async (container: DockerContainer) => {
    setLogContainer(container);
    setContainerLogs("");
    setLogDialogOpen(true);
    await fetchLogs(container.container_id, logTail);
  };

  const fetchLogs = async (containerId: string, tail: number) => {
    setLogLoading(true);
    try {
      const logs = await getContainerLogs(containerId, tail);
      setContainerLogs(logs);
    } catch (error) {
      console.error("Failed to get container logs:", error);
      setContainerLogs("获取日志失败");
    } finally {
      setLogLoading(false);
    }
  };

  const handleLogTailChange = async (tail: number) => {
    setLogTail(tail);
    if (logContainer) {
      await fetchLogs(logContainer.container_id, tail);
    }
  };

  // ─── Port parsing ─────────────────────────────────────────
  const parsePorts = (portsStr: string): { host: string; container: string }[] => {
    if (!portsStr) return [];
    const result: { host: string; container: string }[] = [];
    const parts = portsStr.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Match patterns like "0.0.0.0:8080->80/tcp" or "8080:80"
      const arrowMatch = trimmed.match(/(\d+)[:\/](\d+)/);
      if (arrowMatch) {
        result.push({ host: arrowMatch[1], container: arrowMatch[2] });
      }
    }
    return result;
  };

  // ─── Status badge helper ──────────────────────────────────
  const getStateBadge = (state: string) => {
    switch (state) {
      case "running":
        return <Badge variant="success">运行中</Badge>;
      case "exited":
      case "stopped":
        return <Badge variant="destructive">已停止</Badge>;
      case "paused":
        return <Badge variant="warning">暂停</Badge>;
      default:
        return <Badge variant="outline">{state}</Badge>;
    }
  };

  // ─── Format resource display ──────────────────────────────
  const formatResource = (containerId: string) => {
    const stats = statsMap.get(containerId);
    if (!stats) return "-";
    return (
      <div className="space-y-0.5">
        <div className="text-xs">
          CPU: <span className="font-medium">{stats.cpu_percent.toFixed(1)}%</span>
        </div>
        <div className="text-xs text-muted-foreground">
          内存: {stats.memory_usage_mb.toFixed(0)}MB / {stats.memory_limit_mb.toFixed(0)}MB
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Docker 容器</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            最后刷新: {lastRefresh}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadContainers(true)}
            disabled={loading}
          >
            <RotateCcw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索容器名称 / 镜像 / Compose项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {stateTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={stateFilter === tab.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setStateFilter(tab.value)}
              className="text-xs"
            >
              {tab.label}
              {tab.value !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">
                  {containers.filter((c) => c.state === tab.value).length}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Container Table */}
      {containers.length === 0 ? (
        <Card className="py-16">
          <CardContent className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Container className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-lg font-medium">未检测到 Docker 容器</p>
              <p className="text-sm text-muted-foreground mt-1">
                请确保 Docker 正在运行，或添加容器后再查看
              </p>
            </div>
          </CardContent>
        </Card>
      ) : filteredContainers.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              没有找到匹配的容器
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table Header */}
          <div className="hidden md:grid md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] bg-muted/50">
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
              名称
            </div>
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
              镜像
            </div>
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
              状态
            </div>
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
              端口映射
            </div>
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
              资源
            </div>
            <div className="px-4 py-3 text-sm font-medium text-muted-foreground text-right">
              操作
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y">
            {filteredContainers.map((container) => (
              <div
                key={container.id}
                className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] items-center border-t px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">
                      {container.name}
                    </p>
                    {container.compose_project && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5">
                        {container.compose_project}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Image */}
                <div className="text-sm text-muted-foreground truncate">
                  {container.image}
                </div>

                {/* State */}
                <div className="py-1 md:py-0">
                  {getStateBadge(container.state)}
                </div>

                {/* Ports */}
                <div className="flex flex-wrap gap-1">
                  {container.ports
                    ? parsePorts(container.ports).map((p, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="text-[10px] h-5 px-1.5 flex items-center gap-0.5"
                        >
                          {p.host}
                          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                          {p.container}
                        </Badge>
                      ))
                    : "-"}
                </div>

                {/* Resource */}
                <div className="text-sm">
                  {container.state === "running"
                    ? formatResource(container.container_id)
                    : "-"}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1">
                  {container.state === "running" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="停止"
                      onClick={() => handleStop(container.container_id)}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="启动"
                      onClick={() => handleStart(container.container_id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="重启"
                    onClick={() => handleRestart(container.container_id)}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="查看日志"
                    onClick={() => openLogs(container)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 ${
                      container.state === "running"
                        ? "text-muted-foreground opacity-50 cursor-not-allowed"
                        : "text-destructive hover:text-destructive hover:bg-destructive/10"
                    }`}
                    title={
                      container.state === "running"
                        ? "请先停止容器"
                        : "删除"
                    }
                    onClick={() =>
                      container.state !== "running" &&
                      handleRemove(container.container_id, container.state)
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Logs Dialog ────────────────────────────────────── */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Container className="h-5 w-5" />
              容器日志 — {logContainer?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Log controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">显示行数:</span>
                <Select
                  value={String(logTail)}
                  onChange={(e) => handleLogTailChange(Number(e.target.value))}
                  className="w-20 h-8 text-xs"
                >
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  logContainer && fetchLogs(logContainer.container_id, logTail)
                }
                disabled={logLoading}
              >
                <RotateCcw
                  className={`mr-2 h-4 w-4 ${logLoading ? "animate-spin" : ""}`}
                />
                刷新日志
              </Button>
            </div>

            {/* Log display */}
            <div className="h-[400px] overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed">
              {logLoading ? (
                <p className="text-muted-foreground text-center py-20">
                  加载中...
                </p>
              ) : !containerLogs ? (
                <p className="text-muted-foreground text-center py-20">
                  暂无日志
                </p>
              ) : (
                containerLogs.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className="flex gap-2 hover:bg-white/5 px-1 rounded"
                  >
                    <span className="shrink-0 text-muted-foreground select-none w-8 text-right">
                      {i + 1}
                    </span>
                    <span className="text-green-400 break-all whitespace-pre-wrap">
                      {line}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
