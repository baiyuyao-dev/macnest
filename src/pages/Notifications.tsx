import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Search,
  AlertTriangle,
  Clock,
  Activity,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import type { Notification, NotificationLog } from "@/types";
import {
  listNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  toggleNotification,
  listNotificationLogs,
  getErrorMessage,
} from "@/lib/api";

type NotifyType = "all" | "scheduled" | "monitor";
type CronMode = "daily" | "weekly" | "monthly" | "hourly" | "custom";
type MonitorMetric = "cpu_temp" | "cpu_pressure" | "memory_usage";

const notifyTypeLabels: Record<string, string> = {
  scheduled: "定时",
  monitor: "监控",
};

const monitorMetricLabels: Record<string, string> = {
  cpu_temp: "CPU 温度",
  cpu_pressure: "CPU 压力",
  memory_usage: "内存使用率",
};

const monitorMetricUnits: Record<string, string> = {
  cpu_temp: "°C",
  cpu_pressure: "%",
  memory_usage: "%",
};

const weekDays = [
  { value: "1", label: "周一" },
  { value: "2", label: "周二" },
  { value: "3", label: "周三" },
  { value: "4", label: "周四" },
  { value: "5", label: "周五" },
  { value: "6", label: "周六" },
  { value: "0", label: "周日" },
];

