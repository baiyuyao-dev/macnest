import { useOutlet, useLocation, NavLink } from "react-router-dom";
import { useRef, useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Server,
  Container,
  Bookmark,
  Activity,
  Terminal as TerminalIcon,
  Monitor,
  Settings,
  Copy,
  Check,
  Globe,
  Thermometer,
  Gauge,
  Cpu,
  ScreenShare,
  Bell,
  Database as DatabaseIcon,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getSystemInfo, getCpuDetailedUsage, showSuccess, showError } from "@/lib/api";
import type { SystemInfo, CpuDetailedUsage } from "@/types";
import MacNestLogo from "@/components/icons/MacNestLogo";
import { useThemeStore } from "@/stores/theme";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/services", icon: Server, label: "服务" },
  { to: "/docker", icon: Container, label: "Docker" },
  { to: "/bookmarks", icon: Bookmark, label: "导航" },
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
  { to: "/tmux", icon: Monitor, label: "Tmux" },
  // RDP 功能暂时隐藏菜单入口（功能保留）
  // { to: "/rdp", icon: ScreenShare, label: "RDP" },
  { to: "/mysql", icon: DatabaseIcon, label: "MySQL" },
  { to: "/system", icon: Activity, label: "系统" },
  { to: "/notifications", icon: Bell, label: "通知" },
];

