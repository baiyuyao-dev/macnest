import { useEffect, useState } from "react";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getSystemInfo, listServices, getActiveSshSessionsCount } from "@/lib/api";
import {
  Globe,
  Server,
  Terminal,
  LayoutDashboard,
  ExternalLink,
  Power,
} from "lucide-react";

export default function TrayPopup() {
  const [ip, setIp] = useState<string>("-");
  const [runningServices, setRunningServices] = useState(0);
  const [sshSessions, setSshSessions] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [sysInfo, services, sshCount] = await Promise.all([
        getSystemInfo().catch(() => null),
        listServices().catch(() => []),
        getActiveSshSessionsCount().catch(() => 0),
      ]);
      setIp(sysInfo?.local_ip || "-");
      setRunningServices(services.filter((s) => s.status === "running").length);
      setSshSessions(sshCount);
    } catch (err) {
      console.error("Tray popup load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const navigateTo = async (path: string) => {
    try {
      // 发送导航事件给主窗口
      await emit("tray-navigate", { path });
      // 显示主窗口
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      // 关闭当前 popup
      const popup = getCurrentWebviewWindow();
      await popup.hide();
    } catch (err) {
      console.error("Navigation error:", err);
    }
  };

  const showMainWindow = async () => {
    try {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      const popup = getCurrentWebviewWindow();
      await popup.hide();
    } catch (err) {
      console.error("Show main window error:", err);
    }
  };

  const handleExit = async () => {
    try {
      await invoke("exit_app");
    } catch {
      // fallback
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1c1917] text-foreground select-none">
      <div className="flex flex-col h-full p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 pb-2 border-b border-white/10">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <g transform="translate(16,16)">
                <polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/>
                <g transform="translate(0,-12.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
                <g transform="translate(10.5,-6.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
                <g transform="translate(10.5,6.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
                <g transform="translate(0,12.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
                <g transform="translate(-10.5,6.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
                <g transform="translate(-10.5,-6.1)"><polygon points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"/></g>
              </g>
            </svg>
          </div>
          <span className="text-sm font-bold tracking-tight">MacNest</span>
        </div>

        {/* Status cards */}
        <div className="space-y-2">
          {/* IP */}
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
            <Globe className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">本机 IP</p>
              <p className="text-sm font-medium truncate">{loading ? "..." : ip}</p>
            </div>
          </div>

          {/* Running services */}
          <button
            onClick={() => navigateTo("/services")}
            className="w-full flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10 text-left group"
          >
            <Server className="h-4 w-4 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">运行中服务</p>
              <p className="text-sm font-medium">{loading ? "..." : runningServices}</p>
            </div>
            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>

          {/* SSH sessions */}
          <button
            onClick={() => navigateTo("/terminal")}
            className="w-full flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 transition-colors hover:bg-white/10 text-left group"
          >
            <Terminal className="h-4 w-4 text-rose-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">SSH 终端</p>
              <p className="text-sm font-medium">{loading ? "..." : sshSessions}</p>
            </div>
            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <div className="space-y-1.5 pt-2 border-t border-white/10">
          <button
            onClick={showMainWindow}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            打开主窗口
          </button>
          <button
            onClick={handleExit}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <Power className="h-3.5 w-3.5" />
            退出
          </button>
        </div>
      </div>
    </div>
  );
}
