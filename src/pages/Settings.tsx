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
} from "lucide-react";
import { useThemeStore } from "@/stores/theme";
import { getSettings, updateSettings } from "@/lib/api";

export default function SettingsPage() {
  const { isDark, setTheme } = useThemeStore();

  const [settings, setSettings] = useState({
    theme: "dark",
    auto_refresh_interval: 5,
    show_menu_bar: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      setSettings({
        theme: data.theme,
        auto_refresh_interval: data.auto_refresh_interval,
        show_menu_bar: data.show_menu_bar,
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
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(settings);
      setTheme(settings.theme === "dark");
    } catch (err) {
      console.error("Failed to save settings:", err);
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
      });
      setSettings({
        theme: "dark",
        auto_refresh_interval: 5,
        show_menu_bar: true,
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
