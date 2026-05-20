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
  Pencil,
  Terminal as TerminalIcon,
  Play,
  Loader2,
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

const DEFAULT_SIDEBAR_WIDTH = 280;

/**
 * 每个 Tab 独立的终端+SFTP 分栏，自带 ref 和高度状态。
 * 避免多 tab 共用 ref 导致拖动和布局异常。
 */
function TerminalSplitPane({
  tab,
  isActive,
  xtermRefs,
  onDragOverlayChange,
}: {
  tab: { id: string; name: string; sessionId: string; websocketUrl: string };
  isActive: boolean;
  xtermRefs: React.MutableRefObject<Map<string, XTermHandle>>;
  onDragOverlayChange: (v: "row-resize" | null) => void;
}) {
  const [splitPct, setSplitPct] = useState(60);
  const termRef = useRef<HTMLDivElement>(null);
  const sftpRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startPct = useRef(60);
  // 用 ref 持有回调，避免 useEffect 依赖变化导致重新注册
  const onDragOverlayChangeRef = useRef(onDragOverlayChange);
  onDragOverlayChangeRef.current = onDragOverlayChange;

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current || !termRef.current || !sftpRef.current) return;
      e.preventDefault();
      const parent = sftpRef.current.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const delta = e.clientY - startY.current;
      const deltaPct = (delta / rect.height) * 100;
      const pct = Math.max(20, Math.min(80, startPct.current + deltaPct));
      termRef.current.style.flex = String(pct);
      sftpRef.current.style.flex = String(100 - pct);
    };
    const handleUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const pct = Number(termRef.current?.style.flex ?? 60);
      setSplitPct(pct);
      onDragOverlayChangeRef.current(null);
    };
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="overflow-hidden bg-muted/30" ref={termRef} style={{ flex: splitPct }}>
        <XTerm
          ref={(el) => {
            if (el) xtermRefs.current.set(tab.id, el);
            else xtermRefs.current.delete(tab.id);
          }}
          websocketUrl={tab.websocketUrl}
          active={isActive}
        />
      </div>
      {/* Vertical splitter */}
      <div
        className="h-3 shrink-0 z-10 group relative cursor-row-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          isDragging.current = true;
          startY.current = e.clientY;
          const parent = sftpRef.current?.parentElement;
          if (parent) {
            const rect = parent.getBoundingClientRect();
            const top = termRef.current?.getBoundingClientRect().top ?? rect.top;
            startPct.current = ((e.clientY - top) / rect.height) * 100;
          }
          onDragOverlayChange("row-resize");
        }}
      >
        <div className="absolute inset-0 -top-1 -bottom-1" />
        <div className="h-[3px] w-full my-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
      </div>
      <div className="overflow-hidden" ref={sftpRef} style={{ flex: 100 - splitPct }}>
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
  );
}

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
  onSelectConnection,
  onEditConnection,
  onDeleteConnection,
  onNewConnection,
  onEditGroup,
  onDeleteGroup,
  activeConnectionId,
  connectingId,
}: {
  node: TerminalGroupNode;
  depth: number;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  onConnect: (conn: SshConnection) => void;
  onSelectConnection: (conn: SshConnection) => void;
  onEditConnection: (conn: SshConnection) => void;
  onDeleteConnection: (id: number) => void;
  onNewConnection: (groupId: number | null) => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (id: number) => void;
  activeConnectionId: number | null;
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
            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center text-emerald-500"
            title="新建连接"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditGroup(node);
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
              activeConnectionId={activeConnectionId}
              connectingId={connectingId}
            />
          ))}
          {/* Connections in this group */}
          {node.connections.map((conn) => (
            <div
              key={conn.id}
              onClick={() => onSelectConnection(conn)}
              onDoubleClick={() => onConnect(conn)}
              className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                activeConnectionId === conn.id
                  ? "bg-primary text-primary-foreground shadow-glass"
                  : "hover:bg-accent/50 text-foreground"
              }`}
              style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
            >
              <TerminalIcon className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 cursor-default">{conn.name}</span>
              <span className={`text-xs shrink-0 opacity-70 ${activeConnectionId === conn.id ? "text-primary-foreground" : "text-muted-foreground"}`}>{conn.host}</span>
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
                    className="h-6 w-6 rounded-lg flex items-center justify-center text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600"
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

export default function Terminal() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useTerminalStore();

  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  // Resizable state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const xtermRefs = useRef<Map<string, XTermHandle>>(new Map());
  const isDraggingH = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [dragOverlay, setDragOverlay] = useState<"col-resize" | "row-resize" | null>(null);

  // Drag handlers — sidebar only, V drag is per-tab in TerminalSplitPane
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDraggingH.current && sidebarRef.current) {
        const delta = e.clientX - startXRef.current;
        const w = Math.max(240, Math.min(420, startWidthRef.current + delta));
        sidebarRef.current.style.width = w + "px";
      }
    };
    const handleUp = () => {
      if (isDraggingH.current) {
        isDraggingH.current = false;
        const w = sidebarRef.current?.offsetWidth ?? DEFAULT_SIDEBAR_WIDTH;
        setSidebarWidth(w);
      }
      setDragOverlay(null);
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
  const [groupForm, setGroupForm] = useState({ name: "", parent_id: null as number | null, group_type: "terminal" });
  const [editGroupForm, setEditGroupForm] = useState({ id: 0, name: "", parent_id: null as number | null, group_type: "terminal" });

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
      const data = await listGroups("terminal");
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

  const handleSelectConnection = (conn: SshConnection) => {
    const existing = tabs.find((t) => t.connectionId === conn.id);
    if (existing) {
      setActiveTab(existing.id);
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
        group_type: "terminal",
      });
      setGroupForm({ name: "", parent_id: null, group_type: "terminal" });
      setGroupDialogOpen(false);
      loadGroups();
    } catch (error) {
      console.error("Failed to create group:", error);
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
      await updateGroup({ ...group, name: editGroupForm.name.trim(), parent_id: editGroupForm.parent_id, group_type: "terminal" });
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
        <Label className="text-xs">名称</Label>
        <Input placeholder="例如：生产服务器" value={formName} onChange={(e) => setFormName(e.target.value)} className="input-macos" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">主机</Label>
          <Input placeholder="192.168.1.1" value={formHost} onChange={(e) => setFormHost(e.target.value)} className="input-macos" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">端口</Label>
          <Input placeholder="22" value={formPort} onChange={(e) => setFormPort(e.target.value)} className="input-macos" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">用户名</Label>
        <Input placeholder="root" value={formUsername} onChange={(e) => setFormUsername(e.target.value)} className="input-macos" />
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
      <div className="space-y-1">
        <Label className="text-xs">认证方式</Label>
        <Select value={formAuthType} onValueChange={(v) => setFormAuthType(v as "password" | "publickey")}>
          <SelectTrigger className="input-macos h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="glass-strong border-[var(--glass-border-strong)]"
          >
            <SelectItem value="password">密码</SelectItem>
            <SelectItem value="publickey">公钥</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {formAuthType === "password" ? (
        <div className="space-y-1">
          <Label className="text-xs">密码</Label>
          <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="input-macos" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-xs">密钥路径</Label>
            <Input placeholder="~/.ssh/id_rsa" value={formKeyPath} onChange={(e) => setFormKeyPath(e.target.value)} className="input-macos" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">密钥密码（可选）</Label>
            <Input type="password" value={formKeyPassphrase} onChange={(e) => setFormKeyPassphrase(e.target.value)} className="input-macos" />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" className="rounded-lg" onClick={() => {
          if (editingConnection) { setEditConnDialogOpen(false); setEditingConnection(null); }
          else { setShowNewDialog(false); }
          resetForm();
        }}
        >
          取消
        </Button>
        <Button size="sm" className="btn-macos rounded-lg" onClick={handleSaveConnection} disabled={!formName || !formHost || !formUsername}
        >
          {editingConnection ? "保存修改" : "保存连接"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-background animate-page-enter relative">
      {/* 拖动时全屏透明覆盖层，防止 xterm/sftp 拦截鼠标事件 */}
      {dragOverlay && (
        <div
          className="fixed inset-0 z-[9999]"
          style={{ cursor: dragOverlay }}
        />
      )}
      {/* ── Sidebar ── */}
      <div
        className="border-r border-[var(--glass-border)] flex flex-col shrink-0 bg-muted/20"
        style={{ width: sidebarWidth }}
        ref={sidebarRef}
      >
        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">连接管理</span>
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
                setGroupForm({ name: "", parent_id: null, group_type: "terminal" });
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
              <Server className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground text-center">暂无连接</p>
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
                        onDoubleClick={() => handleConnect(conn)}
                        className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                          activeConnectionId === conn.id
                            ? "bg-primary text-primary-foreground shadow-glass"
                            : "hover:bg-accent/50 text-foreground"
                        }`}
                        style={{ paddingLeft: `${12 + 16}px` }}
                      >
                        <TerminalIcon className="h-4 w-4 shrink-0" />
                        <span className="truncate flex-1 cursor-default">{conn.name}</span>
                        <span className={`text-xs shrink-0 opacity-70 ${activeConnectionId === conn.id ? "text-primary-foreground" : "text-muted-foreground"}`}>{conn.host}</span>
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
                              className="h-6 w-6 rounded-lg flex items-center justify-center text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600"
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
                  activeConnectionId={activeConnectionId}
                  connectingId={connectingId}
                />
              ))}
            </>
          )}
        </div>

      </div>

      {/* Horizontal splitter */}
      <div
        className="w-2 shrink-0 z-20 group relative cursor-col-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          isDraggingH.current = true;
          startXRef.current = e.clientX;
          startWidthRef.current = sidebarRef.current?.offsetWidth ?? DEFAULT_SIDEBAR_WIDTH;
          setDragOverlay("col-resize");
        }}
      >
        <div className="absolute inset-0 -left-1 -right-1" />
        <div className="w-[3px] h-full mx-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="flex items-center border-b border-[var(--glass-border)] bg-muted/30 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-[var(--glass-border)] shrink-0 transition-colors min-w-0 ${
                  activeTabId === tab.id
                    ? "bg-card text-emerald-500 border-t-2 border-t-emerald-500"
                    : "bg-muted/50 text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                <TerminalIcon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[120px]">{tab.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-secondary/60 shrink-0 ${
                    activeTabId === tab.id ? "text-muted-foreground" : "text-muted-foreground/60"
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
              <Server className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground/50">未打开任何会话</h3>
              <p className="mt-2 text-sm text-muted-foreground/40">双击左侧连接或点击连接按钮，或新建一个连接</p>
              <Button
                className="mt-6 btn-macos"
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
                <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--glass-border)] bg-muted/30 shrink-0">
                  <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {tab.name} — {tab.websocketUrl}
                  </span>
                </div>
                {/* Terminal + SFTP — per-tab 独立管理 */}
                <TerminalSplitPane
                  tab={tab}
                  isActive={activeTabId === tab.id}
                  xtermRefs={xtermRefs}
                  onDragOverlayChange={(v) => setDragOverlay(v ? "row-resize" : null)}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── New Connection Dialog ── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建 SSH 连接</DialogTitle>
          </DialogHeader>
          {connectionFormContent}
        </DialogContent>
      </Dialog>

      {/* ── Edit Connection Dialog ── */}
      <Dialog open={editConnDialogOpen} onOpenChange={setEditConnDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑 SSH 连接</DialogTitle>
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
          <p className="text-sm text-muted-foreground py-2">确定要删除该 SSH 连接吗？此操作不可撤销。</p>
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
