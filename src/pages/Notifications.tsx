import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Settings,
} from "lucide-react";
import type { Notification, NotificationLog } from "@/types";
import {
  listNotifications,
  createNotification,
  updateNotification,
  toggleNotification,
  listNotificationLogs,
  getErrorMessage,
  showSuccess,
  showError,
} from "@/lib/api";

// ─── 预设通知模板（首次加载时同步到后端）────────────────────
const PRESET_TEMPLATES: Omit<Notification, "id" | "created_at" | "updated_at">[] = [
  {
    name: "CPU 温度告警",
    notify_type: "monitor",
    content: "CPU 温度超过阈值，请注意散热",
    trigger_condition: '{"metric":"cpu_temp","threshold":75}',
    enabled: true,
  },
  {
    name: "CPU 压力告警",
    notify_type: "monitor",
    content: "CPU 使用率过高，系统可能卡顿",
    trigger_condition: '{"metric":"cpu_pressure","threshold":85}',
    enabled: true,
  },
  {
    name: "内存使用率告警",
    notify_type: "monitor",
    content: "内存使用率过高，建议关闭部分应用",
    trigger_condition: '{"metric":"memory_usage","threshold":85}',
    enabled: true,
  },
  {
    name: "磁盘空间告警",
    notify_type: "monitor",
    content: "磁盘空间不足，请清理无用文件",
    trigger_condition: '{"metric":"disk_usage","threshold":90}',
    enabled: true,
  },
  {
    name: "每日健康报告",
    notify_type: "scheduled",
    content: "系统每日健康状态汇总",
    trigger_condition: "0 9 * * *",
    enabled: false,
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

type CronMode = "daily" | "weekly" | "monthly" | "hourly" | "custom";

const weekDays = [
  { value: "1", label: "周一" },
  { value: "2", label: "周二" },
  { value: "3", label: "周三" },
  { value: "4", label: "周四" },
  { value: "5", label: "周五" },
  { value: "6", label: "周六" },
  { value: "0", label: "周日" },
];

// ─── Cron helpers ─────────────────────────────────────────
function buildCronExpression(data: {
  cron_mode: CronMode;
  cron_minute: string;
  cron_hour: string;
  cron_weekday: string;
  cron_monthday: string;
  cron_custom: string;
}): string {
  const m = data.cron_minute.padStart(2, "0");
  const h = data.cron_hour.padStart(2, "0");
  switch (data.cron_mode) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${data.cron_weekday}`;
    case "monthly":
      return `${m} ${h} ${data.cron_monthday} * *`;
    case "hourly":
      return `${m} * * * *`;
    case "custom":
      return data.cron_custom.trim();
    default:
      return `${m} ${h} * * *`;
  }
}

function parseCronExpression(
  cron: string,
  defaults: {
    cron_mode: CronMode;
    cron_minute: string;
    cron_hour: string;
    cron_weekday: string;
    cron_monthday: string;
    cron_custom: string;
  }
) {
  const parts = cron.split(" ");
  if (parts.length !== 5) {
    return { ...defaults, cron_mode: "custom" as CronMode, cron_custom: cron };
  }
  const [min, hour, dom, _month, dow] = parts;
  let mode: CronMode = "custom";
  let result = { ...defaults, cron_minute: min, cron_hour: hour, cron_custom: cron };

  if (dom === "*" && _month === "*") {
    if (dow === "*" && hour !== "*") {
      mode = "daily";
    } else if (dow !== "*" && hour !== "*") {
      mode = "weekly";
      result.cron_weekday = dow;
    } else if (hour === "*") {
      mode = "hourly";
    }
  } else if (dom !== "*" && _month === "*" && dow === "*" && hour !== "*") {
    mode = "monthly";
    result.cron_monthday = dom;
  }

  return { ...result, cron_mode: mode };
}

// ─── Monitor condition helpers ────────────────────────────
function parseMonitorCondition(condition: string) {
  try {
    return JSON.parse(condition) as { metric: string; threshold: number };
  } catch {
    return null;
  }
}

function buildMonitorCondition(metric: string, threshold: number) {
  return JSON.stringify({ metric, threshold });
}

// ─── Edit form defaults ───────────────────────────────────
const emptyEditForm = {
  id: 0,
  name: "",
  notify_type: "scheduled" as "scheduled" | "monitor",
  content: "",
  // Cron
  cron_mode: "daily" as CronMode,
  cron_hour: "09",
  cron_minute: "00",
  cron_weekday: "1",
  cron_monthday: "1",
  cron_custom: "0 9 * * *",
  // Monitor
  monitor_metric: "cpu_temp",
  monitor_threshold: "80",
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Log viewer states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logNotification, setLogNotification] = useState<Notification | null>(null);
  const [logEntries, setLogEntries] = useState<NotificationLog[]>([]);

  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });

  // ─── Load & sync preset notifications ─────────────────────
  const loadAndSync = useCallback(async () => {
    setLoading(true);
    try {
      let existing = await listNotifications();

      // 找出后端缺失的预设通知
      const missing = PRESET_TEMPLATES.filter(
        (t) => !existing.some((n) => n.name === t.name)
      );

      // 自动创建缺失的预设通知
      for (const template of missing) {
        await createNotification(template);
      }

      // 如果有创建操作，重新拉取
      if (missing.length > 0) {
        existing = await listNotifications();
      }

      // 只保留预设通知，按预设顺序排序
      const preset = PRESET_TEMPLATES.map(
        (t) => existing.find((n) => n.name === t.name)!
      ).filter(Boolean);

      setNotifications(preset);
    } catch (error) {
      console.error("Failed to sync notifications:", error);
      showError("加载失败", getErrorMessage(error));
      // 降级：前端显示预设（功能受限）
      setNotifications(
        PRESET_TEMPLATES.map((t, i) => ({
          ...t,
          id: -(i + 1),
          created_at: "",
          updated_at: "",
        }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAndSync();
  }, [loadAndSync]);

  // Auto refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      listNotifications().then((data) => {
        const preset = PRESET_TEMPLATES.map(
          (t) => data.find((n) => n.name === t.name)!
        ).filter(Boolean);
        setNotifications(preset);
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

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

  // ─── Edit threshold ───────────────────────────────────────
  const openEditDialog = (notification: Notification) => {
    let form = {
      ...emptyEditForm,
      id: notification.id,
      name: notification.name,
      notify_type: notification.notify_type,
      content: notification.content,
    };

    if (notification.notify_type === "scheduled") {
      const parsed = parseCronExpression(notification.trigger_condition, {
        cron_mode: "daily",
        cron_minute: "00",
        cron_hour: "09",
        cron_weekday: "1",
        cron_monthday: "1",
        cron_custom: "0 9 * * *",
      });
      form = { ...form, ...parsed };
    } else {
      const parsed = parseMonitorCondition(notification.trigger_condition);
      if (parsed) {
        form.monitor_metric = parsed.metric;
        form.monitor_threshold = String(parsed.threshold);
      }
    }

    setEditForm(form);
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    const notification = notifications.find((n) => n.id === editForm.id);
    if (!notification) return;

    const triggerCondition =
      editForm.notify_type === "scheduled"
        ? buildCronExpression(editForm)
        : buildMonitorCondition(
            editForm.monitor_metric,
            parseFloat(editForm.monitor_threshold) || 0
          );

    try {
      await updateNotification({
        ...notification,
        trigger_condition: triggerCondition,
        updated_at: new Date().toISOString(),
      });
      setEditDialogOpen(false);
      loadAndSync();
      showSuccess("阈值更新成功");
    } catch (error) {
      console.error("Failed to update notification:", error);
      showError("更新失败", getErrorMessage(error));
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
            系统预设通知项，可自由开关和自定义阈值
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>
            已启用 <span className="font-medium text-foreground">{enabledCount}</span> / {notifications.length}
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="card-macos py-16 animate-slide-up">
          <div className="text-center space-y-3">
            <div className="mx-auto h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        </div>
      ) : (
        /* Notification Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "50ms" }}>
          {notifications.map((notification, index) => (
            <div
              key={notification.id}
              className="card-macos p-4 flex flex-col group animate-slide-up"
              style={{ animationDelay: `${100 + index * 40}ms` }}
            >
              {/* Top: Icon + Name + Type */}
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

              {/* Trigger condition (clickable) */}
              <button
                className="mt-3 text-left rounded-lg bg-muted/60 px-2.5 py-1.5 overflow-hidden border border-[var(--glass-border)] hover:border-primary/30 hover:bg-muted transition-colors group/condition"
                onClick={() => openEditDialog(notification)}
                title="点击编辑阈值"
              >
                <code className="text-[11px] font-mono text-muted-foreground truncate block group-hover/condition:text-foreground transition-colors">
                  {formatTriggerCondition(notification)}
                </code>
              </button>

              {/* Spacer */}
              <div className="flex-1 min-h-[8px]" />

              {/* Bottom: Actions + Toggle */}
              <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-blue-500 hover:bg-blue-500/10 hover:text-blue-600 gap-1.5 text-xs"
                    onClick={() => handleOpenLogs(notification)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    触发记录
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    title="编辑阈值"
                    onClick={() => openEditDialog(notification)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
      )}

      {/* ─── Edit Threshold Dialog ──────────────────────────── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[28rem] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Settings className="h-4 w-4" />
              编辑「{editForm.name}」的阈值
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* ─── Monitor fields ───────────────────────────── */}
            {editForm.notify_type === "monitor" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">监控指标</Label>
                  <div className="flex h-10 w-full items-center rounded-xl border border-[var(--glass-border-strong)] bg-muted/40 px-3 text-sm text-muted-foreground">
                    {metricIcons[editForm.monitor_metric]}
                    <span className="ml-2">{monitorMetricLabels[editForm.monitor_metric] || editForm.monitor_metric}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">阈值</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={editForm.monitor_metric === "cpu_temp" ? 150 : 100}
                      value={editForm.monitor_threshold}
                      onChange={(e) =>
                        setEditForm({ ...editForm, monitor_threshold: e.target.value })
                      }
                      className="input-macos"
                    />
                    <span className="text-sm text-muted-foreground w-8">
                      {monitorMetricUnits[editForm.monitor_metric]}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* ─── Scheduled fields ─────────────────────────── */}
            {editForm.notify_type === "scheduled" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">触发周期</Label>
                  <select
                    value={editForm.cron_mode}
                    onChange={(e) =>
                      setEditForm({ ...editForm, cron_mode: e.target.value as CronMode })
                    }
                    className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                  >
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                    <option value="hourly">每小时</option>
                    <option value="custom">自定义 (Cron)</option>
                  </select>
                </div>

                {editForm.cron_mode !== "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">小时</Label>
                      <select
                        value={editForm.cron_hour}
                        onChange={(e) =>
                          setEditForm({ ...editForm, cron_hour: e.target.value })
                        }
                        className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={String(i).padStart(2, "0")}>
                            {String(i).padStart(2, "0")} 时
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">分钟</Label>
                      <select
                        value={editForm.cron_minute}
                        onChange={(e) =>
                          setEditForm({ ...editForm, cron_minute: e.target.value })
                        }
                        className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                      >
                        {Array.from({ length: 60 }, (_, i) => (
                          <option key={i} value={String(i).padStart(2, "0")}>
                            {String(i).padStart(2, "0")} 分
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {editForm.cron_mode === "weekly" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">星期</Label>
                    <select
                      value={editForm.cron_weekday}
                      onChange={(e) =>
                        setEditForm({ ...editForm, cron_weekday: e.target.value })
                      }
                      className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                    >
                      {weekDays.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {editForm.cron_mode === "monthly" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">日期</Label>
                    <select
                      value={editForm.cron_monthday}
                      onChange={(e) =>
                        setEditForm({ ...editForm, cron_monthday: e.target.value })
                      }
                      className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                    >
                      {Array.from({ length: 31 }, (_, i) => (
                        <option key={i + 1} value={String(i + 1)}>
                          {i + 1} 日
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {editForm.cron_mode === "custom" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cron 表达式</Label>
                    <Input
                      value={editForm.cron_custom}
                      onChange={(e) =>
                        setEditForm({ ...editForm, cron_custom: e.target.value })
                      }
                      placeholder="分 时 日 月 周"
                      className="input-macos font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      格式: 分 时 日 月 周 (如: 0 9 * * *)
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--glass-border)]">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setEditDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleEditSave}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
