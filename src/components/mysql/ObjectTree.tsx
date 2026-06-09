import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Table,
  Eye,
  Zap,
  FunctionSquare,
  Calendar,
  Plus,
  Trash2,
  Edit2,
  Plug,
  Unplug,
  HardDrive,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { showSuccess, showError } from "@/lib/api";
import ConnectionDialog from "./ConnectionDialog";
import BackupDialog from "./BackupDialog";
import type { MysqlConnectionConfig } from "@/types";

interface TreeItemProps {
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
  level?: number;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
}

function TreeItem({
  icon,
  label,
  children,
  level = 0,
  active,
  onClick,
  onDoubleClick,
  actions,
  defaultExpanded = false,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = !!children;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer transition-colors ${
          active ? "bg-primary text-primary-foreground" : "hover:bg-accent/40"
        }`}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          onClick?.();
        }}
        onDoubleClick={onDoubleClick}
      >
        {hasChildren ? (
          <span
            className="shrink-0 opacity-60"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0 opacity-70">{icon}</span>
        <span className="truncate flex-1">{label}</span>
        {actions && (
          <span
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </div>
      {expanded && children}
    </div>
  );
}

export default function ObjectTree() {
  const {
    connections,
    currentConnectionId,
    currentDatabase,
    databases,
    tables,
    views,
    triggers,
    functions,
    events,
    openTabs,
    activeTabIndex,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    connect,
    disconnect,
    selectDatabase,
    loadTableData,
    loadTableStructure,
  } = useMysqlStore();

  const [expandedConn, setExpandedConn] = useState<number | null>(null);
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<MysqlConnectionConfig>>({});
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupConnId, setBackupConnId] = useState<number | null>(null);

  const handleCreate = async (config: MysqlConnectionConfig) => {
    await createConnection(config);
    showSuccess("连接创建成功");
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
      showSuccess("连接更新成功");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此连接？")) return;
    await deleteConnection(id);
    if (expandedConn === id) setExpandedConn(null);
    showSuccess("连接已删除");
  };

  const handleConnect = async (id: number) => {
    try {
      await connect(id);
      setExpandedConn(id);
      showSuccess("连接成功");
    } catch (err: any) {
      showError("连接失败", err.message);
    }
  };

  const handleDisconnect = async (id: number) => {
    await disconnect();
    setExpandedConn(null);
    setExpandedDb(null);
    showSuccess("已断开连接");
  };

  const handleExpandConnection = async (id: number) => {
    if (expandedConn === id) {
      setExpandedConn(null);
      return;
    }
    if (currentConnectionId !== id) {
      try {
        await connect(id);
        showSuccess("连接成功");
      } catch (err: any) {
        showError("连接失败", err.message);
        return;
      }
    }
    setExpandedConn(id);
  };

  const handleExpandDatabase = async (dbName: string) => {
    if (expandedDb === dbName) {
      setExpandedDb(null);
      return;
    }
    await selectDatabase(dbName);
    setExpandedDb(dbName);
  };

  const handleTableClick = (tableName: string) => {
    loadTableData(tableName);
  };

  const handleTableDoubleClick = (tableName: string) => {
    loadTableStructure(tableName);
  };

  return (
    <div className="flex flex-col h-full w-[280px] shrink-0 border-r border-[var(--glass-border)]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">MySQL</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Connection Tree */}
      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        {connections.map((conn) => {
          const isConnected = currentConnectionId === conn.id;
          const isExpanded = expandedConn === conn.id;

          return (
            <TreeItem
              key={conn.id}
              icon={<HardDrive className="h-4 w-4" />}
              label={conn.name}
              active={isConnected}
              defaultExpanded={isExpanded}
              onClick={() => handleExpandConnection(conn.id)}
              actions={
                <div className="flex items-center gap-0.5">
                  {isConnected ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleDisconnect(conn.id)}
                    >
                      <Unplug className="h-3 w-3" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleConnect(conn.id)}
                    >
                      <Plug className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => handleEdit(conn)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => {
                      setBackupConnId(conn.id);
                      setBackupOpen(true);
                    }}
                  >
                    <FolderOpen className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => handleDelete(conn.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              }
            >
              {isConnected && databases.length > 0 && (
                <div className="space-y-0.5">
                  {databases.map((db) => (
                    <TreeItem
                      key={db.name}
                      icon={<Database className="h-3.5 w-3.5 text-primary" />}
                      label={db.name}
                      level={1}
                      active={currentDatabase === db.name}
                      defaultExpanded={expandedDb === db.name}
                      onClick={() => handleExpandDatabase(db.name)}
                    >
                      {expandedDb === db.name && (
                        <div className="space-y-0.5">
                          {/* Tables */}
                          {tables.length > 0 && (
                            <TreeItem
                              icon={<Table className="h-3.5 w-3.5" />}
                              label={`表 (${tables.length})`}
                              level={2}
                            >
                              {tables.map((t) => (
                                <div
                                  key={t.name}
                                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs cursor-pointer transition-colors ${
                                    activeTabIndex >= 0 && openTabs[activeTabIndex]?.table === t.name
                                      ? "bg-primary/20 text-primary"
                                      : "hover:bg-accent/30"
                                  }`}
                                  style={{ paddingLeft: "50px" }}
                                  onClick={() => handleTableClick(t.name)}
                                  onDoubleClick={() =>
                                    handleTableDoubleClick(t.name)
                                  }
                                >
                                  <Table className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{t.name}</span>
                                </div>
                              ))}
                            </TreeItem>
                          )}
                          {/* Views */}
                          {views.length > 0 && (
                            <TreeItem
                              icon={<Eye className="h-3.5 w-3.5" />}
                              label={`视图 (${views.length})`}
                              level={2}
                            >
                              {views.map((v) => (
                                <div
                                  key={v.name}
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                                  style={{ paddingLeft: "50px" }}
                                >
                                  <Eye className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{v.name}</span>
                                </div>
                              ))}
                            </TreeItem>
                          )}
                          {/* Triggers */}
                          {triggers.length > 0 && (
                            <TreeItem
                              icon={<Zap className="h-3.5 w-3.5" />}
                              label={`触发器 (${triggers.length})`}
                              level={2}
                            >
                              {triggers.map((t) => (
                                <div
                                  key={t.name}
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                                  style={{ paddingLeft: "50px" }}
                                >
                                  <Zap className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{t.name}</span>
                                </div>
                              ))}
                            </TreeItem>
                          )}
                          {/* Functions */}
                          {functions.length > 0 && (
                            <TreeItem
                              icon={<FunctionSquare className="h-3.5 w-3.5" />}
                              label={`函数 (${functions.length})`}
                              level={2}
                            >
                              {functions.map((f) => (
                                <div
                                  key={f.name}
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                                  style={{ paddingLeft: "50px" }}
                                >
                                  <FunctionSquare className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{f.name}</span>
                                </div>
                              ))}
                            </TreeItem>
                          )}
                          {/* Events */}
                          {events.length > 0 && (
                            <TreeItem
                              icon={<Calendar className="h-3.5 w-3.5" />}
                              label={`事件 (${events.length})`}
                              level={2}
                            >
                              {events.map((e) => (
                                <div
                                  key={e.name}
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs cursor-pointer hover:bg-accent/30 transition-colors"
                                  style={{ paddingLeft: "50px" }}
                                >
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{e.name}</span>
                                </div>
                              ))}
                            </TreeItem>
                          )}
                        </div>
                      )}
                    </TreeItem>
                  ))}
                </div>
              )}
            </TreeItem>
          );
        })}
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

      <BackupDialog
        open={backupOpen}
        onOpenChange={setBackupOpen}
        connectionId={backupConnId}
      />
    </div>
  );
}
