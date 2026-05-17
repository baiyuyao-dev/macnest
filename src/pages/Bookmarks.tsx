import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  LayoutDashboard, Server, Database, Globe, Terminal,
  Cpu, HardDrive, Code, Box, Layers, Zap, Shield,
  Settings, FileText, Link, BookOpen, BarChart3, FlaskConical,
  Cloud, MessageSquare, Image, Music, Video, Mail, Calendar,
  Plus, Search, Grid3X3, List, ExternalLink, Trash2, Edit, Bookmark,
  Folder, X, ChevronRight, ChevronDown,
  type LucideIcon
} from "lucide-react";
import type { Bookmark as BookmarkType, Group } from "@/types";
import {
  listBookmarks, createBookmark, updateBookmark, deleteBookmark,
  listGroups, createGroup, updateGroup, deleteGroup,
} from "@/lib/api";

function StatusDot({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        isOnline ? "bg-green-500" : "bg-red-500"
      }`}
      title={isOnline ? "在线" : "离线"}
    />
  );
}

interface BookmarkViewProps {
  bookmarks: BookmarkType[];
  groups: Group[];
  onOpen: (url: string) => void;
  onEdit: (bm: BookmarkType) => void;
  onDelete: (id: number) => void;
}

function GridView({ bookmarks, groups, onOpen, onEdit, onDelete }: BookmarkViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {bookmarks.map((bookmark) => {
        const IconComp = getIcon(bookmark.icon || "link");
        const groupName = groups.find((g) => g.id === bookmark.group_id)?.name || "未分组";
        return (
          <div
            key={bookmark.id}
            className="group relative rounded-lg border bg-card p-4 cursor-pointer transition-all hover:bg-accent hover:-translate-y-0.5 hover:shadow-md"
            onClick={() => onOpen(bookmark.url)}
            title={bookmark.description || bookmark.name}
          >
            <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Button variant="ghost" size="icon" className="h-7 w-7 bg-background/80"
                onClick={(e) => { e.stopPropagation(); onOpen(bookmark.url); }}><ExternalLink className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 bg-background/80"
                onClick={(e) => { e.stopPropagation(); onEdit(bookmark); }}><Edit className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 bg-background/80 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(bookmark.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </div>
            <div className="absolute top-3 left-3"><StatusDot isOnline={bookmark.is_online} /></div>
            <div className="flex justify-center mt-4 mb-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><IconComp className="h-7 w-7" /></div>
            </div>
            <h3 className="font-semibold text-center truncate px-1" title={bookmark.name}>{bookmark.name}</h3>
            <p className="text-xs text-muted-foreground text-center truncate mt-1 px-1" title={bookmark.url}>{bookmark.url}</p>
            <div className="flex justify-center mt-2">
              <Badge variant="secondary" className="text-[10px]">{groupName}</Badge>
            </div>
            {bookmark.description && (
              <p className="text-xs text-muted-foreground text-center truncate mt-2 px-1">{bookmark.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ bookmarks, groups, onOpen, onEdit, onDelete }: BookmarkViewProps) {
  return (
    <Card>
      <div className="divide-y">
        {bookmarks.map((bookmark) => {
          const IconComp = getIcon(bookmark.icon || "link");
          const groupName = groups.find((g) => g.id === bookmark.group_id)?.name || "未分组";
          return (
            <div
              key={bookmark.id}
              className="flex items-center gap-4 py-3 px-4 hover:bg-accent/50 transition-colors cursor-pointer group"
              onClick={() => onOpen(bookmark.url)}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><IconComp className="h-4.5 w-4.5" /></div>
              <div className="w-40 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{bookmark.name}</span>
                  <StatusDot isOnline={bookmark.is_online} />
                </div>
              </div>
              <div className="flex-1 min-w-0"><span className="text-sm text-muted-foreground truncate block">{bookmark.url}</span></div>
              <div className="w-28 shrink-0">
                <Badge variant="secondary" className="text-[10px]">{groupName}</Badge>
              </div>
              <div className="hidden lg:block flex-1 min-w-0 max-w-xs"><span className="text-xs text-muted-foreground truncate block">{bookmark.description || "-"}</span></div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onOpen(bookmark.url); }}><ExternalLink className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onEdit(bookmark); }}><Edit className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onDelete(bookmark.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted"><Bookmark className="h-10 w-10 text-muted-foreground" /></div>
      <h3 className="mt-6 text-lg font-semibold">还没有书签</h3>
      <p className="mt-2 text-sm text-muted-foreground">添加你的第一个书签来快速访问常用服务</p>
      <Button className="mt-6" onClick={onCreate}><Plus className="mr-2 h-4 w-4" />添加第一个书签</Button>
    </div>
  );
}

// Icon Mapping
const iconMap: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard, "server": Server, "database": Database,
  "globe": Globe, "terminal": Terminal, "cpu": Cpu, "hard-drive": HardDrive,
  "code": Code, "box": Box, "layers": Layers, "zap": Zap, "shield": Shield,
  "settings": Settings, "file-text": FileText, "link": Link, "book-open": BookOpen,
  "bar-chart": BarChart3, "flask": FlaskConical, "cloud": Cloud,
  "message-square": MessageSquare, "image": Image, "music": Music,
  "video": Video, "mail": Mail, "calendar": Calendar,
};

function getIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Link;
}

const ICON_OPTIONS = [
  { value: "layout-dashboard", label: "仪表板" }, { value: "server", label: "服务器" },
  { value: "database", label: "数据库" }, { value: "globe", label: "地球" },
  { value: "terminal", label: "终端" }, { value: "cpu", label: "CPU" },
  { value: "hard-drive", label: "硬盘" }, { value: "code", label: "代码" },
  { value: "box", label: "容器" }, { value: "layers", label: "层叠" },
  { value: "zap", label: "闪电" }, { value: "shield", label: "盾牌" },
  { value: "settings", label: "设置" }, { value: "file-text", label: "文件" },
  { value: "link", label: "链接" }, { value: "book-open", label: "书本" },
  { value: "bar-chart", label: "图表" }, { value: "flask", label: "实验" },
  { value: "cloud", label: "云" }, { value: "message-square", label: "消息" },
  { value: "image", label: "图片" }, { value: "music", label: "音乐" },
  { value: "video", label: "视频" }, { value: "mail", label: "邮件" },
  { value: "calendar", label: "日历" },
];

type ViewMode = "grid" | "list";
type DialogMode = "create" | "edit" | null;

// Build tree from flat groups
interface GroupNode extends Group {
  children: GroupNode[];
}

function buildGroupTree(groups: Group[]): GroupNode[] {
  const map = new Map<number, GroupNode>();
  const roots: GroupNode[] = [];

  // First pass: create nodes
  for (const g of groups) {
    map.set(g.id, { ...g, children: [] });
  }

  // Second pass: build tree
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

// Collect all descendant group IDs (including self)
function collectDescendantIds(node: GroupNode): number[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

// Filter tree by search query
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

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "", url: "", description: "", group_id: null as number | null, icon: "link",
    service_id: null as number | null, health_check_url: "",
  });

  // Group management state
  const [groupSearchInput, setGroupSearchInput] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  // Group dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "edit" | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", parent_id: null as number | null });

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  // Expanded group nodes
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBookmarks();
      setBookmarks(data);
    } catch (error) {
      console.error("Failed to load bookmarks:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await listGroups();
      setGroups(data);
    } catch (error) {
      console.error("Failed to load groups:", error);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const filteredBookmarks = useMemo(() => {
    let result = bookmarks;
    // 按分组过滤（包含该分组下所有子分组的书签）
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
      result = result.filter((b) => b.group_id != null && allowedSet.has(b.group_id));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((b) =>
        b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) ||
        (b.description && b.description.toLowerCase().includes(q))
      );
    }
    return result;
  }, [bookmarks, searchQuery, activeGroupId, groups]);

  const resetForm = () => {
    setFormData({ name: "", url: "", description: "", group_id: null, icon: "link", service_id: null, health_check_url: "" });
    setEditingId(null); setDialogMode(null);
  };

  const openCreateDialog = () => {
    setFormData({ name: "", url: "", description: "", group_id: activeGroupId, icon: "link", service_id: null, health_check_url: "" });
    setEditingId(null); setDialogMode("create"); setDialogOpen(true);
  };

  const openEditDialog = (bookmark: BookmarkType) => {
    setFormData({
      name: bookmark.name, url: bookmark.url, description: bookmark.description || "",
      group_id: bookmark.group_id, icon: bookmark.icon || "link",
      service_id: bookmark.service_id, health_check_url: bookmark.health_check_url || "",
    });
    setEditingId(bookmark.id); setDialogMode("edit"); setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!formData.name.trim() || !formData.url.trim()) return;
    try {
      await createBookmark(formData);
      setDialogOpen(false); resetForm(); loadBookmarks();
    } catch (error) { console.error("Failed to create bookmark:", error); }
  };

  const handleUpdate = async () => {
    if (!editingId || !formData.name.trim() || !formData.url.trim()) return;
    try {
      await updateBookmark({ id: editingId, ...formData });
      setDialogOpen(false); resetForm(); loadBookmarks();
    } catch (error) { console.error("Failed to update bookmark:", error); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteBookmark(id); loadBookmarks(); }
    catch (error) { console.error("Failed to delete bookmark:", error); }
  };

  // Group search: press Enter or click search button to filter
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
    } catch (error) { console.error("Failed to create group:", error); }
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
    } catch (error) { console.error("Failed to update group:", error); }
  };

  const handleDeleteGroup = async (id: number) => {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteGroup = async () => {
    if (deleteTargetId == null) return;
    try {
      await deleteGroup(deleteTargetId);
      if (activeGroupId === deleteTargetId) setActiveGroupId(null);
      loadGroups();
      loadBookmarks();
    } catch (error) { console.error("Failed to delete group:", error); }
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const openUrl = (url: string) => { window.open(url, "_blank"); };
  const handleDialogSave = () => { dialogMode === "edit" ? handleUpdate() : handleCreate(); };

  const groupCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    bookmarks.forEach((b) => {
      if (b.group_id != null) {
        counts[b.group_id] = (counts[b.group_id] || 0) + 1;
      }
    });
    return counts;
  }, [bookmarks]);

  const totalCount = bookmarks.length;

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

  // Recursive tree renderer
  interface TreeNodeProps {
    node: GroupNode;
    depth: number;
  }

  function TreeNode({ node, depth }: TreeNodeProps) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = activeGroupId === node.id;
    const descendantIds = useMemo(() => collectDescendantIds(node), [node]);
    const count = useMemo(() =>
      descendantIds.reduce((sum, id) => sum + (groupCounts[id] || 0), 0),
      [descendantIds, groupCounts]
    );

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
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
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
              <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Input
                  value={editingGroupName}
                  onChange={(e) => setEditingGroupName(e.target.value)}
                  className="h-6 text-xs w-24"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdateGroup(node.id);
                    if (e.key === "Escape") { setEditingGroupId(null); setEditingGroupName(""); }
                  }}
                />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUpdateGroup(node.id)}>
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
                  onClick={() => { setEditingGroupId(node.id); setEditingGroupName(node.name); }}
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
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Flat list of all groups for parent select
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
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">分组</h2>
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
            <TreeNode key={node.id} node={node} depth={0} />
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
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={handleGroupSearch}>
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
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">服务导航</h1>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            添加书签
          </Button>
        </div>

        {/* Search + View toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索书签名称、URL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center border rounded-md overflow-hidden">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-none"
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {bookmarks.length === 0 ? (
          <EmptyState onCreate={openCreateDialog} />
        ) : filteredBookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Search className="h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">没有找到匹配的书签</p>
            <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
              清除搜索
            </Button>
          </div>
        ) : viewMode === "grid" ? (
          <GridView
            bookmarks={filteredBookmarks}
            groups={groups}
            onOpen={openUrl}
            onEdit={openEditDialog}
            onDelete={handleDelete}
          />
        ) : (
          <ListView
            bookmarks={filteredBookmarks}
            groups={groups}
            onOpen={openUrl}
            onEdit={openEditDialog}
            onDelete={handleDelete}
          />
        )}
      </div>

      {/* Bookmark Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[48rem] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>{dialogMode === "edit" ? "编辑书签" : "添加书签"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>名称 <span className="text-destructive">*</span></Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如：Grafana 监控"
              />
            </div>
            <div className="space-y-2">
              <Label>URL <span className="text-destructive">*</span></Label>
              <Input
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="http://localhost:8080"
              />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="简短描述该服务的用途"
              />
            </div>
            <div className="space-y-2">
              <Label>分组</Label>
              <Select
                value={formData.group_id?.toString() || ""}
                onChange={(e) =>
                  setFormData({ ...formData, group_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">未分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}{g.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>图标</Label>
              <Select
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
              >
                {ICON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>健康检测 URL</Label>
              <Input
                value={formData.health_check_url}
                onChange={(e) => setFormData({ ...formData, health_check_url: e.target.value })}
                placeholder="http://localhost:8080/health (可选)"
              />
              <p className="text-xs text-muted-foreground">用于检测服务是否在线，留空则不检测</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
                取消
              </Button>
              <Button onClick={handleDialogSave} disabled={!formData.name.trim() || !formData.url.trim()}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Create/Edit Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupDialogMode === "edit" ? "编辑分组" : "新建分组"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>分组名称 <span className="text-destructive">*</span></Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="输入分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupForm.name.trim()) handleCreateGroup();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>上级分组</Label>
              <Select
                value={groupForm.parent_id?.toString() || ""}
                onChange={(e) =>
                  setGroupForm({ ...groupForm, parent_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">一级分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}{g.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">选择上级分组可将该分组作为子分组，留空则为一级分组</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setGroupDialogOpen(false); setGroupDialogMode(null); }}>
                取消
              </Button>
              <Button onClick={handleCreateGroup} disabled={!groupForm.name.trim()}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除分组</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除该分组吗？该分组下的书签将变为未分组，子分组将提升为一级分组。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmOpen(false); setDeleteTargetId(null); }}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDeleteGroup}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
