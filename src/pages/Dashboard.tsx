import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  Terminal,
  LayoutGrid,
  ChevronRight,
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
  tmuxListSessions,
  getActiveSshSessionsCount,
} from "@/lib/api";
import { formatBytes, statusVariant } from "@/lib/utils";
import type { Service, DockerContainer, Bookmark as BookmarkType, Group, SystemInfo } from "@/types";

const MIN_LOADING_MS = 500;

/* ── Skeletons ── */
function StatCardSkeleton() {
  return (
    <div className="card-macos p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2.5 w-full">
          <Skeleton className="h-3.5 w-20 rounded-md" />
          <Skeleton className="h-8 w-14 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
    </div>
  );
}

function ServiceRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-3 w-16 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
        <Skeleton className="h-3 w-14 rounded-md" />
      </div>
    </div>
  );
}

function BookmarkCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
        <Skeleton className="h-4 w-full rounded-md" />
      </div>
      <Skeleton className="h-3 w-10 rounded-full ml-10" />
      <Skeleton className="h-3 w-20 ml-10 rounded-md" />
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
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
  delay: number;
}) {
  return (
    <div
      className="card-macos p-5 cursor-default"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground tracking-wide">{label}</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[26px] font-bold tracking-tight ${colorClass || ""}`}>{value}</span>
            {sub && <span className="text-xs font-medium text-muted-foreground">{sub}</span>}
          </div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${colorClass ? colorClass.replace("text-", "bg-") + "/10" : "bg-muted"} ${colorClass || "text-muted-foreground"}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
    </div>
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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (showSkeleton: boolean) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);

    try {
      const [svcList, ctrList, bmList, gpList, sysInfo, tmuxList, sshCount, sshConns] = await Promise.all([
        listServices().catch(() => [] as Service[]),
        listContainers().catch(() => [] as DockerContainer[]),
        listBookmarks().catch(() => [] as BookmarkType[]),
        listGroups("bookmark").catch(() => [] as Group[]),
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

  const runningServices = useMemo(
    () => services.filter((s) => s.status === "running").length,
    [services]
  );
  const runningContainers = useMemo(
    () => containers.filter((c) => c.state === "running").length,
    [containers]
  );

  return (
    <div className="space-y-6 p-6 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up" style={{ animationDelay: "0ms" }}>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">仪表盘</h1>
          <p className="text-xs text-muted-foreground mt-0.5">概览系统运行状态</p>
        </div>
        <Badge variant="outline" className="text-[10px] font-medium px-2.5 py-0.5 rounded-full glass">
          v0.2.0
        </Badge>
      </div>

      {/* Stats */}
      {initialLoading ? (
        <div className="grid grid-cols-3 gap-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Server} label="运行中服务" value={`${runningServices}`} sub={`/ ${services.length}`} colorClass="text-emerald-500" delay={50} />
          <StatCard icon={Container} label="Docker 容器" value={`${runningContainers}`} sub={`/ ${containers.length}`} colorClass="text-blue-500" delay={100} />
          <StatCard icon={Bookmark} label="书签数量" value={bookmarks.length} colorClass="text-amber-500" delay={150} />
          <StatCard icon={Globe} label="本机 IP" value={systemInfo?.local_ip || "-"} colorClass="text-purple-500" delay={200} />
          <StatCard icon={LayoutGrid} label="Tmux 会话" value={tmuxSessions} colorClass="text-cyan-500" delay={250} />
          <StatCard icon={Terminal} label="SSH 终端" value={`${sshSessionCount}`} sub={`/ ${sshConnections}`} colorClass="text-rose-500" delay={300} />
        </div>
      )}

      {/* Services + Bookmarks */}
      <div className="grid grid-cols-2 gap-4">
        {/* Services Card */}
        <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "350ms" }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
            <h3 className="flex items-center text-sm font-semibold tracking-tight">
              <Server className="mr-2 h-4 w-4 text-muted-foreground" />
              服务状态
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs font-medium hover:bg-secondary/60" onClick={() => navigate("/services")}>
              查看全部 <ChevronRight className="ml-0.5 h-3 w-3" />
            </Button>
          </div>
          <div className="p-3">
            {initialLoading ? (
              <div className="space-y-1">
                <ServiceRowSkeleton />
                <ServiceRowSkeleton />
                <ServiceRowSkeleton />
                <ServiceRowSkeleton />
                <ServiceRowSkeleton />
              </div>
            ) : services.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Server className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">还没有添加服务</p>
                  <p className="text-xs text-muted-foreground mt-0.5">添加本地进程服务，方便一键启动/停止</p>
                </div>
                <Button size="sm" className="btn-macos mt-1" onClick={() => navigate("/services")}>
                  <Plus className="mr-1 h-3 w-3" />添加服务
                </Button>
              </div>
            ) : services.filter((s) => s.status === "running").length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Server className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">暂无运行中服务</p>
                  <p className="text-xs text-muted-foreground mt-0.5">所有服务当前均已停止</p>
                </div>
                <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate("/services")}>
                  <Play className="mr-1 h-3 w-3" />去启动服务
                </Button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {services.filter((s) => s.status === "running").slice(0, 5).map((svc) => (
                  <div
                    key={svc.id}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-accent/50 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant={statusVariant(svc.status)} className="text-[10px] shrink-0 font-semibold px-2 py-0.5 rounded-full">
                        运行中
                      </Badge>
                      <span className="text-sm font-medium truncate">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {svc.ports && <span className="text-[11px] text-muted-foreground hidden sm:inline font-mono">:{svc.ports}</span>}
                      <span className="text-[11px] text-muted-foreground hidden sm:inline font-mono">{svc.cpu_percent?.toFixed(1)}%</span>
                      <span className="text-[11px] text-muted-foreground hidden sm:inline font-mono">{svc.memory_mb?.toFixed(0)}MB</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-600" onClick={() => handleStop(svc.id)} title="终止">
                        <Square className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" onClick={() => handleRestart(svc.id)} title="重启">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bookmarks Card */}
        <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "400ms" }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
            <h3 className="flex items-center text-sm font-semibold tracking-tight">
              <Bookmark className="mr-2 h-4 w-4 text-muted-foreground" />
              快速访问
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs font-medium hover:bg-secondary/60" onClick={() => navigate("/bookmarks")}>
              查看全部 <ChevronRight className="ml-0.5 h-3 w-3" />
            </Button>
          </div>
          <div className="p-3">
            {initialLoading ? (
              <div className="grid grid-cols-2 gap-3">
                <BookmarkCardSkeleton />
                <BookmarkCardSkeleton />
                <BookmarkCardSkeleton />
                <BookmarkCardSkeleton />
                <BookmarkCardSkeleton />
                <BookmarkCardSkeleton />
              </div>
            ) : bookmarks.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Bookmark className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">还没有添加书签</p>
                  <p className="text-xs text-muted-foreground mt-0.5">添加常用服务链接，快速访问</p>
                </div>
                <Button size="sm" className="btn-macos mt-1" onClick={() => navigate("/bookmarks")}>
                  <Plus className="mr-1 h-3 w-3" />添加书签
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {bookmarks.slice(0, 6).map((bm) => (
                  <a
                    key={bm.id}
                    href={bm.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col gap-1.5 rounded-xl border border-transparent p-3 transition-all duration-300 hover:bg-accent/40 hover:border-[var(--glass-border-strong)] hover:shadow-glass"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                        {bm.icon ? <img src={bm.icon} alt="" className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                      </div>
                      <p className="truncate text-sm font-medium group-hover:text-accent-foreground transition-colors">{bm.name}</p>
                    </div>
                    {bm.group_id && (
                      <div className="pl-10">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 w-fit rounded-full">
                          {groups.find(g => g.id === bm.group_id)?.name || "未分组"}
                        </Badge>
                      </div>
                    )}
                    <p className="pl-10 truncate text-[10px] text-muted-foreground font-mono">
                      {bm.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
