import { useOutlet, useLocation, NavLink } from "react-router-dom";
import { useRef, useState } from "react";
import {
  LayoutDashboard,
  Server,
  Container,
  Bookmark,
  Activity,
  Terminal as TerminalIcon,
  Monitor,
  Settings,
} from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(false);

  const currentPath = location.pathname;
  if (outlet && !cacheRef.current.has(currentPath)) {
    cacheRef.current.set(currentPath, outlet);
  }

  useThemeStore();

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
      </main>
    </div>
  );
}
