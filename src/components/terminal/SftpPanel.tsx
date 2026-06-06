import { useState, useEffect, useCallback, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import SftpTree from "./SftpTree";
import SftpFileList from "./SftpFileList";
import SftpFileDetail, { type SftpFileDetailHandle } from "./SftpFileDetail";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sftpListDir, sftpDelete, sftpMkdir, sftpRename, sftpUpload, sftpDownload, sftpGetProgress, sftpCancelTransfer, sftpReadFile, sftpWriteFile, getErrorMessage } from "@/lib/api";
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

  // ── 上传覆盖确认 ────────────────────────────────────────
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    localPath: string;
    remotePath: string;
    fileName: string;
    existingFile: SftpFile;
  } | null>(null);

  // ── 文件编辑器 ──────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFile, setEditorFile] = useState<SftpFile | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  // ── Resizable widths ──────────────────────────────────
  const DEFAULT_TREE_WIDTH = 160;
  const DEFAULT_DETAIL_WIDTH = 180;
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const treeRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailCompRef = useRef<SftpFileDetailHandle>(null);
  const isDraggingTree = useRef(false);
  const isDraggingDetail = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_TREE_WIDTH);
  const [dragCursor, setDragCursor] = useState<"col-resize" | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDraggingTree.current && treeRef.current) {
        const delta = e.clientX - startXRef.current;
        const w = Math.max(120, Math.min(300, startWidthRef.current + delta));
        treeRef.current.style.width = w + "px";
      }
      if (isDraggingDetail.current && detailRef.current) {
        const delta = startXRef.current - e.clientX;
        const w = Math.max(140, Math.min(320, startWidthRef.current + delta));
        detailRef.current.style.width = w + "px";
      }
    };
    const handleUp = () => {
      if (isDraggingTree.current) {
        isDraggingTree.current = false;
        const w = treeRef.current?.offsetWidth ?? DEFAULT_TREE_WIDTH;
        setTreeWidth(w);
      }
      if (isDraggingDetail.current) {
        isDraggingDetail.current = false;
        const w = detailRef.current?.offsetWidth ?? DEFAULT_DETAIL_WIDTH;
        setDetailWidth(w);
      }
      setDragCursor(null);
    };
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

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

  // 终端路径变化时自动同步（只在 syncPath / autoSync / loadFiles 变化时触发，避免 currentPath 变化导致反向同步）
  useEffect(() => {
    if (autoSync && syncPath && syncPath !== currentPath) {
      console.log("[SFTP AutoSync] syncPath changed:", syncPath, "currentPath:", currentPath);
      loadFiles(syncPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPath, autoSync, loadFiles]);

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
      alert("删除失败: " + getErrorMessage(err));
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

  const performUpload = async (localPath: string, remotePath: string, fileName: string) => {
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

      const existing = files.find(f => f.name === fileName);
      if (existing) {
        setPendingUpload({ localPath, remotePath, fileName, existingFile: existing });
        setUploadConfirmOpen(true);
        return;
      }

      await performUpload(localPath, remotePath, fileName);
    } catch (err) {
      console.error("Failed to upload:", err);
      alert("上传失败: " + getErrorMessage(err));
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

      const existing = files.find(f => f.name === fileName);
      if (existing) {
        setPendingUpload({ localPath, remotePath, fileName, existingFile: existing });
        setUploadConfirmOpen(true);
        return;
      }

      await performUpload(localPath, remotePath, fileName);
    } catch (err) {
      console.error("Failed to upload:", err);
      alert("上传失败: " + getErrorMessage(err));
    }
  };

  const confirmUpload = async () => {
    if (!pendingUpload) return;
    setUploadConfirmOpen(false);
    try {
      await performUpload(pendingUpload.localPath, pendingUpload.remotePath, pendingUpload.fileName);
    } catch (err) {
      console.error("Failed to upload:", err);
      alert("上传失败: " + getErrorMessage(err));
    } finally {
      setPendingUpload(null);
    }
  };

  const handleEdit = async (file: SftpFile) => {
    if (file.is_dir) return;
    setEditorFile(file);
    setEditorOpen(true);
    setEditorLoading(true);
    setEditorContent("");
    try {
      const content = await sftpReadFile(sessionId, file.path);
      setEditorContent(content);
    } catch (err) {
      console.error("Failed to read file:", err);
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
      await sftpWriteFile(sessionId, editorFile.path, editorContent);
      setEditorOpen(false);
      loadFiles(currentPath);
      toast.success("保存成功");
    } catch (err) {
      console.error("Failed to save file:", err);
      alert("保存失败: " + getErrorMessage(err));
    } finally {
      setEditorSaving(false);
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
      {/* 拖动时全屏透明覆盖层 */}
      {dragCursor && (
        <div className="fixed inset-0 z-[9999]" style={{ cursor: dragCursor }} />
      )}

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

        {/* Tree */}
        <div ref={treeRef} className="shrink-0 h-full" style={{ width: treeWidth }}>
          <SftpTree
            sessionId={sessionId}
            currentPath={currentPath}
            onPathChange={loadFiles}
          />
        </div>

        {/* Splitter: Tree ↔ FileList */}
        <div
          className="w-2 shrink-0 z-20 group relative cursor-col-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingTree.current = true;
            startXRef.current = e.clientX;
            startWidthRef.current = treeRef.current?.offsetWidth ?? DEFAULT_TREE_WIDTH;
            setDragCursor("col-resize");
          }}
        >
          <div className="absolute inset-0 -left-1 -right-1" />
          <div className="w-[3px] h-full mx-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* FileList */}
        <div className="flex-1 min-w-0 flex flex-col">
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
            onEdit={handleEdit}
            onSyncToTerminal={onSyncToTerminal ? () => onSyncToTerminal(currentPath) : undefined}
          />
        </div>

        {/* Splitter: FileList ↔ FileDetail */}
        <div
          className="w-2 shrink-0 z-20 group relative cursor-col-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingDetail.current = true;
            startXRef.current = e.clientX;
            startWidthRef.current = detailRef.current?.offsetWidth ?? DEFAULT_DETAIL_WIDTH;
            setDragCursor("col-resize");
          }}
        >
          <div className="absolute inset-0 -left-1 -right-1" />
          <div className="w-[3px] h-full mx-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* FileDetail */}
        <div ref={detailRef} className="shrink-0 h-full" style={{ width: detailWidth }}>
          <SftpFileDetail
            ref={detailCompRef}
            file={selectedFile}
            transfers={transfers}
            onCancelTransfer={handleCancelTransfer}
          />
        </div>

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

        {/* 上传覆盖确认对话框 */}
        <Dialog open={uploadConfirmOpen} onOpenChange={setUploadConfirmOpen}>
          <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">确认覆盖</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              远程已存在同名
              {pendingUpload?.existingFile?.is_dir ? "文件夹" : "文件"}
              <strong className="text-foreground"> {pendingUpload?.fileName}</strong>
              ，是否覆盖？
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setUploadConfirmOpen(false);
                  setPendingUpload(null);
                }}
              >
                取消
              </Button>
              <Button
                variant="default"
                size="sm"
                className="rounded-lg"
                onClick={confirmUpload}
              >
                覆盖上传
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 文件编辑器 */}
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
      </div>
    </div>
  );
}
