import type { SftpFile, SftpTransfer } from "@/types";

interface SftpFileDetailProps {
  file: SftpFile | null;
  transfers: SftpTransfer[];
}

export default function SftpFileDetail({ file, transfers }: SftpFileDetailProps) {
  return (
    <div className="flex h-full w-[160px] flex-col border-l border-[#333] bg-[#1a1a2e] shrink-0">
      {/* 文件详情 */}
      <div className="bg-[#252540] px-2 py-1.5 text-[10px] font-bold text-[#aaa] border-b border-[#333]">
        文件详情
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-[10px] text-[#999] leading-relaxed">
        {file ? (
          <>
            <p><strong className="text-[#ccc]">名称:</strong> {file.name}</p>
            <p><strong className="text-[#ccc]">类型:</strong> {file.is_dir ? "文件夹" : "文件"}</p>
            <p><strong className="text-[#ccc]">大小:</strong> {formatSize(file.size)}</p>
            <p><strong className="text-[#ccc]">权限:</strong> {file.permissions}</p>
            <p><strong className="text-[#ccc]">所有者:</strong> {file.owner}:{file.group}</p>
            <p><strong className="text-[#ccc]">修改:</strong> {file.modified_time}</p>
          </>
        ) : (
          <p className="text-[#666]">选择文件查看详情</p>
        )}
      </div>

      {/* 传输队列 */}
      <div className="bg-[#252540] px-2 py-1.5 text-[10px] font-bold text-[#aaa] border-t border-[#333] border-b border-[#333]">
        传输队列
      </div>
      <div className="flex-1 overflow-y-auto">
        {transfers.length === 0 ? (
          <p className="p-2 text-[10px] text-[#666]">暂无传输</p>
        ) : (
          transfers.map((t) => (
            <div key={t.id} className="px-2 py-1.5 text-[9px] border-b border-[#222]">
              <div className={t.status === "completed" ? "text-[#0dbc79]" : "text-[#e5e510]"}>
                {t.direction === "upload" ? "⬆" : "⬇"} {t.file_name}
              </div>
              {t.status === "in_progress" ? (
                <>
                  <div className="h-[3px] bg-[#333] rounded mt-1 overflow-hidden">
                    <div className="h-full bg-[#e5e510] rounded animate-progress-indeterminate" />
                  </div>
                  <div className="mt-0.5 text-[#888]">传输中...</div>
                </>
              ) : (
                <>
                  <div className="h-[3px] bg-[#333] rounded mt-1">
                    <div className="h-full bg-[#0dbc79] rounded" style={{ width: "100%" }} />
                  </div>
                  <div className="mt-0.5 text-[#0dbc79]">
                    {t.total_bytes > 0 ? `${formatSize(t.total_bytes)} | ` : ""}已完成
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
