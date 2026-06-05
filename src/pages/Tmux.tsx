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
  Monitor,
  Plus,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  Pencil,
  Trash2,
  FolderOpen,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  LayoutGrid,
  FileText,
  Eye,
  ExternalLink,
  FileCode,
  FileJson,
  FileImage,
  FileType,
  FileSpreadsheet,
  FileAudio,
  FileVideo,
  FileArchive,
  FileTerminal,
  Settings,
  Check,
  StickyNote,
  AppWindow,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import TmuxTerminal from "@/components/terminal/TmuxTerminal";
import ContextMenu, { type ContextMenuItemOrDivider } from "@/components/terminal/ContextMenu";
import {
  tmuxListSessions,
  tmuxCreateSession,
  tmuxKillSession,
  tmuxRenameSession,
  tmuxUpdateSessionStartDirectory,
  tmuxUpdateSessionGroupId,
  tmuxOpenInGhostty,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  localListDir,
  localReadFile,
  localWriteFile,
  localOpenFile,
  localRevealInFinder,
  localGetInstalledApps,
  localGetRecommendedApps,
  getErrorMessage,
} from "@/lib/api";
import { buildGroupTree, flattenGroups, type GroupNode } from "@/lib/tree";
import type { TmuxSession, Group, LocalFileNode } from "@/types";

/* ── Types ── */

interface WorkspaceNode extends Omit<GroupNode, "children"> {
  children: WorkspaceNode[];
  sessions: TmuxSession[];
}

const DEFAULT_SIDEBAR_WIDTH = 280;

function buildWorkspaceTree(groups: Group[], sessions: TmuxSession[]): WorkspaceNode[] {
  const tree = buildGroupTree(groups);
  const map = new Map<number, WorkspaceNode>();

  function collect(nodes: GroupNode[]) {
    for (const n of nodes) {
      map.set(n.id, { ...n, children: [], sessions: [] });
      collect(n.children);
    }
  }
  collect(tree);

  for (const s of sessions) {
    if (s.group_id != null && map.has(s.group_id)) {
      map.get(s.group_id)!.sessions.push(s);
    }
  }

  const roots: WorkspaceNode[] = [];
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

function WorkspaceTreeNode({
  node,
  depth,
  expandedIds,
  toggleExpand,
  onAttach,
  onEditSession,
  onDeleteSession,
  onNewSession,
  onEditWorkspace,
  onDeleteWorkspace,
  activeSession,
  idleSessions,
  connectingId,
}: {
  node: WorkspaceNode;
  depth: number;
  expandedIds: Set<number>;
  toggleExpand: (id: number) => void;
  onAttach: (name: string) => void;
  onEditSession: (session: TmuxSession) => void;
  onDeleteSession: (displayName: string) => void;
  onNewSession: (groupId: number | null) => void;
  onEditWorkspace: (group: Group) => void;
  onDeleteWorkspace: (id: number) => void;
  activeSession: string | null;
  idleSessions: Set<string>;
  connectingId: string | null;
}) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0 || node.sessions.length > 0;

  return (
    <div>
      {/* Workspace row */}
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
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-foreground">{node.name}</span>
          {node.start_directory && (
            <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[120px]">
              {node.start_directory}
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-0.5 opacity-70">
            ({node.sessions.length + node.children.reduce((sum, c) => sum + c.sessions.length, 0)})
          </span>
        </div>
        <div
          className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNewSession(node.id);
            }}
            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center text-primary"
            title="新建会话"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditWorkspace(node);
            }}
            className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center"
            title="编辑工作空间"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteWorkspace(node.id);
            }}
            className="h-6 w-6 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-destructive"
            title="删除工作空间"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content: sub-workspaces + sessions */}
      {isExpanded && (
        <div>
          {/* Sub-workspaces */}
          {node.children.map((child) => (
            <WorkspaceTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              onAttach={onAttach}
              onEditSession={onEditSession}
              onDeleteSession={onDeleteSession}
              onNewSession={onNewSession}
              onEditWorkspace={onEditWorkspace}
              onDeleteWorkspace={onDeleteWorkspace}
              activeSession={activeSession}
              idleSessions={idleSessions}
              connectingId={connectingId}
            />
          ))}
          {/* Sessions in this workspace */}
          {node.sessions.map((s) => (
            <div
              key={s.name}
              onClick={() => onAttach(s.name)}
              className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                activeSession === s.name
                  ? "bg-primary text-primary-foreground shadow-glass"
                  : "hover:bg-accent/50 text-foreground"
              }`}
              style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
            >
              <div
                className={`shrink-0 h-2 w-2 rounded-full ${
                  activeSession === s.name
                    ? "bg-primary-foreground animate-pulse-dot"
                    : idleSessions.has(s.name)
                      ? "bg-amber-500 animate-pulse-dot"
                      : "bg-emerald-500"
                }`}
              />
              <TerminalIcon className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{s.display_name}</span>
              <span
                className={`text-[10px] shrink-0 opacity-70 ${
                  activeSession === s.name ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {s.windows} 窗口 · {s.created_at}
              </span>
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditSession(s);
                  }}
                  className={`h-6 w-6 rounded-lg flex items-center justify-center ${
                    activeSession === s.name
                      ? "text-primary-foreground hover:bg-white/20"
                      : "hover:bg-secondary/60"
                  }`}
                  title="编辑"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.display_name);
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

/* ── File Tree Helpers ── */

function getFileIcon(name: string, isDir: boolean) {
  if (isDir) return <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
    case "vue":
    case "svelte":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    case "json":
    case "xml":
      return <FileJson className="h-3.5 w-3.5 shrink-0 text-yellow-500" />;
    case "html":
    case "htm":
    case "css":
    case "scss":
    case "less":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
    case "py":
    case "pyw":
    case "ipynb":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
    case "rs":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-orange-600" />;
    case "go":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-cyan-400" />;
    case "java":
    case "kt":
    case "gradle":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-red-400" />;
    case "swift":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-orange-500" />;
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "m":
    case "mm":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
    case "rb":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-red-500" />;
    case "php":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-indigo-400" />;
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return <FileTerminal className="h-3.5 w-3.5 shrink-0 text-green-500" />;
    case "sql":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
    case "md":
    case "markdown":
    case "mdx":
      return <StickyNote className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "conf":
    case "cfg":
    case "env":
      return <FileType className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "tiff":
    case "heic":
    case "svg":
      return <FileImage className="h-3.5 w-3.5 shrink-0 text-pink-400" />;
    case "pdf":
      return <FileType className="h-3.5 w-3.5 shrink-0 text-red-500" />;
    case "doc":
    case "docx":
      return <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />;
    case "xls":
    case "xlsx":
    case "csv":
      return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-green-600" />;
    case "ppt":
    case "pptx":
      return <FileType className="h-3.5 w-3.5 shrink-0 text-orange-600" />;
    case "mp3":
    case "wav":
    case "aac":
    case "flac":
    case "m4a":
      return <FileAudio className="h-3.5 w-3.5 shrink-0 text-violet-400" />;
    case "mp4":
    case "mov":
    case "avi":
    case "mkv":
    case "wmv":
      return <FileVideo className="h-3.5 w-3.5 shrink-0 text-rose-400" />;
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
    case "bz2":
    case "dmg":
      return <FileArchive className="h-3.5 w-3.5 shrink-0 text-amber-600" />;
    case "dockerfile":
      return <FileCode className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
    case "txt":
    case "log":
      return <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
    default:
      return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatModifiedTime(timestamp: string): string {
  if (!timestamp) return "";
  const secs = parseInt(timestamp, 10);
  if (isNaN(secs)) return timestamp;
  const date = new Date(secs * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "昨天";
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } else {
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
  }
}

function updateNodeChildren(
  nodes: LocalFileNode[],
  targetPath: string,
  children: LocalFileNode[]
): LocalFileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: updateNodeChildren(node.children, targetPath, children) };
    }
    return node;
  });
}

