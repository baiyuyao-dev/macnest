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
} from "lucide-react";
import { useMysqlStore } from "@/stores/mysql";
import type { MysqlObjectType } from "@/types";

interface TreeNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  onClick?: () => void;
}

function TreeItem({
  node,
  level = 0,
}: {
  node: TreeNode;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-accent/40 transition-colors"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          node.onClick?.();
        }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0">{node.icon}</span>
        <span className="truncate">{node.label}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ObjectTree() {
  const {
    currentConnectionId,
    currentDatabase,
    databases,
    tables,
    views,
    triggers,
    functions,
    events,
    selectDatabase,
    loadTableStructure,
  } = useMysqlStore();

  const [selectedDb, setSelectedDb] = useState<string | null>(null);

  if (!currentConnectionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        请先连接 MySQL
      </div>
    );
  }

  const handleSelectDatabase = async (dbName: string) => {
    setSelectedDb(dbName);
    await selectDatabase(dbName);
  };

  const databaseNodes: TreeNode[] = databases.map((db) => ({
    id: `db-${db.name}`,
    label: db.name,
    icon: <Database className="h-3.5 w-3.5 text-primary" />,
    onClick: () => handleSelectDatabase(db.name),
    children:
      selectedDb === db.name
        ? [
            {
              id: "tables",
              label: `表 (${tables.length})`,
              icon: <Table className="h-3.5 w-3.5" />,
              children: tables.map((t) => ({
                id: `table-${t.name}`,
                label: t.name,
                icon: <Table className="h-3.5 w-3.5" />,
                isLeaf: true,
                onClick: () => loadTableStructure(t.name),
              })),
            },
            {
              id: "views",
              label: `视图 (${views.length})`,
              icon: <Eye className="h-3.5 w-3.5" />,
              children: views.map((v) => ({
                id: `view-${v.name}`,
                label: v.name,
                icon: <Eye className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "triggers",
              label: `触发器 (${triggers.length})`,
              icon: <Zap className="h-3.5 w-3.5" />,
              children: triggers.map((t) => ({
                id: `trigger-${t.name}`,
                label: t.name,
                icon: <Zap className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "functions",
              label: `函数 (${functions.length})`,
              icon: <FunctionSquare className="h-3.5 w-3.5" />,
              children: functions.map((f) => ({
                id: `function-${f.name}`,
                label: f.name,
                icon: <FunctionSquare className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "events",
              label: `事件 (${events.length})`,
              icon: <Calendar className="h-3.5 w-3.5" />,
              children: events.map((e) => ({
                id: `event-${e.name}`,
                label: e.name,
                icon: <Calendar className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
          ]
        : undefined,
  }));

  return (
    <div className="flex flex-col h-full w-[240px] shrink-0 border-r border-[var(--glass-border)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">对象浏览器</span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {databaseNodes.map((node) => (
          <TreeItem key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}
