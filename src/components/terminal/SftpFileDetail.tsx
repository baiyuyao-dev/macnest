import type { SftpFile, SftpTransfer } from "@/types";
import { formatSize } from "@/lib/utils";

interface SftpFileDetailProps {
  file: SftpFile | null;
  transfers: SftpTransfer[];
  onCancelTransfer?: (id: string) => void;
}

export default function SftpFileDetail({ file, transfers, onCancelTransfer }: SftpFileDetailProps) {
  return (
    <div className="flex h-full w-[160px] flex-col border-l border-[var(--glass-border)] bg-muted/20 shrink-0">
      {/* 文件详情 */}
      <div className="bg-muted/40 px-2 py-1.5 text-[10px] font-bold text-muted-foreground border-b border-[var(--glass-border)]">
        文件详情
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-[10px] text-muted-foreground leading-relaxed">
        {file ? (
          <>
            <p><strong className="text-foreground">名称:</strong> {file.name}</p>
            <p><strong className="text-foreground">类型:</strong> {file.is_dir ? "文件夹" : "文件"}</p>
            <p><strong className="text-foreground">大小:</strong> {formatSize(file.size)}</p>
            <p><strong className="text-foreground">权限:</strong> {file.permissions}</p>
            <p><strong className="text-foreground">所有者:</strong> {file.owner}:{file.group}</p>
            <p><strong className="text-foreground">修改:</strong> {file.modified_time}</p>
          </>
        ) : (
          <p className="text-muted-foreground/50">选择文件查看详情</p>
        )}
      </div>

      {/* 传输队列 */}
      <div className="bg-muted/40 px-2 py-1.5 text-[10px] font-bold text-muted-foreground border-t border-b border-[var(--glass-border)]">
        传输队列
      </div>
      <div className="flex-1 overflow-y-auto">
        {transfers.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground/50">暂无传输</p>
        ) : (
          transfers.map((t) => {
            const percent = t.total_bytes > 0
              ? Math.min(100, Math.round((t.transferred_bytes / t.total_bytes) * 100))
              : 0;
            const isDone = t.status === "completed";
            const isFailed = t.status === "failed" || t.status === "cancelled";
            const isActive = t.status === "in_progress";

            return (
              <div key={t.id} className="px-2 py-1.5 text-[9px] border-b border-[var(--glass-border)]">
                <div className={isDone ? "text-emerald-500" : isFailed ? "text-red-500" : "text-amber-500"}>
                  {t.direction === "upload" ? "⬆" : "⬇"} {t.file_name}
                </div>
                <div className="h-[3px] bg-muted rounded mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded transition-all duration-200 ${
                      isDone ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-amber-500"
                    }`}
                    style={{ width: isActive ? `${percent}%` : "100%" }}
                  />
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className={isDone ? "text-emerald-500" : isFailed ? "text-red-500" : "text-muted-foreground"}>
                    {isDone
                      ? `${formatSize(t.total_bytes)} | 已完成`
                      : isFailed
                      ? t.status === "cancelled" ? "已取消" : "失败"
                      : t.total_bytes > 0
                      ? `${formatSize(t.transferred_bytes)} / ${formatSize(t.total_bytes)} (${percent}%)`
                      : "传输中..."}
                  </span>
                  {isActive && onCancelTransfer && (
                    <button
                      onClick={() => onCancelTransfer(t.id)}
                      className="text-red-500 hover:text-red-400 ml-1 cursor-pointer"
                      title="取消"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

