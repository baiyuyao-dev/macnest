import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";

const PAGE_SIZE = 100;

export default function ResultTable() {
  const { queryResult } = useMysqlStore();
  const [page, setPage] = useState(0);

  if (!queryResult || queryResult.columns.length === 0) {
    const affected = queryResult?.affected_rows;
    if (affected !== null && affected !== undefined) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          执行成功，影响 {affected} 行
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        执行查询以查看结果
      </div>
    );
  }

  const totalPages = Math.ceil(queryResult.rows.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, queryResult.rows.length);
  const visibleRows = queryResult.rows.slice(start, end);

  const formatValue = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted/50 z-10">
            <tr>
              {queryResult.columns.map((col) => (
                <th
                  key={col}
                  className="border border-[var(--glass-border)] px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="hover:bg-accent/20 even:bg-muted/20"
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className="border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                    title={formatValue(cell)}
                  >
                    {cell === null ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : (
                      formatValue(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-2 border-t border-[var(--glass-border)]">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {start + 1}-{end} / {queryResult.rows.length} 行 (第 {page + 1}/{totalPages} 页)
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
