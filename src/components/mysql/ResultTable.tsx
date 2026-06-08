import { useState } from "react";
import { ChevronLeft, ChevronRight, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 500, 1000];

export default function ResultTable() {
  const {
    queryResult,
    selectedTable,
    tableStructure,
    pendingEdits,
    isExecuting,
    pageSize,
    setPageSize,
    setCellEdit,
    removeCellEdit,
    commitEdits,
    cancelEdits,
  } = useMysqlStore();

  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");

  const hasEdits = pendingEdits.size > 0;

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
        执行查询或选择表以查看数据
      </div>
    );
  }

  const totalPages = Math.ceil(queryResult.rows.length / pageSize);
  const start = page * pageSize;
  const end = Math.min(start + pageSize, queryResult.rows.length);
  const visibleRows = queryResult.rows.slice(start, end);

  // 找到主键列索引（如果有）
  const pkColIndex = tableStructure
    ? tableStructure.columns.findIndex(
        (c) =>
          c.key === "PRI" ||
          c.extra?.toLowerCase().includes("auto_increment")
      )
    : -1;

  const formatValue = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const getEditKey = (rowIdx: number, colName: string) =>
    `${rowIdx + start}:${colName}`;

  const getCellDisplayValue = (rowIdx: number, colName: string, raw: unknown) => {
    const key = getEditKey(rowIdx, colName);
    const edit = pendingEdits.get(key);
    if (edit) return edit.newValue;
    return formatValue(raw);
  };

  const handleCellClick = (
    rowIdx: number,
    colIdx: number,
    colName: string,
    value: unknown
  ) => {
    if (!selectedTable) return;
    if (pkColIndex === -1 && colIdx === 0) return; // 无明确主键时，禁止编辑第一列
    if (pkColIndex >= 0 && colIdx === pkColIndex) return; // 禁止编辑主键列

    setEditingCell({ row: rowIdx, col: colIdx });
    setEditValue(formatValue(value));
  };

  const handleCellBlur = () => {
    if (!editingCell || !selectedTable) {
      setEditingCell(null);
      return;
    }

    const colName = queryResult.columns[editingCell.col];
    const rawValue = queryResult.rows[start + editingCell.row][editingCell.col];
    const oldValue = formatValue(rawValue);

    if (editValue !== oldValue) {
      setCellEdit({
        rowIndex: start + editingCell.row,
        colName,
        oldValue: rawValue,
        newValue: editValue,
      });
    } else {
      removeCellEdit(start + editingCell.row, colName);
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
        <div className="flex items-center gap-2">
          {selectedTable && (
            <>
              <span className="text-xs text-muted-foreground">
                {queryResult.rows.length} 行
              </span>
              {hasEdits && (
                <>
                  <span className="text-xs text-amber-500 font-medium">
                    {pendingEdits.size} 处修改
                  </span>
                  <Button
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={commitEdits}
                    disabled={isExecuting}
                  >
                    <Save className="h-3 w-3" />
                    提交
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs gap-1"
                    onClick={cancelEdits}
                  >
                    <RotateCcw className="h-3 w-3" />
                    取消
                  </Button>
                </>
              )}
            </>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2">
          {/* Page size selector */}
          <select
            value={pageSize}
            onChange={(e) => {
              const size = Number(e.target.value);
              setPageSize(size);
              setPage(0);
              if (selectedTable) {
                const { loadTableData } = useMysqlStore.getState();
                loadTableData(selectedTable, size);
              }
            }}
            className="h-6 text-xs rounded border border-input bg-transparent px-2"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} 条/页
              </option>
            ))}
          </select>

          {totalPages > 1 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted/50 z-10">
            <tr>
              {queryResult.columns.map((col, ci) => (
                <th
                  key={col}
                  className={`border border-[var(--glass-border)] px-2 py-1.5 text-left font-semibold whitespace-nowrap ${
                    tableStructure?.columns[ci]?.key === "PRI"
                      ? "text-primary"
                      : ""
                  }`}
                  title={
                    tableStructure?.columns[ci]
                      ? `${tableStructure.columns[ci].data_type}${
                          tableStructure.columns[ci].is_nullable === "NO"
                            ? " NOT NULL"
                            : ""
                        }`
                      : undefined
                  }
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIdx) => (
              <tr
                key={start + rowIdx}
                className="hover:bg-accent/20 even:bg-muted/20"
              >
                {row.map((cell, cellIdx) => {
                  const colName = queryResult.columns[cellIdx];
                  const isEditing =
                    editingCell?.row === rowIdx &&
                    editingCell?.col === cellIdx;
                  const isModified = pendingEdits.has(
                    getEditKey(rowIdx, colName)
                  );
                  const displayValue = getCellDisplayValue(
                    rowIdx,
                    colName,
                    cell
                  );
                  const isPk =
                    pkColIndex >= 0 ? cellIdx === pkColIndex : cellIdx === 0;

                  return (
                    <td
                      key={cellIdx}
                      className={`border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis ${
                        isModified ? "bg-amber-500/10" : ""
                      } ${isPk ? "font-medium text-primary/80" : ""}`}
                      title={displayValue}
                      onClick={() =>
                        handleCellClick(rowIdx, cellIdx, colName, cell)
                      }
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleCellBlur}
                          onKeyDown={handleKeyDown}
                          className="w-full bg-background border border-primary rounded px-1 py-0.5 text-xs font-mono outline-none"
                        />
                      ) : cell === null ? (
                        <span className="text-muted-foreground italic">
                          NULL
                        </span>
                      ) : (
                        displayValue
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
