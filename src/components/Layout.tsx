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
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getSystemInfo, showSuccess, showError } from "@/lib/api";
import type { SystemInfo } from "@/types";
import MacNestLogo from "@/components/icons/MacNestLogo";
import { useThemeStore } from "@/stores/theme";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/services", icon: Server, label: "服务" },
  { to: "/docker", icon: Container, label: "Docker" },
  { to: "/bookmarks", icon: Bookmark, label: "导航" },
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
  { to: "/tmux", icon: Monitor, label: "Tmux" },
  { to: "/system", icon: Activity, label: "系统" },
];

export default function Layout() {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef<Map<string, React.ReactNode>>(new Map());
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
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

  useEffect(() => {
    loadSystemInfo();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadSystemInfo();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadSystemInfo]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* ── Top Header ── */}
      <header className="relative flex h-[40px] shrink-0 items-center z-20 border-b border-[var(--glass-border)]">

        {/* Logo */}
        <div className="relative flex h-full items-center px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MacNestLogo className="h-4 w-4" size={20} />
            </div>
            <div className="overflow-hidden whitespace-nowrap">
              <span className="text-[15px] font-bold tracking-tight">MacNest</span>
              <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">v0.2</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="relative flex flex-1 items-center justify-center gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `group relative flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-300 mb-1 ${
                  isActive
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div className="absolute inset-0 rounded-xl bg-primary shadow-glass transition-all duration-300" />
                  )}
                  <item.icon
                    className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-300 ${
                      isActive ? "" : "group-hover:scale-110"
                    }`}
                  />
                  <span className="relative">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Right side: IP + Settings */}
        <div className="relative flex items-center gap-2 px-4 border-l border-[var(--glass-border)]">
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
              className="group flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 active:scale-[0.97] transition-all duration-150 cursor-pointer"
            >
              <Globe className="relative h-[14px] w-[14px] shrink-0" />
              <span>{systemInfo.local_ip}</span>
              <span>
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

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `group relative flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-300 ${
                isActive
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute inset-0 rounded-xl bg-primary shadow-glass transition-all duration-300" />
                )}
                <Settings
                  className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-300 ${
                    isActive ? "" : "group-hover:rotate-45"
                  }`}
                />
                <span className="relative">设置</span>
              </>
            )}
          </NavLink>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="relative flex-1 overflow-hidden mx-2 mb-2">
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
