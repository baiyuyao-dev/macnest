import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  X,
  Server,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  Trash2,
  Edit,
  Terminal as TerminalIcon,
  Play,
} from "lucide-react";
import XTerm, { type XTermHandle } from "@/components/terminal/XTerm";
import SftpPanel from "@/components/terminal/SftpPanel";
import {
  createSshConnection,
  listSshConnections,
  updateSshConnection,
  deleteSshConnection,
  sshConnect,
  sshDisconnect,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "@/lib/api";
import { useTerminalStore } from "@/stores/terminal";
import { buildGroupTree, flattenGroups, type GroupNode } from "@/lib/tree";
import type { SshConnection, Group } from "@/types";

/* ── Types ── */

interface TerminalGroupNode extends Omit<GroupNode, "children"> {
  connections: SshConnection[];
  children: TerminalGroupNode[];
}

const DEFAULT_SIDEBAR_WIDTH = 220;

function buildTerminalGroupTree(groups: Group[], connections: SshConnection[]): TerminalGroupNode[] {
  const tree = buildGroupTree(groups);
  const map = new Map<number, TerminalGroupNode>();

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

  const roots: TerminalGroupNode[] = [];
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
  onEditConnection,
  onDeleteConnection,
  onNewConnection,
  onEditGroup,
  onDeleteGroup,
  activeConnectionId,
}: {
  node: TerminalGroupNode;
  depth: number;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  onConnect: (conn: SshConnection) => void;
  onEditConnection: (conn: SshConnection) => void;
  onDeleteConnection: (id: number) => void;
  onNewConnection: (groupId: number | null) => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (id: number) => void;
  activeConnectionId: number | null;
}) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0 || node.connections.length > 0;

  return (
    <div>
      {/* Group row */}
      <div
        className="group flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer hover:bg-[#2a2a40]"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="shrink-0 p-0.5 rounded hover:bg-[#333]"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-[#888]" />
              ) : (
                <ChevronRight className="h-3 w-3 text-[#888]" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-[#e5a000]" />
          <span className="truncate text-[#ccc]">{node.name}</span>
          <span className="text-[10px] text-[#666] ml-0.5">
            ({node.connections.length + node.children.reduce((sum, c) => sum + c.connections.length, 0)})
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewConnection(node.id);
            }}
            className="p-0.5 rounded hover:bg-[#333] text-[#0dbc79]"
            title="新建连接"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditGroup(node);
            }}
            className="p-0.5 rounded hover:bg-[#333] text-[#888]"
            title="编辑分组"
          >
            <Edit className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteGroup(node.id);
            }}
            className="p-0.5 rounded hover:bg-[#333] text-[#f14c4c]"
            title="删除分组"
          >
            <Trash2 className="h-3 w-3" />
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
              onEditConnection={onEditConnection}
              onDeleteConnection={onDeleteConnection}
              onNewConnection={onNewConnection}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
              activeConnectionId={activeConnectionId}
            />
          ))}
          {/* Connections in this group */}
          {node.connections.map((conn) => (
            <div
              key={conn.id}
              onDoubleClick={() => onConnect(conn)}
              className={`group flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                activeConnectionId === conn.id
                  ? "bg-[#0dbc79]/20 text-[#0dbc79]"
                  : "hover:bg-[#252540] text-[#999]"
              }`}
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
            >
              <TerminalIcon className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1 cursor-default">{conn.name}</span>
              <span className="text-[10px] text-[#666] shrink-0">{conn.host}</span>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnect(conn);
                  }}
                  className="p-0.5 rounded hover:bg-[#333] text-[#0dbc79]"
                  title="连接"
                >
                  <Play className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditConnection(conn);
                  }}
                  className="p-0.5 rounded hover:bg-[#333] text-[#888]"
                  title="编辑"
                >
                  <Edit className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConnection(conn.id);
                  }}
                  className="p-0.5 rounded hover:bg-[#333] text-[#f14c4c]"
                  title="删除"
                >
                  <Trash2 className="h-3 w-3" />
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

