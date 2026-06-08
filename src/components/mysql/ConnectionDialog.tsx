import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showSuccess, showError } from "@/lib/api";
import type { MysqlConnectionConfig } from "@/types";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<MysqlConnectionConfig>;
  onSubmit: (config: MysqlConnectionConfig) => Promise<void>;
  onTest: (config: MysqlConnectionConfig) => Promise<boolean>;
  title: string;
}

export default function ConnectionDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  onTest,
  title,
}: ConnectionDialogProps) {
  const [config, setConfig] = useState<MysqlConnectionConfig>({
    name: initialData?.name || "",
    host: initialData?.host || "localhost",
    port: initialData?.port || 3306,
    username: initialData?.username || "",
    password: initialData?.password || "",
    database: initialData?.database || "",
  });
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const ok = await onTest(config);
      if (ok) {
        showSuccess("连接测试成功");
      } else {
        showError("连接测试失败");
      }
    } catch (err: any) {
      showError("连接测试失败", err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(config);
      onOpenChange(false);
    } catch (err: any) {
      showError("保存失败", err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              名称
            </Label>
            <Input
              id="name"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="col-span-3"
              placeholder="本地 MySQL"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="host" className="text-right">
              主机
            </Label>
            <Input
              id="host"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              className="col-span-3"
              placeholder="localhost"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right">
              端口
            </Label>
            <Input
              id="port"
              type="number"
              value={config.port}
              onChange={(e) =>
                setConfig({ ...config, port: parseInt(e.target.value) || 3306 })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="username" className="text-right">
              用户名
            </Label>
            <Input
              id="username"
              value={config.username}
              onChange={(e) =>
                setConfig({ ...config, username: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
              密码
            </Label>
            <div className="col-span-3 relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={config.password}
                onChange={(e) =>
                  setConfig({ ...config, password: e.target.value })
                }
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="database" className="text-right">
              默认库
            </Label>
            <Input
              id="database"
              value={config.database}
              onChange={(e) =>
                setConfig({ ...config, database: e.target.value })
              }
              className="col-span-3"
              placeholder="(可选)"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
