import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Terminal as TerminalIcon, Plus, Unplug } from "lucide-react";
import XTerm from "@/components/terminal/XTerm";
import {
  createSshConnection,
  listSshConnections,
  deleteSshConnection,
  sshConnect,
  sshDisconnect,
} from "@/lib/api";
import type { SshConnection } from "@/types";

export default function Terminal() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [websocketUrl, setWebsocketUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("22");
  const [formUsername, setFormUsername] = useState("");
  const [formAuthType, setFormAuthType] = useState<"password" | "publickey">("password");
  const [formPassword, setFormPassword] = useState("");
  const [formKeyPath, setFormKeyPath] = useState("");
  const [formKeyPassphrase, setFormKeyPassphrase] = useState("");

  const loadConnections = useCallback(async () => {
    try {
      const list = await listSshConnections();
      setConnections(list);
    } catch (err) {
      console.error("Failed to load connections:", err);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleCreateConnection = async () => {
    try {
      const authType =
        formAuthType === "password"
          ? { type: "Password" as const, password: formPassword }
          : {
              type: "PublicKey" as const,
              key_path: formKeyPath,
              passphrase: formKeyPassphrase || undefined,
            };

      await createSshConnection({
        name: formName,
        host: formHost,
        port: parseInt(formPort, 10) || 22,
        username: formUsername,
        auth_type: authType,
        group_name: "默认",
      });

      setShowNewDialog(false);
      resetForm();
      loadConnections();
    } catch (err) {
      console.error("Failed to create connection:", err);
      alert("保存连接失败: " + String(err));
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort("22");
    setFormUsername("");
    setFormAuthType("password");
    setFormPassword("");
    setFormKeyPath("");
    setFormKeyPassphrase("");
  };

  const handleConnect = async (connectionId: number) => {
    if (connecting) return;
    setConnecting(true);
    try {
      const wsUrl = await sshConnect(connectionId);
      setWebsocketUrl(wsUrl);
    } catch (err) {
      console.error("Failed to connect:", err);
      alert("连接失败: " + String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (sessionId) {
      try {
        await sshDisconnect(sessionId);
      } catch (err) {
        console.error("Failed to disconnect:", err);
      }
    }
    setWebsocketUrl("");
    setSessionId("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b p-3">
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-3 w-3" />
              新建连接
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>新建 SSH 连接</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  placeholder="例如：生产服务器"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="host">主机</Label>
                  <Input
                    id="host"
                    placeholder="192.168.1.1"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">端口</Label>
                  <Input
                    id="port"
                    placeholder="22"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  placeholder="root"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>认证方式</Label>
                <Select
                  value={formAuthType}
                  onValueChange={(v: "password" | "publickey") =>
                    setFormAuthType(v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">密码</SelectItem>
                    <SelectItem value="publickey">公钥</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formAuthType === "password" ? (
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="keyPath">密钥路径</Label>
                    <Input
                      id="keyPath"
                      placeholder="~/.ssh/id_rsa"
                      value={formKeyPath}
                      onChange={(e) => setFormKeyPath(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keyPassphrase">密钥密码（可选）</Label>
                    <Input
                      id="keyPassphrase"
                      type="password"
                      value={formKeyPassphrase}
                      onChange={(e) => setFormKeyPassphrase(e.target.value)}
                    />
                  </div>
                </>
              )}
              <Button
                className="w-full"
                onClick={handleCreateConnection}
                disabled={!formName || !formHost || !formUsername}
              >
                保存连接
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Select
          value={selectedConnectionId}
          onValueChange={(value) => {
            setSelectedConnectionId(value);
            if (value) {
              handleConnect(parseInt(value, 10));
            }
          }}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="选择连接" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} ({c.host})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {websocketUrl && (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDisconnect}
            >
              <Unplug className="mr-1 h-3 w-3" />
              断开
            </Button>
            <span className="ml-auto text-xs text-emerald-500 flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              已连接
            </span>
          </>
        )}

        {connecting && (
          <span className="ml-auto text-xs text-muted-foreground">
            连接中...
          </span>
        )}
      </div>

      {/* Terminal area */}
      <div className="flex-1 overflow-hidden bg-[#1a1a2e]">
        {websocketUrl ? (
          <XTerm websocketUrl={websocketUrl} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <TerminalIcon className="mx-auto mb-3 h-12 w-12 opacity-50" />
              <p className="text-sm">选择一个连接或新建连接</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
