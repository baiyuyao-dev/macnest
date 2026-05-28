import { useState, useEffect, useCallback, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import SftpTree from "./SftpTree";
import SftpFileList from "./SftpFileList";
import SftpFileDetail from "./SftpFileDetail";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sftpListDir, sftpDelete, sftpMkdir, sftpRename, sftpUpload, sftpDownload, sftpGetProgress, sftpCancelTransfer } from "@/lib/api";
import type { SftpFile, SftpTransfer } from "@/types";

interface SftpPanelProps {
  sessionId: string;
  onSyncToTerminal?: (path: string) => void;
  syncPath?: string | null;
}

export default function SftpPanel({ sessionId, onSyncToTerminal, syncPath }: SftpPanelProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SftpFile | null>(null);
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<SftpFile | null>(null);
  const [autoSync, setAutoSync] = useState(true);

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const list = await sftpListDir(sessionId, path);
      setFiles(list);
      setCurrentPath(path);
      setSelectedFile(null);
    } catch (err) {
      console.error("Failed to list directory:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadFiles("/");
  }, [sessionId, loadFiles]);

  // 终端路径变化时自动同步
  useEffect(() => {
    if (autoSync && syncPath && syncPath !== currentPath) {
      loadFiles(syncPath);
    }
  }, [syncPath, currentPath, autoSync, loadFiles]);

  // 进度轮询（使用 ref 避免依赖 transfers 导致多次创建 interval）
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;

  useEffect(() => {
    const interval = setInterval(async () => {
      const inProgress = transfersRef.current.filter(t => t.status === "in_progress");
      for (const t of inProgress) {
        try {
          const progress = await sftpGetProgress(t.id);
          if (progress) {
            const newTransferred = Number(progress.transferred_bytes);
            const newStatus = progress.status === "cancelled" ? "cancelled" :
                              progress.status === "failed" ? "failed" :
                              progress.status === "completed" ? "completed" : "in_progress";
            setTransfers(prev => {
              const existing = prev.find(pt => pt.id === t.id);
              if (existing && existing.transferred_bytes === newTransferred && existing.status === newStatus) {
                return prev;
              }
              return prev.map(pt => {
                if (pt.id !== t.id) return pt;
                return {
                  ...pt,
                  total_bytes: Number(progress.total_bytes),
                  transferred_bytes: newTransferred,
                  status: newStatus,
                };
              });
            });
          }
        } catch (e) {
          // ignore polling errors
        }
      }
    }, 200);
    return () => clearInterval(interval);
  }, [sessionId]);

  // 完成后自动清理
  useEffect(() => {
    const completed = transfers.filter(t => t.status === "completed" || t.status === "failed" || t.status === "cancelled");
    if (completed.length === 0) return;
    const timers = completed.map(t =>
      setTimeout(() => {
        setTransfers(prev => prev.filter(pt => pt.id !== t.id));
      }, 3000)
    );
    return () => timers.forEach(clearTimeout);
  }, [transfers]);

  // Tauri 原生拖拽上传
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      try {
        const win = getCurrentWebviewWindow();
        unlisten = await win.onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            for (const path of event.payload.paths) {
              handleDropUpload(path);
            }
          }
        });
      } catch (e) {
        console.error("Failed to setup drag-drop listener:", e);
      }
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentPath]);

  const handleDelete = (file: SftpFile) => {
    setPendingDeleteFile(file);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteFile) return;
    setDeleteDialogOpen(false);
    try {
      await sftpDelete(sessionId, pendingDeleteFile.path, pendingDeleteFile.is_dir);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("删除失败: " + String(err));
    } finally {
      setPendingDeleteFile(null);
    }
  };

  const handleMkdir = async (name: string) => {
    const newPath = currentPath === "/" ? "/" + name : currentPath + "/" + name;
    try {
      await sftpMkdir(sessionId, newPath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to create directory:", err);
      alert("创建失败: " + String(err));
    }
  };

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      await sftpRename(sessionId, oldPath, newPath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      alert("重命名失败: " + String(err));
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });
      if (!selected) return;
      const localPath = selected as string;
      const fileName = localPath.split(/[/\\]/).pop() || "uploaded_file";
      const remotePath = currentPath === "/" ? "/" + fileName : currentPath + "/" + fileName;

      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, {
        id: transferId,
        file_name: fileName,
        direction: "upload",
        total_bytes: 0,
        transferred_bytes: 0,
        status: "in_progress",
      }]);

      await sftpUpload(sessionId, transferId, localPath, remotePath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to upload:", err);
      alert("上传失败: " + String(err));
    }
  };

  const handleDownload = async () => {
    if (!selectedFile || selectedFile.is_dir) {
      alert("请先选择一个文件");
      return;
    }
    try {
      const savePath = await save({
        defaultPath: selectedFile.name,
      });
      if (!savePath) return;

      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, {
        id: transferId,
        file_name: selectedFile.name,
        direction: "download",
        total_bytes: selectedFile.size,
        transferred_bytes: 0,
        status: "in_progress",
      }]);

      await sftpDownload(sessionId, transferId, selectedFile.path, savePath);
    } catch (err) {
      console.error("Failed to download:", err);
      alert("下载失败: " + String(err));
    }
  };

  const handleDropUpload = async (localPath: string) => {
    try {
      const fileName = localPath.split(/[/\\]/).pop() || "uploaded_file";
      const remotePath = currentPath === "/" ? "/" + fileName : currentPath + "/" + fileName;

      const transferId = crypto.randomUUID();
      setTransfers(prev => [...prev, {
        id: transferId,
        file_name: fileName,
        direction: "upload",
        total_bytes: 0,
        transferred_bytes: 0,
        status: "in_progress",
      }]);

      await sftpUpload(sessionId, transferId, localPath, remotePath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to upload:", err);
      alert("上传失败: " + String(err));
    }
  };

  const handleCancelTransfer = async (transferId: string) => {
    try {
      await sftpCancelTransfer(transferId);
      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: "cancelled" } : t
      ));
    } catch (err) {
      console.error("Failed to cancel transfer:", err);
    }
  };

  return (
    <div className="flex h-full bg-background relative flex-col">
      {/* 终端路径同步状态条 */}
      {syncPath && (
        <div className="flex items-center justify-between px-3 py-1 bg-muted/40 border-b border-[var(--glass-border)] text-[11px] shrink-0">
          <span className="text-muted-foreground truncate mr-2" title={syncPath}>
            终端: {syncPath}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="h-3 w-3 rounded accent-primary"
            />
            <span className={autoSync ? "text-primary" : "text-muted-foreground"}>自动同步</span>
          </label>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
            <div className="text-emerald-500 text-xs">加载中...</div>
          </div>
        )}
        <SftpTree
        currentPath={currentPath}
        onPathChange={loadFiles}
      />
      <SftpFileList
        files={files}
        currentPath={currentPath}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onPathChange={loadFiles}
        onRefresh={() => loadFiles(currentPath)}
        onDelete={handleDelete}
        onMkdir={handleMkdir}
        onRename={handleRename}
        onUpload={handleUpload}
        onDownload={handleDownload}
        onDropUpload={handleDropUpload}
        onSyncToTerminal={onSyncToTerminal ? () => onSyncToTerminal(currentPath) : undefined}
      />
      <SftpFileDetail
        file={selectedFile}
        transfers={transfers}
        onCancelTransfer={handleCancelTransfer}
      />

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            确定要删除 <strong className="text-foreground">{pendingDeleteFile?.name}</strong> 吗？
            {pendingDeleteFile?.is_dir ? " 文件夹及其内容将无法恢复。" : " 此操作无法撤销。"}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setDeleteDialogOpen(false);
                setPendingDeleteFile(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-lg"
              onClick={confirmDelete}
            >
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
