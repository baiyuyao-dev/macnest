import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
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
  Folder, X, ChevronRight, ChevronDown, RefreshCw,
} from "lucide-react";
import BookmarkIcon from "@/components/BookmarkIcon";
import type { Bookmark as BookmarkType, Group } from "@/types";
import {
  listBookmarks, createBookmark, updateBookmark, deleteBookmark,
  listGroups, createGroup, updateGroup, deleteGroup,
  openExternalUrl, importSafariBookmarks,
} from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
import { buildGroupTree, collectDescendantIds, filterGroupTree, type GroupNode } from "@/lib/tree";

interface BookmarkViewProps {
  bookmarks: BookmarkType[];
  groups: Group[];
  onOpen: (url: string) => void;
  onEdit: (bm: BookmarkType) => void;
  onDelete: (id: number) => void;
}

function GridView({ bookmarks, groups, onOpen, onEdit, onDelete }: BookmarkViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {bookmarks.map((bookmark, index) => {
        const groupName = groups.find((g) => g.id === bookmark.group_id)?.name || "未分组";
        return (
          <div
            key={bookmark.id}
            className="group relative card-macos p-4 cursor-pointer transition-all duration-300 hover:shadow-glass-lg"
            onClick={() => onOpen(bookmark.url)}
            title={bookmark.name}
            style={{ animationDelay: `${index * 30}ms` }}
          >
            <div className="flex justify-center mt-5 mb-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 overflow-hidden">
                <BookmarkIcon icon={bookmark.icon} url={bookmark.url} className="h-6 w-6" />
              </div>
            </div>
            <h3 className="font-semibold text-sm text-center truncate px-1" title={bookmark.name}>{bookmark.name}</h3>
            <p className="text-[11px] text-muted-foreground text-center truncate mt-1 px-2" title={bookmark.url}>{bookmark.url}</p>
            <div className="flex justify-center mt-2">
              <Badge variant="secondary" className="text-[10px] rounded-full">{groupName}</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ bookmarks, groups, onOpen, onEdit, onDelete }: BookmarkViewProps) {
  return (
    <div className="card-macos overflow-hidden">
      <div className="divide-y divide-[var(--glass-border)]">
        {bookmarks.map((bookmark) => {
          const groupName = groups.find((g) => g.id === bookmark.group_id)?.name || "未分组";
          return (
            <div
              key={bookmark.id}
              className="flex items-center gap-4 py-3 px-4 hover:bg-accent/40 transition-colors cursor-pointer group"
              onClick={() => onOpen(bookmark.url)}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary overflow-hidden">
                <BookmarkIcon icon={bookmark.icon} url={bookmark.url} className="h-4.5 w-4.5" />
              </div>
              <div className="w-40 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate text-sm">{bookmark.name}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0"><span className="text-sm text-muted-foreground truncate block">{bookmark.url}</span></div>
              <div className="w-28 shrink-0">
                <Badge variant="secondary" className="text-[10px] rounded-full">{groupName}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Bookmark className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-5 text-base font-semibold tracking-tight">还没有导航</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">添加你的第一个导航来快速访问常用服务</p>
      <Button className="btn-macos mt-5 rounded-xl" onClick={onCreate}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        添加第一个导航
      </Button>
    </div>
  );
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
    name: "", url: "", group_id: null as number | null, icon: "link",
  });

  const [sidebarSearch, setSidebarSearch] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "edit" | null>(null);
  const [groupForm, setGroupForm] = useState({ id: 0, name: "", parent_id: null as number | null, group_type: "bookmark" });

  const [groupDeleteConfirmOpen, setGroupDeleteConfirmOpen] = useState(false);
  const [groupDeleteTargetId, setGroupDeleteTargetId] = useState<number | null>(null);
  const [bookmarkDeleteConfirmOpen, setBookmarkDeleteConfirmOpen] = useState(false);
  const [bookmarkDeleteTargetId, setBookmarkDeleteTargetId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // ── Resizable sidebar ──────────────────────────────────────
  const DEFAULT_SIDEBAR_WIDTH = 280;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isDraggingH = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [dragOverlay, setDragOverlay] = useState<"col-resize" | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDraggingH.current && sidebarRef.current) {
        const delta = e.clientX - startXRef.current;
        const w = Math.max(280, Math.min(420, startWidthRef.current + delta));
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
      const data = await listGroups("bookmark");
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

  // Listen for auto-sync completion from backend
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("safari-bookmarks-synced", () => {
      loadBookmarks();
      loadGroups();
      toast.success("Safari 书签已同步");
    }).then((fn) => {
      unlisten = fn;
    }).catch(console.error);
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadBookmarks, loadGroups]);

  const handleSyncFromSafari = async () => {
    setSyncing(true);
    try {
      const result = await importSafariBookmarks();
      await loadBookmarks();
      await loadGroups();
      toast.success(
        `同步完成：导入 ${result.bookmarks_imported} 个书签，${result.groups_imported} 个分组`
      );
    } catch (error: any) {
      console.error("Failed to sync Safari bookmarks:", error);
      toast.error(error?.message || "同步失败，请检查 Safari 书签文件访问权限");
    } finally {
      setSyncing(false);
    }
  };

  const filteredBookmarks = useMemo(() => {
    let result = bookmarks;
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
        b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
      );
    }
    if (sidebarSearch.trim()) {
      const q = sidebarSearch.toLowerCase().trim();
      result = result.filter((b) =>
        b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
      );
    }
    return result;
  }, [bookmarks, searchQuery, sidebarSearch, activeGroupId, groups]);

  const resetForm = () => {
    setFormData({ name: "", url: "", group_id: null, icon: "link" });
    setEditingId(null); setDialogMode(null);
  };

  const openCreateDialog = () => {
    setFormData({ name: "", url: "", group_id: activeGroupId, icon: "link" });
    setEditingId(null); setDialogMode("create"); setDialogOpen(true);
  };

  const openEditDialog = (bookmark: BookmarkType) => {
    setFormData({
      name: bookmark.name, url: bookmark.url,
      group_id: bookmark.group_id, icon: bookmark.icon || "link",
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

  const handleDelete = (id: number) => {
    setBookmarkDeleteTargetId(id);
    setBookmarkDeleteConfirmOpen(true);
  };

  const confirmDeleteBookmark = async () => {
    if (bookmarkDeleteTargetId == null) return;
    try {
      await deleteBookmark(bookmarkDeleteTargetId);
      loadBookmarks();
    } catch (error) { console.error("Failed to delete bookmark:", error); }
    setBookmarkDeleteConfirmOpen(false);
    setBookmarkDeleteTargetId(null);
  };

  const handleCreateGroup = async () => {
    if (!groupForm.name.trim()) return;
    try {
      await createGroup({
        name: groupForm.name.trim(),
        parent_id: groupForm.parent_id,
        sort_order: groups.length,
        group_type: "bookmark",
      });
      setGroupForm({ id: 0, name: "", parent_id: null, group_type: "bookmark" });
      setGroupDialogOpen(false);
      setGroupDialogMode(null);
      loadGroups();
    } catch (error) { console.error("Failed to create group:", error); }
  };

  const handleUpdateGroup = async () => {
    if (!groupForm.name.trim() || !groupForm.id) return;
    try {
      const group = groups.find((g) => g.id === groupForm.id);
      if (!group) return;
      await updateGroup({ ...group, name: groupForm.name.trim(), parent_id: groupForm.parent_id, group_type: "bookmark" });
      setGroupForm({ id: 0, name: "", parent_id: null, group_type: "bookmark" });
      setGroupDialogOpen(false);
      setGroupDialogMode(null);
      loadGroups();
    } catch (error) { console.error("Failed to update group:", error); }
  };

  const handleDeleteGroup = async (id: number) => {
    setGroupDeleteTargetId(id);
    setGroupDeleteConfirmOpen(true);
  };

  const confirmDeleteGroup = async () => {
    if (groupDeleteTargetId == null) return;
    try {
      await deleteGroup(groupDeleteTargetId);
      if (activeGroupId === groupDeleteTargetId) setActiveGroupId(null);
      loadGroups();
      loadBookmarks();
    } catch (error) { console.error("Failed to delete group:", error); }
    setGroupDeleteConfirmOpen(false);
    setGroupDeleteTargetId(null);
  };

  const openUrl = async (url: string) => {
    await openExternalUrl(url);
  };
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
    if (!sidebarSearch.trim()) return groupTree;
    return filterGroupTree(groupTree, sidebarSearch);
  }, [groupTree, sidebarSearch]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Expand all when searching
  useEffect(() => {
    if (sidebarSearch.trim()) {
      const allIds = new Set<number>();
      function collect(nodes: GroupNode[]) {
        for (const n of nodes) {
          allIds.add(n.id);
          collect(n.children);
        }
      }
      collect(displayedTree);
      setExpandedIds(allIds);
    }
  }, [sidebarSearch, displayedTree]);

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
          className={`group flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
            isActive
              ? "bg-primary text-primary-foreground shadow-glass"
              : "hover:bg-accent/50 text-foreground"
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <div className="flex items-center gap-1 flex-1 min-w-0">
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                className="shrink-0 p-0.5 rounded-md hover:bg-black/10 transition-colors"
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
    <div className="flex h-full animate-page-enter relative">
      {/* Drag overlay */}
      {dragOverlay && (
        <div className="fixed inset-0 z-[9999]" style={{ cursor: dragOverlay }} />
      )}

      {/* Sidebar - Group Navigation */}
      <div
        className="border-r border-[var(--glass-border)] flex flex-col shrink-0 bg-muted/20"
        style={{ width: sidebarWidth }}
        ref={sidebarRef}
      >
        {/* Search */}
        <div className="p-3 border-b border-[var(--glass-border)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索分组或导航..."
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="h-8 text-xs pl-9 input-macos"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <button
            onClick={() => setActiveGroupId(null)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all duration-200 ${
              activeGroupId === null
                ? "bg-primary text-primary-foreground shadow-glass"
                : "hover:bg-accent/50 text-foreground"
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

      {/* Main Content */}
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between animate-slide-up">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">服务导航</h1>
            <p className="text-xs text-muted-foreground mt-0.5">管理常用服务导航</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs rounded-xl btn-macos-secondary"
              onClick={handleSyncFromSafari}
              disabled={syncing}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "同步中..." : "从 Safari 同步"}
            </Button>
          </div>
        </div>

        {/* Search + View toggle */}
        <div className="flex items-center gap-3 animate-slide-up" style={{ animationDelay: "50ms" }}>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索导航名称、URL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-macos pl-10"
            />
          </div>
          <div className="flex items-center p-0.5 rounded-xl bg-muted/50">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              className={`h-9 w-9 rounded-lg transition-all ${viewMode === "grid" ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground"}`}
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className={`h-9 w-9 rounded-lg transition-all ${viewMode === "list" ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground"}`}
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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-4">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">没有找到匹配的导航</p>
            <Button variant="outline" className="mt-4 rounded-lg btn-macos-secondary" onClick={() => setSearchQuery("")}>
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
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[48rem] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{dialogMode === "edit" ? "编辑导航" : "添加导航"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label className="text-xs">名称 <span className="text-destructive">*</span></Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="例如：Grafana 监控" className="input-macos" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">URL <span className="text-destructive">*</span></Label>
              <Input
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="http://localhost:8080"
                className="input-macos"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">分组</Label>
              <select
                value={formData.group_id?.toString() || ""}
                onChange={(e) =>
                  setFormData({ ...formData, group_id: e.target.value ? Number(e.target.value) : null })
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
              >
                <option value="">未分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}{g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">图标</Label>
              <select
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
              >
                {ICON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setDialogOpen(false); resetForm(); }}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleDialogSave} disabled={!formData.name.trim() || !formData.url.trim()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Create/Edit Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{groupDialogMode === "edit" ? "编辑分组" : "新建分组"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">分组名称 <span className="text-destructive">*</span></Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="输入分组名称" autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupForm.name.trim()) {
                    groupDialogMode === "edit" ? handleUpdateGroup() : handleCreateGroup();
                  }
                }}
                className="input-macos"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">上级分组</Label>
              <select
                value={groupForm.parent_id?.toString() || ""}
                onChange={(e) =>
                  setGroupForm({ ...groupForm, parent_id: e.target.value ? Number(e.target.value) : null })
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all"
              >
                <option value="">一级分组</option>
                {flatGroupsForSelect.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}{g.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">选择上级分组可将该分组作为子分组，留空则为一级分组</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setGroupDialogOpen(false); setGroupDialogMode(null); }}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg"
                onClick={() => groupDialogMode === "edit" ? handleUpdateGroup() : handleCreateGroup()}
                disabled={!groupForm.name.trim()}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Delete Confirmation Dialog */}
      <Dialog open={groupDeleteConfirmOpen} onOpenChange={setGroupDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除分组</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除该分组吗？该分组下的导航将变为未分组，子分组将提升为一级分组。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setGroupDeleteConfirmOpen(false); setGroupDeleteTargetId(null); }}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={confirmDeleteGroup}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bookmark Delete Confirmation Dialog */}
      <Dialog open={bookmarkDeleteConfirmOpen} onOpenChange={setBookmarkDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除导航</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除该导航吗？删除后将无法恢复。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setBookmarkDeleteConfirmOpen(false); setBookmarkDeleteTargetId(null); }}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={confirmDeleteBookmark}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
