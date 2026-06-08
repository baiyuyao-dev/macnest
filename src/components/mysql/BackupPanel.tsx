import { useState, useEffect } from "react";
import { Plus, Trash2, Play, Pause, Clock, FolderOpen } from "lucide-react";
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
import { toast } from "sonner";

export default function BackupPanel() {
  const {
    connections,
    currentConnectionId,
    currentDatabase,
    backupTasks,
    loadBackupTasks,
    createBackupTask,
    deleteBackupTask,
    toggleBackupTask,
    runBackupNow,
  } = useMysqlStore();

  const [open, setOpen] = useState(false);
  const [cron, setCron] = useState("0 2 * * *");
  const [backupPath, setBackupPath] = useState("~/mysql_backups");
  const [selectedConn, setSelectedConn] = useState<number | null>(null);
  const [selectedDb, setSelectedDb] = useState("");

  useEffect(() => {
    loadBackupTasks();
  }, []);

  const handleCreate = async () => {
    if (!selectedConn || !selectedDb || !cron || !backupPath) {
      toast.error("请填写完整信息");
      return;
    }
    try {
      await createBackupTask(selectedConn, selectedDb, cron, backupPath);
      toast.success("备份任务创建成功");
      setOpen(false);
    } catch (err: any) {
      toast.error("创建失败: " + err.message);
    }
  };

  const handleRun = async (taskId: number) => {
    try {
      const path = await runBackupNow(taskId);
      toast.success("备份完成: " + path);
    } catch (err: any) {
      toast.error("备份失败: " + err.message);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">定时备份</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setSelectedConn(currentConnectionId || connections[0]?.id || null);
            setSelectedDb(currentDatabase || "");
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {backupTasks.map((task) => (
          <div
            key={task.id}
            className="rounded-lg border border-[var(--glass-border)] p-3 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{task.database_name}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => toggleBackupTask(task.id, !task.is_enabled)}
                >
                  {task.is_enabled ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRun(task.id)}
                >
                  <Play className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => deleteBackupTask(task.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {task.cron_expression}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              {task.backup_path}
            </div>
            {task.last_run_at && (
              <div className="text-xs text-muted-foreground">
                上次执行: {task.last_run_at}
                <span
                  className={`ml-1 ${
                    task.last_status === "success"
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {task.last_status === "success" ? "成功" : "失败"}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>添加备份任务</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">连接</Label>
              <select
                className="col-span-3 flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                value={selectedConn || ""}
                onChange={(e) => setSelectedConn(Number(e.target.value))}
              >
                <option value="">选择连接</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">数据库</Label>
              <Input
                className="col-span-3"
                value={selectedDb}
                onChange={(e) => setSelectedDb(e.target.value)}
                placeholder="数据库名"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Cron</Label>
              <Input
                className="col-span-3"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 2 * * *"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">路径</Label>
              <Input
                className="col-span-3"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
                placeholder="~/mysql_backups"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
