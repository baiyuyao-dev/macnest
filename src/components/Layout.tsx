import { Outlet, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Container,
  Bookmark,
  Activity,
  Terminal as TerminalIcon,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { useThemeStore } from "@/stores/theme";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/services", icon: Server, label: "服务" },
  { to: "/docker", icon: Container, label: "Docker" },
  { to: "/bookmarks", icon: Bookmark, label: "导航" },
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
  { to: "/system", icon: Activity, label: "系统" },
];

export default function Layout() {
  const { isDark, toggleTheme } = useThemeStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-[200px] flex-col border-r bg-card">
        <div className="flex h-14 items-center border-b px-4">
          <Server className="mr-2 h-5 w-5 text-primary" />
          <span className="text-lg font-bold">MacOps</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            {isDark ? "浅色模式" : "深色模式"}
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `mt-1 flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`
            }
          >
            <Settings className="mr-2 h-4 w-4" />
            设置
          </NavLink>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
