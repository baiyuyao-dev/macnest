import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Services from "./pages/Services";
import Docker from "./pages/Docker";
import Bookmarks from "./pages/Bookmarks";
import System from "./pages/System";
import Terminal from "./pages/Terminal";
import Tmux from "./pages/Tmux";
import Settings from "./pages/Settings";
import { useThemeStore } from "./stores/theme";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

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
  const { isDark } = useThemeStore();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  return (
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
          <Route path="system" element={<System />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
