import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { getSystemInfo, getResourceUsage, listServices } from "@/lib/api";
import {
  Globe,
  Server,
  Cpu,
  MemoryStick,
  LayoutDashboard,
  Power,
} from "lucide-react";

export default function TrayPopup() {
  const [ip, setIp] = useState<string>("-");
  const [cpu, setCpu] = useState(0);
  const [memoryPercent, setMemoryPercent] = useState(0);
  const [memoryUsed, setMemoryUsed] = useState("-");
  const [memoryTotal, setMemoryTotal] = useState("-");
  const [runningServices, setRunningServices] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [sysInfo, resources, services] = await Promise.all([
        getSystemInfo().catch(() => null),
        getResourceUsage().catch(() => null),
        listServices().catch(() => []),
      ]);
      setIp(sysInfo?.local_ip || "-");
      if (resources) {
        setCpu(Math.round(resources.cpu_percent));
        setMemoryPercent(Math.round(resources.memory_percent));
        setMemoryUsed(`${Math.round(resources.memory_used_mb / 1024 * 10) / 10} GB`);
        setMemoryTotal(`${Math.round(resources.memory_total_mb / 1024 * 10) / 10} GB`);
      }
      setRunningServices(services.filter((s) => s.status === "running").length);
    } catch (err) {
      console.error("Tray popup load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  const showMainWindow = async () => {
    try {
      await invoke("show_main_window");
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
    <div className="dark h-screen w-screen overflow-hidden bg-[#1c1917] text-foreground select-none">
      <div className="flex flex-col h-full p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2 pb-1 border-b border-white/10">
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
        <div className="space-y-1.5">
          {/* IP */}
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-1.5">
            <Globe className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">本机 IP</p>
              <p className="text-sm font-medium truncate">{loading ? "..." : ip}</p>
            </div>
          </div>

          {/* CPU */}
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-1.5">
            <Cpu className="h-4 w-4 text-sky-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">CPU 使用率</p>
              <p className="text-sm font-medium">{loading ? "..." : `${cpu}%`}</p>
            </div>
            <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-500"
                style={{ width: `${Math.min(cpu, 100)}%` }}
              />
            </div>
          </div>

          {/* Memory */}
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-1.5">
            <MemoryStick className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">内存</p>
              <p className="text-sm font-medium">{loading ? "..." : `${memoryUsed} / ${memoryTotal}`}</p>
            </div>
            <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                style={{ width: `${Math.min(memoryPercent, 100)}%` }}
              />
            </div>
          </div>

          {/* Running services */}
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-1.5">
            <Server className="h-4 w-4 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground">运行中服务</p>
              <p className="text-sm font-medium">{loading ? "..." : runningServices}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-auto space-y-1 pt-1.5 border-t border-white/10">
          <button
            onClick={showMainWindow}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            打开主窗口
          </button>
          <button
            onClick={handleExit}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
          >
            <Power className="h-3.5 w-3.5" />
            退出
          </button>
        </div>
      </div>
    </div>
  );
}
