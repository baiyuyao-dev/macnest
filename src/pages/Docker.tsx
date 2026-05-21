import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Container,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Search,
  RotateCcw,
  Box,
  ArrowRight,
  AlertTriangle,
  Loader2,
  Terminal,
} from "lucide-react";
import type { DockerContainer } from "@/types";
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStats,
  dockerDetectShells,
  dockerTerminalConnect,
  dockerTerminalDisconnect,
} from "@/lib/api";
import DockerTerminalDialog, { type DockerTerminalTab } from "@/components/terminal/DockerTerminalDialog";

type ContainerState = "all" | "running" | "stopped" | "paused";
type PendingAction = "starting" | "stopping" | "restarting" | "removing";

interface ContainerStats {
  containerId: string;
  cpu_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
}

const MIN_LOADING_MS = 500;

const stateTabs: { value: ContainerState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "stopped", label: "已停止" },
  { value: "paused", label: "暂停" },
];

function getStateCount(tabs: typeof stateTabs, containers: DockerContainer[], value: ContainerState): number | null {
  if (value === "all") return null;
  if (value === "stopped") return containers.filter((c) => c.state === "exited" || c.state === "stopped").length;
  return containers.filter((c) => c.state === value).length;
}

/* ── Skeletons ── */
function TableRowSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] items-center px-4 py-3">
      <div className="flex items-center gap-2 min-w-0">
        <Skeleton className="h-4 w-4 shrink-0 rounded" />
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="h-3.5 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-4 w-32 rounded-md" />
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <div className="space-y-1">
        <Skeleton className="h-3 w-20 rounded-md" />
        <Skeleton className="h-3 w-24 rounded-md" />
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  switch (state) {
    case "running":
      return <Badge className="badge-macos badge-macos-success rounded-full">运行中</Badge>;
    case "exited":
    case "stopped":
      return <Badge variant="secondary" className="text-[10px] rounded-full">已停止</Badge>;
    case "paused":
      return <Badge className="badge-macos badge-macos-warning rounded-full">暂停</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] rounded-full">{state}</Badge>;
  }
}

function ResourceCell({ containerId, statsMap }: { containerId: string; statsMap: Map<string, ContainerStats> }) {
  const stats = statsMap.get(containerId);
  if (!stats) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <div className="space-y-0.5">
      <div className="text-[11px]">
        CPU: <span className="font-medium font-mono">{stats.cpu_percent.toFixed(1)}%</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {stats.memory_usage_mb.toFixed(0)}MB / {stats.memory_limit_mb.toFixed(0)}MB
      </div>
    </div>
  );
}

