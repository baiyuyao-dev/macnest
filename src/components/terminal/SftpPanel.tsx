import { useState, useEffect, useCallback } from "react";
import SftpTree from "./SftpTree";
import SftpFileList from "./SftpFileList";
import SftpFileDetail from "./SftpFileDetail";
import { sftpListDir, sftpDelete, sftpMkdir, sftpRename } from "@/lib/api";
import type { SftpFile, SftpTransfer } from "@/types";

interface SftpPanelProps {
  sessionId: string;
}

export default function SftpPanel({ sessionId }: SftpPanelProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SftpFile | null>(null);
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [loading, setLoading] = useState(false);

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

  const handleDelete = async (file: SftpFile) => {
    if (!confirm(`确定要删除 "${file.name}" 吗？`)) return;
    try {
      await sftpDelete(sessionId, file.path, file.is_dir);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("删除失败: " + String(err));
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

  return (
    <div className="flex h-full bg-[#1e1e2e] relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
          <div className="text-[#0dbc79] text-xs">加载中...</div>
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
      />
      <SftpFileDetail
        file={selectedFile}
        transfers={transfers}
      />
    </div>
  );
}
