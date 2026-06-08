import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Services from "./pages/Services";
import Docker from "./pages/Docker";
import Bookmarks from "./pages/Bookmarks";
import System from "./pages/System";
import Terminal from "./pages/Terminal";
import Tmux from "./pages/Tmux";
import Rdp from "./pages/Rdp";
import Mysql from "./pages/Mysql";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import { useThemeStore } from "./stores/theme";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSettings } from "./lib/api";
import { initNotificationListener } from "./lib/notification";
import { Toaster } from "sonner";

function NavigationListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlisten = listen("navigate-to", (event) => {
      const path = event.payload as string;
      if (path) {
        navigate(path);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [navigate]);

  return null;
}

function App() {
  const { isDark, setTheme } = useThemeStore();

  // 应用启动时从数据库加载主题设置
  useEffect(() => {
    getSettings()
      .then((data) => {
        setTheme(data.theme === "dark");
      })
      .catch(() => {
        // 首次启动无设置记录，保持默认深色
      });
  }, [setTheme]);

  // 初始化通知事件监听（后端推送 → 系统通知 + Toast）
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initNotificationListener().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  // 全局禁用浏览器默认右键菜单，只保留单独绑定的自定义右键菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  return (
    <>
      <Toaster
        position="top-center"
        duration={2000}
        toastOptions={{
          style: {
            background: isDark ? "#1c1917" : "#fafaf9",
            color: isDark ? "#fafaf9" : "#1c1917",
            border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)",
            fontSize: "13px",
          },
        }}
        richColors
      />
      <HashRouter>
        <NavigationListener />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="services" element={<Services />} />
            <Route path="docker" element={<Docker />} />
            <Route path="bookmarks" element={<Bookmarks />} />
            <Route path="terminal" element={<Terminal />} />
            <Route path="tmux" element={<Tmux />} />
            <Route path="rdp" element={<Rdp />} />
            <Route path="mysql" element={<Mysql />} />
            <Route path="system" element={<System />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}

export default App;
