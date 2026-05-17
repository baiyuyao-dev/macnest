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
    <div className="space-y-1">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}

function ProcessRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md px-3 py-2">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-4 w-24 flex-1" />
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-5 w-14 rounded-full" />
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
    <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground">{label}</p>
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
      setProcesses(procs.slice(0, 20));
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
    <div className="space-y-6 p-6 page-fade-in">
      <h1 className="text-2xl font-bold">系统监控</h1>

      {/* ========== 系统信息卡片 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Computer className="mr-2 h-4 w-4" />
            系统信息
          </CardTitle>
          <CardDescription>macOS 系统硬件与软件信息</CardDescription>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="grid grid-cols-5 gap-4">
              <InfoRowSkeleton />
              <InfoRowSkeleton />
              <InfoRowSkeleton />
              <InfoRowSkeleton />
              <InfoRowSkeleton />
            </div>
          ) : systemInfo ? (
            <div className="grid grid-cols-5 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">主机名</p>
                <p className="text-sm font-medium">{systemInfo.hostname}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">macOS 版本</p>
                <p className="text-sm font-medium">{systemInfo.os_version}</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center text-xs text-muted-foreground">
                  <Cpu className="mr-1 h-3 w-3" />
                  CPU 型号
                </p>
                <p className="text-sm font-medium">{systemInfo.cpu_model}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">CPU 核心数</p>
                <p className="text-sm font-medium">{systemInfo.cpu_cores} 核</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center text-xs text-muted-foreground">
                  <MemoryStick className="mr-1 h-3 w-3" />
                  总内存
                </p>
                <p className="text-sm font-medium">{formatBytes(systemInfo.memory_total_mb)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">加载中...</p>
          )}
        </CardContent>
      </Card>

      {/* ========== 实时资源监控图表 ========== */}
      <div className="grid grid-cols-2 gap-4">
        {/* ---- CPU 图表 ---- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center text-base">
              <Cpu className="mr-2 h-4 w-4 text-emerald-500" />
              CPU 使用率
              <span className="ml-auto text-lg font-bold text-emerald-500">
                {resourceUsage.cpu_percent.toFixed(1)}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU"
                    stroke="#10b981"
                    fill="url(#cpuFill)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ---- 内存图表 ---- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center text-base">
              <MemoryStick className="mr-2 h-4 w-4 text-blue-500" />
              内存使用率
              <span className="ml-auto text-lg font-bold text-blue-500">
                {resourceUsage.memory_percent.toFixed(1)}%
              </span>
            </CardTitle>
            <CardDescription>
              {formatBytes(resourceUsage.memory_used_mb)} / {formatBytes(resourceUsage.memory_total_mb)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="memory"
                    name="内存"
                    stroke="#3b82f6"
                    fill="url(#memFill)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ========== 进程列表 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Activity className="mr-2 h-4 w-4" />
            进程列表
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (Top {processes.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* 表头 */}
          <div className="flex items-center gap-4 border-b px-3 pb-2 text-xs font-medium text-muted-foreground">
            <span className="w-16 shrink-0">PID</span>
            <span className="flex-1">进程名</span>
            <span className="w-20 text-right">CPU%</span>
            <span className="w-24 text-right">内存</span>
            <span className="w-20 text-center">状态</span>
            <span className="w-32 hidden xl:block">命令</span>
          </div>

          {/* 进程行 */}
          <div className="max-h-[480px] overflow-y-auto">
            {initialLoading && processes.length === 0 ? (
              <div className="space-y-1">
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
                <ProcessRowSkeleton />
              </div>
            ) : processes.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Activity className="mr-2 h-4 w-4 animate-spin" />
                进程数据加载中...
              </div>
            ) : (
              processes.map((proc) => (
                <div
                  key={proc.pid}
                  className="flex items-center gap-4 rounded-md px-3 py-2 transition-colors hover:bg-accent"
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                    {proc.pid}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{proc.name}</span>
                  <span className="w-20 text-right text-sm text-muted-foreground">
                    {proc.cpu_percent?.toFixed(1)}%
                  </span>
                  <span className="w-24 text-right text-sm text-muted-foreground">
                    {formatBytes(proc.memory_mb)}
                  </span>
                  <span className="w-20 text-center">
                    <Badge variant={processStatusVariant(proc.status)} className="text-[10px]">
                      {proc.status}
                    </Badge>
                  </span>
                  <span className="w-32 hidden truncate text-xs text-muted-foreground xl:block" title={proc.command}>
                    {proc.command}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* 底部运行时间 */}
      {systemInfo && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          系统已运行 {formatUptime(systemInfo.uptime_seconds)}
        </div>
      )}
    </div>
  );
}
