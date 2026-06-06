import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  X,
  Server,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  Trash2,
  Pencil,
  Play,
  Loader2,
  Monitor,
  ExternalLink,
} from "lucide-react";
import {
  createRdpConnection,
  listRdpConnections,
  updateRdpConnection,
  deleteRdpConnection,
  rdpConnect,
  rdpStartSession,
  rdpStopSession,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getErrorMessage,
} from "@/lib/api";
import { buildGroupTree, flattenGroups, type GroupNode } from "@/lib/tree";
import type { RdpConnection, Group } from "@/types";
import { toast } from "sonner";
import RdpCanvas from "@/components/rdp/RdpCanvas";

/* ── Types ── */

interface RdpGroupNode extends Omit<GroupNode, "children"> {
  connections: RdpConnection[];
  children: RdpGroupNode[];
}

const DEFAULT_SIDEBAR_WIDTH = 280;

function buildRdpGroupTree(groups: Group[], connections: RdpConnection[]): RdpGroupNode[] {
  const tree = buildGroupTree(groups);
  const map = new Map<number, RdpGroupNode>();

  function collect(nodes: GroupNode[]) {
    for (const n of nodes) {
      map.set(n.id, { ...n, children: [], connections: [] });
      collect(n.children);
    }
  }
  collect(tree);

  for (const c of connections) {
    if (c.group_id != null && map.has(c.group_id)) {
      map.get(c.group_id)!.connections.push(c);
    }
  }

  const roots: RdpGroupNode[] = [];
  for (const n of tree) {
    const node = map.get(n.id)!;
    if (n.parent_id != null && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/* ── Sidebar Tree Node ── */

function SidebarTreeNode({
  node,
  depth,
  expandedIds,
  toggleExpand,
  onConnect,
  onSelectConnection,
  onEditConnection,
  onDeleteConnection,
  onNewConnection,
  onEditGroup,
  onDeleteGroup,
  selectedConnectionId,
  connectingId,
}: {
  node: RdpGroupNode;
  depth: number;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  onConnect: (conn: RdpConnection) => void;
  onSelectConnection: (conn: RdpConnection) => void;
  onEditConnection: (conn: RdpConnection) => void;
  onDeleteConnection: (id: number) => void;
  onNewConnection: (groupId: number | null) => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (id: number) => void;
  selectedConnectionId: number | null;
  connectingId: number | null;
}) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0 || node.connections.length > 0;

  return (
    <div>
      {/* Group row */}
      <div
        onClick={() => hasChildren && toggleExpand(node.id)}
        className="group flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer hover:bg-accent/50"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {hasChildren ? (
            <span className="shrink-0 p-0.5 rounded-md">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </span>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <Folder className="h-4 w-4 shrink-0" />
          <span className="truncate text-foreground">{node.name}</span>
          <span className="text-xs text-muted-foreground ml-0.5 opacity-70">
            ({node.connections.length + node.children.reduce((sum, c) => sum + c.connections.length, 0)})
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewConnection(node.id);
            }}
            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center text-primary"
            title="新建连接"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditGroup(node as unknown as Group);
            }}
            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center"
            title="编辑分组"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteGroup(node.id);
            }}
            className="h-6 w-6 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-destructive"
            title="删除分组"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content: sub-groups + connections */}
      {isExpanded && (
        <div>
          {/* Sub-groups */}
          {node.children.map((child) => (
            <SidebarTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              onConnect={onConnect}
              onSelectConnection={onSelectConnection}
              onEditConnection={onEditConnection}
              onDeleteConnection={onDeleteConnection}
              onNewConnection={onNewConnection}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
              selectedConnectionId={selectedConnectionId}
              connectingId={connectingId}
            />
          ))}
          {/* Connections in this group */}
          {node.connections.map((conn) => (
            <div
              key={conn.id}
              onClick={() => onSelectConnection(conn)}
              className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                selectedConnectionId === conn.id
                  ? "bg-primary text-primary-foreground shadow-glass"
                  : "hover:bg-accent/50 text-foreground"
              }`}
              style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
            >
              <Monitor className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 cursor-default">{conn.name}</span>
              <span className={`text-xs shrink-0 opacity-70 ${selectedConnectionId === conn.id ? "text-primary-foreground" : "text-muted-foreground"}`}>{conn.host}</span>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {connectingId === conn.id ? (
                  <span className="h-6 w-6 flex items-center justify-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConnect(conn);
                    }}
                    className={`h-6 w-6 rounded-lg flex items-center justify-center ${
                      selectedConnectionId === conn.id
                        ? "text-primary-foreground hover:bg-white/20"
                        : "text-emerald-400 hover:bg-emerald-500/25 hover:text-white"
                    }`}
                    title="连接"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditConnection(conn);
                  }}
                  className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center"
                  title="编辑"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConnection(conn.id);
                  }}
                  className="h-6 w-6 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-destructive"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

export default function Rdp() {
  const [connections, setConnections] = useState<RdpConnection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  // 内嵌 RDP 会话状态
  const [embeddedSession, setEmbeddedSession] = useState<{
    sessionId: string;
    connection: RdpConnection;
  } | null>(null);

  // Resizable state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);

  // Dialogs
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newConnGroupId, setNewConnGroupId] = useState<number | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editGroupDialogOpen, setEditGroupDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [connDeleteConfirmOpen, setConnDeleteConfirmOpen] = useState(false);
  const [connDeleteTargetId, setConnDeleteTargetId] = useState<number | null>(null);

  // Connection edit dialog
  const [editConnDialogOpen, setEditConnDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RdpConnection | null>(null);

  // Form state (shared for new + edit)
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("3389");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDomain, setFormDomain] = useState("");
  const [formScreenWidth, setFormScreenWidth] = useState("1920");
  const [formScreenHeight, setFormScreenHeight] = useState("1080");
  const [formColorDepth, setFormColorDepth] = useState("32");
  const [formGroupId, setFormGroupId] = useState<number | null>(null);

  // Group form
  const [groupForm, setGroupForm] = useState({ name: "", parent_id: null as number | null, group_type: "rdp" });
  const [editGroupForm, setEditGroupForm] = useState({ id: 0, name: "", parent_id: null as number | null, group_type: "rdp" });

  const loadConnections = useCallback(async () => {
    try {
      const list = await listRdpConnections();
      setConnections(list);
    } catch (err) {
      console.error("Failed to load RDP connections:", err);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await listGroups("rdp");
      setGroups(data);
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  }, []);

  useEffect(() => {
    loadConnections();
    loadGroups();
  }, [loadConnections, loadGroups]);

  const groupTree = useMemo(() => buildRdpGroupTree(groups, connections), [groups, connections]);
  const flatGroups = useMemo(() => flattenGroups(groupTree), [groupTree]);

  const selectedConnection = useMemo(() => {
    return connections.find((c) => c.id === selectedConnectionId) ?? null;
  }, [connections, selectedConnectionId]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConnect = async (conn: RdpConnection) => {
    setConnectingId(conn.id);
    try {
      await rdpConnect(conn.id);
      toast.success(`已启动外部 RDP 客户端: ${conn.name}`);
    } catch (err) {
      console.error("Failed to connect RDP:", err);
      toast.error("RDP 连接失败: " + getErrorMessage(err));
    } finally {
      setConnectingId(null);
    }
  };

  const handleEmbeddedConnect = async (conn: RdpConnection) => {
    setConnectingId(conn.id);
    try {
      const result = await rdpStartSession(conn.id);
      setEmbeddedSession({
        sessionId: result.session_id,
        connection: conn,
      });
      toast.success(`RDP 内嵌会话已启动: ${conn.name}`);
    } catch (err) {
      console.error("Failed to start embedded RDP:", err);
      toast.error("内嵌 RDP 启动失败: " + getErrorMessage(err));
    } finally {
      setConnectingId(null);
    }
  };

  const handleEmbeddedDisconnect = async () => {
    if (embeddedSession) {
      try {
        await rdpStopSession(embeddedSession.sessionId);
      } catch (err) {
        console.error("Failed to disconnect embedded RDP:", err);
      }
      setEmbeddedSession(null);
    }
  };

  const handleSelectConnection = (conn: RdpConnection) => {
    setSelectedConnectionId(conn.id);
  };

  const handleDeleteConnection = (id: number) => {
    setConnDeleteTargetId(id);
    setConnDeleteConfirmOpen(true);
  };

  const confirmDeleteConnection = async () => {
    if (connDeleteTargetId == null) return;
    try {
      await deleteRdpConnection(connDeleteTargetId);
      if (selectedConnectionId === connDeleteTargetId) {
        setSelectedConnectionId(null);
      }
      loadConnections();
      toast.success("连接已删除");
    } catch (err) {
      console.error("Failed to delete connection:", err);
      toast.error("删除失败: " + getErrorMessage(err));
    }
    setConnDeleteConfirmOpen(false);
    setConnDeleteTargetId(null);
  };

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort("3389");
    setFormUsername("");
    setFormPassword("");
    setFormDomain("");
    setFormScreenWidth("1920");
    setFormScreenHeight("1080");
    setFormColorDepth("32");
    setFormGroupId(null);
  };

  const handleNewConnection = (groupId: number | null) => {
    resetForm();
    setFormGroupId(groupId);
    setNewConnGroupId(groupId);
    setShowNewDialog(true);
  };

  const handleEditConnection = (conn: RdpConnection) => {
    setEditingConnection(conn);
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(conn.port.toString());
    setFormUsername(conn.username);
    setFormPassword(conn.password);
    setFormDomain(conn.domain);
    setFormScreenWidth(conn.screen_width.toString());
    setFormScreenHeight(conn.screen_height.toString());
    setFormColorDepth(conn.color_depth.toString());
    setFormGroupId(conn.group_id);
    setEditConnDialogOpen(true);
  };

  const handleSaveConnection = async () => {
    try {
      if (editingConnection) {
        await updateRdpConnection({
          ...editingConnection,
          name: formName,
          host: formHost,
          port: parseInt(formPort, 10) || 3389,
          username: formUsername,
          password: formPassword,
          domain: formDomain,
          screen_width: parseInt(formScreenWidth, 10) || 1920,
          screen_height: parseInt(formScreenHeight, 10) || 1080,
          color_depth: parseInt(formColorDepth, 10) || 32,
          group_id: formGroupId,
        });
        setEditConnDialogOpen(false);
        setEditingConnection(null);
        toast.success("连接已更新");
      } else {
        await createRdpConnection({
          name: formName,
          host: formHost,
          port: parseInt(formPort, 10) || 3389,
          username: formUsername,
          password: formPassword,
          domain: formDomain,
          screen_width: parseInt(formScreenWidth, 10) || 1920,
          screen_height: parseInt(formScreenHeight, 10) || 1080,
          color_depth: parseInt(formColorDepth, 10) || 32,
          group_id: formGroupId,
        });
        setShowNewDialog(false);
        toast.success("连接已创建");
      }
      resetForm();
      loadConnections();
    } catch (err) {
      console.error("Failed to save connection:", err);
      toast.error("保存失败: " + getErrorMessage(err));
    }
  };

  const handleCreateGroup = async () => {
    if (!groupForm.name.trim()) return;
    try {
      await createGroup({
        name: groupForm.name.trim(),
        parent_id: groupForm.parent_id,
        sort_order: groups.length,
        group_type: "rdp",
        start_directory: "",
      });
      setGroupForm({ name: "", parent_id: null, group_type: "rdp" });
      setGroupDialogOpen(false);
      loadGroups();
      toast.success("分组已创建");
    } catch (error) {
      console.error("Failed to create group:", error);
      toast.error("创建分组失败");
    }
  };

  const handleEditGroup = (group: Group) => {
    setEditGroupForm({ id: group.id, name: group.name, parent_id: group.parent_id, group_type: group.group_type });
    setEditGroupDialogOpen(true);
  };

  const handleSaveGroup = async () => {
    if (!editGroupForm.name.trim()) return;
    try {
      const group = groups.find((g) => g.id === editGroupForm.id);
      if (!group) return;
      await updateGroup({ ...group, name: editGroupForm.name.trim(), parent_id: editGroupForm.parent_id, group_type: "rdp" });
      setEditGroupDialogOpen(false);
      loadGroups();
      toast.success("分组已更新");
    } catch (error) {
      console.error("Failed to update group:", error);
      toast.error("更新分组失败");
    }
  };

  const handleDeleteGroup = (id: number) => {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteGroup = async () => {
    if (deleteTargetId == null) return;
    try {
      await deleteGroup(deleteTargetId);
      loadGroups();
      loadConnections();
      toast.success("分组已删除");
    } catch (error) {
      console.error("Failed to delete group:", error);
      toast.error("删除分组失败");
    }
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!sidebarSearch.trim()) return groupTree;
    const q = sidebarSearch.toLowerCase();

    function filterNodes(nodes: RdpGroupNode[]): RdpGroupNode[] {
      const result: RdpGroupNode[] = [];
      for (const node of nodes) {
        const matchName = node.name.toLowerCase().includes(q);
        const filteredChildren = filterNodes(node.children);
        const filteredConns = node.connections.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.host.toLowerCase().includes(q)
        );
        if (matchName || filteredChildren.length > 0 || filteredConns.length > 0) {
          result.push({
            ...node,
            children: matchName ? node.children : filteredChildren,
            connections: matchName ? node.connections : filteredConns,
          });
        }
      }
      return result;
    }

    return filterNodes(groupTree);
  }, [groupTree, sidebarSearch]);

  // Expand all when searching
  useEffect(() => {
    if (sidebarSearch.trim()) {
      const allIds = new Set<number>();
      function collect(nodes: RdpGroupNode[]) {
        for (const n of nodes) {
          allIds.add(n.id);
          collect(n.children);
        }
      }
      collect(filteredTree);
      setExpandedIds(allIds);
    }
  }, [sidebarSearch, filteredTree]);

  // Connection form dialog content (shared between new + edit)
  const connectionFormContent = (
    <div className="space-y-3 py-2">
      <div className="space-y-1">
        <Label className="text-xs">名称</Label>
        <Input placeholder="例如：Windows 服务器" value={formName} onChange={(e) => setFormName(e.target.value)} className="input-macos" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">主机</Label>
          <Input placeholder="192.168.1.100" value={formHost} onChange={(e) => setFormHost(e.target.value)} className="input-macos" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">端口</Label>
          <Input placeholder="3389" value={formPort} onChange={(e) => setFormPort(e.target.value)} className="input-macos" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">用户名</Label>
          <Input placeholder="Administrator" value={formUsername} onChange={(e) => setFormUsername(e.target.value)} className="input-macos" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">密码</Label>
          <Input type="password" placeholder="可选" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="input-macos" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">域（可选）</Label>
        <Input placeholder="WORKGROUP" value={formDomain} onChange={(e) => setFormDomain(e.target.value)} className="input-macos" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">分组</Label>
        <select value={formGroupId?.toString() || ""} onChange={(e) => setFormGroupId(e.target.value ? Number(e.target.value) : null)}
          className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
        >
          <option value="">未分组</option>
          {flatGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {"\u00A0".repeat(g.depth * 2)}{g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">宽度</Label>
          <Input placeholder="1920" value={formScreenWidth} onChange={(e) => setFormScreenWidth(e.target.value)} className="input-macos" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">高度</Label>
          <Input placeholder="1080" value={formScreenHeight} onChange={(e) => setFormScreenHeight(e.target.value)} className="input-macos" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">色深</Label>
          <select value={formColorDepth} onChange={(e) => setFormColorDepth(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
          >
            <option value="16">16 bit</option>
            <option value="24">24 bit</option>
            <option value="32">32 bit</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" className="rounded-lg" onClick={() => {
          if (editingConnection) { setEditConnDialogOpen(false); setEditingConnection(null); }
          else { setShowNewDialog(false); }
          resetForm();
        }}
        >
          取消
        </Button>
        <Button size="sm" className="btn-macos rounded-lg" onClick={handleSaveConnection} disabled={!formName || !formHost}
        >
          {editingConnection ? "保存修改" : "保存连接"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-background animate-page-enter relative">
      {/* ── Sidebar ── */}
      <div
        className="border-r border-[var(--glass-border)] flex flex-col shrink-0 bg-muted/20"
        style={{ width: sidebarWidth }}
      >
        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">RDP 连接</span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 rounded-lg text-xs px-2.5 btn-macos"
              onClick={() => handleNewConnection(null)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              新增连接
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-lg text-xs px-2.5 btn-macos-secondary"
              onClick={() => {
                setGroupForm({ name: "", parent_id: null, group_type: "rdp" });
                setGroupDialogOpen(true);
              }}
            >
              <Folder className="h-3.5 w-3.5 mr-1" />
              新建分组
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--glass-border)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索分组或连接..."
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="h-8 text-xs pl-9 input-macos"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTree.length === 0 && connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <Monitor className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground text-center">暂无 RDP 连接</p>
              <Button
                size="sm"
                className="mt-2 text-sm btn-macos rounded-lg h-8 px-3"
                onClick={() => handleNewConnection(null)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                添加连接
              </Button>
            </div>
          ) : (
            <>
              {/* All connections header */}
              <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
                全部 ({connections.length})
              </div>

              {/* Ungrouped connections */}
              {connections.filter((c) => c.group_id == null).length > 0 && (
                <div className="mb-1">
                  <div className="px-3 py-1 text-xs text-muted-foreground font-medium">未分组</div>
                  {connections
                    .filter((c) => c.group_id == null)
                    .map((conn) => (
                      <div
                        key={conn.id}
                        onClick={() => handleSelectConnection(conn)}
                        className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                          selectedConnectionId === conn.id
                            ? "bg-primary text-primary-foreground shadow-glass"
                            : "hover:bg-accent/50 text-foreground"
                        }`}
                        style={{ paddingLeft: `${12 + 16}px` }}
                      >
                        <Monitor className="h-4 w-4 shrink-0" />
                        <span className="truncate flex-1 cursor-default">{conn.name}</span>
                        <span className={`text-xs shrink-0 opacity-70 ${selectedConnectionId === conn.id ? "text-primary-foreground" : "text-muted-foreground"}`}>{conn.host}</span>
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {connectingId === conn.id ? (
                            <span className="h-6 w-6 flex items-center justify-center">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConnect(conn);
                              }}
                              className={`h-6 w-6 rounded-lg flex items-center justify-center ${
                                "text-white hover:bg-white/20"
                              }`}
                              title="连接"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditConnection(conn);
                            }}
                            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center"
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConnection(conn.id);
                            }}
                            className="h-6 w-6 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-destructive"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {/* Group tree */}
              {filteredTree.map((node) => (
                <SidebarTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onConnect={handleConnect}
                  onSelectConnection={handleSelectConnection}
                  onEditConnection={handleEditConnection}
                  onDeleteConnection={handleDeleteConnection}
                  onNewConnection={handleNewConnection}
                  onEditGroup={handleEditGroup}
                  onDeleteGroup={handleDeleteGroup}
                  selectedConnectionId={selectedConnectionId}
                  connectingId={connectingId}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {embeddedSession ? (
          <RdpCanvas
            sessionId={embeddedSession.sessionId}
            connection={embeddedSession.connection}
            onDisconnect={handleEmbeddedDisconnect}
            onExternalClient={() => {
              handleEmbeddedDisconnect();
              handleConnect(embeddedSession.connection);
            }}
          />
        ) : selectedConnection ? (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto">
            <div className="max-w-2xl mx-auto w-full space-y-6">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Monitor className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold">{selectedConnection.name}</h2>
                  <p className="text-sm text-muted-foreground">{selectedConnection.host}:{selectedConnection.port}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    className="btn-macos rounded-lg"
                    onClick={() => handleEmbeddedConnect(selectedConnection)}
                    disabled={connectingId === selectedConnection.id}
                  >
                    {connectingId === selectedConnection.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Monitor className="h-4 w-4 mr-2" />
                    )}
                    内嵌连接
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => handleConnect(selectedConnection)}
                    disabled={connectingId === selectedConnection.id}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    外部客户端
                  </Button>
                </div>
              </div>

              {/* Info Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">主机</Label>
                  <p className="text-sm font-medium">{selectedConnection.host}</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">端口</Label>
                  <p className="text-sm font-medium">{selectedConnection.port}</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">用户名</Label>
                  <p className="text-sm font-medium">{selectedConnection.username || "-"}</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">域</Label>
                  <p className="text-sm font-medium">{selectedConnection.domain || "-"}</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">分辨率</Label>
                  <p className="text-sm font-medium">{selectedConnection.screen_width} × {selectedConnection.screen_height}</p>
                </div>
                <div className="rounded-xl border border-[var(--glass-border)] bg-card p-4 space-y-1">
                  <Label className="text-xs text-muted-foreground">色深</Label>
                  <p className="text-sm font-medium">{selectedConnection.color_depth} bit</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => handleEditConnection(selectedConnection)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  className="rounded-lg text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteConnection(selectedConnection.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  删除
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <Monitor className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground/50">未选择 RDP 连接</h3>
            <p className="mt-2 text-sm text-muted-foreground/40">从左侧选择一个连接，或新建一个 RDP 连接</p>
            <Button
              className="mt-6 btn-macos"
              onClick={() => handleNewConnection(null)}
            >
              <Plus className="mr-2 h-4 w-4" />
              新建连接
            </Button>
          </div>
        )}
      </div>

      {/* ── New Connection Dialog ── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建 RDP 连接</DialogTitle>
          </DialogHeader>
          {connectionFormContent}
        </DialogContent>
      </Dialog>

      {/* ── Edit Connection Dialog ── */}
      <Dialog open={editConnDialogOpen} onOpenChange={setEditConnDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑 RDP 连接</DialogTitle>
          </DialogHeader>
          {connectionFormContent}
        </DialogContent>
      </Dialog>

      {/* ── New Group Dialog ── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建分组</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">分组名称</Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupForm.name.trim()) handleCreateGroup();
                }}
                className="input-macos"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">上级分组</Label>
              <select
                value={groupForm.parent_id?.toString() || ""}
                onChange={(e) => setGroupForm({ ...groupForm, parent_id: e.target.value ? Number(e.target.value) : null })}
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
              >
                <option value="">一级分组</option>
                {flatGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setGroupDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleCreateGroup}
                disabled={!groupForm.name.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Group Dialog ── */}
      <Dialog open={editGroupDialogOpen} onOpenChange={setEditGroupDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑分组</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">分组名称</Label>
              <Input
                value={editGroupForm.name}
                onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })}
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editGroupForm.name.trim()) handleSaveGroup();
                }}
                className="input-macos"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">上级分组</Label>
              <select
                value={editGroupForm.parent_id?.toString() || ""}
                onChange={(e) => setEditGroupForm({ ...editGroupForm, parent_id: e.target.value ? Number(e.target.value) : null })}
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
              >
                <option value="">一级分组</option>
                {flatGroups
                  .filter((g) => g.id !== editGroupForm.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {"\u00A0".repeat(g.depth * 2)}
                      {g.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setEditGroupDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleSaveGroup}
                disabled={!editGroupForm.name.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Group Delete Confirmation ── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除分组</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            确定要删除该分组吗？该分组下的连接将变为未分组，子分组将提升为一级分组。
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setDeleteTargetId(null);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-lg"
              onClick={confirmDeleteGroup}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Connection Delete Confirmation ── */}
      <Dialog open={connDeleteConfirmOpen} onOpenChange={setConnDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除连接</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">确定要删除该 RDP 连接吗？此操作不可撤销。</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setConnDeleteConfirmOpen(false);
                setConnDeleteTargetId(null);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-lg"
              onClick={confirmDeleteConnection}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