export default function Docker() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("-");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ContainerState>("all");
  const [statsMap, setStatsMap] = useState<Map<string, ContainerStats>>(new Map());

  // Pending actions for visual feedback
  const [pendingActions, setPendingActions] = useState<Record<string, PendingAction>>({});

  // Delete confirm states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [containerToDelete, setContainerToDelete] = useState<DockerContainer | null>(null);

  // Terminal states
  const [terminalTabs, setTerminalTabs] = useState<DockerTerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [shellSelectorOpen, setShellSelectorOpen] = useState(false);
  const [shellSelectorContainer, setShellSelectorContainer] = useState<DockerContainer | null>(null);
  const [availableShells, setAvailableShells] = useState<string[]>([]);
  const [shellLoading, setShellLoading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContainers = useCallback(async (showSkeleton = false) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);
    try {
      const data = await listContainers();
      setContainers(data);
      setLastRefresh(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      const running = data.filter((c: DockerContainer) => c.state === "running");
      if (running.length > 0) {
        const newStatsMap = new Map<string, ContainerStats>();
        await Promise.all(
          running.map(async (container: DockerContainer) => {
            try {
              const stats = await getContainerStats(container.container_id);
              newStatsMap.set(container.container_id, {
                containerId: container.container_id,
                cpu_percent: parseFloat(stats.cpu_percent),
                memory_usage_mb: parseFloat(stats.memory_usage),
                memory_limit_mb: parseFloat(stats.memory_limit),
                memory_percent: parseFloat(stats.memory_percent),
              });
            } catch {
              /* ignore stats errors */
            }
          })
        );
        setStatsMap(newStatsMap);
      } else {
        setStatsMap(new Map());
      }
    } catch (error) {
      console.error("Failed to load containers:", error);
    } finally {
      if (showSkeleton) {
        const remain = MIN_LOADING_MS - (Date.now() - start);
        if (remain > 0) {
          timerRef.current = setTimeout(() => setInitialLoading(false), remain);
        } else {
          setInitialLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    loadContainers(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loadContainers]);

  useEffect(() => {
    const interval = setInterval(() => loadContainers(), 8000);
    return () => clearInterval(interval);
  }, [loadContainers]);

  const filteredContainers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return containers.filter((c) => {
      const matchesSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        (c.compose_project || "").toLowerCase().includes(q);
      const matchesState =
        stateFilter === "all"
          ? true
          : stateFilter === "stopped"
          ? c.state === "exited" || c.state === "stopped"
          : c.state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [containers, searchQuery, stateFilter]);

  const parsedPortsMap = useMemo(() => {
    const map = new Map<string, { host: string; container: string }[]>();
    for (const c of containers) {
      if (!c.ports) {
        map.set(c.container_id, []);
        continue;
      }
      const result: { host: string; container: string }[] = [];
      for (const part of c.ports.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const arrowMatch = trimmed.match(/(\d+)[:\/](\d+)/);
        if (arrowMatch) result.push({ host: arrowMatch[1], container: arrowMatch[2] });
      }
      map.set(c.container_id, result);
    }
    return map;
  }, [containers]);

  const setPending = (id: string, action: "starting" | "stopping" | "restarting" | "removing" | null) => {
    setPendingActions((prev) => {
      const next = { ...prev };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  };

  const handleStart = async (id: string) => {
    setPending(id, "starting");
    try {
      await startContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error) {
      console.error("Failed to start container:", error);
    } finally {
      setPending(id, null);
    }
  };

  const handleStop = async (id: string) => {
    setPending(id, "stopping");
    try {
      await stopContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error) {
      console.error("Failed to stop container:", error);
    } finally {
      setPending(id, null);
    }
  };

  const handleRestart = async (id: string) => {
    setPending(id, "restarting");
    try {
      await restartContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error) {
      console.error("Failed to restart container:", error);
    } finally {
      setPending(id, null);
    }
  };

  const openDeleteConfirm = (container: DockerContainer) => {
    if (container.state === "running") return;
    setContainerToDelete(container);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!containerToDelete) return;
    setPending(containerToDelete.container_id, "removing");
    try {
      await removeContainer(containerToDelete.container_id);
      setDeleteConfirmOpen(false);
      setContainerToDelete(null);
      loadContainers();
    } catch (error) {
      console.error("Failed to remove container:", error);
    } finally {
      setPending(containerToDelete.container_id, null);
    }
  };

  // ─── Terminal handlers ────────────────────────────────────
  const handleOpenTerminal = async (container: DockerContainer) => {
    // If already has a tab for this container, switch to it
    const existing = terminalTabs.find((t) => t.containerId === container.container_id);
    if (existing) {
      setActiveTerminalId(existing.id);
      setTerminalDialogOpen(true);
      return;
    }
    // Detect available shells
    setShellLoading(true);
    try {
      const shells = await dockerDetectShells(container.container_id);
      setAvailableShells(shells);
      if (shells.length <= 1) {
        // Only one shell (or fallback to /bin/sh), connect directly
        await connectTerminal(container, shells[0] || "/bin/sh");
      } else {
        // Show shell selector
        setShellSelectorContainer(container);
        setShellSelectorOpen(true);
      }
    } catch {
      // Fallback to /bin/sh
      await connectTerminal(container, "/bin/sh");
    } finally {
      setShellLoading(false);
    }
  };

  const connectTerminal = async (container: DockerContainer, shell: string) => {
    try {
      const res = await dockerTerminalConnect(
        container.container_id,
        container.name,
        shell
      );
      const tab: DockerTerminalTab = {
        id: res.session_id,
        containerId: container.container_id,
        containerName: container.name,
        shell,
        websocketUrl: res.websocket_url,
      };
      setTerminalTabs((prev) => [...prev, tab]);
      setActiveTerminalId(tab.id);
      setTerminalDialogOpen(true);
      setShellSelectorOpen(false);
    } catch (error) {
      console.error("Failed to connect terminal:", error);
    }
  };

  const handleCloseTerminalTab = async (tabId: string) => {
    try {
      await dockerTerminalDisconnect(tabId);
    } catch {
      // ignore disconnect errors
    }
    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTerminalId === tabId) {
        setActiveTerminalId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  const handleTerminalDialogClose = (open: boolean) => {
    setTerminalDialogOpen(open);
    if (!open) {
      // Disconnect all sessions when dialog closes
      for (const tab of terminalTabs) {
        dockerTerminalDisconnect(tab.id).catch(() => {});
      }
      setTerminalTabs([]);
      setActiveTerminalId(null);
    }
  };


  return (
    <div className="p-6 space-y-5 animate-page-enter">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Docker 容器</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理本地 Docker 容器</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">最后刷新: {lastRefresh}</span>
          <Button variant="outline" size="sm" className="btn-macos-secondary rounded-xl h-8 text-xs" onClick={() => loadContainers(true)} disabled={loading}>
            <RotateCcw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="搜索容器名称 / 镜像 / Compose项目..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input-macos pl-10" />
        </div>
        <div className="flex gap-1 p-0.5 rounded-xl bg-muted/50">
          {stateTabs.map((tab) => (
            <Button key={tab.value} variant={stateFilter === tab.value ? "default" : "ghost"} size="sm" onClick={() => setStateFilter(tab.value)}
              className={`text-xs rounded-lg transition-all duration-200 ${stateFilter === tab.value ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground hover:text-foreground"}`}
            >
              {tab.label}
              {tab.value !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">{getStateCount(stateTabs, containers, tab.value)}</span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Container Table */}
      {initialLoading ? (
        <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="hidden md:grid md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] bg-muted/30 border-b border-[var(--glass-border)]">
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">镜像</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">状态</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">端口映射</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">资源</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
          </div>
          <div className="divide-y divide-[var(--glass-border)]">
            <TableRowSkeleton />
            <TableRowSkeleton />
            <TableRowSkeleton />
            <TableRowSkeleton />
            <TableRowSkeleton />
          </div>
        </div>
      ) : containers.length === 0 ? (
        <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Container className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-medium">未检测到 Docker 容器</p>
              <p className="text-xs text-muted-foreground mt-1">请确保 Docker 正在运行</p>
            </div>
          </div>
        </div>
      ) : filteredContainers.length === 0 ? (
        <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的容器</p>
          </div>
        </div>
      ) : (
        <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "100ms" }}>
          {/* Table Header */}
          <div className="hidden md:grid md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] bg-muted/30 border-b border-[var(--glass-border)]">
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">镜像</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">状态</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">端口映射</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">资源</div>
            <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-[var(--glass-border)]">
            {filteredContainers.map((container) => (
              <div key={container.id} className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] items-center px-4 py-3 hover:bg-accent/30 transition-colors group">
                <div className="flex items-center gap-2 min-w-0">
                  <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">{container.name}</p>
                    {container.compose_project && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5 rounded-full">{container.compose_project}</Badge>
                    )}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground truncate">{container.image}</div>
                <div className="py-1 md:py-0"><StateBadge state={container.state} /></div>
                <div className="flex flex-wrap gap-1">
                  {(parsedPortsMap.get(container.container_id) ?? []).length > 0 ? (parsedPortsMap.get(container.container_id) ?? []).map((p, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] h-5 px-1.5 flex items-center gap-0.5 rounded-full font-mono">
                      {p.host}<ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />{p.container}
                    </Badge>
                  )) : "-"}
                </div>
                <div className="text-sm">{container.state === "running" ? <ResourceCell containerId={container.container_id} statsMap={statsMap} /> : "-"}</div>
                <div className="flex items-center justify-end gap-0.5">
                  {container.state === "running" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-secondary/60" title="终端"
                      disabled={shellLoading} onClick={() => handleOpenTerminal(container)}
                    >
                      {shellLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                    </Button>
                  )}
                  {container.state === "running" ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-600" title="停止"
                      disabled={!!pendingActions[container.container_id]} onClick={() => handleStop(container.container_id)}
                    >
                      {pendingActions[container.container_id] === "stopping" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600" title="启动"
                      disabled={!!pendingActions[container.container_id]} onClick={() => handleStart(container.container_id)}
                    >
                      {pendingActions[container.container_id] === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" title="重启"
                    disabled={!!pendingActions[container.container_id]} onClick={() => handleRestart(container.container_id)}
                  >
                    {pendingActions[container.container_id] === "restarting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon"
                    className={`h-8 w-8 rounded-lg ${container.state === "running" ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                    title={container.state === "running" ? "请先停止容器" : "删除"}
                    disabled={container.state === "running" || !!pendingActions[container.container_id]}
                    onClick={() => openDeleteConfirm(container)}
                  >
                    {pendingActions[container.container_id] === "removing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Delete Confirm Dialog ─────────────────────────── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除容器
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除容器 <span className="font-medium text-foreground">{containerToDelete?.name}</span> 吗？此操作不可撤销。
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

      {/* ─── Shell Selector Dialog ─────────────────────────── */}
      <Dialog open={shellSelectorOpen} onOpenChange={setShellSelectorOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Terminal className="h-4 w-4" />
              选择 Shell — {shellSelectorContainer?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {availableShells.map((shell) => (
              <Button
                key={shell}
                variant="outline"
                className="w-full justify-start text-xs rounded-lg font-mono"
                onClick={() => shellSelectorContainer && connectTerminal(shellSelectorContainer, shell)}
              >
                {shell}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Docker Terminal Dialog ────────────────────────── */}
      <DockerTerminalDialog
        open={terminalDialogOpen}
        onOpenChange={handleTerminalDialogClose}
        tabs={terminalTabs}
        activeTabId={activeTerminalId}
        onActiveTabChange={setActiveTerminalId}
        onCloseTab={handleCloseTerminalTab}
      />
    </div>
  );
}
