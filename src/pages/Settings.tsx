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
      // 同步主题
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
      app: "MacOps",
      version: "0.1.0",
      export_at: new Date().toISOString(),
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `macops-config-${Date.now()}.json`;
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
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">设置</h1>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "保存中..." : "保存设置"}
        </Button>
      </div>

      {/* ========== 外观设置 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Monitor className="mr-2 h-4 w-4" />
            外观
          </CardTitle>
          <CardDescription>自定义 MacOps 的外观和主题</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>主题</Label>
              <p className="text-sm text-muted-foreground">选择深色或浅色主题</p>
            </div>
            <select
              value={settings.theme}
              onChange={(e) => handleThemeChange(e.target.value)}
              className="w-32 flex h-9 rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>深色模式预览</Label>
              <p className="text-sm text-muted-foreground">
                当前状态：{isDark ? "深色模式" : "浅色模式"}
              </p>
            </div>
            <Badge variant={isDark ? "default" : "secondary"}>
              {isDark ? "深色" : "浅色"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ========== 刷新设置 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <RefreshCw className="mr-2 h-4 w-4" />
            数据刷新
          </CardTitle>
          <CardDescription>配置系统监控数据自动刷新频率</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label>自动刷新间隔</Label>
              <p className="text-sm text-muted-foreground">
                仪表盘和系统监控数据的刷新频率
              </p>
            </div>
            <select
              value={String(settings.auto_refresh_interval)}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  auto_refresh_interval: Number(e.target.value),
                }))
              }
              className="w-32 flex h-9 rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="1">1 秒</option>
              <option value="3">3 秒</option>
              <option value="5">5 秒</option>
              <option value="10">10 秒</option>
              <option value="30">30 秒</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* ========== 菜单栏设置 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Menu className="mr-2 h-4 w-4" />
            菜单栏
          </CardTitle>
          <CardDescription>macOS 菜单栏图标显示设置</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label>显示菜单栏图标</Label>
              <p className="text-sm text-muted-foreground">
                在 macOS 顶部菜单栏显示 MacOps 图标
              </p>
            </div>
            <Switch
              checked={settings.show_menu_bar}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, show_menu_bar: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ========== 数据管理 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Database className="mr-2 h-4 w-4" />
            数据管理
          </CardTitle>
          <CardDescription>导出、导入或重置配置数据</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>导出配置</Label>
              <p className="text-sm text-muted-foreground">
                将当前设置导出为 JSON 文件
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              导出
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>导入配置</Label>
              <p className="text-sm text-muted-foreground">
                从 JSON 文件导入设置
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleImport}>
              <Upload className="mr-2 h-4 w-4" />
              导入
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                重置所有数据
              </Label>
              <p className="text-sm text-muted-foreground">
                清除所有设置并恢复默认值
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={handleReset}>
              <Trash2 className="mr-2 h-4 w-4" />
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ========== 关于 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-base">
            <Info className="mr-2 h-4 w-4" />
            关于 MacOps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">应用名称</span>
              <span className="font-medium">MacOps</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">版本号</span>
              <Badge variant="outline">0.1.0</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">描述</span>
              <span>macOS 本地运维面板</span>
            </div>
            <Separator />
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
        </CardContent>
      </Card>
    </div>
  );
}