/* ── File Tree Node ── */

function FileTreeNode({
  node,
  depth,
  expandedPaths,
  toggleExpand,
  onLoadChildren,
  onEditFile,
  onContextMenu,
}: {
  node: LocalFileNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleExpand: (path: string) => void;
  onLoadChildren: (path: string) => void;
  onEditFile?: (node: LocalFileNode) => void;
  onContextMenu?: (e: React.MouseEvent, node: LocalFileNode) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);

  const handleClick = () => {
    if (node.is_dir) {
      toggleExpand(node.path);
      if (!isExpanded && (!node.children || node.children.length === 0)) {
        onLoadChildren(node.path);
      }
    }
  };

  const handleDoubleClick = () => {
    if (!node.is_dir && onEditFile) {
      onEditFile(node);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu?.(e, node)}
        className="group flex items-center gap-1.5 px-2 py-[3px] text-xs cursor-pointer hover:bg-accent/40 rounded-lg select-none transition-colors"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.is_dir ? (
          <>
            <span className="shrink-0 w-3.5 flex items-center justify-center">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
            </span>
            {getFileIcon(node.name, true)}
          </>
        ) : (
          <>
            <span className="shrink-0 w-3.5" />
            {getFileIcon(node.name, false)}
          </>
        )}
        <span className={`truncate flex-1 min-w-0 ${node.is_dir ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"}`}>
          {node.name}
        </span>
        {!node.is_dir && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatFileSize(node.size)}
          </span>
        )}
        {!node.is_dir && node.modified_time && (
          <span className="text-[10px] text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            {formatModifiedTime(node.modified_time)}
          </span>
        )}
      </div>
      {isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              onLoadChildren={onLoadChildren}
              onEditFile={onEditFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

export default function Tmux() {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTmux, setHasTmux] = useState(true);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [idleSessions, setIdleSessions] = useState<Set<string>>(new Set());
  const [readVersions, setReadVersions] = useState<Record<string, number>>({});

  // Sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [dragOverlay, setDragOverlay] = useState<"col-resize" | "row-resize" | null>(null);

  // File tree panel height (resizable)
  const DEFAULT_FILE_TREE_HEIGHT = 280;
  const [fileTreeHeight, setFileTreeHeight] = useState(DEFAULT_FILE_TREE_HEIGHT);
  const fileTreeRef = useRef<HTMLDivElement>(null);
  const isDraggingFileTree = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(DEFAULT_FILE_TREE_HEIGHT);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sidebarSearch, setSidebarSearch] = useState("");

  // File tree state
  const [fileTree, setFileTree] = useState<LocalFileNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [fileTreeRoot, setFileTreeRoot] = useState<string>("");
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);

  // File editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFile, setEditorFile] = useState<LocalFileNode | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  // File tree context menu
  const [fileContextMenu, setFileContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItemOrDivider[];
  }>({ open: false, x: 0, y: 0, items: [] });

  // Open with dialog
  const [openWithDialogOpen, setOpenWithDialogOpen] = useState(false);
  const [openWithTarget, setOpenWithTarget] = useState<LocalFileNode | null>(null);
  const [openWithApp, setOpenWithApp] = useState("");
  const [installedApps, setInstalledApps] = useState<string[]>([]);
  const [recommendedApps, setRecommendedApps] = useState<string[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [rememberDefault, setRememberDefault] = useState(false);
  const [fileAssociations, setFileAssociations] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("macnest-file-associations") || "{}");
    } catch {
      return {};
    }
  });

  const [fileTreeDragOver, setFileTreeDragOver] = useState(false);

  // Session dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editName, setEditName] = useState("");
  const [editCwd, setEditCwd] = useState("");
  const [editGroupId, setEditGroupId] = useState<number | null>(null);
  const [editIsExternal, setEditIsExternal] = useState(false);

  // Workspace dialogs
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [editWorkspaceDialogOpen, setEditWorkspaceDialogOpen] = useState(false);
  const [deleteWorkspaceOpen, setDeleteWorkspaceOpen] = useState(false);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<number | null>(null);
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "",
    parent_id: null as number | null,
    start_directory: "",
  });
  const [editWorkspaceForm, setEditWorkspaceForm] = useState({
    id: 0,
    name: "",
    parent_id: null as number | null,
    start_directory: "",
  });

  // Drag handlers
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDragging.current && sidebarRef.current) {
        const delta = e.clientX - startXRef.current;
        const w = Math.max(240, Math.min(420, startWidthRef.current + delta));
        sidebarRef.current.style.width = w + "px";
      }
      if (isDraggingFileTree.current && fileTreeRef.current) {
        const delta = startYRef.current - e.clientY;
        const h = Math.max(160, Math.min(500, startHeightRef.current + delta));
        fileTreeRef.current.style.height = h + "px";
      }
    };
    const handleUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        const w = sidebarRef.current?.offsetWidth ?? DEFAULT_SIDEBAR_WIDTH;
        setSidebarWidth(w);
      }
      if (isDraggingFileTree.current) {
        isDraggingFileTree.current = false;
        const h = fileTreeRef.current?.offsetHeight ?? DEFAULT_FILE_TREE_HEIGHT;
        setFileTreeHeight(h);
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

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tmuxListSessions();
      setSessions(data);
      setHasTmux(true);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      if (msg.includes("no server")) {
        setSessions([]);
        setHasTmux(true);
      } else if (msg.toLowerCase().includes("not installed")) {
        setHasTmux(false);
      } else {
        // 其他错误（权限、执行失败等）只记录日志，不显示"未安装"
        console.error("tmux list-sessions error:", msg);
        setSessions([]);
        setHasTmux(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const data = await listGroups("tmux");
      setGroups(data);
    } catch (err) {
      console.error("Failed to load workspaces:", err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadGroups();
  }, [loadSessions, loadGroups]);

  const workspaceTree = useMemo(() => buildWorkspaceTree(groups, sessions), [groups, sessions]);

  const flatGroups = useMemo(() => flattenGroups(workspaceTree), [workspaceTree]);

  const ungroupedSessions = useMemo(
    () => sessions.filter((s) => s.group_id == null),
    [sessions]
  );

  // Current active session display name
  const activeDisplayName = useMemo(() => {
    if (!activeSession) return "";
    return sessions.find((s) => s.name === activeSession)?.display_name || activeSession;
  }, [activeSession, sessions]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await tmuxCreateSession({
        name: newName.trim(),
        start_directory: newCwd.trim() || undefined,
        group_id: newGroupId,
      });
      setNewName("");
      setNewCwd("");
      setNewGroupId(null);
      setCreateOpen(false);
      loadSessions();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Create] Failed:", e);
      alert(`创建失败: ${msg}`);
    }
  };

  const handleKill = async () => {
    if (!deleteTarget) return;
    try {
      await tmuxKillSession(deleteTarget);
      const deleted = sessions.find((s) => s.display_name === deleteTarget);
      if (deleted && activeSession === deleted.name) {
        setActiveSession(null);
      }
      setDeleteOpen(false);
      setDeleteTarget("");
      loadSessions();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Kill] Failed:", e);
      alert(`删除失败: ${msg}`);
    }
  };

  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return String(e);
  };

  const handleEdit = async () => {
    if (!editName.trim() || !editTarget) return;
    const trimmedName = editName.trim();
    const trimmedCwd = editCwd.trim();

    const original = sessions.find((s) => s.display_name === editTarget);
    if (!original) {
      alert("会话信息已失效，请刷新后重试");
      return;
    }

    const originalCwd = original.start_directory || "";
    const nameChanged = trimmedName !== editTarget;
    const groupIdChanged = editGroupId !== (original.group_id ?? null);

    // 只有未分组时才检测工作目录变化
    const isUngrouped = editGroupId == null;
    const cwdChanged = isUngrouped && trimmedCwd !== originalCwd;

    // 获取新工作空间的目录
    let newWorkspaceDir = "";
    if (groupIdChanged && editGroupId != null) {
      const ws = groups.find((g) => g.id === editGroupId);
      if (ws) {
        newWorkspaceDir = ws.start_directory || "";
      }
    }
    const workspaceDirChanged = groupIdChanged && editGroupId != null && newWorkspaceDir !== originalCwd;

    if (!nameChanged && !groupIdChanged && !cwdChanged) {
      setEditOpen(false);
      setEditTarget("");
      setEditName("");
      setEditCwd("");
      setEditGroupId(null);
      return;
    }

    try {
      // 1. 更新名称
      if (nameChanged) {
        await tmuxRenameSession({
          old_name: editTarget,
          new_name: trimmedName,
        });
      }

      const lookupName = nameChanged ? trimmedName : editTarget;

      // 2. 更新工作空间（如果变更）
      if (groupIdChanged) {
        await tmuxUpdateSessionGroupId(lookupName, editGroupId);
        // 如果切换到了工作空间，同时更新目录为工作空间目录
        if (editGroupId != null && newWorkspaceDir) {
          await tmuxUpdateSessionStartDirectory(lookupName, newWorkspaceDir);
        }
        // 如果切换到未分组，使用用户输入的目录
        if (editGroupId == null && trimmedCwd) {
          await tmuxUpdateSessionStartDirectory(lookupName, trimmedCwd);
        }
      }

      // 3. 未分组时更新工作目录
      if (!groupIdChanged && cwdChanged) {
        await tmuxUpdateSessionStartDirectory(lookupName, trimmedCwd);
      }

      // 保存 group_id 供后续重建使用（清理状态前先保存）
      const targetGroupId = editGroupId;

      setEditOpen(false);
      setEditTarget("");
      setEditName("");
      setEditCwd("");
      setEditGroupId(null);
      setEditIsExternal(false);
      await loadSessions();

      // 提示重建（目录变化时）
      if (cwdChanged || workspaceDirChanged) {
        const changedDir = workspaceDirChanged ? newWorkspaceDir : trimmedCwd;
        const shouldRebuild = confirm(
          "工作目录已更新，但当前运行的 tmux 会话不会自动切换目录。\n\n" +
            "是否需要销毁当前会话并重新创建以应用新目录？\n\n" +
            "⚠️ 警告：此操作会丢失当前会话内的所有状态（如未保存的工作、历史命令等）。"
        );
        if (shouldRebuild) {
          try {
            const displayNameToKill = nameChanged ? trimmedName : editTarget;
            await tmuxKillSession(displayNameToKill);
            await tmuxCreateSession({
              name: nameChanged ? trimmedName : editTarget,
              start_directory: changedDir || undefined,
              group_id: targetGroupId,
            });
            await loadSessions();
            alert("会话已重建，新工作目录已生效。");
          } catch (e: unknown) {
            const msg = getErrorMessage(e);
            console.error("[Tmux Edit] Rebuild failed:", e);
            alert(`重建失败: ${msg}`);
          }
        }
      } else {
        // 非目录变更时给出成功提示
        alert("编辑成功");
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Edit] Edit failed:", e);
      alert(`编辑失败: ${msg}`);
    }
  };

  const handleAttach = (name: string) => {
    setActiveSession(name);
    setIdleSessions((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setReadVersions((prev) => ({
      ...prev,
      [name]: (prev[name] || 0) + 1,
    }));
  };

  const handleDetach = () => {
    setActiveSession(null);
  };

  const handleIdle = useCallback((name: string, idle: boolean) => {
    setIdleSessions((prev) => {
      const next = new Set(prev);
      if (idle) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }, []);

  // ── File tree logic ──

  const loadFileTree = useCallback(async (path: string) => {
    if (!path) return;
    setFileTreeLoading(true);
    setFileTreeError(null);
    try {
      const data = await localListDir(path);
      setFileTree(data);
      setFileTreeRoot(path);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      setFileTreeError(msg);
      setFileTree([]);
    } finally {
      setFileTreeLoading(false);
    }
  }, []);

  const loadChildren = useCallback(async (path: string) => {
    try {
      const data = await localListDir(path);
      setFileTree((prev) => updateNodeChildren(prev, path, data));
    } catch (e: unknown) {
      console.error("[FileTree] Failed to load children:", e);
    }
  }, []);

  const togglePathExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // 当活跃会话变化时，自动加载其工作目录的文件树
  useEffect(() => {
    if (activeSession) {
      const session = sessions.find((s) => s.name === activeSession);
      let dir = session?.start_directory;
      // 如果会话没有目录，尝试使用其工作空间的目录
      if (!dir && session?.group_id) {
        const ws = groups.find((g) => g.id === session.group_id);
        dir = ws?.start_directory;
      }
      if (dir && dir !== fileTreeRoot) {
        loadFileTree(dir);
      }
    }
  }, [activeSession, sessions, groups, fileTreeRoot, loadFileTree]);

  // Tauri 原生拖拽监听（从 Finder 拖拽文件到文件树）
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      try {
        const win = getCurrentWebviewWindow();
        unlisten = await win.onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            for (const path of event.payload.paths) {
              const node: LocalFileNode = {
                name: path.split(/[/\\]/).pop() || "file",
                path,
                is_dir: false,
                size: 0,
                modified_time: String(Math.floor(Date.now() / 1000)),
                permissions: "",
              };
              const defaultApp = getDefaultAppForFile(node);
              handleOpenWith(node, defaultApp);
            }
          }
        });
      } catch (e) {
        console.error("Failed to setup file-tree drag-drop listener:", e);
      }
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 文件编辑器 ──
  const handleEditFile = async (node: LocalFileNode) => {
    if (node.is_dir) return;
    setEditorFile(node);
    setEditorOpen(true);
    setEditorLoading(true);
    setEditorContent("");
    try {
      const content = await localReadFile(node.path);
      setEditorContent(content);
    } catch (err) {
      console.error("[FileEditor] Failed to read file:", err);
      alert("读取文件失败: " + getErrorMessage(err));
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  };

  const saveEditor = async () => {
    if (!editorFile) return;
    setEditorSaving(true);
    try {
      await localWriteFile(editorFile.path, editorContent);
      setEditorOpen(false);
      toast.success("保存成功");
    } catch (err) {
      console.error("[FileEditor] Failed to save file:", err);
      alert("保存失败: " + getErrorMessage(err));
    } finally {
      setEditorSaving(false);
    }
  };

  // ── 文件树右键菜单 ──
  const handleFileContextMenu = (e: React.MouseEvent, node: LocalFileNode) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItemOrDivider[] = [
      {
        id: "view",
        label: node.is_dir ? "展开" : "查看",
        icon: <Eye className="h-3.5 w-3.5" />,
        onClick: () => {
          if (node.is_dir) {
            togglePathExpand(node.path);
            if (!expandedPaths.has(node.path)) {
              loadChildren(node.path);
            }
          } else {
            handleEditFile(node);
          }
        },
      },
    ];

    if (!node.is_dir) {
      items.push("divider");
      const defaultApp = getDefaultAppForFile(node);
      items.push({
        id: "open-default",
        label: defaultApp ? `用 ${defaultApp} 打开` : "用默认方式打开",
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        onClick: () => handleOpenWith(node, defaultApp),
      });
      items.push({
        id: "open-with",
        label: "用其他应用打开...",
        icon: <LayoutGrid className="h-3.5 w-3.5" />,
        onClick: async () => {
          setOpenWithTarget(node);
          setOpenWithApp("");
          setAppSearchQuery("");
          setRememberDefault(false);
          setOpenWithDialogOpen(true);
          // 加载推荐应用和系统应用
          const ext = node.name.split(".").pop()?.toLowerCase() || "";
          try {
            const [recommended, allApps] = await Promise.all([
              ext ? localGetRecommendedApps(ext) : Promise.resolve([]),
              localGetInstalledApps(),
            ]);
            setRecommendedApps(recommended);
            setInstalledApps(allApps.map((a) => a.name));
          } catch (err) {
            console.error("Failed to load apps:", err);
          }
        },
      });
    }

    items.push("divider");
    items.push({
      id: "reveal-in-finder",
      label: "在 Finder 中显示",
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      onClick: () => handleRevealInFinder(node),
    });

    setFileContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
  };

  const handleOpenWith = async (node: LocalFileNode, app?: string) => {
    try {
      await localOpenFile(node.path, app);
    } catch (err) {
      alert("打开失败: " + getErrorMessage(err));
    }
  };

  const handleRevealInFinder = async (node: LocalFileNode) => {
    try {
      await localRevealInFinder(node.path);
    } catch (err) {
      alert("打开 Finder 失败: " + getErrorMessage(err));
    }
  };

  const confirmOpenWith = async () => {
    if (!openWithTarget || !openWithApp.trim()) return;
    const appName = openWithApp.trim();

    // 保存默认关联
    if (rememberDefault && openWithTarget) {
      const ext = openWithTarget.name.split(".").pop()?.toLowerCase() || "";
      if (ext) {
        const newAssociations = { ...fileAssociations, [ext]: appName };
        setFileAssociations(newAssociations);
        localStorage.setItem("macnest-file-associations", JSON.stringify(newAssociations));
        toast.success(`已设置 .${ext} 文件的默认打开方式为 ${appName}`);
      }
    }

    setOpenWithDialogOpen(false);
    await handleOpenWith(openWithTarget, appName);
    setOpenWithTarget(null);
    setOpenWithApp("");
    setRememberDefault(false);
    setAppSearchQuery("");
  };

  const getDefaultAppForFile = (node: LocalFileNode): string | undefined => {
    const ext = node.name.split(".").pop()?.toLowerCase() || "";
    return ext ? fileAssociations[ext] : undefined;
  };

  const handleGhostty = async (displayName: string) => {
    try {
      await tmuxOpenInGhostty(displayName);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Ghostty] Failed:", e);
      alert(`Ghostty 打开失败: ${msg}`);
    }
  };

  const pickDirectory = async (setter: (path: string) => void) => {
    try {
      const selected = await open({ directory: true });
      if (selected && typeof selected === "string") {
        setter(selected);
      }
    } catch {
      // 用户取消选择，忽略
    }
  };

  // Workspace handlers
  const handleCreateWorkspace = async () => {
    if (!workspaceForm.name.trim()) return;
    try {
      await createGroup({
        name: workspaceForm.name.trim(),
        parent_id: workspaceForm.parent_id,
        sort_order: groups.length,
        group_type: "tmux",
        start_directory: workspaceForm.start_directory.trim(),
      });
      setWorkspaceForm({ name: "", parent_id: null, start_directory: "" });
      setWorkspaceDialogOpen(false);
      loadGroups();
    } catch (error) {
      console.error("Failed to create workspace:", error);
      alert("创建工作空间失败");
    }
  };

  const handleEditWorkspace = (group: Group) => {
    setEditWorkspaceForm({
      id: group.id,
      name: group.name,
      parent_id: group.parent_id,
      start_directory: group.start_directory || "",
    });
    setEditWorkspaceDialogOpen(true);
  };

  const handleSaveWorkspace = async () => {
    if (!editWorkspaceForm.name.trim()) return;
    try {
      const group = groups.find((g) => g.id === editWorkspaceForm.id);
      if (!group) return;
      await updateGroup({
        ...group,
        name: editWorkspaceForm.name.trim(),
        parent_id: editWorkspaceForm.parent_id,
        start_directory: editWorkspaceForm.start_directory.trim(),
      });
      setEditWorkspaceDialogOpen(false);
      loadGroups();
    } catch (error) {
      console.error("Failed to update workspace:", error);
      alert("更新工作空间失败");
    }
  };

  const handleDeleteWorkspace = (id: number) => {
    setDeleteWorkspaceId(id);
    setDeleteWorkspaceOpen(true);
  };

  const confirmDeleteWorkspace = async () => {
    if (deleteWorkspaceId == null) return;
    try {
      await deleteGroup(deleteWorkspaceId);
      loadGroups();
      loadSessions();
    } catch (error) {
      console.error("Failed to delete workspace:", error);
      alert("删除工作空间失败");
    }
    setDeleteWorkspaceOpen(false);
    setDeleteWorkspaceId(null);
  };

  const handleNewSession = (groupId: number | null) => {
    setNewName("");
    setNewCwd("");
    setNewGroupId(groupId);
    setCreateOpen(true);
  };

  const handleEditSession = (session: TmuxSession) => {
    setEditTarget(session.display_name);
    setEditName(session.display_name);
    setEditCwd(session.start_directory || "");
    setEditGroupId(session.group_id ?? null);
    setEditIsExternal(session.is_external ?? false);
    setEditOpen(true);
  };

  const handleDeleteSession = (displayName: string) => {
    setDeleteTarget(displayName);
    setDeleteOpen(true);
  };

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!sidebarSearch.trim()) return workspaceTree;
    const q = sidebarSearch.toLowerCase();

    function filterNodes(nodes: WorkspaceNode[]): WorkspaceNode[] {
      const result: WorkspaceNode[] = [];
      for (const node of nodes) {
        const matchName = node.name.toLowerCase().includes(q);
        const matchDir = node.start_directory.toLowerCase().includes(q);
        const filteredChildren = filterNodes(node.children);
        const filteredSessions = node.sessions.filter(
          (s) =>
            s.display_name.toLowerCase().includes(q) ||
            (s.start_directory?.toLowerCase().includes(q) ?? false)
        );
        if (matchName || matchDir || filteredChildren.length > 0 || filteredSessions.length > 0) {
          result.push({
            ...node,
            children: matchName ? node.children : filteredChildren,
            sessions: matchName ? node.sessions : filteredSessions,
          });
        }
      }
      return result;
    }

    return filterNodes(workspaceTree);
  }, [workspaceTree, sidebarSearch]);

  // Expand all when searching
  useEffect(() => {
    if (sidebarSearch.trim()) {
      const allIds = new Set<number>();
      function collect(nodes: WorkspaceNode[]) {
        for (const n of nodes) {
          allIds.add(n.id);
          collect(n.children);
        }
      }
      collect(filteredTree);
      setExpandedIds(allIds);
    }
  }, [sidebarSearch, filteredTree]);

  if (!hasTmux) {
    return (
      <div className="flex h-full items-center justify-center animate-page-enter">
        <div className="text-center card-macos p-10 max-w-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto mb-5">
            <TerminalIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mb-2 text-lg font-semibold tracking-tight">未检测到 tmux</h2>
          <p className="text-sm text-muted-foreground">请先安装 tmux：brew install tmux</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background animate-page-enter relative">
      {/* 拖动时全屏透明覆盖层 */}
      {dragOverlay && (
        <div className="fixed inset-0 z-[9999]" style={{ cursor: dragOverlay }} />
      )}

      {/* ── Sidebar ── */}
      <div
        className="border-r border-[var(--glass-border)] flex flex-col shrink-0 bg-muted/20"
        style={{ width: sidebarWidth }}
        ref={sidebarRef}
      >
        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            工作空间
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 rounded-lg text-xs px-2.5 btn-macos"
              onClick={() => handleNewSession(null)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              新建会话
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-lg text-xs px-2.5 btn-macos-secondary"
              onClick={() => {
                setWorkspaceForm({ name: "", parent_id: null, start_directory: "" });
                setWorkspaceDialogOpen(true);
              }}
            >
              <Folder className="h-3.5 w-3.5 mr-1" />
              新建空间
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--glass-border)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索工作空间或会话..."
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="h-8 text-xs pl-9 input-macos"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTree.length === 0 && ungroupedSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <Monitor className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground text-center">没有 tmux 会话</p>
              <Button
                size="sm"
                className="mt-2 text-sm btn-macos rounded-lg h-8 px-3"
                onClick={() => handleNewSession(null)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                创建第一个会话
              </Button>
            </div>
          ) : (
            <>
              {/* All sessions header */}
              <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
                全部 ({sessions.length})
              </div>

              {/* Ungrouped sessions */}
              {ungroupedSessions.length > 0 && (
                <div className="mb-1">
                  <div className="px-3 py-1 text-xs text-muted-foreground font-medium">未分组</div>
                  {ungroupedSessions.map((s) => (
                    <div
                      key={s.name}
                      onClick={() => handleAttach(s.name)}
                      className={`group flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all duration-200 cursor-pointer ${
                        activeSession === s.name
                          ? "bg-primary text-primary-foreground shadow-glass"
                          : "hover:bg-accent/50 text-foreground"
                      }`}
                      style={{ paddingLeft: `${12 + 16}px` }}
                    >
                      <div
                        className={`shrink-0 h-2 w-2 rounded-full ${
                          activeSession === s.name
                            ? "bg-primary-foreground animate-pulse-dot"
                            : idleSessions.has(s.name)
                              ? "bg-amber-500 animate-pulse-dot"
                              : "bg-emerald-500"
                        }`}
                      />
                      <TerminalIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate flex-1">{s.display_name}</span>
                      <span
                        className={`text-[10px] shrink-0 opacity-70 ${
                          activeSession === s.name
                            ? "text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {s.windows} 窗口 · {s.created_at}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditSession(s);
                          }}
                          className={`h-6 w-6 rounded-lg flex items-center justify-center ${
                            activeSession === s.name
                              ? "text-primary-foreground hover:bg-white/20"
                              : "hover:bg-secondary/60"
                          }`}
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(s.display_name);
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

              {/* Workspace tree */}
              {filteredTree.map((node) => (
                <WorkspaceTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onAttach={handleAttach}
                  onEditSession={handleEditSession}
                  onDeleteSession={handleDeleteSession}
                  onNewSession={handleNewSession}
                  onEditWorkspace={handleEditWorkspace}
                  onDeleteWorkspace={handleDeleteWorkspace}
                  activeSession={activeSession}
                  idleSessions={idleSessions}
                  connectingId={null}
                />
              ))}
            </>
          )}
        </div>

        {/* Horizontal splitter: Workspace tree ↔ File Tree */}
        <div
          className="h-2 shrink-0 z-20 group relative cursor-row-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingFileTree.current = true;
            startYRef.current = e.clientY;
            startHeightRef.current = fileTreeRef.current?.offsetHeight ?? DEFAULT_FILE_TREE_HEIGHT;
            setDragOverlay("row-resize");
          }}
        >
          <div className="absolute inset-0 -top-1 -bottom-1" />
          <div className="h-[3px] w-full mx-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* ── File Tree Panel ── */}
        <div
          ref={fileTreeRef}
          className={`flex flex-col min-h-[160px] shrink-0 transition-colors ${fileTreeDragOver ? "bg-primary/10 border-primary/30" : ""}`}
          style={{ height: fileTreeHeight }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFileTreeDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFileTreeDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFileTreeDragOver(false);
            const items = e.dataTransfer.items;
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) {
                  // @ts-expect-error Tauri webview exposes file path
                  const path = file.path as string | undefined;
                  if (path) {
                    // 创建临时文件节点并打开
                    const node: LocalFileNode = {
                      name: path.split(/[/\\]/).pop() || "file",
                      path,
                      is_dir: false,
                      size: file.size,
                      modified_time: String(Math.floor(Date.now() / 1000)),
                      permissions: "",
                    };
                    const defaultApp = getDefaultAppForFile(node);
                    handleOpenWith(node, defaultApp);
                  }
                }
              }
            }
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--glass-border)] bg-muted/20">
            <div className="flex items-center gap-1.5 min-w-0">
              <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${fileTreeDragOver ? "text-primary animate-bounce" : "text-primary"}`} />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                {fileTreeDragOver ? "释放以打开文件" : "文件树"}
              </span>
              {fileTreeRoot && !fileTreeDragOver && (
                <span className="text-[10px] text-muted-foreground truncate ml-1" title={fileTreeRoot}>
                  {fileTreeRoot}
                </span>
              )}
            </div>
            <button
              onClick={() => fileTreeRoot && loadFileTree(fileTreeRoot)}
              className="h-6 w-6 rounded-lg hover:bg-secondary/60 flex items-center justify-center text-muted-foreground shrink-0"
              title="刷新"
              disabled={fileTreeLoading}
            >
              <RefreshCw className={`h-3 w-3 ${fileTreeLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1 px-1">
            {fileTreeError ? (
              <div className="text-[11px] text-destructive px-2 py-2">{fileTreeError}</div>
            ) : fileTree.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-2 py-4 text-center flex flex-col items-center gap-1">
                {fileTreeDragOver ? (
                  <>
                    <FolderOpen className="h-5 w-5 text-primary animate-bounce" />
                    <span className="text-primary font-medium">释放以打开文件</span>
                  </>
                ) : (
                  <>
                    <span>{fileTreeLoading ? "加载中..." : fileTreeRoot ? "空目录" : "选择一个会话查看文件"}</span>
                    {!fileTreeRoot && (
                      <span className="text-[10px] text-muted-foreground/60">或从 Finder 拖拽文件到此处</span>
                    )}
                  </>
                )}
              </div>
            ) : (
              fileTree.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  toggleExpand={togglePathExpand}
                  onLoadChildren={loadChildren}
                  onEditFile={handleEditFile}
                  onContextMenu={handleFileContextMenu}
                />
              ))
            )}
          </div>

          {/* 文件树右键菜单 */}
          <ContextMenu
            open={fileContextMenu.open}
            x={fileContextMenu.x}
            y={fileContextMenu.y}
            items={fileContextMenu.items}
            onClose={() => setFileContextMenu((prev) => ({ ...prev, open: false }))}
          />
        </div>
      </div>

      {/* Horizontal splitter */}
      <div
        className="w-2 shrink-0 z-20 group relative cursor-col-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          isDragging.current = true;
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
        {activeSession ? (
          <div className="flex flex-1 flex-col bg-muted m-3 rounded-2xl overflow-hidden border border-[var(--glass-border)]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full animate-pulse-dot bg-emerald-500" />
                <span className="text-sm font-medium">{activeDisplayName}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs rounded-lg hover:bg-secondary/60"
                  onClick={() => handleGhostty(activeDisplayName)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Ghostty
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 rounded-lg"
                  onClick={handleDetach}
                >
                  <Square className="mr-1 h-3 w-3" />
                  断开
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TmuxTerminal
                key={activeSession}
                sessionName={activeSession}
                onDetach={handleDetach}
                onIdle={(idle) => handleIdle(activeSession, idle)}
                readVersion={readVersions[activeSession] || 0}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <Monitor className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground/50">未打开任何会话</h3>
            <p className="mt-2 text-sm text-muted-foreground/40">
              点击左侧会话进行连接，或新建一个会话
            </p>
            <Button className="mt-6 btn-macos" onClick={() => handleNewSession(null)}>
              <Plus className="mr-2 h-4 w-4" />
              新建会话
            </Button>
          </div>
        )}
      </div>

      {/* ── New Session Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建 tmux 会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">会话名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如 my-project、web-server"
                onKeyDown={(e) =>
                  e.key === "Enter" && !e.nativeEvent.isComposing && handleCreate()
                }
                className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作空间</Label>
              <select
                value={newGroupId?.toString() || ""}
                onChange={(e) =>
                  setNewGroupId(e.target.value ? Number(e.target.value) : null)
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all mt-1.5"
              >
                <option value="">未分组</option>
                {flatGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                选择工作空间后，会话将自动进入该工作空间的目录
              </p>
            </div>
            {/* 只有未分组时才显示工作目录输入 */}
            {newGroupId == null && (
              <div>
                <Label className="text-xs">工作目录</Label>
                <div className="flex gap-2 mt-1.5">
                  <Input
                    value={newCwd}
                    onChange={(e) => setNewCwd(e.target.value)}
                    placeholder="如 /Users/xxx/projects，留空使用主目录"
                    onKeyDown={(e) =>
                      e.key === "Enter" && !e.nativeEvent.isComposing && handleCreate()
                    }
                    className="input-macos flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 rounded-lg text-xs"
                    onClick={() => pickDirectory(setNewCwd)}
                    type="button"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1" />
                    浏览
                  </Button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setNewName("");
                  setNewCwd("");
                  setNewGroupId(null);
                  setCreateOpen(false);
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Session Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">会话名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="会话名称"
                onKeyDown={(e) =>
                  e.key === "Enter" && !e.nativeEvent.isComposing && handleEdit()
                }
                className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作空间</Label>
              {editIsExternal ? (
                <>
                  <Input
                    value="未分组（外部会话）"
                    disabled
                    className="input-macos mt-1.5 bg-muted/50 text-muted-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    外部创建的 tmux 会话不支持修改工作空间，如需分组请复制配置后重新创建
                  </p>
                </>
              ) : (
                <>
                  <select
                    value={editGroupId?.toString() || ""}
                    onChange={(e) =>
                      setEditGroupId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all mt-1.5"
                  >
                    <option value="">未分组</option>
                    {flatGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {"\u00A0".repeat(g.depth * 2)}
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {editGroupId != null
                      ? "属于工作空间的会话将使用该工作空间的目录"
                      : "未分组的会话可自主设置工作目录"}
                  </p>
                </>
              )}
            </div>
            {/* 只有未分组时才可编辑工作目录 */}
            {editGroupId == null ? (
              <div>
                <Label className="text-xs">工作目录</Label>
                <div className="flex gap-2 mt-1.5">
                  <Input
                    value={editCwd}
                    onChange={(e) => setEditCwd(e.target.value)}
                    placeholder="如 /Users/xxx/projects"
                    onKeyDown={(e) =>
                      e.key === "Enter" && !e.nativeEvent.isComposing && handleEdit()
                    }
                    className="input-macos flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 rounded-lg text-xs"
                    onClick={() => pickDirectory(setEditCwd)}
                    type="button"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1" />
                    浏览
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  修改工作目录后，当前运行的 tmux 会话不会自动切换。保存后可选择是否销毁重建以应用新目录。
                </p>
              </div>
            ) : (
              <div>
                <Label className="text-xs">工作目录</Label>
                <Input
                  value={(() => {
                    const ws = groups.find((g) => g.id === editGroupId);
                    return ws?.start_directory || "使用主目录";
                  })()}
                  disabled
                  className="input-macos mt-1.5 bg-muted/50 text-muted-foreground"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  工作目录由工作空间决定，如需更改请编辑对应工作空间
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setEditOpen(false);
                  setEditTarget("");
                  setEditGroupId(null);
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleEdit}
                disabled={!editName.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Session Dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">删除会话</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            确定要销毁 tmux 会话 <strong>"{deleteTarget}"</strong> 吗？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleKill}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── New Workspace Dialog ── */}
      <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建工作空间</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">工作空间名称</Label>
              <Input
                value={workspaceForm.name}
                onChange={(e) =>
                  setWorkspaceForm({ ...workspaceForm, name: e.target.value })
                }
                placeholder="如 项目开发、服务器运维"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && workspaceForm.name.trim()) handleCreateWorkspace();
                }}
                className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作目录</Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  value={workspaceForm.start_directory}
                  onChange={(e) =>
                    setWorkspaceForm({ ...workspaceForm, start_directory: e.target.value })
                  }
                  placeholder="如 /Users/xxx/projects，留空使用主目录"
                  className="input-macos flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 rounded-lg text-xs"
                  onClick={() => pickDirectory((path) => setWorkspaceForm({ ...workspaceForm, start_directory: path }))}
                  type="button"
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  浏览
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                在此工作空间下创建的会话将默认进入该目录
              </p>
            </div>
            <div>
              <Label className="text-xs">上级工作空间</Label>
              <select
                value={workspaceForm.parent_id?.toString() || ""}
                onChange={(e) =>
                  setWorkspaceForm({
                    ...workspaceForm,
                    parent_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all mt-1.5"
              >
                <option value="">一级工作空间</option>
                {flatGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {"\u00A0".repeat(g.depth * 2)}
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setWorkspaceDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleCreateWorkspace}
                disabled={!workspaceForm.name.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Workspace Dialog ── */}
      <Dialog open={editWorkspaceDialogOpen} onOpenChange={setEditWorkspaceDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑工作空间</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">工作空间名称</Label>
              <Input
                value={editWorkspaceForm.name}
                onChange={(e) =>
                  setEditWorkspaceForm({ ...editWorkspaceForm, name: e.target.value })
                }
                placeholder="工作空间名称"
                className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作目录</Label>
              <div className="flex gap-2 mt-1.5">
                <Input
                  value={editWorkspaceForm.start_directory}
                  onChange={(e) =>
                    setEditWorkspaceForm({ ...editWorkspaceForm, start_directory: e.target.value })
                  }
                  placeholder="如 /Users/xxx/projects"
                  className="input-macos flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 rounded-lg text-xs"
                  onClick={() => pickDirectory((path) => setEditWorkspaceForm({ ...editWorkspaceForm, start_directory: path }))}
                  type="button"
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  浏览
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">上级工作空间</Label>
              <select
                value={editWorkspaceForm.parent_id?.toString() || ""}
                onChange={(e) =>
                  setEditWorkspaceForm({
                    ...editWorkspaceForm,
                    parent_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="flex h-10 w-full rounded-xl border border-[var(--glass-border-strong)] bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus:border-primary/50 transition-all mt-1.5"
              >
                <option value="">一级工作空间</option>
                {flatGroups
                  .filter((g) => g.id !== editWorkspaceForm.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {"\u00A0".repeat(g.depth * 2)}
                      {g.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setEditWorkspaceDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="btn-macos rounded-lg"
                onClick={handleSaveWorkspace}
                disabled={!editWorkspaceForm.name.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Workspace Dialog ── */}
      <Dialog open={deleteWorkspaceOpen} onOpenChange={setDeleteWorkspaceOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除工作空间</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            确定要删除该工作空间吗？该工作空间下的会话将变为未分组，子工作空间将提升为一级工作空间。
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setDeleteWorkspaceOpen(false);
                setDeleteWorkspaceId(null);
              }}
            >
              取消
            </Button>
            <Button size="sm" variant="destructive" className="rounded-lg" onClick={confirmDeleteWorkspace}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── File Editor Dialog ── */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[90vw] max-w-[1400px] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑: {editorFile?.name}</DialogTitle>
          </DialogHeader>
          {editorLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <textarea
              className="flex-1 w-full resize-none bg-muted/30 border border-[var(--glass-border)] rounded-lg p-3 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              spellCheck={false}
            />
          )}
          <div className="flex justify-end gap-2 mt-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setEditorOpen(false)}
              disabled={editorSaving}
            >
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              className="rounded-lg"
              onClick={saveEditor}
              disabled={editorLoading || editorSaving}
            >
              {editorSaving ? "保存中..." : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Open With Dialog ── */}
      <Dialog open={openWithDialogOpen} onOpenChange={setOpenWithDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <AppWindow className="h-4 w-4 text-primary" />
              打开方式
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">{openWithTarget?.name}</p>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {/* 推荐应用 */}
            {recommendedApps.length > 0 && (
              <div>
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">推荐应用</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {recommendedApps.map((app) => (
                    <button
                      key={app}
                      onClick={() => setOpenWithApp(app)}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-1.5 ${
                        openWithApp === app
                          ? "border-primary bg-primary/10 text-primary shadow-sm"
                          : "border-[var(--glass-border)] hover:border-primary/50 text-muted-foreground hover:bg-accent/30"
                      }`}
                    >
                      {openWithApp === app && <Check className="h-3 w-3" />}
                      {app}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 搜索所有应用 */}
            <div>
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">所有应用</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索应用..."
                  value={appSearchQuery}
                  onChange={(e) => setAppSearchQuery(e.target.value)}
                  className="h-8 text-xs pl-8 input-macos"
                />
              </div>
              <div className="mt-1.5 max-h-[180px] overflow-y-auto rounded-lg border border-[var(--glass-border)]">
                {installedApps
                  .filter((app) => app.toLowerCase().includes(appSearchQuery.toLowerCase()))
                  .map((app) => (
                    <button
                      key={app}
                      onClick={() => setOpenWithApp(app)}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                        openWithApp === app
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                      }`}
                    >
                      <AppWindow className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{app}</span>
                      {openWithApp === app && <Check className="h-3 w-3 ml-auto shrink-0" />}
                    </button>
                  ))}
                {installedApps.filter((app) => app.toLowerCase().includes(appSearchQuery.toLowerCase())).length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground text-center">未找到应用</div>
                )}
              </div>
            </div>

            {/* 始终用此应用打开 */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberDefault}
                onChange={(e) => setRememberDefault(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">始终用此应用打开此类文件</span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setOpenWithDialogOpen(false);
                  setOpenWithTarget(null);
                  setOpenWithApp("");
                  setAppSearchQuery("");
                  setRememberDefault(false);
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                className="rounded-lg"
                onClick={confirmOpenWith}
                disabled={!openWithApp.trim()}
              >
                打开
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
