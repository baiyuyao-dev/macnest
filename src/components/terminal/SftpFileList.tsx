import { useState, useMemo, useRef, useEffect } from "react";
import { Folder, FileText, ArrowUp, ArrowDown, Trash2, FolderPlus, Pencil, RefreshCw, Terminal, FolderOpen, Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SftpFile } from "@/types";
import { formatSize } from "@/lib/utils";
import ContextMenu, { type ContextMenuItemOrDivider } from "./ContextMenu";

interface SftpFileListProps {
  files: SftpFile[];
  currentPath: string;
  selectedFile: SftpFile | null;
  onSelectFile: (file: SftpFile | null) => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onDelete: (file: SftpFile) => void;
  onMkdir: (name: string) => void;
  onRename: (oldPath: string, newName: string) => void;
  onUpload: () => void;
  onDownload: () => void;
  onDropUpload: (localPath: string) => void;
  onSyncToTerminal?: () => void;
}

export default function SftpFileList({
  files,
  currentPath,
  selectedFile,
  onSelectFile,
  onPathChange,
  onRefresh,
  onDelete,
  onMkdir,
  onRename,
  onUpload,
  onDownload,
  onDropUpload,
  onSyncToTerminal,
}: SftpFileListProps) {
  const [showMkdirDialog, setShowMkdirDialog] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItemOrDivider[];
  }>({ open: false, x: 0, y: 0, items: [] });

  useEffect(() => {
    if (!toolbarRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCompact(entry.contentRect.width < 520);
      }
    });
    ro.observe(toolbarRef.current);
    return () => ro.disconnect();
  }, []);

  const breadcrumbs = useMemo(() =>
    currentPath === "/"
      ? [{ name: "根目录", path: "/" }]
      : [{ name: "根目录", path: "/" }, ...currentPath.split("/").filter(Boolean).map((part, i, arr) => ({
          name: part,
          path: "/" + arr.slice(0, i + 1).join("/"),
        }))],
    [currentPath]
  );

  const handleDoubleClick = (file: SftpFile) => {
    if (file.is_dir) {
      onPathChange(file.path);
    }
  };

  const handleDelete = () => {
    if (selectedFile) {
      onDelete(selectedFile);
    }
  };

  const handleMkdir = () => {
    if (mkdirName.trim()) {
      onMkdir(mkdirName.trim());
      setMkdirName("");
      setShowMkdirDialog(false);
    }
  };

  const handleRename = () => {
    if (selectedFile && renameValue.trim()) {
      const parent = currentPath === "/" ? "" : currentPath;
      const newPath = parent + "/" + renameValue.trim();
      onRename(selectedFile.path, newPath);
      setRenameValue("");
      setShowRenameDialog(false);
    }
  };

  const openRename = () => {
    if (selectedFile) {
      setRenameValue(selectedFile.name);
      setShowRenameDialog(true);
    }
  };

  // ── 右键菜单 ────────────────────────────────────────────

  const handleFileContextMenu = (e: React.MouseEvent, file: SftpFile) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItemOrDivider[] = [
      {
        id: "open",
        label: file.is_dir ? "进入目录" : "打开",
        icon: file.is_dir ? <FolderOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />,
        onClick: () => {
          if (file.is_dir) {
            onPathChange(file.path);
          } else {
            onSelectFile(file);
            onDownload();
          }
        },
      },
      {
        id: "download",
        label: "下载",
        icon: <ArrowDown className="h-3.5 w-3.5" />,
        disabled: file.is_dir,
        onClick: () => {
          onSelectFile(file);
          onDownload();
        },
      },
      {
        id: "rename",
        label: "重命名",
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: () => {
          onSelectFile(file);
          setRenameValue(file.name);
          setShowRenameDialog(true);
        },
      },
      {
        id: "copy-path",
        label: "复制路径",
        icon: <Clipboard className="h-3.5 w-3.5" />,
        onClick: () => {
          navigator.clipboard.writeText(file.path).catch(() => {});
        },
      },
    ];

    if (onSyncToTerminal) {
      items.push({
        id: "sync-to-terminal",
        label: "复制路径到终端",
        icon: <Terminal className="h-3.5 w-3.5" />,
        onClick: onSyncToTerminal,
      });
    }

    items.push("divider");
    items.push({
      id: "delete",
      label: "删除",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      destructive: true,
      onClick: () => {
        onSelectFile(file);
        onDelete(file);
      },
    });

    setContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
  };

  const handleBlankContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const items: ContextMenuItemOrDivider[] = [
      {
        id: "mkdir",
        label: "新建文件夹",
        icon: <FolderPlus className="h-3.5 w-3.5" />,
        onClick: () => setShowMkdirDialog(true),
      },
      {
        id: "upload",
        label: "上传文件",
        icon: <ArrowUp className="h-3.5 w-3.5" />,
        onClick: onUpload,
      },
      {
        id: "refresh",
        label: "刷新",
        icon: <RefreshCw className="h-3.5 w-3.5" />,
        onClick: onRefresh,
      },
    ];

    if (onSyncToTerminal) {
      items.push("divider");
      items.push({
        id: "sync-to-terminal",
        label: "同步到终端",
        icon: <Terminal className="h-3.5 w-3.5" />,
        onClick: onSyncToTerminal,
      });
    }

    setContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 面包屑 */}
      <div className="bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground border-b border-[var(--glass-border)]">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            {i > 0 && <span className="mx-1 text-muted-foreground/50">&gt;</span>}
            <span
              className="cursor-pointer text-primary hover:underline hover:text-primary/80"
              onClick={() => onPathChange(crumb.path)}
            >
              {crumb.name}
            </span>
          </span>
        ))}
      </div>

      {/* 工具栏 */}
      <div ref={toolbarRef} className="flex gap-1 px-2 py-1 bg-muted/30 border-b border-[var(--glass-border)]">
        <Button size="sm" variant="ghost" title="上传" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 shrink-0" onClick={onUpload}>
          <ArrowUp className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "上传"}
        </Button>
        <Button size="sm" variant="ghost" title="下载" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 shrink-0" onClick={onDownload}>
          <ArrowDown className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "下载"}
        </Button>
        <Button size="sm" variant="ghost" title="删除" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 shrink-0" onClick={handleDelete}>
          <Trash2 className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "删除"}
        </Button>
        <Button size="sm" variant="ghost" title="新建文件夹" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 shrink-0" onClick={() => setShowMkdirDialog(true)}>
          <FolderPlus className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "新建"}
        </Button>
        <Button size="sm" variant="ghost" title="重命名" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 shrink-0" onClick={openRename}>
          <Pencil className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "重命名"}
        </Button>
        {onSyncToTerminal && (
          <Button size="sm" variant="ghost" title="同步到终端" className="h-7 text-xs px-2 text-primary hover:bg-accent/40 shrink-0" onClick={onSyncToTerminal}>
            <Terminal className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "同步到终端"}
          </Button>
        )}
        <Button size="sm" variant="ghost" title="刷新" className="h-7 text-xs px-2 text-muted-foreground hover:bg-accent/40 ml-auto shrink-0" onClick={onRefresh}>
          <RefreshCw className={`h-3.5 w-3.5 ${compact ? "" : "mr-1"}`} />{!compact && "刷新"}
        </Button>
      </div>

      {/* 列表头 */}
      <div className="flex px-3 py-1 bg-muted/20 border-b border-[var(--glass-border)] text-xs text-muted-foreground font-semibold">
        <div className="flex-[2]">名称</div>
        <div className="flex-1 text-right">大小</div>
        <div className="flex-[1.5] text-right">修改时间</div>
        <div className="flex-1 text-right">权限</div>
      </div>

      {/* 文件列表 */}
      <div
        className={`flex-1 overflow-y-auto min-h-0 ${isDragging ? "bg-primary/10" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          const items = e.dataTransfer.items;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === "file") {
              const file = item.getAsFile();
              if (file) {
                // @ts-expect-error Tauri webview exposes file path
                const path = file.path as string | undefined;
                if (path) {
                  onDropUpload(path);
                }
              }
            }
          }
        }}
        onContextMenu={handleBlankContextMenu}
      >
        {/* 返回上级 */}
        {currentPath !== "/" && (
          <div
            className="flex px-3 py-1.5 text-xs text-muted-foreground cursor-pointer hover:bg-accent/30 border-b border-[var(--glass-border)]"
            onClick={() => {
              const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
              onPathChange(parent);
            }}
          >
            <div className="flex-[2]">📁 ..</div>
            <div className="flex-1 text-right">-</div>
            <div className="flex-[1.5] text-right">-</div>
            <div className="flex-1 text-right">-</div>
          </div>
        )}
        {files.map((file) => (
          <div
            key={file.path}
            className={`flex px-3 py-1.5 text-xs cursor-pointer border-b border-[var(--glass-border)] ${
              selectedFile?.path === file.path
                ? "bg-primary/15"
                : "hover:bg-accent/30"
            }`}
            onClick={() => onSelectFile(file)}
            onDoubleClick={() => handleDoubleClick(file)}
            onContextMenu={(e) => handleFileContextMenu(e, file)}
          >
            <div className={`flex-[2] ${file.is_dir ? "text-amber-500" : "text-foreground"}`}>
              {file.is_dir ? <Folder className="h-3.5 w-3.5 inline mr-1" /> : <FileText className="h-3.5 w-3.5 inline mr-1" />}
              {file.name}
            </div>
            <div className="flex-1 text-right text-muted-foreground">{formatSize(file.size)}</div>
            <div className="flex-[1.5] text-right text-muted-foreground">{file.modified_time}</div>
            <div className="flex-1 text-right text-muted-foreground font-mono text-[11px]">{file.permissions}</div>
          </div>
        ))}
      </div>

      {/* 状态栏 */}
      <div className="bg-muted/40 px-3 py-[3px] text-[11px] text-muted-foreground border-t border-[var(--glass-border)]">
        {files.length} 个项目{selectedFile ? ` | 已选择: ${selectedFile.name}` : ""}
      </div>

      {/* 新建文件夹对话框 */}
      <Dialog open={showMkdirDialog} onOpenChange={setShowMkdirDialog}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="文件夹名称"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleMkdir()}
              autoFocus
              className="input-macos"
            />
            <Button className="w-full btn-macos rounded-lg" onClick={handleMkdir} disabled={!mkdirName.trim()}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">重命名</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="新名称"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleRename()}
              autoFocus
              className="input-macos"
            />
            <Button className="w-full btn-macos rounded-lg" onClick={handleRename} disabled={!renameValue.trim()}>
              确认
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 右键菜单 */}
      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenu.items}
        onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

