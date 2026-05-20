import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Computer,
  Cpu,
  MemoryStick,
  Activity,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { getSystemInfo, getResourceUsage, getProcesses } from "@/lib/api";
import { formatUptime, formatBytes, processStatusVariant } from "@/lib/utils";
import type { SystemInfo as SystemInfoType, ProcessInfo } from "@/types";

/* ------------------------------------------------------------------ */
/* 骨架屏                                                              */
/* ------------------------------------------------------------------ */
const MIN_LOADING_MS = 200;

function InfoRowSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-3 w-16 rounded-md" />
      <Skeleton className="h-4 w-24 rounded-md" />
    </div>
  );
}

function ProcessRowSkeleton() {
  return (
    <div className="grid grid-cols-[4rem_1fr_3.5rem_4.5rem_4rem_1fr] gap-3 rounded-xl px-3 py-2.5">
      <Skeleton className="h-3 rounded-md" />
      <Skeleton className="h-4 rounded-md" />
      <Skeleton className="h-3 rounded-md ml-auto" />
      <Skeleton className="h-3 rounded-md ml-auto" />
      <Skeleton className="h-5 w-16 rounded-full mx-auto" />
      <Skeleton className="h-3 rounded-md" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 数据点（最多保留 30 个）                                               */
/* ------------------------------------------------------------------ */
interface ChartPoint {
  time: string;
  cpu: number;
  memory: number;
}

const MAX_POINTS = 30;

function formatTime(date: Date) {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* 深色模式图表 Tooltip                                                   */
/* ------------------------------------------------------------------ */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-macos">
      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="text-xs font-medium" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                              */
/* ------------------------------------------------------------------ */
export default function System() {
  const [systemInfo, setSystemInfo] = useState<SystemInfoType | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [resourceUsage, setResourceUsage] = useState({
    cpu_percent: 0,
    memory_percent: 0,
    memory_used_mb: 0,
    memory_total_mb: 0,
    disk_percent: 0,
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const dataRef = useRef<ChartPoint[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSystemInfo = useCallback(async () => {
    try {
      const info = await getSystemInfo();
      setSystemInfo(info);
    } catch (err) {
      console.error("Failed to load system info:", err);
    }
  }, []);

  const loadResourceUsage = useCallback(async () => {
    try {
      const res = await getResourceUsage();
      setResourceUsage(res);
      const now = new Date();
      const newPoint: ChartPoint = {
        time: formatTime(now),
        cpu: res.cpu_percent,
        memory: res.memory_percent,
      };
      const updated = [...dataRef.current, newPoint];
      if (updated.length > MAX_POINTS) {
        updated.shift();
      }
      dataRef.current = updated;
      setChartData([...updated]);
    } catch (err) {
      console.error("Failed to load resource usage:", err);
    }
  }, []);

  const loadProcesses = useCallback(async () => {
    try {
      const procs = await getProcesses();
      setProcesses(procs.slice(0, 10));
    } catch (err) {
      console.error("Failed to load processes:", err);
    }
  }, []);

  const loadData = useCallback(async (showSkeleton: boolean) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);
    await Promise.all([
      loadSystemInfo(),
      loadResourceUsage(),
      loadProcesses(),
    ]);
    if (showSkeleton) {
      const remain = MIN_LOADING_MS - (Date.now() - start);
      if (remain > 0) {
        timerRef.current = setTimeout(() => setInitialLoading(false), remain);
      } else {
        setInitialLoading(false);
      }
    }
  }, [loadSystemInfo, loadResourceUsage, loadProcesses]);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadResourceUsage();
        loadProcesses();
      }
    }, 3000);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loadData, loadResourceUsage, loadProcesses]);

  return (
    <div className="flex flex-col gap-5 p-6 h-full animate-page-enter">
      {/* Header */}
      <div className="animate-slide-up">
        <h1 className="text-[22px] font-bold tracking-tight">系统监控</h1>
        <p className="text-xs text-muted-foreground mt-0.5">实时查看 macOS 系统资源与进程状态</p>
      </div>

      {/* 系统信息卡片 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
          <h3 className="flex items-center text-sm font-semibold tracking-tight">
            <Computer className="mr-2 h-4 w-4 text-muted-foreground" />
            系统信息
          </h3>
          <p className="text-[11px] text-muted-foreground">macOS 硬件与软件信息</p>
        </div>
        <div className="p-5">
          {initialLoading ? (
            <div className="grid grid-cols-5 gap-4">
              <InfoRowSkeleton /><InfoRowSkeleton /><InfoRowSkeleton /><InfoRowSkeleton /><InfoRowSkeleton />
            </div>
          ) : systemInfo ? (
            <div className="grid grid-cols-5 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground font-medium">主机名</p>
                <p className="text-sm font-semibold">{systemInfo.hostname}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground font-medium">macOS 版本</p>
                <p className="text-sm font-semibold">{systemInfo.os_version}</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center text-[11px] text-muted-foreground font-medium">
                  <Cpu className="mr-1 h-3 w-3" />
                  CPU 型号
                </p>
                <p className="text-sm font-semibold">{systemInfo.cpu_model}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground font-medium">CPU 核心数</p>
                <p className="text-sm font-semibold">{systemInfo.cpu_cores} 核</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center text-[11px] text-muted-foreground font-medium">
                  <MemoryStick className="mr-1 h-3 w-3" />
                  总内存
                </p>
                <p className="text-sm font-semibold">{formatBytes(systemInfo.memory_total_mb)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中...</p>
          )}
        </div>
      </div>

      {/* 实时资源监控图表 */}
      <div className="grid grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
        {/* CPU 图表 */}
        <div className="card-macos overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--glass-border)]">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center text-sm font-semibold tracking-tight">
                <Cpu className="mr-2 h-4 w-4 text-emerald-500" />
                CPU 使用率
              </h3>
              <span className="text-[22px] font-bold text-emerald-500 tracking-tight">{resourceUsage.cpu_percent.toFixed(1)}%</span>
            </div>
          </div>
          <div className="p-4">
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="cpu" name="CPU" stroke="#10b981" fill="url(#cpuFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 内存图表 */}
        <div className="card-macos overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--glass-border)]">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center text-sm font-semibold tracking-tight">
                <MemoryStick className="mr-2 h-4 w-4 text-blue-500" />
                内存使用率
              </h3>
              <span className="text-[22px] font-bold text-blue-500 tracking-tight">{resourceUsage.memory_percent.toFixed(1)}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {formatBytes(resourceUsage.memory_used_mb)} / {formatBytes(resourceUsage.memory_total_mb)}
            </p>
          </div>
          <div className="p-4">
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="memory" name="内存" stroke="#3b82f6" fill="url(#memFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* 进程列表 */}
      <div className="card-macos overflow-hidden animate-slide-up flex-1 flex flex-col min-h-0" style={{ animationDelay: "150ms" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
          <h3 className="flex items-center text-sm font-semibold tracking-tight">
            <Activity className="mr-2 h-4 w-4 text-muted-foreground" />
            进程列表
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">(Top {processes.length})</span>
          </h3>
        </div>
        <div className="flex-1 overflow-hidden p-3">
          <div className="h-full overflow-auto">
            <div className="grid grid-cols-[4rem_1fr_3.5rem_4.5rem_4rem_1fr] gap-3 border-b border-[var(--glass-border)] px-3 pb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-full">
              <span>PID</span>
              <span>进程名</span>
              <span className="text-right">CPU%</span>
              <span className="text-right">内存</span>
              <span className="text-center">状态</span>
              <span>命令</span>
            </div>

            {initialLoading && processes.length === 0 ? (
              <div className="space-y-1 min-w-full">
                <ProcessRowSkeleton /><ProcessRowSkeleton /><ProcessRowSkeleton /><ProcessRowSkeleton />
                <ProcessRowSkeleton /><ProcessRowSkeleton /><ProcessRowSkeleton /><ProcessRowSkeleton />
              </div>
            ) : processes.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Activity className="mr-2 h-4 w-4 animate-spin" />
                进程数据加载中...
              </div>
            ) : (
              processes.map((proc) => (
                <div key={proc.pid} className="grid grid-cols-[4rem_1fr_3.5rem_4.5rem_4rem_1fr] gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/40 min-w-full">
                  <span className="font-mono text-[11px] text-muted-foreground">{proc.pid}</span>
                  <div className="overflow-hidden truncate text-sm font-medium" title={proc.name}>{proc.name}</div>
                  <span className="text-right text-sm text-muted-foreground font-mono">{proc.cpu_percent?.toFixed(1)}%</span>
                  <span className="text-right text-sm text-muted-foreground font-mono">{formatBytes(proc.memory_mb)}</span>
                  <span className="text-center">
                    <Badge variant={processStatusVariant(proc.status)} className="text-[10px] rounded-full">{proc.status}</Badge>
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground" title={proc.command}>{proc.command}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 底部运行时间 */}
      {systemInfo && (
        <div className="shrink-0 flex items-center justify-center gap-2 text-[11px] text-muted-foreground animate-slide-up" style={{ animationDelay: "200ms" }}>
          <Clock className="h-3 w-3" />
          系统已运行 {formatUptime(systemInfo.uptime_seconds)}
        </div>
      )}
    </div>
  );
}
