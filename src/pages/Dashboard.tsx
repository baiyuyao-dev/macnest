import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Server,
  Container,
  Bookmark,
  Clock,
  ExternalLink,
  Plus,
} from "lucide-react";
import {
  listServices,
  listContainers,
  listBookmarks,
  listGroups,
  getSystemInfo,
} from "@/lib/api";
import { formatUptime, formatBytes, statusVariant } from "@/lib/utils";
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
  const [initialLoading, setInitialLoading] = useState(true);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (showSkeleton: boolean) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);

    try {
      const [svcList, ctrList, bmList, gpList, sysInfo] = await Promise.all([
        listServices().catch(() => [] as Service[]),
        listContainers().catch(() => [] as DockerContainer[]),
        listBookmarks().catch(() => [] as BookmarkType[]),
        listGroups().catch(() => [] as Group[]),
        getSystemInfo().catch(() => null),
      ]);
      setServices(svcList);
      setContainers(ctrList);
      setBookmarks(bmList);
      setGroups(gpList);
      setSystemInfo(sysInfo);
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
        <div className="grid grid-cols-4 gap-4">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Server} label="运行中服务" value={`${runningServices}`} sub={`/ ${services.length} 个`} colorClass="text-emerald-500" />
          <StatCard icon={Container} label="Docker 容器" value={`${runningContainers}`} sub={`/ ${containers.length} 个`} colorClass="text-blue-500" />
          <StatCard icon={Bookmark} label="书签数量" value={bookmarks.length} colorClass="text-amber-500" />
          <StatCard icon={Clock} label="系统运行时间" value={systemInfo ? formatUptime(systemInfo.uptime_seconds) : "-"} colorClass="text-purple-500" />
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
            ) : (
              <div className="space-y-2">
                {services.slice(0, 5).map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent">
                    <div className="flex items-center gap-3">
                      <Badge variant={statusVariant(svc.status)} className="text-[10px]">
                        {svc.status === "running" ? "运行中" : svc.status === "error" ? "错误" : svc.status === "restarting" ? "重启中" : "已停止"}
                      </Badge>
                      <span className="text-sm font-medium">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {svc.ports && <span>端口 {svc.ports}</span>}
                      {svc.status === "running" && (
                        <>
                          <span>CPU {svc.cpu_percent?.toFixed(1)}%</span>
                          <span>内存 {svc.memory_mb?.toFixed(0)}MB</span>
                        </>
                      )}
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
    </div>
  );
}