export default function Terminal() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useTerminalStore();

  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  // Resizable state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [terminalHeight, setTerminalHeight] = useState(60);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const termPanelRef = useRef<HTMLDivElement>(null);
  const sftpPanelRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const xtermRefs = useRef<Map<string, XTermHandle>>(new Map());
  const isDraggingH = useRef(false);
  const isDraggingV = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const startYRef = useRef(0);
  const startPctRef = useRef(45);

  // Drag handlers — direct DOM manipulation, no React state during drag
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDraggingH.current && sidebarRef.current) {
        const delta = e.clientX - startXRef.current;
        const w = Math.max(160, Math.min(400, startWidthRef.current + delta));
        sidebarRef.current.style.width = w + "px";
      }
      if (isDraggingV.current && termPanelRef.current && sftpPanelRef.current) {
        const parent = sftpPanelRef.current.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          const delta = e.clientY - startYRef.current;
          const deltaPct = (delta / rect.height) * 100;
          const pct = Math.max(20, Math.min(80, startPctRef.current + deltaPct));
          termPanelRef.current.style.flex = String(pct);
          sftpPanelRef.current.style.flex = String(100 - pct);
        }
      }
    };
    const handleUp = () => {
      if (isDraggingH.current) {
        isDraggingH.current = false;
        const w = sidebarRef.current?.offsetWidth ?? DEFAULT_SIDEBAR_WIDTH;
        setSidebarWidth(w);
      }
      if (isDraggingV.current) {
        isDraggingV.current = false;
        const pct = Number(termPanelRef.current?.style.flex ?? 45);
        setTerminalHeight(pct);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.pointerEvents = "";
    };
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  // Sidebar state
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sidebarSearch, setSidebarSearch] = useState("");

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
  const [editingConnection, setEditingConnection] = useState<SshConnection | null>(null);

  // Form state (shared for new + edit)
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("22");
  const [formUsername, setFormUsername] = useState("");
  const [formAuthType, setFormAuthType] = useState<"password" | "publickey">("password");
  const [formPassword, setFormPassword] = useState("");
  const [formKeyPath, setFormKeyPath] = useState("");
  const [formKeyPassphrase, setFormKeyPassphrase] = useState("");
  const [formGroupId, setFormGroupId] = useState<number | null>(null);

  // Group form
  const [groupForm, setGroupForm] = useState({ name: "", parent_id: null as number | null });
  const [editGroupForm, setEditGroupForm] = useState({ id: 0, name: "", parent_id: null as number | null });

  const loadConnections = useCallback(async () => {
    try {
      const list = await listSshConnections();
      setConnections(list);
    } catch (err) {
      console.error("Failed to load connections:", err);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await listGroups();
      setGroups(data);
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  }, []);

  useEffect(() => {
    loadConnections();
    loadGroups();
  }, [loadConnections, loadGroups]);

  const groupTree = useMemo(() => buildTerminalGroupTree(groups, connections), [groups, connections]);

  const flatGroups = useMemo(() => flattenGroups(groupTree), [groupTree]);

  const activeConnectionId = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    return activeTab?.connectionId ?? null;
  }, [tabs, activeTabId]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConnect = async (conn: SshConnection) => {
    const existing = tabs.find((t) => t.connectionId === conn.id);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    setConnectingId(conn.id);
    try {
      const result = await sshConnect(conn.id);
      addTab({
        id: crypto.randomUUID(),
        name: conn.name,
        connectionId: conn.id,
        sessionId: result.session_id,
        websocketUrl: result.websocket_url,
      });
    } catch (err) {
      console.error("Failed to connect:", err);
      alert("连接失败: " + String(err));
    } finally {
      setConnectingId(null);
    }
  };

  const handleCloseTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      try {
        await sshDisconnect(tab.sessionId);
      } catch (err) {
        console.error("Failed to disconnect:", err);
      }
    }
    removeTab(tabId);
  };

  const handleDeleteConnection = (id: number) => {
    setConnDeleteTargetId(id);
    setConnDeleteConfirmOpen(true);
  };

  const confirmDeleteConnection = async () => {
    if (connDeleteTargetId == null) return;
    try {
      await deleteSshConnection(connDeleteTargetId);
      loadConnections();
    } catch (err) {
      console.error("Failed to delete connection:", err);
      alert("删除失败: " + String(err));
    }
    setConnDeleteConfirmOpen(false);
    setConnDeleteTargetId(null);
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
    setFormGroupId(null);
  };

  const handleNewConnection = (groupId: number | null) => {
    resetForm();
    setFormGroupId(groupId);
    setNewConnGroupId(groupId);
    setShowNewDialog(true);
  };

  const handleEditConnection = (conn: SshConnection) => {
    setEditingConnection(conn);
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(conn.port.toString());
    setFormUsername(conn.username);
    setFormGroupId(conn.group_id);

    if (conn.auth_type.type === "Password") {
      setFormAuthType("password");
      setFormPassword(conn.auth_type.password);
      setFormKeyPath("");
      setFormKeyPassphrase("");
    } else {
      setFormAuthType("publickey");
      setFormPassword("");
      setFormKeyPath(conn.auth_type.key_path);
      setFormKeyPassphrase(conn.auth_type.passphrase || "");
    }

    setEditConnDialogOpen(true);
  };

  const handleSaveConnection = async () => {
    const authType =
      formAuthType === "password"
        ? { type: "Password" as const, password: formPassword }
        : {
            type: "PublicKey" as const,
            key_path: formKeyPath,
            passphrase: formKeyPassphrase || undefined,
          };

    try {
      if (editingConnection) {
        await updateSshConnection({
          ...editingConnection,
          name: formName,
          host: formHost,
          port: parseInt(formPort, 10) || 22,
          username: formUsername,
          auth_type: authType,
          group_id: formGroupId,
        });
        setEditConnDialogOpen(false);
        setEditingConnection(null);
      } else {
        await createSshConnection({
          name: formName,
          host: formHost,
          port: parseInt(formPort, 10) || 22,
          username: formUsername,
          auth_type: authType,
          group_id: formGroupId,
        });
        setShowNewDialog(false);
      }
      resetForm();
      loadConnections();
    } catch (err) {
      console.error("Failed to save connection:", err);
      alert("保存失败: " + String(err));
    }
  };

  const handleCreateGroup = async () => {
    if (!groupForm.name.trim()) return;
    try {
      await createGroup({
        name: groupForm.name.trim(),
        parent_id: groupForm.parent_id,
        sort_order: groups.length,
      });
      setGroupForm({ name: "", parent_id: null });
      setGroupDialogOpen(false);
      loadGroups();
    } catch (error) {
      console.error("Failed to create group:", error);
    }
  };

  const handleEditGroup = (group: Group) => {
    setEditGroupForm({ id: group.id, name: group.name, parent_id: group.parent_id });
    setEditGroupDialogOpen(true);
  };

  const handleSaveGroup = async () => {
    if (!editGroupForm.name.trim()) return;
    try {
      const group = groups.find((g) => g.id === editGroupForm.id);
      if (!group) return;
      await updateGroup({ ...group, name: editGroupForm.name.trim(), parent_id: editGroupForm.parent_id });
      setEditGroupDialogOpen(false);
      loadGroups();
    } catch (error) {
      console.error("Failed to update group:", error);
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
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!sidebarSearch.trim()) return groupTree;
    const q = sidebarSearch.toLowerCase();

    function filterNodes(nodes: TerminalGroupNode[]): TerminalGroupNode[] {
      const result: TerminalGroupNode[] = [];
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
      function collect(nodes: TerminalGroupNode[]) {
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
        <Label className="text-[#aaa] text-xs">名称</Label>
        <Input
          placeholder="例如：生产服务器"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label className="text-[#aaa] text-xs">主机</Label>
          <Input
            placeholder="192.168.1.1"
            value={formHost}
            onChange={(e) => setFormHost(e.target.value)}
            className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[#aaa] text-xs">端口</Label>
          <Input
            placeholder="22"
            value={formPort}
            onChange={(e) => setFormPort(e.target.value)}
            className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[#aaa] text-xs">用户名</Label>
        <Input
          placeholder="root"
          value={formUsername}
          onChange={(e) => setFormUsername(e.target.value)}
          className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[#aaa] text-xs">分组</Label>
        <select
          value={formGroupId?.toString() || ""}
          onChange={(e) => setFormGroupId(e.target.value ? Number(e.target.value) : null)}
          className="flex h-9 w-full rounded-md border border-[#333] bg-[#1a1a2e] px-3 py-1 text-sm text-[#ccc]"
        >
          <option value="">未分组</option>
          {flatGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {"\u00A0".repeat(g.depth * 2)}
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-[#aaa] text-xs">认证方式</Label>
        <Select value={formAuthType} onValueChange={(v) => setFormAuthType(v as "password" | "publickey")}>
          <SelectTrigger className="bg-[#1a1a2e] border-[#333] text-[#ccc]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1e1e2e] border-[#333]">
            <SelectItem value="password">密码</SelectItem>
            <SelectItem value="publickey">公钥</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {formAuthType === "password" ? (
        <div className="space-y-1">
          <Label className="text-[#aaa] text-xs">密码</Label>
          <Input
            type="password"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
          />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-[#aaa] text-xs">密钥路径</Label>
            <Input
              placeholder="~/.ssh/id_rsa"
              value={formKeyPath}
              onChange={(e) => setFormKeyPath(e.target.value)}
              className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[#aaa] text-xs">密钥密码（可选）</Label>
            <Input
              type="password"
              value={formKeyPassphrase}
              onChange={(e) => setFormKeyPassphrase(e.target.value)}
              className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
            />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="border-[#444] text-[#ccc] hover:bg-[#333]"
          onClick={() => {
            if (editingConnection) {
              setEditConnDialogOpen(false);
              setEditingConnection(null);
            } else {
              setShowNewDialog(false);
            }
            resetForm();
          }}
        >
          取消
        </Button>
        <Button
          size="sm"
          className="bg-[#0dbc79] hover:bg-[#0dbc79]/90 text-black"
          onClick={handleSaveConnection}
          disabled={!formName || !formHost || !formUsername}
        >
          {editingConnection ? "保存修改" : "保存连接"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-[#1e1e2e]">
      {/* ── Sidebar ── */}
      <div
        className="border-r border-[#333] flex flex-col shrink-0 bg-[#161622]"
        style={{ width: sidebarWidth }}
        ref={sidebarRef}
      >
        <div className="px-3 py-2 border-b border-[#333] flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#888] uppercase tracking-wider">连接管理</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-[#0dbc79] hover:bg-[#252540]"
            onClick={() => handleNewConnection(null)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b border-[#333]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#666]" />
            <Input
              placeholder="搜索分组或连接..."
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="h-7 text-xs pl-7 bg-[#1a1a2e] border-[#333] text-[#ccc] placeholder:text-[#555]"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {filteredTree.length === 0 && connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <Server className="h-8 w-8 text-[#444] mb-2" />
              <p className="text-[11px] text-[#666] text-center">暂无连接</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 text-[10px] text-[#0dbc79] hover:bg-[#252540]"
                onClick={() => handleNewConnection(null)}
              >
                <Plus className="h-3 w-3 mr-1" />
                添加连接
              </Button>
            </div>
          ) : (
            <>
              {/* Ungrouped connections */}
              {connections.filter((c) => c.group_id == null).length > 0 && (
                <div className="mb-1">
                  <div className="px-2 py-1 text-[10px] text-[#666] font-medium">未分组</div>
                  {connections
                    .filter((c) => c.group_id == null)
                    .map((conn) => (
                      <div
                        key={conn.id}
                        onDoubleClick={() => handleConnect(conn)}
                        className={`group flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                          activeConnectionId === conn.id
                            ? "bg-[#0dbc79]/20 text-[#0dbc79]"
                            : "hover:bg-[#252540] text-[#999]"
                        }`}
                      >
                        <TerminalIcon className="h-3 w-3 shrink-0" />
                        <span className="truncate flex-1 cursor-default">{conn.name}</span>
                        <span className="text-[10px] text-[#666] shrink-0">{conn.host}</span>
                        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConnect(conn);
                            }}
                            className="p-0.5 rounded hover:bg-[#333] text-[#0dbc79]"
                            title="连接"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditConnection(conn);
                            }}
                            className="p-0.5 rounded hover:bg-[#333] text-[#888]"
                            title="编辑"
                          >
                            <Edit className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConnection(conn.id);
                            }}
                            className="p-0.5 rounded hover:bg-[#333] text-[#f14c4c]"
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
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
                  onEditConnection={handleEditConnection}
                  onDeleteConnection={handleDeleteConnection}
                  onNewConnection={handleNewConnection}
                  onEditGroup={handleEditGroup}
                  onDeleteGroup={handleDeleteGroup}
                  activeConnectionId={activeConnectionId}
                />
              ))}
            </>
          )}
        </div>

        {/* Bottom: add group */}
        <div className="px-2 py-1.5 border-t border-[#333]">
          <Button
            size="sm"
            variant="ghost"
            className="w-full h-7 text-[10px] text-[#888] hover:bg-[#252540] hover:text-[#ccc] justify-start"
            onClick={() => {
              setGroupForm({ name: "", parent_id: null });
              setGroupDialogOpen(true);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            新建分组
          </Button>
        </div>
      </div>

      {/* Horizontal splitter */}
      <div
        className="w-[5px] bg-[#222] hover:bg-[#0dbc79] cursor-col-resize shrink-0 z-20 transition-colors"
        onMouseDown={(e) => {
          isDraggingH.current = true;
          startXRef.current = e.clientX;
          startWidthRef.current = sidebarRef.current?.offsetWidth ?? DEFAULT_SIDEBAR_WIDTH;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          document.body.style.pointerEvents = "none";
        }}
      />

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="flex items-center border-b border-[#333] bg-[#1a1a2e] overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-[#333] shrink-0 transition-colors min-w-0 ${
                  activeTabId === tab.id
                    ? "bg-[#1e1e2e] text-[#0dbc79] border-t-2 border-t-[#0dbc79]"
                    : "bg-[#161622] text-[#888] hover:bg-[#1e1e2e] hover:text-[#ccc]"
                }`}
              >
                <TerminalIcon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[120px]">{tab.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-[#333] shrink-0 ${
                    activeTabId === tab.id ? "text-[#888]" : "text-[#555]"
                  }`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 relative overflow-hidden">
          {tabs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Server className="h-16 w-16 text-[#333] mb-4" />
              <h3 className="text-lg font-semibold text-[#666]">未打开任何会话</h3>
              <p className="mt-2 text-sm text-[#555]">双击左侧连接或点击连接按钮，或新建一个连接</p>
              <Button
                className="mt-6 bg-[#0dbc79] hover:bg-[#0dbc79]/90 text-black"
                onClick={() => handleNewConnection(null)}
              >
                <Plus className="mr-2 h-4 w-4" />
                新建连接
              </Button>
            </div>
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: activeTabId === tab.id ? "flex" : "none",
                }}
              >
                {/* Status bar */}
                <div className="flex items-center justify-between px-3 py-1 border-b border-[#333] bg-[#1a1a2e] shrink-0">
                  <span className="text-[10px] text-[#0dbc79] flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#0dbc79] animate-pulse" />
                    {tab.name} — {tab.websocketUrl}
                  </span>
                </div>
                {/* Terminal + SFTP */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="overflow-hidden bg-[#1a1a2e]" ref={termPanelRef} style={{ flex: terminalHeight }}>
                    <XTerm
                      ref={(el) => {
                        if (el) xtermRefs.current.set(tab.id, el);
                        else xtermRefs.current.delete(tab.id);
                      }}
                      websocketUrl={tab.websocketUrl}
                      active={activeTabId === tab.id}
                    />
                  </div>
                  {/* Vertical splitter */}
                  <div
                    className="h-[5px] bg-[#222] hover:bg-[#0dbc79] cursor-row-resize shrink-0 z-10 transition-colors"
                    onMouseDown={(e) => {
                      isDraggingV.current = true;
                      startYRef.current = e.clientY;
                      const parent = sftpPanelRef.current?.parentElement;
                      if (parent) {
                        const rect = parent.getBoundingClientRect();
                        const top = termPanelRef.current?.getBoundingClientRect().top ?? rect.top;
                        startPctRef.current = ((e.clientY - top) / rect.height) * 100;
                      }
                      document.body.style.cursor = "row-resize";
                      document.body.style.userSelect = "none";
                      document.body.style.pointerEvents = "none";
                    }}
                  />
                  <div className="overflow-hidden" ref={sftpPanelRef} style={{ flex: 100 - terminalHeight }}>
                    <SftpPanel
                      sessionId={tab.sessionId}
                      onSyncToTerminal={(path) => {
                        const xterm = xtermRefs.current.get(tab.id);
                        if (xterm) {
                          xterm.sendCommand(`cd ${path}`);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── New Connection Dialog ── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">新建 SSH 连接</DialogTitle>
          </DialogHeader>
          {connectionFormContent}
        </DialogContent>
      </Dialog>

      {/* ── Edit Connection Dialog ── */}
      <Dialog open={editConnDialogOpen} onOpenChange={setEditConnDialogOpen}>
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">编辑 SSH 连接</DialogTitle>
          </DialogHeader>
          {connectionFormContent}
        </DialogContent>
      </Dialog>

      {/* ── New Group Dialog ── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">新建分组</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-[#aaa] text-xs">分组名称</Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupForm.name.trim()) handleCreateGroup();
                }}
                className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[#aaa] text-xs">上级分组</Label>
              <select
                value={groupForm.parent_id?.toString() || ""}
                onChange={(e) => setGroupForm({ ...groupForm, parent_id: e.target.value ? Number(e.target.value) : null })}
                className="flex h-9 w-full rounded-md border border-[#333] bg-[#1a1a2e] px-3 py-1 text-sm text-[#ccc]"
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
                className="border-[#444] text-[#ccc] hover:bg-[#333]"
                onClick={() => setGroupDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="bg-[#0dbc79] hover:bg-[#0dbc79]/90 text-black"
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
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">编辑分组</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-[#aaa] text-xs">分组名称</Label>
              <Input
                value={editGroupForm.name}
                onChange={(e) => setEditGroupForm({ ...editGroupForm, name: e.target.value })}
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editGroupForm.name.trim()) handleSaveGroup();
                }}
                className="bg-[#1a1a2e] border-[#333] text-[#ccc]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[#aaa] text-xs">上级分组</Label>
              <select
                value={editGroupForm.parent_id?.toString() || ""}
                onChange={(e) => setEditGroupForm({ ...editGroupForm, parent_id: e.target.value ? Number(e.target.value) : null })}
                className="flex h-9 w-full rounded-md border border-[#333] bg-[#1a1a2e] px-3 py-1 text-sm text-[#ccc]"
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
                className="border-[#444] text-[#ccc] hover:bg-[#333]"
                onClick={() => setEditGroupDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="bg-[#0dbc79] hover:bg-[#0dbc79]/90 text-black"
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
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">确认删除分组</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#999] py-2">
            确定要删除该分组吗？该分组下的连接将变为未分组，子分组将提升为一级分组。
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="border-[#444] text-[#ccc] hover:bg-[#333]"
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
              className="bg-[#c0392b] hover:bg-[#e74c3c]"
              onClick={confirmDeleteGroup}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Connection Delete Confirmation ── */}
      <Dialog open={connDeleteConfirmOpen} onOpenChange={setConnDeleteConfirmOpen}>
        <DialogContent className="bg-[#1e1e2e] border-[#333] text-[#ccc] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#eee]">确认删除连接</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#999] py-2">确定要删除该 SSH 连接吗？此操作不可撤销。</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="border-[#444] text-[#ccc] hover:bg-[#333]"
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
              className="bg-[#c0392b] hover:bg-[#e74c3c]"
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
