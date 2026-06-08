import { useState, useEffect } from "react";
import { Clock, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMysqlStore } from "@/stores/mysql";
import { showSuccess, showError } from "@/lib/api";

const PRESETS = [
  { label: "每小时", cron: "0 * * * *" },
  { label: "每天凌晨2点", cron: "0 2 * * *" },
  { label: "每天凌晨4点", cron: "0 4 * * *" },
  { label: "每周一凌晨3点", cron: "0 3 * * 1" },
  { label: "每月1号凌晨2点", cron: "0 2 1 * *" },
];

interface BackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: number | null;
}

export default function BackupDialog({
  open,
  onOpenChange,
  connectionId,
}: BackupDialogProps) {
  const {
    connections,
    currentDatabase,
    backupTasks,
    loadBackupTasks,
    createBackupTask,
    deleteBackupTask,
    toggleBackupTask,
    runBackupNow,
  } = useMysqlStore();

  const [cron, setCron] = useState("0 2 * * *");
  const [backupPath, setBackupPath] = useState("~/mysql_backups");
  const [selectedDb, setSelectedDb] = useState("");

  useEffect(() => {
    if (open) {
      loadBackupTasks();
      setSelectedDb(currentDatabase || "");
    }
  }, [open]);

  const handleCreate = async () => {
    if (!connectionId || !selectedDb || !cron || !backupPath) {
      showError("请填写完整信息");
      return;
    }
    try {
      await createBackupTask(connectionId, selectedDb, cron, backupPath);
      showSuccess("备份任务创建成功");
      setCron("0 2 * * *");
    } catch (err: any) {
      showError("创建失败", err.message);
    }
  };

  const handleRun = async (taskId: number) => {
    try {
      const path = await runBackupNow(taskId);
      showSuccess("备份完成", path);
    } catch (err: any) {
      showError("备份失败", err.message);
    }
  };

  const conn = connections.find((c) => c.id === connectionId);
  const connTasks = backupTasks.filter((t) => t.connection_id === connectionId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>备份管理 {conn ? `— ${conn.name}` : ""}</DialogTitle>
        </DialogHeader>

        {/* Create new task */}
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">数据库</Label>
            <Input
              className="col-span-3"
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              placeholder="数据库名"
            />
          </div>

          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="text-right pt-2">周期</Label>
            <div className="col-span-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <Button
                    key={p.cron}
                    size="sm"
                    variant={cron === p.cron ? "default" : "outline"}
                    onClick={() => setCron(p.cron)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 2 * * *"
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">路径</Label>
            <div className="col-span-3 relative">
              <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
                placeholder="~/mysql_backups"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleCreate}>
              创建任务
            </Button>
          </div>
        </div>

        {/* Task list */}
        {connTasks.length > 0 && (
          <>
            <div className="border-t border-[var(--glass-border)]" />
            <div className="space-y-2 max-h-[200px] overflow-auto">
              {connTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] px-3 py-2 text-sm"
                >
                  <div className="space-y-0.5">
                    <span className="font-medium">{task.database_name}</span>
                    <div className="text-xs text-muted-foreground">
                      {task.cron_expression}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={task.is_enabled ? "default" : "outline"}
                      className="h-6 text-xs"
                      onClick={() =>
                        toggleBackupTask(task.id, !task.is_enabled)
                      }
                    >
                      {task.is_enabled ? "启用中" : "已暂停"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      onClick={() => handleRun(task.id)}
                    >
                      立即执行
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => deleteBackupTask(task.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
