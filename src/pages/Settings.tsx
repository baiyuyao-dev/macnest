import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Monitor,
  RefreshCw,
  Menu,
  Database,
  Info,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Save,
  Hexagon,
  Sun,
  Moon,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import { useThemeStore } from "@/stores/theme";
import { getSettings, updateSettings } from "@/lib/api";
import { notify, notifyThrottled, initNotificationPermission } from "@/lib/notification";
import { Bell, BellRing, BellDot, Megaphone, FolderOpen, RotateCcw } from "lucide-react";

export default function SettingsPage() {
  const { isDark, setTheme } = useThemeStore();

  const [settings, setSettings] = useState({
    theme: "dark",
    auto_refresh_interval: 5,
    show_menu_bar: true,
    auto_sync_bookmarks_interval: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifPermission, setNotifPermission] = useState<boolean | null>(null);
  const [appPath, setAppPath] = useState<string>("");
  const [inApplications, setInApplications] = useState<boolean | null>(null);
  const [reinstalling, setReinstalling] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      setSettings({
        theme: data.theme,
        auto_refresh_interval: data.auto_refresh_interval,
        show_menu_bar: data.show_menu_bar,
        auto_sync_bookmarks_interval: data.auto_sync_bookmarks_interval,
      });
      setTheme(data.theme === "dark");
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }, [setTheme]);

  useEffect(() => {
    loadSettings();
    // 初始化时检查通知权限
    initNotificationPermission().then((granted) => {
      setNotifPermission(granted);
    }).catch(() => {
      setNotifPermission(false);
    });
    // 获取应用路径和安装状态
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_app_path").then(setAppPath).catch(() => setAppPath("unknown"));
      invoke<boolean>("is_in_applications").then(setInApplications).catch(() => setInApplications(null));
    });
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      setTheme(settings.theme === "dark");
      toast.success("设置已保存");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleThemeChange = (value: string) => {
    const dark = value === "dark";
    setSettings((prev) => ({ ...prev, theme: dark ? "dark" : "light" }));
    setTheme(dark);
  };

  const handleExport = () => {
    const data = {
      app: "MacNest",
      version: "0.2.0",
      export_at: new Date().toISOString(),
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `macnest-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.settings) {
          setSettings(data.settings);
          await updateSettings(data.settings);
          setTheme(data.settings.theme === "dark");
        }
      } catch (err) {
        console.error("Failed to import config:", err);
      }
    };
    input.click();
  };

  const handleReset = async () => {
    if (!window.confirm("确定要重置所有数据吗？此操作不可恢复！")) return;
    try {
      await updateSettings({
        theme: "dark",
        auto_refresh_interval: 5,
        show_menu_bar: true,
        auto_sync_bookmarks_interval: 0,
      });
      setSettings({
        theme: "dark",
        auto_refresh_interval: 5,
        show_menu_bar: true,
        auto_sync_bookmarks_interval: 0,
      });
      setTheme(true);
    } catch (err) {
      console.error("Failed to reset settings:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center animate-page-enter">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">设置</h1>
          <p className="text-xs text-muted-foreground mt-0.5">自定义 MacNest 的偏好选项</p>
        </div>
        <Button className="btn-macos rounded-xl" onClick={handleSave} disabled={saving}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "保存中..." : "保存设置"}
        </Button>
      </div>

      {/* 外观设置 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Monitor className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">外观</h3>
            <p className="text-[11px] text-muted-foreground">自定义 MacNest 的外观和主题</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">主题</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">选择深色或浅色主题</p>
            </div>
            <div className="flex items-center gap-2 p-1 rounded-xl bg-muted/50">
              <button
                onClick={() => handleThemeChange("light")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${settings.theme === "light" ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sun className="h-3.5 w-3.5" />
                浅色
              </button>
              <button
                onClick={() => handleThemeChange("dark")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${settings.theme === "dark" ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Moon className="h-3.5 w-3.5" />
                深色
              </button>
            </div>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">当前状态</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isDark ? "深色模式" : "浅色模式"}
              </p>
            </div>
            <Badge variant={isDark ? "default" : "secondary"} className="text-[10px] rounded-full">
              {isDark ? "深色" : "浅色"}
            </Badge>
          </div>
        </div>
      </div>

      {/* 刷新设置 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "100ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">数据刷新</h3>
            <p className="text-[11px] text-muted-foreground">配置系统监控数据自动刷新频率</p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">自动刷新间隔</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">仪表盘和系统监控数据的刷新频率</p>
            </div>
            <select
              value={String(settings.auto_refresh_interval)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  auto_refresh_interval: Number(e.target.value),
                }))
              }
              className="w-28 h-9 text-xs flex rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 shadow-sm outline-none focus:border-primary/50 transition-all"
            >
              <option value="1">1 秒</option>
              <option value="3">3 秒</option>
              <option value="5">5 秒</option>
              <option value="10">10 秒</option>
              <option value="30">30 秒</option>
            </select>
          </div>
        </div>
      </div>

      {/* 菜单栏设置 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "150ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Menu className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">菜单栏</h3>
            <p className="text-[11px] text-muted-foreground">macOS 菜单栏图标显示设置</p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">显示菜单栏图标</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">在 macOS 顶部菜单栏显示 MacNest 图标</p>
            </div>
            <Switch
              checked={settings.show_menu_bar}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, show_menu_bar: checked }))
              }
            />
          </div>
        </div>
      </div>

      {/* 书签同步 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "175ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Bookmark className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">书签同步</h3>
            <p className="text-[11px] text-muted-foreground">自动从 Safari 同步书签</p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">自动同步频率</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">导航模块与 Safari 书签保持同步的频率</p>
            </div>
            <select
              value={String(settings.auto_sync_bookmarks_interval)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  auto_sync_bookmarks_interval: Number(e.target.value),
                }))
              }
              className="w-28 h-9 text-xs flex rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 shadow-sm outline-none focus:border-primary/50 transition-all"
            >
              <option value="0">关闭</option>
              <option value="5">5 分钟</option>
              <option value="10">10 分钟</option>
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60">60 分钟</option>
            </select>
          </div>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "200ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Database className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">数据管理</h3>
            <p className="text-[11px] text-muted-foreground">导出、导入或重置配置数据</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">导出配置</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">将当前设置导出为 JSON 文件</p>
            </div>
            <Button variant="outline" size="sm" className="btn-macos-secondary rounded-lg h-8 text-xs" onClick={handleExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              导出
            </Button>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">导入配置</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">从 JSON 文件导入设置</p>
            </div>
            <Button variant="outline" size="sm" className="btn-macos-secondary rounded-lg h-8 text-xs" onClick={handleImport}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              导入
            </Button>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                重置所有数据
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">清除所有设置并恢复默认值</p>
            </div>
            <Button variant="destructive" size="sm" className="rounded-lg h-8 text-xs" onClick={handleReset}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              重置
            </Button>
          </div>
        </div>
      </div>

      {/* 通知测试 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "225ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Bell className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">系统通知测试</h3>
            <p className="text-[11px] text-muted-foreground">测试 macOS 原生通知效果</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* 权限状态 */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">通知权限</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {notifPermission === null
                  ? "检测中..."
                  : notifPermission
                    ? "已授权 ✅"
                    : "未授权 ❌"}
              </p>
            </div>
            <Badge
              variant={notifPermission ? "default" : "secondary"}
              className="text-[10px] rounded-full"
            >
              {notifPermission === null
                ? "检测中"
                : notifPermission
                  ? "已授权"
                  : "未授权"}
            </Badge>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />

          {/* 应用路径诊断 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">应用安装位置</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono break-all">
                  {appPath || "检测中..."}
                </p>
              </div>
              <Badge
                variant={inApplications === true ? "default" : "destructive"}
                className="text-[10px] rounded-full shrink-0 ml-2"
              >
                {inApplications === null
                  ? "检测中"
                  : inApplications
                    ? "已安装"
                    : "未安装"}
              </Badge>
            </div>
            {inApplications === false && (
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex-1">
                  ⚠️ 应用不在 /Applications 目录，通知可能无法正常显示
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="btn-macos-secondary rounded-lg h-7 text-[11px] shrink-0"
                  disabled={reinstalling}
                  onClick={async () => {
                    setReinstalling(true);
                    try {
                      const { invoke } = await import("@tauri-apps/api/core");
                      const result = await invoke<string>("reinstall_to_applications");
                      toast.success(result);
                    } catch (err: any) {
                      console.error("重新安装失败:", err);
                      toast.error(err?.toString?.() || "安装失败");
                    } finally {
                      setReinstalling(false);
                    }
                  }}
                >
                  {reinstalling ? (
                    <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1 h-3 w-3" />
                  )}
                  {reinstalling ? "安装中..." : "安装到 Applications"}
                </Button>
              </div>
            )}
          </div>
          <div className="h-px bg-[var(--glass-border)]" />

          <p className="text-[11px] text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-400/10 rounded-lg px-3 py-2">
            💡 开发模式下通知图标可能显示为终端图标，打包成 App 后会自动变为 MacNest 图标
          </p>
          <p className="text-[11px] text-blue-500 dark:text-blue-400 bg-blue-500/10 dark:bg-blue-400/10 rounded-lg px-3 py-2">
            ℹ️ 如果点击"允许"后通知仍不弹出，请<strong>完全退出应用后重新启动</strong>（macOS 权限需要重启生效）
          </p>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">基础通知</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">发送一条标准系统通知</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="btn-macos-secondary rounded-lg h-8 text-xs"
              onClick={async () => {
                const granted = await initNotificationPermission();
                setNotifPermission(granted);
                await notify("MacNest", "这是一条测试通知 🎉");
                toast.success("通知已发送");
              }}
            >
              <Bell className="mr-1.5 h-3.5 w-3.5" />
              发送
            </Button>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">带图标通知</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">发送带应用图标的通知</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="btn-macos-secondary rounded-lg h-8 text-xs"
              onClick={async () => {
                const granted = await initNotificationPermission();
                setNotifPermission(granted);
                await notify("Docker 提醒", "容器 nginx 已启动", "icons/128x128.png");
                toast.success("图标通知已发送");
              }}
            >
              <BellRing className="mr-1.5 h-3.5 w-3.5" />
              发送
            </Button>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">防刷屏通知</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">30 秒内相同内容只发一次</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="btn-macos-secondary rounded-lg h-8 text-xs"
              onClick={async () => {
                const granted = await initNotificationPermission();
                setNotifPermission(granted);
                await notifyThrottled("test-throttle", "服务告警", "CPU 使用率超过 80%");
                toast.success("防刷屏通知已发送（30s 内重复点击不会重复发送）");
              }}
            >
              <BellDot className="mr-1.5 h-3.5 w-3.5" />
              发送
            </Button>
          </div>
          <div className="h-px bg-[var(--glass-border)]" />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">批量通知</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">连续发送 3 条不同通知</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="btn-macos-secondary rounded-lg h-8 text-xs"
              onClick={async () => {
                const granted = await initNotificationPermission();
                setNotifPermission(granted);
                await notify("服务状态", "Nginx 已启动 ✅");
                setTimeout(async () => {
                  await notify("Docker", "容器 mysql 运行中 🐳");
                }, 1500);
                setTimeout(async () => {
                  await notify("系统", "书签同步完成 📚");
                }, 3000);
                toast.success("3 条通知将在 3 秒内陆续弹出");
              }}
            >
              <Megaphone className="mr-1.5 h-3.5 w-3.5" />
              发送
            </Button>
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "250ms" }}>
        <div className="flex items-center px-5 py-4 border-b border-[var(--glass-border)]">
          <Info className="mr-2 h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">关于 MacNest</h3>
          </div>
        </div>
        <div className="p-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">应用名称</span>
              <span className="font-medium">MacNest</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">版本号</span>
              <Badge variant="outline" className="text-[10px] rounded-full glass">0.2.0</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">描述</span>
              <span className="text-muted-foreground">macOS 本地运维面板</span>
            </div>
            <div className="h-px bg-[var(--glass-border)]" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tauri</span>
              <span className="text-muted-foreground">v2.0</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">React</span>
              <span className="text-muted-foreground">v19.0</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tailwind CSS</span>
              <span className="text-muted-foreground">v4.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