const emptyFormData = {
  id: 0,
  name: "",
  notify_type: "scheduled" as "scheduled" | "monitor",
  content: "",
  trigger_condition: "",
  enabled: true,
  // Cron helper fields
  cron_mode: "daily" as CronMode,
  cron_hour: "09",
  cron_minute: "00",
  cron_weekday: "1",
  cron_monthday: "1",
  cron_custom: "0 9 * * *",
  // Monitor helper fields
  monitor_metric: "cpu_temp" as MonitorMetric,
  monitor_threshold: "80",
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<NotifyType>("all");
  const [loading, setLoading] = useState(false);

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ ...emptyFormData });

  // Delete confirm state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<Notification | null>(null);

  // Log viewer states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logNotification, setLogNotification] = useState<Notification | null>(null);
  const [logEntries, setLogEntries] = useState<NotificationLog[]>([]);

  // ─── Load notifications ───────────────────────────────────
  const loadNotifications = useCallback(async () => {
    try {
      const data = await listNotifications();
      setNotifications(data);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Auto refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => loadNotifications(), 10000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // ─── Filtered notifications ───────────────────────────────
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      const matchesSearch = n.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = typeFilter === "all" || n.notify_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [notifications, searchQuery, typeFilter]);

  // ─── Cron helpers ─────────────────────────────────────────
  function buildCronExpression(data: typeof emptyFormData): string {
    if (data.notify_type === "monitor") return "";
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

  function parseCronExpression(cron: string, data: typeof emptyFormData): typeof emptyFormData {
    const parts = cron.split(" ");
    if (parts.length !== 5) {
      return { ...data, cron_mode: "custom", cron_custom: cron };
    }
    const [min, hour, dom, _month, dow] = parts;
    let mode: CronMode = "custom";
    let result = { ...data, cron_minute: min, cron_hour: hour, cron_custom: cron };

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

  function buildMonitorCondition(data: typeof emptyFormData): string {
    if (data.notify_type === "scheduled") return "";
    return JSON.stringify({
      metric: data.monitor_metric,
      threshold: parseFloat(data.monitor_threshold) || 0,
    });
  }

  function parseMonitorCondition(condition: string, data: typeof emptyFormData): typeof emptyFormData {
    try {
      const parsed = JSON.parse(condition);
      return {
        ...data,
        monitor_metric: parsed.metric || "cpu_temp",
        monitor_threshold: String(parsed.threshold || "80"),
      };
    } catch {
      return data;
    }
  }

  // ─── CRUD handlers ────────────────────────────────────────
  const openCreateDialog = () => {
    setFormData({ ...emptyFormData });
    setIsEditing(false);
    setDialogOpen(true);
  };

  const openEditDialog = (notification: Notification) => {
    let parsed = { ...emptyFormData };
    if (notification.notify_type === "scheduled") {
      parsed = parseCronExpression(notification.trigger_condition, parsed);
    } else {
      parsed = parseMonitorCondition(notification.trigger_condition, parsed);
    }
    setFormData({
      ...parsed,
      id: notification.id,
      name: notification.name,
      notify_type: notification.notify_type as "scheduled" | "monitor",
      content: notification.content,
      enabled: notification.enabled,
    });
    setIsEditing(true);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    const triggerCondition =
      formData.notify_type === "scheduled"
        ? buildCronExpression(formData)
        : buildMonitorCondition(formData);

    try {
      if (isEditing) {
        await updateNotification({
          id: formData.id,
          name: formData.name,
          notify_type: formData.notify_type,
          content: formData.content,
          trigger_condition: triggerCondition,
          enabled: formData.enabled,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        await createNotification({
          name: formData.name,
          notify_type: formData.notify_type,
          content: formData.content,
          trigger_condition: triggerCondition,
        });
      }
      setDialogOpen(false);
      loadNotifications();
      toast.success(isEditing ? "保存成功" : "创建成功");
    } catch (error) {
      console.error("Failed to save notification:", error);
      toast.error("保存失败", { description: getErrorMessage(error) });
    }
  };

  const openDeleteConfirm = (notification: Notification) => {
    setNotificationToDelete(notification);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!notificationToDelete) return;
    try {
      await deleteNotification(notificationToDelete.id);
      setDeleteConfirmOpen(false);
      setNotificationToDelete(null);
      loadNotifications();
      toast.success("删除成功");
    } catch (error) {
      console.error("Failed to delete notification:", error);
      toast.error("删除失败", { description: getErrorMessage(error) });
    }
  };

  const handleToggle = async (notification: Notification, enabled: boolean) => {
    try {
      await toggleNotification(notification.id, enabled);
      loadNotifications();
    } catch (error) {
      console.error("Failed to toggle notification:", error);
      toast.error("切换状态失败", { description: getErrorMessage(error) });
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

  // ─── Filter tabs ──────────────────────────────────────────
  const typeTabs: { value: NotifyType; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "scheduled", label: "定时" },
    { value: "monitor", label: "监控" },
  ];

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">通知管理</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理定时提醒和系统监控告警</p>
        </div>
        <Button className="btn-macos rounded-xl" onClick={openCreateDialog}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          添加通知
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "50ms" }}>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索通知名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-macos pl-10"
          />
        </div>
        <div className="flex gap-1 p-0.5 rounded-xl bg-muted/50">
          {typeTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={typeFilter === tab.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setTypeFilter(tab.value)}
              className={`text-xs rounded-lg transition-all duration-200 ${
                typeFilter === tab.value
                  ? "bg-primary text-primary-foreground shadow-glass"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.value !== "all" && (
                <span className="ml-1 text-[10px] opacity-60">
                  {notifications.filter((n) => n.notify_type === tab.value).length}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Notification Grid */}
      {notifications.length === 0 ? (
        <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-medium">还没有通知</p>
              <p className="text-xs text-muted-foreground mt-1">添加第一个通知来开始使用</p>
            </div>
            <Button className="btn-macos mt-2 rounded-xl" onClick={openCreateDialog}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              添加第一个通知
            </Button>
          </div>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="text-center">
            <Search className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的通知</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
          {filteredNotifications.map((notification, index) => (
            <div
              key={notification.id}
              className="card-macos p-4 flex flex-col group animate-slide-up"
              style={{ animationDelay: `${150 + index * 40}ms` }}
            >
              {/* Top: Name + Type + Toggle */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate" title={notification.name}>
                    {notification.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {getTypeBadge(notification.notify_type)}
                  <Switch
                    checked={notification.enabled}
                    onCheckedChange={(checked) => handleToggle(notification, checked)}
                  />
                </div>
              </div>

              {/* Content */}
              {notification.content && (
                <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{notification.content}</p>
              )}

              {/* Trigger condition */}
              <div className="mt-3 rounded-lg bg-muted/60 px-2.5 py-1.5 overflow-hidden border border-[var(--glass-border)]">
                <code className="text-[11px] font-mono text-muted-foreground truncate block">
                  {formatTriggerCondition(notification)}
                </code>
              </div>

              {/* Spacer */}
              <div className="flex-1 min-h-[8px]" />

              {/* Action buttons */}
              <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-blue-500 hover:bg-blue-500/10 hover:text-blue-600"
                  title="日志"
                  onClick={() => handleOpenLogs(notification)}
                >
                  <FileText className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                  title="编辑"
                  onClick={() => openEditDialog(notification)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="删除"
                  onClick={() => openDeleteConfirm(notification)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Create/Edit Dialog ─────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[32rem] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {isEditing ? "编辑通知" : "添加通知"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="notif-name" className="text-xs">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="notif-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="如: 每日早报提醒"
                className="input-macos"
              />
            </div>

            {/* Type */}
            <div className="space-y-1.5">
              <Label htmlFor="notif-type" className="text-xs">通知类型</Label>
              <select
                id="notif-type"
                value={formData.notify_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    notify_type: e.target.value as "scheduled" | "monitor",
                  })
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all"
              >
                <option value="scheduled">{notifyTypeLabels.scheduled}</option>
                <option value="monitor">{notifyTypeLabels.monitor}</option>
              </select>
            </div>

            {/* ─── Scheduled fields ─────────────────────────── */}
            {formData.notify_type === "scheduled" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">触发时机</Label>
                  <select
                    value={formData.cron_mode}
                    onChange={(e) =>
                      setFormData({ ...formData, cron_mode: e.target.value as CronMode })
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

                {formData.cron_mode !== "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">小时</Label>
                      <select
                        value={formData.cron_hour}
                        onChange={(e) =>
                          setFormData({ ...formData, cron_hour: e.target.value })
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
                        value={formData.cron_minute}
                        onChange={(e) =>
                          setFormData({ ...formData, cron_minute: e.target.value })
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

                {formData.cron_mode === "weekly" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">星期</Label>
                    <select
                      value={formData.cron_weekday}
                      onChange={(e) =>
                        setFormData({ ...formData, cron_weekday: e.target.value })
                      }
                      className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                    >
                      {weekDays.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {formData.cron_mode === "monthly" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">日期</Label>
                    <select
                      value={formData.cron_monthday}
                      onChange={(e) =>
                        setFormData({ ...formData, cron_monthday: e.target.value })
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

                {formData.cron_mode === "custom" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cron 表达式</Label>
                    <Input
                      value={formData.cron_custom}
                      onChange={(e) =>
                        setFormData({ ...formData, cron_custom: e.target.value })
                      }
                      placeholder="分 时 日 月 周"
                      className="input-macos font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      格式: 分 时 日 月 周 (如: 0 9 * * *)
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">通知内容</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) =>
                      setFormData({ ...formData, content: e.target.value })
                    }
                    placeholder="通知内容..."
                    rows={3}
                    className="input-macos"
                  />
                </div>
              </>
            )}

            {/* ─── Monitor fields ───────────────────────────── */}
            {formData.notify_type === "monitor" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">监控指标</Label>
                  <select
                    value={formData.monitor_metric}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        monitor_metric: e.target.value as MonitorMetric,
                      })
                    }
                    className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
                  >
                    <option value="cpu_temp">CPU 温度 (°C)</option>
                    <option value="cpu_pressure">CPU 压力 (%)</option>
                    <option value="memory_usage">内存使用率 (%)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">阈值</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={formData.monitor_metric === "cpu_temp" ? 150 : 100}
                      value={formData.monitor_threshold}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          monitor_threshold: e.target.value,
                        })
                      }
                      className="input-macos"
                    />
                    <span className="text-sm text-muted-foreground">
                      {monitorMetricUnits[formData.monitor_metric]}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">通知内容</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) =>
                      setFormData({ ...formData, content: e.target.value })
                    }
                    placeholder="通知内容（可选，留空将使用默认格式）..."
                    rows={3}
                    className="input-macos"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--glass-border)]">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleSave}
                disabled={!formData.name.trim()}
              >
                {isEditing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm Dialog ─────────────────────────── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除通知
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除通知{" "}
              <span className="font-medium text-foreground">{notificationToDelete?.name}</span>{" "}
              吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              取消
            </Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
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
