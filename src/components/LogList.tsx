import { useRef, useEffect } from "react";
import { formatIsoTime } from "@/lib/utils";

export interface LogEntry {
  content: string;
  level: string;
  created_at: string;
}

interface LogListProps {
  logs: LogEntry[];
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  showTimestamps?: boolean;
  className?: string;
  listClassName?: string;
  logClassName?: string;
  timestampClassName?: string;
}

function levelColor(level: string): string {
  switch (level) {
    case "error": return "text-red-400";
    case "warn": return "text-yellow-400";
    case "stdout": return "text-blue-300";
    default: return "text-green-400";
  }
}

export default function LogList({
  logs,
  emptyMessage = "没有日志",
  emptyIcon,
  showTimestamps = true,
  className = "",
  listClassName = "",
  logClassName = "",
  timestampClassName = "",
}: LogListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full text-muted-foreground gap-3 ${className}`}>
        {emptyIcon}
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`${className} ${listClassName}`}>
      {logs.map((log, i) => (
        <div key={i} className={`flex gap-2 ${logClassName}`}>
          {showTimestamps && (
            <span className={`shrink-0 select-none ${timestampClassName}`}>
              {formatIsoTime(log.created_at)}
            </span>
          )}
          <span className={levelColor(log.level)}>{log.content}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
