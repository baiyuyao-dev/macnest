import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import type { SftpFile, SftpTransfer } from "@/types";
import { formatSize } from "@/lib/utils";

export interface SftpFileDetailHandle {
  getDetailPct: () => number;
}

interface SftpFileDetailProps {
  file: SftpFile | null;
  transfers: SftpTransfer[];
  onCancelTransfer?: (id: string) => void;
}

const SftpFileDetail = forwardRef<SftpFileDetailHandle, SftpFileDetailProps>(
  function SftpFileDetail({ file, transfers, onCancelTransfer }, ref) {
    const [detailPct, setDetailPct] = useState(50);
    const detailRef = useRef<HTMLDivElement>(null);
    const queueRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startPct = useRef(50);

    useImperativeHandle(ref, () => ({
      getDetailPct: () => detailPct,
    }));

    useEffect(() => {
      const handleMove = (e: MouseEvent) => {
        if (!isDragging.current || !detailRef.current || !queueRef.current) return;
        e.preventDefault();
        const parent = detailRef.current.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const delta = e.clientY - startY.current;
        const deltaPct = (delta / rect.height) * 100;
        const pct = Math.max(20, Math.min(80, startPct.current + deltaPct));
        detailRef.current.style.flex = String(pct);
        queueRef.current.style.flex = String(100 - pct);
      };
      const handleUp = () => {
        if (!isDragging.current) return;
        isDragging.current = false;
        const pct = Number(detailRef.current?.style.flex ?? 50);
        setDetailPct(pct);
      };
      window.addEventListener("mousemove", handleMove, { passive: false });
      window.addEventListener("mouseup", handleUp);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
    }, []);

    return (
      <div className="flex h-full flex-col border-l border-[var(--glass-border)] bg-muted/20 overflow-hidden">
        {/* 文件详情 */}
        <div ref={detailRef} className="flex flex-col overflow-hidden" style={{ flex: detailPct }}>
          <div className="bg-muted/40 px-2 py-1.5 text-xs font-bold text-muted-foreground border-b border-[var(--glass-border)] shrink-0">
            文件详情
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-xs text-muted-foreground leading-relaxed">
            {file ? (
              <>
                <p><strong className="text-foreground">名称:</strong> {file.name}</p>
                <p><strong className="text-foreground">类型:</strong> {file.is_dir ? "文件夹" : "文件"}</p>
                <p><strong className="text-foreground">大小:</strong> {formatSize(file.size)}</p>
                <p><strong className="text-foreground">权限:</strong> <span className="font-mono">{file.permissions}</span></p>
                <p><strong className="text-foreground">所有者:</strong> {file.owner}:{file.group}</p>
                <p><strong className="text-foreground">修改:</strong> {file.modified_time}</p>
              </>
            ) : (
              <p className="text-muted-foreground/50">选择文件查看详情</p>
            )}
          </div>
        </div>

        {/* Vertical splitter */}
        <div
          className="h-2 shrink-0 z-10 group relative cursor-row-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            isDragging.current = true;
            startY.current = e.clientY;
            const parent = detailRef.current?.parentElement;
            if (parent && detailRef.current) {
              const rect = parent.getBoundingClientRect();
              const top = detailRef.current.getBoundingClientRect().top;
              startPct.current = ((e.clientY - top) / rect.height) * 100;
            }
          }}
        >
          <div className="absolute inset-0 -top-1 -bottom-1" />
          <div className="h-[3px] w-full my-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
        </div>

        {/* 传输队列 */}
        <div ref={queueRef} className="flex flex-col overflow-hidden" style={{ flex: 100 - detailPct }}>
          <div className="bg-muted/40 px-2 py-1.5 text-xs font-bold text-muted-foreground border-b border-[var(--glass-border)] shrink-0">
            传输队列
          </div>
          <div className="flex-1 overflow-y-auto">
            {transfers.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground/50">暂无传输</p>
            ) : (
              transfers.map((t) => {
                const percent = t.total_bytes > 0
                  ? Math.min(100, Math.round((t.transferred_bytes / t.total_bytes) * 100))
                  : 0;
                const isDone = t.status === "completed";
                const isFailed = t.status === "failed" || t.status === "cancelled";
                const isActive = t.status === "in_progress";

                return (
                  <div key={t.id} className="px-2 py-1.5 text-[11px] border-b border-[var(--glass-border)]">
                    <div className={isDone ? "text-primary" : isFailed ? "text-red-500" : "text-amber-500"}>
                      {t.direction === "upload" ? "⬆" : "⬇"} {t.file_name}
                    </div>
                    <div className="h-[3px] bg-muted rounded mt-1 overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-200 ${
                          isDone ? "bg-primary" : isFailed ? "bg-red-500" : "bg-amber-500"
                        }`}
                        style={{ width: isActive ? `${percent}%` : "100%" }}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center justify-between">
                      <span className={isDone ? "text-primary" : isFailed ? "text-red-500" : "text-muted-foreground"}>
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
      </div>
    );
  }
);

export default SftpFileDetail;
