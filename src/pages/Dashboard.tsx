import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Card, CardContent } from "@/components/ui/card";
import LogList, { type LogEntry } from "@/components/LogList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Server,
  Container,
  Bookmark,
  Globe,
  ExternalLink,
  Plus,
  Play,
  Square,
  RefreshCw,
  FileText,
  RotateCcw,
  XCircle,
  Terminal,
  LayoutGrid,
} from "lucide-react";
import {
  listServices,
  listContainers,
  listBookmarks,
  listGroups,
  listSshConnections,
  getSystemInfo,
  startService,
  stopService,
  restartService,
  getServiceLogs,
  tmuxListSessions,
  getActiveSshSessionsCount,
} from "@/lib/api";
import { formatBytes, statusVariant } from "@/lib/utils";
import type { Service, DockerContainer, Bookmark as BookmarkType, Group, SystemInfo } from "@/types";

const MIN_LOADING_MS = 400;

/* ── Skeletons ── */
function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 w-full">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

function BookmarkCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-3 w-10 rounded-full ml-9.5" />
      <Skeleton className="h-3 w-20 ml-9.5" />
    </div>
  );
}

/* ── Stat card ── */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${colorClass || ""}`}>{value}</span>
              {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
            </div>
          </div>
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main ── */
export default function Dashboard() {
  const navigate = useNavigate();

  const [services, setServices] = useState<Service[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [tmuxSessions, setTmuxSessions] = useState(0);
  const [sshSessionCount, setSshSessionCount] = useState(0);
  const [sshConnections, setSshConnections] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);

  // Log states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logService, setLogService] = useState<Service | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logTab, setLogTab] = useState("realtime");
  const [isListening, setIsListening] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (showSkeleton: boolean) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);

    try {
      const [svcList, ctrList, bmList, gpList, sysInfo, tmuxList, sshCount, sshConns] = await Promise.all([
        listServices().catch(() => [] as Service[]),
        listContainers().catch(() => [] as DockerContainer[]),
        listBookmarks().catch(() => [] as BookmarkType[]),
        listGroups().catch(() => [] as Group[]),
        getSystemInfo().catch(() => null),
        tmuxListSessions().catch(() => []),
        getActiveSshSessionsCount().catch(() => 0),
        listSshConnections().catch(() => []),
      ]);
      setServices(svcList);
      setContainers(ctrList);
      setBookmarks(bmList);
      setGroups(gpList);
      setSystemInfo(sysInfo);
      setTmuxSessions(tmuxList.length);
      setSshSessionCount(sshCount);
      setSshConnections(sshConns.length);
    } catch (err) {
      console.error("Dashboard load error:", err);
    }

    if (showSkeleton) {
      const remain = MIN_LOADING_MS - (Date.now() - start);
      if (remain > 0) {
        timerRef.current = setTimeout(() => setInitialLoading(false), remain);
      } else {
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadData(false);
      }
    }, 5000);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loadData]);

  // ─── Real-time log listener ───────────────────────────────
  useEffect(() => {
    if (!logDialogOpen || !logService) return;

    const setupListener = async () => {
      try {
        const unlisten = await listen(`service:log:${logService.id}`, (event) => {
          setLogs((prev) => {
            const next = [...prev, {
              content: event.payload as string,
              level: "info",
              created_at: new Date().toISOString(),
            }];
            return next.length > 1000 ? next.slice(-1000) : next;
          });
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

  // ─── Service action handlers ──────────────────────────────
  const handleStart = async (id: number) => {
    try {
      await startService(id);
      loadData(false);
    } catch (error) {
      console.error("Failed to start service:", error);
    }
  };

  const handleStop = async (id: number) => {
    try {
      await stopService(id);
      loadData(false);
    } catch (error) {
      console.error("Failed to stop service:", error);
    }
  };

  const handleRestart = async (id: number) => {
    try {
      await restartService(id);
      loadData(false);
    } catch (error) {
      console.error("Failed to restart service:", error);
    }
  };

  const openLogs = async (service: Service) => {
    setLogService(service);
    setLogs([]);
    setLogTab("realtime");
    setLogDialogOpen(true);

    try {
      const historicalLogs = await getServiceLogs(service.id);
      const formatted = historicalLogs.map((l: { content: string; level: string; created_at: string }) => ({
        content: l.content,
        level: l.level,
        created_at: l.created_at,
      }));
      setLogs(formatted);
    } catch (error) {
      console.error("Failed to load historical logs:", error);
    }
  };

  const clearLogs = () => setLogs([]);


  const runningServices = services.filter((s) => s.status === "running").length;
  const runningContainers = containers.filter((c) => c.state === "running").length;

  return (
    <div className="space-y-6 p-6 page-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <Badge variant="outline">v0.1.0</Badge>
      </div>

      {/* Stats */}
      {initialLoading ? (
        <div className="grid grid-cols-3 gap-4">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Server} label="运行中服务" value={`${runningServices}`} sub={`/ ${services.length} 个`} colorClass="text-emerald-500" />
          <StatCard icon={Container} label="Docker 容器" value={`${runningContainers}`} sub={`/ ${containers.length} 个`} colorClass="text-blue-500" />
          <StatCard icon={Bookmark} label="书签数量" value={bookmarks.length} colorClass="text-amber-500" />
          <StatCard icon={Globe} label="本机 IP" value={systemInfo?.local_ip || "-"} colorClass="text-purple-500" />
          <StatCard icon={LayoutGrid} label="Tmux 会话" value={tmuxSessions} colorClass="text-cyan-500" />
          <StatCard icon={Terminal} label="SSH 终端" value={`${sshSessionCount}`} sub={`/ ${sshConnections} 个`} colorClass="text-rose-500" />
        </div>
      )}

      {/* Services + Bookmarks */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between p-6 pb-2">
            <h3 className="flex items-center text-base font-semibold">
              <Server className="mr-2 h-4 w-4" />
              服务状态
            </h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/services")}>查看全部</Button>
          </div>
          <CardContent>
            {initialLoading ? (
              <div className="space-y-2">
                <ServiceRowSkeleton /><ServiceRowSkeleton /><ServiceRowSkeleton />
                <ServiceRowSkeleton /><ServiceRowSkeleton />
              </div>
            ) : services.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Server className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">还没有添加服务</p>
                  <p className="text-xs text-muted-foreground">添加本地进程服务，方便一键启动/停止</p>
                </div>
                <Button size="sm" onClick={() => navigate("/services")}>
                  <Plus className="mr-1 h-3 w-3" />添加服务
                </Button>
              </div>
            ) : services.filter((s) => s.status === "running").length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Server className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">暂无运行中服务</p>
                  <p className="text-xs text-muted-foreground">所有服务当前均已停止</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate("/services")}>
                  <Play className="mr-1 h-3 w-3" />去启动服务
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {services.filter((s) => s.status === "running").slice(0, 5).map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant={statusVariant(svc.status)} className="text-[10px] shrink-0">
                        运行中
                      </Badge>
                      <span className="text-sm font-medium truncate">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {svc.ports && <span className="text-xs text-muted-foreground hidden sm:inline">端口 {svc.ports}</span>}
                      <span className="text-xs text-muted-foreground hidden sm:inline">CPU {svc.cpu_percent?.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">内存 {svc.memory_mb?.toFixed(0)}MB</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStop(svc.id)} title="终止">
                        <Square className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRestart(svc.id)} title="重启">
                        <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLogs(svc)} title="日志">
                        <FileText className="h-3.5 w-3.5 text-blue-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <div className="flex items-center justify-between p-6 pb-2">
            <h3 className="flex items-center text-base font-semibold">
              <Bookmark className="mr-2 h-4 w-4" />
              快速访问
            </h3>
            <Button variant="ghost" size="sm" onClick={() => navigate("/bookmarks")}>查看全部</Button>
          </div>
          <CardContent>
            {initialLoading ? (
              <div className="grid grid-cols-2 gap-3">
                <BookmarkCardSkeleton /><BookmarkCardSkeleton /><BookmarkCardSkeleton />
                <BookmarkCardSkeleton /><BookmarkCardSkeleton /><BookmarkCardSkeleton />
              </div>
            ) : bookmarks.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Bookmark className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">还没有添加书签</p>
                  <p className="text-xs text-muted-foreground">添加常用服务链接，快速访问</p>
                </div>
                <Button size="sm" onClick={() => navigate("/bookmarks")}>
                  <Plus className="mr-1 h-3 w-3" />添加书签
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {bookmarks.slice(0, 6).map((bm) => (
                  <a
                    key={bm.id}
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-1.5 rounded-md border p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        {bm.icon ? <img src={bm.icon} alt="" className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                      </div>
                      <p className="truncate text-sm font-medium group-hover:text-accent-foreground">{bm.name}</p>
                    </div>
                    {bm.group_id && (
                      <div className="pl-9.5">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-fit">
                          {groups.find(g => g.id === bm.group_id)?.name || "未分组"}
                        </Badge>
                      </div>
                    )}
                    <p className="pl-9.5 truncate text-[10px] text-muted-foreground">
                      {bm.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
              <LogList
                logs={logs}
                emptyMessage="等待日志输出..."
                className="h-[400px] overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed"
                timestampClassName="shrink-0 text-muted-foreground select-none"
              />
            </TabsContent>

            <TabsContent value="history">
              <LogList
                logs={logs}
                emptyMessage="没有历史日志"
                className="h-[400px] overflow-y-auto rounded-md bg-black/80 p-3 font-mono text-xs leading-relaxed"
                timestampClassName="shrink-0 text-muted-foreground select-none"
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
