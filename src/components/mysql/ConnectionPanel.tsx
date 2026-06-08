import { useState } from "react";
import { Database, Plus, Trash2, Edit2, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { toast } from "sonner";
import ConnectionDialog from "./ConnectionDialog";
import type { MysqlConnectionConfig } from "@/types";

export default function ConnectionPanel() {
  const {
    connections,
    currentConnectionId,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    connect,
    disconnect,
  } = useMysqlStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<MysqlConnectionConfig>>({});

  const handleCreate = async (config: MysqlConnectionConfig) => {
    await createConnection(config);
    toast.success("连接创建成功");
  };

  const handleEdit = (conn: (typeof connections)[0]) => {
    setEditingId(conn.id);
    setEditData({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: "",
      database: conn.database,
    });
    setEditOpen(true);
  };

  const handleUpdate = async (config: MysqlConnectionConfig) => {
    if (editingId) {
      await updateConnection(editingId, config);
      toast.success("连接更新成功");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此连接？")) return;
    await deleteConnection(id);
    toast.success("连接已删除");
  };

  const handleConnect = async (id: number) => {
    try {
      await connect(id);
      toast.success("连接成功");
    } catch (err: any) {
      toast.error("连接失败: " + err.message);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast.success("已断开连接");
  };

  return (
    <div className="flex flex-col h-full w-[220px] shrink-0 border-r border-[var(--glass-border)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">MySQL 连接</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {connections.map((conn) => (
          <div
            key={conn.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors ${
              currentConnectionId === conn.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent/40"
            }`}
          >
            <Database className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{conn.name}</span>
            {currentConnectionId === conn.id ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect();
                }}
              >
                <Unplug className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConnect(conn.id);
                }}
              >
                <Plug className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(conn);
              }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(conn.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <ConnectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        onTest={testConnection}
        title="添加 MySQL 连接"
      />

      <ConnectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialData={editData}
        onSubmit={handleUpdate}
        onTest={testConnection}
        title="编辑 MySQL 连接"
      />
    </div>
  );
}
