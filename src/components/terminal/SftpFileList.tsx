import { useState, useMemo } from "react";
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
      <div className="bg-[#252540] px-3 py-1.5 text-[10px] text-[#aaa] border-b border-[#333]">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            {i > 0 && <span className="mx-1 text-[#666]">&gt;</span>}
            <span
              className="cursor-pointer text-[#4fc3f7] hover:underline"
              onClick={() => onPathChange(crumb.path)}
            >
              {crumb.name}
            </span>
          </span>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex gap-1 px-2 py-1 bg-[#1e1e2e] border-b border-[#333]">
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={onUpload}>
          <ArrowUp className="h-3 w-3 mr-1" />上传
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={onDownload}>
          <ArrowDown className="h-3 w-3 mr-1" />下载
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={handleDelete}>
          <Trash2 className="h-3 w-3 mr-1" />删除
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={() => setShowMkdirDialog(true)}>
          <FolderPlus className="h-3 w-3 mr-1" />新建
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={openRename}>
          <Pencil className="h-3 w-3 mr-1" />重命名
        </Button>
        {onSyncToTerminal && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#0dbc79] hover:bg-[#3a3a55]" onClick={onSyncToTerminal}>
            <Terminal className="h-3 w-3 mr-1" />同步到终端
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55] ml-auto" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" />刷新
        </Button>
      </div>

      {/* 列表头 */}
      <div className="flex px-3 py-1 bg-[#1a1a2e] border-b border-[#333] text-[10px] text-[#888] font-bold">
        <div className="flex-[2]">名称</div>
        <div className="flex-1 text-right">大小</div>
        <div className="flex-[1.5] text-right">修改时间</div>
        <div className="flex-1 text-right">权限</div>
      </div>

      {/* 文件列表 */}
      <div
        className={`flex-1 overflow-y-auto ${isDragging ? "bg-[#1e3a5f]/30" : ""}`}
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
            className="flex px-3 py-1 text-[10px] text-[#888] cursor-pointer hover:bg-[#252540] border-b border-[#222]"
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
            className={`flex px-3 py-1 text-[10px] cursor-pointer border-b border-[#222] ${
              selectedFile?.path === file.path
                ? "bg-[#1e3a5f]"
                : "hover:bg-[#252540]"
            }`}
            onClick={() => onSelectFile(file)}
            onDoubleClick={() => handleDoubleClick(file)}
          >
            <div className={`flex-[2] ${file.is_dir ? "text-[#e5e510]" : "text-[#bbb]"}`}>
              {file.is_dir ? <Folder className="h-3 w-3 inline mr-1" /> : <FileText className="h-3 w-3 inline mr-1" />}
              {file.name}
            </div>
            <div className="flex-1 text-right text-[#999]">{formatSize(file.size)}</div>
            <div className="flex-[1.5] text-right text-[#999]">{file.modified_time}</div>
            <div className="flex-1 text-right text-[#999]">{file.permissions}</div>
          </div>
        ))}
      </div>

      {/* 状态栏 */}
      <div className="bg-[#252540] px-3 py-[3px] text-[9px] text-[#888] border-t border-[#333]">
        {files.length} 个项目{selectedFile ? ` | 已选择: ${selectedFile.name}` : ""}
      </div>

      {/* 新建文件夹对话框 */}
      <Dialog open={showMkdirDialog} onOpenChange={setShowMkdirDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="文件夹名称"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
              autoFocus
            />
            <Button className="w-full" onClick={handleMkdir} disabled={!mkdirName.trim()}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="新名称"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
            <Button className="w-full" onClick={handleRename} disabled={!renameValue.trim()}>
              确认
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

