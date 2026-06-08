import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Bell,
  Clock,
  Activity,
  FileText,
  Thermometer,
  Cpu,
  HardDrive,
  MemoryStick,
  CheckCircle2,
} from "lucide-react";
import type { Notification, NotificationLog } from "@/types";
import {
  toggleNotification,
  listNotificationLogs,
  getErrorMessage,
  showError,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── 预设通知项（写死，不可增删改）─────────────────────────
const PRESET_NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    name: "CPU 温度告警",
    notify_type: "monitor",
    content: "CPU 温度超过阈值，请注意散热",
    trigger_condition: '{"metric":"cpu_temp","threshold":75}',
    enabled: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "CPU 压力告警",
    notify_type: "monitor",
    content: "CPU 使用率过高，系统可能卡顿",
    trigger_condition: '{"metric":"cpu_pressure","threshold":85}',
    enabled: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 3,
    name: "内存使用率告警",
    notify_type: "monitor",
    content: "内存使用率过高，建议关闭部分应用",
    trigger_condition: '{"metric":"memory_usage","threshold":85}',
    enabled: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 4,
    name: "磁盘空间告警",
    notify_type: "monitor",
    content: "磁盘空间不足，请清理无用文件",
    trigger_condition: '{"metric":"disk_usage","threshold":90}',
    enabled: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 5,
    name: "每日健康报告",
    notify_type: "scheduled",
    content: "系统每日健康状态汇总",
    trigger_condition: "0 9 * * *",
    enabled: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
];

const monitorMetricLabels: Record<string, string> = {
  cpu_temp: "CPU 温度",
  cpu_pressure: "CPU 压力",
  memory_usage: "内存使用率",
  disk_usage: "磁盘使用率",
};

const monitorMetricUnits: Record<string, string> = {
  cpu_temp: "°C",
  cpu_pressure: "%",
  memory_usage: "%",
  disk_usage: "%",
};

const metricIcons: Record<string, React.ReactNode> = {
  cpu_temp: <Thermometer className="h-4 w-4" />,
  cpu_pressure: <Cpu className="h-4 w-4" />,
  memory_usage: <MemoryStick className="h-4 w-4" />,
  disk_usage: <HardDrive className="h-4 w-4" />,
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>(PRESET_NOTIFICATIONS);

  // Log viewer states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logNotification, setLogNotification] = useState<Notification | null>(null);
  const [logEntries, setLogEntries] = useState<NotificationLog[]>([]);

  // ─── Toggle handler ───────────────────────────────────────
  const handleToggle = async (notification: Notification, enabled: boolean) => {
    try {
      await toggleNotification(notification.id, enabled);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, enabled } : n))
      );
    } catch (error) {
      console.error("Failed to toggle notification:", error);
      showError("切换状态失败", getErrorMessage(error));
    }
  };

  // ─── Log viewer ───────────────────────────────────────────
  const handleOpenLogs = async (notification: Notification) => {
    setLogNotification(notification);
    setLogDialogOpen(true);
    try {
      const logs = await listNotificationLogs(notification.id);
      setLogEntries(logs);
    } catch (error) {
      console.error("Failed to load logs:", error);
      setLogEntries([]);
    }
  };

  // ─── Type badge helper ────────────────────────────────────
  const getTypeBadge = (type: string) => {
    switch (type) {
      case "scheduled":
        return (
          <Badge className="badge-macos badge-macos-info rounded-full flex items-center gap-1">
            <Clock className="h-3 w-3" />
            定时
          </Badge>
        );
      case "monitor":
        return (
          <Badge className="badge-macos badge-macos-warning rounded-full flex items-center gap-1">
            <Activity className="h-3 w-3" />
            监控
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-[10px] rounded-full">未知</Badge>;
    }
  };

  // ─── Format trigger condition for display ─────────────────
  const formatTriggerCondition = (notification: Notification) => {
    if (notification.notify_type === "scheduled") {
      return notification.trigger_condition;
    }
    try {
      const parsed = JSON.parse(notification.trigger_condition);
      const metric = monitorMetricLabels[parsed.metric] || parsed.metric;
      const unit = monitorMetricUnits[parsed.metric] || "";
      return `${metric} >= ${parsed.threshold}${unit}`;
    } catch {
      return notification.trigger_condition;
    }
  };

  const getMetricIcon = (notification: Notification) => {
    if (notification.notify_type !== "monitor") return null;
    try {
      const parsed = JSON.parse(notification.trigger_condition);
      return metricIcons[parsed.metric] || <Activity className="h-4 w-4" />;
    } catch {
      return <Activity className="h-4 w-4" />;
    }
  };

  // ─── Stats ────────────────────────────────────────────────
  const enabledCount = notifications.filter((n) => n.enabled).length;

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">通知管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            系统预设通知项，可自由开关
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>
            已启用 <span className="font-medium text-foreground">{enabledCount}</span> / {notifications.length}
          </span>
        </div>
      </div>

      {/* Notification Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "50ms" }}>
        {notifications.map((notification, index) => (
          <div
            key={notification.id}
            className="card-macos p-4 flex flex-col group animate-slide-up"
            style={{ animationDelay: `${100 + index * 40}ms` }}
          >
            {/* Top: Icon + Name + Type + Toggle */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {notification.notify_type === "monitor"
                    ? getMetricIcon(notification)
                    : <Bell className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate" title={notification.name}>
                    {notification.name}
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getTypeBadge(notification.notify_type)}
              </div>
            </div>

            {/* Content */}
            {notification.content && (
              <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2">
                {notification.content}
              </p>
            )}

            {/* Trigger condition */}
            <div className="mt-3 rounded-lg bg-muted/60 px-2.5 py-1.5 overflow-hidden border border-[var(--glass-border)]">
              <code className="text-[11px] font-mono text-muted-foreground truncate block">
                {formatTriggerCondition(notification)}
              </code>
            </div>

            {/* Spacer */}
            <div className="flex-1 min-h-[8px]" />

            {/* Bottom: Toggle + Log */}
            <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg text-blue-500 hover:bg-blue-500/10 hover:text-blue-600 gap-1.5 text-xs"
                onClick={() => handleOpenLogs(notification)}
              >
                <FileText className="h-3.5 w-3.5" />
                触发记录
              </Button>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${notification.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                  {notification.enabled ? "已开启" : "已关闭"}
                </span>
                <Switch
                  checked={notification.enabled}
                  onCheckedChange={(checked) => handleToggle(notification, checked)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Log Viewer Dialog ──────────────────────────────── */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[40rem] max-w-[95vw] h-[60vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              {logNotification?.name} - 触发记录
              <Badge variant="secondary" className="text-[10px] ml-2">
                {logEntries.length} 条
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {logEntries.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">暂无触发记录</p>
            ) : (
              logEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex gap-3 text-xs p-2 rounded-lg bg-muted/40"
                >
                  <span className="text-muted-foreground shrink-0 whitespace-nowrap">
                    {new Date(entry.triggered_at).toLocaleString()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{entry.title}</p>
                    <p className="text-muted-foreground mt-0.5">{entry.body}</p>
                    {entry.trigger_value !== undefined && (
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        触发值: {entry.trigger_value.toFixed(1)}
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