export default function Layout() {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef<Map<string, React.ReactNode>>(new Map());
  const [collapsed, setCollapsed] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [cpuUsage, setCpuUsage] = useState<CpuDetailedUsage | null>(null);
  const [ipCopied, setIpCopied] = useState(false);

  const currentPath = location.pathname;
  if (outlet && !cacheRef.current.has(currentPath)) {
    cacheRef.current.set(currentPath, outlet);
  }
  const hasCurrentInCache = cacheRef.current.has(currentPath);

  useThemeStore();

  const loadSystemInfo = useCallback(async () => {
    try {
      const info = await getSystemInfo();
      setSystemInfo(info);
    } catch (err) {
      console.error("Failed to load system info:", err);
    }
  }, []);

  const loadCpuUsage = useCallback(async () => {
    try {
      const usage = await getCpuDetailedUsage();
      setCpuUsage(usage);
    } catch (err) {
      console.error("Failed to load CPU usage:", err);
    }
  }, []);

  useEffect(() => {
    loadSystemInfo();
    loadCpuUsage();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadSystemInfo();
        loadCpuUsage();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadSystemInfo, loadCpuUsage]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <aside
        className={`relative flex flex-col shrink-0 z-20 transition-all duration-300 ease-in-out ${
          collapsed ? "w-16" : "w-[220px]"
        }`}
      >
        {/* Glass background */}
        <div className="absolute inset-0 glass-strong border-r border-[var(--glass-border-strong)]" />

        {/* Logo */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="relative flex h-[52px] w-full items-center px-3 cursor-pointer hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MacNestLogo className="h-5 w-5" size={20} />
            </div>
            <div
              className="overflow-hidden whitespace-nowrap"
              style={{
                opacity: collapsed ? 0 : 1,
                maxWidth: collapsed ? 0 : 120,
                transition: collapsed
                  ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                  : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
              }}
            >
              <span className="text-[15px] font-bold tracking-tight">MacNest</span>
              <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">v0.2</span>
            </div>
          </div>
        </button>

        {/* Nav */}
        <nav className="relative flex-1 space-y-0.5 px-2 py-2">
          {navItems.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ${
                  isActive
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
              style={{ animationDelay: `${index * 40}ms` }}
            >
              {({ isActive }) => (
                <>
                  {/* Active background pill */}
                  {isActive && (
                    <div className="absolute inset-0 rounded-xl bg-primary shadow-glass transition-all duration-300" />
                  )}
                  {/* Active indicator dot */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary-foreground/80" />
                  )}
                  <item.icon
                    className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-300 ${
                      isActive ? "" : "group-hover:scale-110"
                    }`}
                  />
                  <span
                    className="relative overflow-hidden whitespace-nowrap"
                    style={{
                      opacity: collapsed ? 0 : 1,
                      maxWidth: collapsed ? 0 : 120,
                      transition: collapsed
                        ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                        : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                    }}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* System Monitor Section */}
        <div className="relative px-2 py-2 border-t border-[var(--glass-border)]">
          {/* IP Display */}
          {systemInfo?.local_ip && (
            <button
              onClick={async () => {
                if (!systemInfo?.local_ip) return;
                try {
                  await writeText(systemInfo.local_ip);
                  setIpCopied(true);
                  showSuccess("IP 已复制到剪贴板");
                  setTimeout(() => setIpCopied(false), 1500);
                } catch (err) {
                  showError("复制失败");
                  console.error("Copy failed:", err);
                }
              }}
              className="group flex items-center gap-2 w-full rounded-xl px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 active:scale-[0.97] transition-all duration-150 cursor-pointer"
            >
              <Globe className="relative h-[14px] w-[14px] shrink-0" />
              <span
                className="relative overflow-hidden whitespace-nowrap"
                style={{
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : 120,
                  transition: collapsed
                    ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                    : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                }}
              >
                {systemInfo.local_ip}
              </span>
              <span className="flex-1" />
              <span
                className="shrink-0 transition-all duration-200"
                style={{
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : undefined,
                }}
              >
                {ipCopied ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 font-semibold">
                    <Check className="h-2.5 w-2.5" />
                    已复制
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground/60 group-hover:text-muted-foreground group-hover:bg-accent/50 transition-all duration-150">
                    <Copy className="h-2.5 w-2.5" />
                    复制
                  </span>
                )}
              </span>
            </button>
          )}

          {/* CPU Temperature */}
          {cpuUsage?.thermal && (
            <div className="flex items-center gap-2 w-full rounded-xl px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <Thermometer className="relative h-[14px] w-[14px] shrink-0" />
              <span
                className="relative overflow-hidden whitespace-nowrap flex-1"
                style={{
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : 120,
                  transition: collapsed
                    ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                    : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                }}
              >
                <span className={cpuUsage.thermal.temperature_celsius > 80 ? "text-red-500 font-semibold" : ""}>
                  {cpuUsage.thermal.temperature_celsius.toFixed(1)}°C
                </span>
              </span>
            </div>
          )}

          {/* CPU Pressure */}
          {cpuUsage?.pressure && (
            <div className="flex items-center gap-2 w-full rounded-xl px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <Gauge className="relative h-[14px] w-[14px] shrink-0" />
              <span
                className="relative overflow-hidden whitespace-nowrap flex-1"
                style={{
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : 120,
                  transition: collapsed
                    ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                    : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                }}
              >
                {cpuUsage.pressure.total_pressure.toFixed(1)}%
              </span>
            </div>
          )}

          {/* CPU Core Average Load */}
          {cpuUsage?.cores && cpuUsage.cores.length > 0 && (
            <div className="flex items-center gap-2 w-full rounded-xl px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <Cpu className="relative h-[14px] w-[14px] shrink-0" />
              <span
                className="relative overflow-hidden whitespace-nowrap flex-1"
                style={{
                  opacity: collapsed ? 0 : 1,
                  maxWidth: collapsed ? 0 : 120,
                  transition: collapsed
                    ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                    : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                }}
              >
                {(cpuUsage.cores.reduce((sum, c) => sum + c.usage_percent, 0) / cpuUsage.cores.length).toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="relative p-2 space-y-0.5">
          <NavLink
            to="/settings"
            title={collapsed ? "设置" : undefined}
            className={({ isActive }) =>
              `group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300 ${
                isActive
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <div className="absolute inset-0 rounded-xl bg-primary shadow-glass transition-all duration-300" />}
                <Settings
                  className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-300 ${
                    isActive ? "" : "group-hover:rotate-45"
                  }`}
                />
                <span
                  className="relative overflow-hidden whitespace-nowrap"
                  style={{
                    opacity: collapsed ? 0 : 1,
                    maxWidth: collapsed ? 0 : 120,
                    transition: collapsed
                      ? "opacity 120ms ease-in-out, max-width 300ms ease-in-out 120ms"
                      : "max-width 300ms ease-in-out, opacity 120ms ease-in-out 180ms",
                  }}
                >
                  设置
                </span>
              </>
            )}
          </NavLink>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="relative flex-1 overflow-hidden">
        {Array.from(cacheRef.current.entries()).map(([path, element]) => {
          const isActive = currentPath === path;
          return (
            <div
              key={path}
              className="h-full w-full overflow-auto"
              style={{
                position: "absolute",
                inset: 0,
                display: isActive ? "block" : "none",
              }}
            >
              {element}
            </div>
          );
        })}
        {/* Fallback: render outlet directly if not yet cached */}
        {!hasCurrentInCache && outlet && (
          <div
            className="h-full w-full overflow-auto"
            style={{ position: "absolute", inset: 0 }}
          >
            {outlet}
          </div>
        )}
      </main>
    </div>
  );
}
