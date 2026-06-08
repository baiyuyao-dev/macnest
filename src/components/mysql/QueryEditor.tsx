import { useState, useRef, useCallback } from "react";
import { Play, RotateCcw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { toast } from "sonner";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE",
  "DROP", "ALTER", "TABLE", "DATABASE", "INDEX", "VIEW", "TRIGGER",
  "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT",
  "NULL", "IS", "IN", "BETWEEN", "LIKE", "ORDER", "BY", "GROUP", "HAVING",
  "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "AS", "VALUES", "SET",
  "INTO", "IF", "EXISTS", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "DEFAULT", "AUTO_INCREMENT", "UNIQUE", "CHECK", "CONSTRAINT",
];

const KEYWORD_SET = new Set(KEYWORDS.map((k) => k.toLowerCase()));

function highlightSql(sql: string): string {
  let result = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 字符串高亮
  result = result.replace(
    /('[^']*')/g,
    '<span style="color: #a5d6ff;">$1</span>'
  );

  // 数字高亮
  result = result.replace(
    /\b(\d+)\b/g,
    '<span style="color: #79c0ff;">$1</span>'
  );

  // 关键字高亮
  result = result.replace(/\b\w+\b/gi, (match) => {
    if (KEYWORD_SET.has(match.toLowerCase())) {
      return `<span style="color: #ff7b72; font-weight: 600;">${match}</span>`;
    }
    return match;
  });

  // 注释高亮
  result = result.replace(
    /(--.*$)/gm,
    '<span style="color: #8b949e;">$1</span>'
  );
  result = result.replace(
    /(\/\*[\s\S]*?\*\/)/g,
    '<span style="color: #8b949e;">$1</span>'
  );

  return result;
}

export default function QueryEditor() {
  const { executeQuery, queryResult, isExecuting, queryHistory, currentConnectionId } =
    useMysqlStore();
  const [sql, setSql] = useState("SELECT * FROM ");
  const [showHistory, setShowHistory] = useState(false);

  const handleExecute = async () => {
    if (!sql.trim()) {
      toast.error("请输入 SQL");
      return;
    }
    if (!currentConnectionId) {
      toast.error("请先连接 MySQL");
      return;
    }
    try {
      await executeQuery(sql);
    } catch (err: any) {
      toast.error("执行失败: " + err.message);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        handleExecute();
      }
    },
    [sql]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-[var(--glass-border)]">
        <Button
          size="sm"
          onClick={handleExecute}
          disabled={isExecuting}
          className="gap-1"
        >
          <Play className="h-3.5 w-3.5" />
          {isExecuting ? "执行中..." : "执行 (Cmd+Enter)"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSql("")}
          className="gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          清空
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowHistory(!showHistory)}
          className="gap-1 ml-auto"
        >
          <Clock className="h-3.5 w-3.5" />
          历史
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* SQL Editor */}
        <div className="flex-1 relative overflow-hidden">
          {/* Line numbers */}
          <div className="absolute left-0 top-0 bottom-0 w-10 bg-muted/30 border-r border-[var(--glass-border)] text-right pr-2 pt-2 text-xs text-muted-foreground font-mono select-none overflow-hidden">
            {sql.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Highlight overlay */}
          <div
            className="absolute left-10 right-0 top-0 bottom-0 p-2 text-sm font-mono whitespace-pre-wrap overflow-auto pointer-events-none"
            dangerouslySetInnerHTML={{
              __html: highlightSql(sql + " "),
            }}
            style={{ minHeight: "100%" }}
          />

          {/* Textarea */}
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            className="absolute left-10 right-0 top-0 bottom-0 w-[calc(100%-2.5rem)] h-full p-2 text-sm font-mono bg-transparent text-transparent caret-foreground resize-none outline-none"
            spellCheck={false}
            placeholder="输入 SQL 查询..."
          />
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="w-[200px] border-l border-[var(--glass-border)] overflow-auto">
            <div className="p-2 text-xs font-semibold text-muted-foreground">
              查询历史
            </div>
            {queryHistory.map((q, i) => (
              <div
                key={i}
                className="px-2 py-1 text-xs cursor-pointer hover:bg-accent/40 truncate"
                onClick={() => {
                  setSql(q);
                  setShowHistory(false);
                }}
                title={q}
              >
                {q.length > 40 ? q.slice(0, 40) + "..." : q}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      {queryResult && (
        <div className="flex items-center gap-4 px-3 py-1 text-xs text-muted-foreground border-t border-[var(--glass-border)]">
          <span>
            {queryResult.affected_rows !== null
              ? `影响 ${queryResult.affected_rows} 行`
              : `共 ${queryResult.rows.length} 行`}
          </span>
          <span>{queryResult.execution_time_ms}ms</span>
          {queryResult.rows.length > 0 && (
            <span>{queryResult.columns.length} 列</span>
          )}
        </div>
      )}
    </div>
  );
}
