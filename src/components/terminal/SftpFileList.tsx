import { useState, useMemo, useRef, useEffect } from "react";
import { Folder, FileText, ArrowUp, ArrowDown, Trash2, FolderPlus, Pencil, RefreshCw, Terminal } from "lucide-react";
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
        className={`flex-1 overflow-y-auto ${isDragging ? "bg-primary/10" : ""}`}
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
              onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
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
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
              className="input-macos"
            />
            <Button className="w-full btn-macos rounded-lg" onClick={handleRename} disabled={!renameValue.trim()}>
              确认
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

