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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Terminal as TerminalIcon,
  Plus,
  Unplug,
  Server,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  Trash2,
  Edit,
} from "lucide-react";
import XTerm from "@/components/terminal/XTerm";
import SftpPanel from "@/components/terminal/SftpPanel";
import {
  createSshConnection,
  listSshConnections,
  deleteSshConnection,
  sshConnect,
  sshDisconnect,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from "@/lib/api";
import type { SshConnection, Group } from "@/types";

/* ── Tree utilities ── */

interface GroupNode extends Group {
  children: GroupNode[];
}

function buildGroupTree(groups: Group[]): GroupNode[] {
  const map = new Map<number, GroupNode>();
  const roots: GroupNode[] = [];

  for (const g of groups) {
    map.set(g.id, { ...g, children: [] });
  }

  for (const g of groups) {
    const node = map.get(g.id)!;
    if (g.parent_id != null && map.has(g.parent_id)) {
      map.get(g.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function collectDescendantIds(node: GroupNode): number[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

function filterGroupTree(nodes: GroupNode[], query: string): GroupNode[] {
  const q = query.toLowerCase();
  const result: GroupNode[] = [];
  for (const node of nodes) {
    const matchSelf = node.name.toLowerCase().includes(q);
    const filteredChildren = filterGroupTree(node.children, query);
    if (matchSelf || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: matchSelf ? node.children : filteredChildren,
      });
    }
  }
  return result;
}

/* ── TreeNode component ── */

function TreeNode({
  node,
  depth,
  activeGroupId,
  setActiveGroupId,
  expandedIds,
  toggleExpand,
  groupCounts,
  editingGroupId,
  setEditingGroupId,
  editingGroupName,
  setEditingGroupName,
  handleUpdateGroup,
  handleDeleteGroup,
}: {
  node: GroupNode;
  depth: number;
  activeGroupId: number | null;
  setActiveGroupId: (id: number | null) => void;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  groupCounts: Record<number, number>;
  editingGroupId: number | null;
  setEditingGroupId: (id: number | null) => void;
  editingGroupName: string;
  setEditingGroupName: (name: string) => void;
  handleUpdateGroup: (id: number) => void;
  handleDeleteGroup: (id: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = activeGroupId === node.id;

  const count = useMemo(() => {
    const descendantIds = collectDescendantIds(node);
    return descendantIds.reduce(
      (sum, id) => sum + (groupCounts[id] || 0),
      0
    );
  }, [node, groupCounts]);

  return (
    <div>
      <div
        onClick={() => setActiveGroupId(node.id)}
        className={`group flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent text-foreground"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="shrink-0 p-0.5 rounded hover:bg-black/10"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <Folder className="h-4 w-4 shrink-0" />
          <span className="truncate">{node.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <span className="text-xs opacity-70">{count}</span>
          {editingGroupId === node.id ? (
            <div
              className="flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                value={editingGroupName}
                onChange={(e) => setEditingGroupName(e.target.value)}
                className="h-6 text-xs w-24"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUpdateGroup(node.id);
                  if (e.key === "Escape") {
                    setEditingGroupId(null);
                    setEditingGroupName("");
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleUpdateGroup(node.id)}
              >
                <Edit className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div
              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setEditingGroupId(node.id);
                  setEditingGroupName(node.name);
                }}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:text-destructive"
                onClick={() => handleDeleteGroup(node.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              groupCounts={groupCounts}
              editingGroupId={editingGroupId}
              setEditingGroupId={setEditingGroupId}
              editingGroupName={editingGroupName}
              setEditingGroupName={setEditingGroupName}
              handleUpdateGroup={handleUpdateGroup}
              handleDeleteGroup={handleDeleteGroup}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ── */

export default function Terminal() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [websocketUrl, setWebsocketUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Group tree state
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [groupSearchInput, setGroupSearchInput] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  // Group dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "edit" | null>(null);
  const [groupForm, setGroupForm] = useState({
    name: "",
    parent_id: null as number | null,
  });

  // Group delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  // Connection delete confirmation
  const [connDeleteConfirmOpen, setConnDeleteConfirmOpen] = useState(false);
  const [connDeleteTargetId, setConnDeleteTargetId] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("22");
  const [formUsername, setFormUsername] = useState("");
  const [formAuthType, setFormAuthType] = useState<"password" | "publickey">(
    "password"
  );
  const [formPassword, setFormPassword] = useState("");
  const [formKeyPath, setFormKeyPath] = useState("");
  const [formKeyPassphrase, setFormKeyPassphrase] = useState("");
  const [formGroupId, setFormGroupId] = useState<number | null>(null);

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

  const filteredConnections = useMemo(() => {
    let result = connections;
    // Filter by group (include descendants)
    if (activeGroupId != null) {
      const allowedIds: number[] = [];
      function collectDescendants(pid: number) {
        allowedIds.push(pid);
        for (const g of groups) {
          if (g.parent_id === pid) collectDescendants(g.id);
        }
      }
      collectDescendants(activeGroupId);
      const allowedSet = new Set(allowedIds);
      result = result.filter(
        (c) => c.group_id != null && allowedSet.has(c.group_id)
      );
    }
    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q)
      );
    }
    return result;
  }, [connections, activeGroupId, searchQuery, groups]);

  const groupCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    connections.forEach((c) => {
      if (c.group_id != null) {
        counts[c.group_id] = (counts[c.group_id] || 0) + 1;
      }
    });
    return counts;
  }, [connections]);

  const totalCount = connections.length;

  const groupTree = useMemo(() => buildGroupTree(groups), [groups]);

  const displayedTree = useMemo(() => {
    if (!groupSearchQuery.trim()) return groupTree;
    return filterGroupTree(groupTree, groupSearchQuery);
  }, [groupTree, groupSearchQuery]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGroupSearch = () => {
    setGroupSearchQuery(groupSearchInput);
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
      setGroupDialogMode(null);
      loadGroups();
    } catch (error) {
      console.error("Failed to create group:", error);
    }
  };

  const handleUpdateGroup = async (id: number) => {
    if (!editingGroupName.trim()) return;
    try {
      const group = groups.find((g) => g.id === id);
      if (!group) return;
      await updateGroup({ ...group, name: editingGroupName.trim() });
      setEditingGroupId(null);
      setEditingGroupName("");
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
      if (activeGroupId === deleteTargetId) setActiveGroupId(null);
      loadGroups();
      loadConnections();
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
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
    setFormGroupId(activeGroupId);
  };

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
        group_id: formGroupId,
      });

      setShowNewDialog(false);
      resetForm();
      loadConnections();
    } catch (err) {
      console.error("Failed to create connection:", err);
      alert("保存连接失败: " + String(err));
    }
  };

  const handleConnect = async (connectionId: number) => {
    if (connecting) return;
    setConnecting(true);
    try {
      const result = await sshConnect(connectionId);
      setWebsocketUrl(result.websocket_url);
      setSessionId(result.session_id);
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

  // Flat groups for select
  const flatGroupsForSelect = useMemo(() => {
    const result: { id: number; name: string; depth: number }[] = [];
    function walk(nodes: GroupNode[], depth: number) {
      for (const n of nodes) {
        result.push({ id: n.id, name: n.name, depth });
        walk(n.children, depth + 1);
      }
    }
    walk(groupTree, 0);
    return result;
  }, [groupTree]);

  return (
    <div className="flex h-full">
      {/* Sidebar - Group Navigation */}
      <div className="w-64 border-r bg-muted/30 flex flex-col shrink-0">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            分组
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => setActiveGroupId(null)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
              activeGroupId === null
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent text-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              <Folder className="h-4 w-4" />
              全部
            </span>
            <span className="text-xs opacity-70">{totalCount}</span>
          </button>
          {displayedTree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              groupCounts={groupCounts}
              editingGroupId={editingGroupId}
              setEditingGroupId={setEditingGroupId}
              editingGroupName={editingGroupName}
              setEditingGroupName={setEditingGroupName}
              handleUpdateGroup={handleUpdateGroup}
              handleDeleteGroup={handleDeleteGroup}
            />
          ))}
        </div>
        <div className="p-3 border-t space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="搜索分组"
              value={groupSearchInput}
              onChange={(e) => setGroupSearchInput(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGroupSearch();
              }}
            />
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              onClick={handleGroupSearch}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                setGroupForm({ name: "", parent_id: activeGroupId });
                setGroupDialogMode("create");
                setGroupDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {websocketUrl ? (
          <>
            {/* Terminal toolbar */}
            <div className="flex items-center gap-2 border-b p-3">
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
            </div>
            {/* 上下分栏：SSH 终端 + SFTP */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* SSH 终端 - 上部 45% */}
              <div className="h-[45%] border-b border-[#333] overflow-hidden bg-[#1a1a2e]">
                <XTerm websocketUrl={websocketUrl} />
              </div>
              {/* SFTP 文件管理器 - 下部 55% */}
              <div className="h-[55%] overflow-hidden">
                <SftpPanel sessionId={sessionId} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Connection list toolbar */}
            <div className="flex items-center justify-between p-4 border-b">
              <h1 className="text-xl font-bold">SSH 连接</h1>
              <Button
                onClick={() => {
                  resetForm();
                  setFormGroupId(activeGroupId);
                  setShowNewDialog(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                新建连接
              </Button>
            </div>

            {/* Search */}
            <div className="p-4 pb-0">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索连接名称、主机、用户名..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Connection list */}
            <div className="flex-1 overflow-y-auto p-4">
              {connections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                    <Server className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">还没有连接</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    添加你的第一个 SSH 连接
                  </p>
                  <Button
                    className="mt-6"
                    onClick={() => {
                      resetForm();
                      setFormGroupId(activeGroupId);
                      setShowNewDialog(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    添加第一个连接
                  </Button>
                </div>
              ) : filteredConnections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Search className="h-10 w-10 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    没有找到匹配的连接
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setSearchQuery("")}
                  >
                    清除搜索
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredConnections.map((conn) => (
                    <div
                      key={conn.id}
                      className="flex items-center gap-4 rounded-md border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Server className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{conn.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {conn.host}:{conn.port}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {conn.username}@{conn.host}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={() => handleConnect(conn.id)}
                          disabled={connecting}
                        >
                          {connecting ? "连接中..." : "连接"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:text-destructive"
                          onClick={() => handleDeleteConnection(conn.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* New Connection Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
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
              <Label>分组</Label>
              <select
                value={formGroupId?.toString() || ""}
                onChange={(e) =>
                  setFormGroupId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">未分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>认证方式</Label>
              <Select
                value={formAuthType}
                onValueChange={(v) =>
                  setFormAuthType(v as "password" | "publickey")
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

      {/* Group Create/Edit Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {groupDialogMode === "edit" ? "编辑分组" : "新建分组"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>
                分组名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                value={groupForm.name}
                onChange={(e) =>
                  setGroupForm({ ...groupForm, name: e.target.value })
                }
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupForm.name.trim())
                    handleCreateGroup();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>上级分组</Label>
              <select
                value={groupForm.parent_id?.toString() || ""}
                onChange={(e) =>
                  setGroupForm({
                    ...groupForm,
                    parent_id: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">一级分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                选择上级分组可将该分组作为子分组，留空则为一级分组
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setGroupDialogOpen(false);
                  setGroupDialogMode(null);
                }}
              >
                取消
              </Button>
              <Button
                onClick={handleCreateGroup}
                disabled={!groupForm.name.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除分组</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除该分组吗？该分组下的连接将变为未分组，子分组将提升为一级分组。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setDeleteTargetId(null);
              }}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDeleteGroup}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Connection Delete Confirmation Dialog */}
      <Dialog open={connDeleteConfirmOpen} onOpenChange={setConnDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除连接</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除该 SSH 连接吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConnDeleteConfirmOpen(false);
                setConnDeleteTargetId(null);
              }}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDeleteConnection}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
