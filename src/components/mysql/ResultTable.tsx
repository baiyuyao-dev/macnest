import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Save, RotateCcw, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 500, 1000];

type EditorType = "text" | "number" | "date" | "datetime" | "time" | "checkbox";

function getEditorType(dataType: string): EditorType {
  const t = dataType.toLowerCase();
  if (t.includes("datetime")) return "datetime";
  if (t.includes("timestamp")) return "datetime";
  if (t.includes("date")) return "date";
  if (t.includes("time")) return "time";
  if (t.includes("year")) return "number";
  if (t.includes("int") || t.includes("float") || t.includes("double") || t.includes("decimal")) return "number";
  if (t.includes("bool") || t.includes("tinyint(1)")) return "checkbox";
  return "text";
}

function isDateTimeType(editorType: EditorType): boolean {
  return editorType === "datetime" || editorType === "date" || editorType === "time";
}

/** MySQL datetime → HTML datetime-local (YYYY-MM-DDTHH:MM) */
function toDatetimeLocal(v: string): string {
  if (!v || v === "NULL") return "";
  const clean = v.replace(/\.\d+$/, "").trim();
  if (clean.length < 10) return "";
  return clean.replace(" ", "T").slice(0, 16);
}

/** HTML datetime-local → MySQL datetime */
function fromDatetimeLocal(v: string): string {
  if (!v) return "NULL";
  return v.replace("T", " ") + ":00";
}

/** MySQL date → HTML date */
function toHtmlDate(v: string): string {
  if (!v || v === "NULL") return "";
  return v.trim().slice(0, 10);
}

/** MySQL time → HTML time */
function toHtmlTime(v: string): string {
  if (!v || v === "NULL") return "";
  return v.trim().slice(0, 8);
}

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
  const [previewCell, setPreviewCell] = useState<{
    row: number;
    col: number;
    editorType: EditorType;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const hasEdits = pendingEdits.size > 0;

  // 点击表格外部取消 preview/edit
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!tableRef.current) return;
      if (!tableRef.current.contains(e.target as Node)) {
        setPreviewCell(null);
        if (editingCell) {
          handleCellBlur();
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingCell, previewCell, editValue]);

  // Escape 取消
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewCell(null);
        setEditingCell(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.type === "text" || inputRef.current.type === "number") {
        inputRef.current.select();
      }
      // 对日期时间类型，尝试主动弹出选择器
      const et = previewCell?.editorType;
      if (et && isDateTimeType(et)) {
        setTimeout(() => {
          try {
            (inputRef.current as any)?.showPicker?.();
          } catch {
            // 浏览器不支持 showPicker，用户需手动点击日历图标
          }
        }, 50);
      }
    }
  }, [editingCell]);

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
  const visibleRows = queryResult.rows.slice(start, start + pageSize);

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

  const computeInitialEditValue = (
    rowIdx: number,
    colIdx: number,
    colName: string,
    value: unknown,
    editorType: EditorType
  ): string => {
    const key = getEditKey(rowIdx, colName);
    const edit = pendingEdits.get(key);
    if (edit) return edit.newValue;

    const rawStr = formatValue(value);
    if (editorType === "datetime") return toDatetimeLocal(rawStr);
    if (editorType === "date") return toHtmlDate(rawStr);
    if (editorType === "time") return toHtmlTime(rawStr);
    return rawStr;
  };

  const handleCellDoubleClick = (
    rowIdx: number,
    colIdx: number,
    colName: string,
    value: unknown
  ) => {
    if (!selectedTable) return;
    if (pkColIndex === -1 && colIdx === 0) return;
    if (pkColIndex >= 0 && colIdx === pkColIndex) return;

    const dataType = tableStructure?.columns[colIdx]?.data_type || "";
    const editorType = getEditorType(dataType);
    const initialValue = computeInitialEditValue(rowIdx, colIdx, colName, value, editorType);
    setEditValue(initialValue);

    if (isDateTimeType(editorType)) {
      // 日期时间类型：先进入 preview 状态，用户需主动点击才打开选择器
      setPreviewCell({ row: rowIdx, col: colIdx, editorType });
      setEditingCell(null);
    } else {
      // 其他类型：直接进入编辑
      setPreviewCell(null);
      setEditingCell({ row: rowIdx, col: colIdx });
    }
  };

  const handleOpenDatePicker = useCallback(() => {
    if (!previewCell) return;
    setEditingCell({ row: previewCell.row, col: previewCell.col });
    setPreviewCell(null);
  }, [previewCell]);

  const handleCellBlur = () => {
    if (!editingCell || !selectedTable) {
      setEditingCell(null);
      return;
    }

    const colName = queryResult.columns[editingCell.col];
    const rawValue = queryResult.rows[start + editingCell.row][editingCell.col];
    const oldValue = formatValue(rawValue);

    const dataType = tableStructure?.columns[editingCell.col]?.data_type || "";
    const editorType = getEditorType(dataType);

    let newValue = editValue;
    if (editorType === "datetime") {
      newValue = fromDatetimeLocal(editValue);
    } else if (editorType === "checkbox") {
      newValue = editValue === "true" || editValue === "1" ? "1" : "0";
    }

    if (newValue !== oldValue) {
      setCellEdit({
        rowIndex: start + editingCell.row,
        colName,
        oldValue: rawValue,
        newValue,
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
      setPreviewCell(null);
    }
  };

  const renderEditor = (editorType: EditorType) => {
    const baseClass =
      "absolute inset-0 w-full h-full bg-background/95 border border-primary rounded-sm px-2 py-1 text-xs font-mono outline-none box-border";

    switch (editorType) {
      case "datetime":
        return (
          <input
            ref={inputRef}
            type="datetime-local"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={handleKeyDown}
            className={baseClass}
            step={1}
          />
        );
      case "date":
        return (
          <input
            ref={inputRef}
            type="date"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={handleKeyDown}
            className={baseClass}
          />
        );
      case "time":
        return (
          <input
            ref={inputRef}
            type="time"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={handleKeyDown}
            className={baseClass}
            step={1}
          />
        );
      case "number":
        return (
          <input
            ref={inputRef}
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={handleKeyDown}
            className={baseClass}
          />
        );
      case "checkbox":
        return (
          <input
            ref={inputRef}
            type="checkbox"
            checked={editValue === "1" || editValue === "true"}
            onChange={(e) => {
              setEditValue(e.target.checked ? "1" : "0");
              setTimeout(() => {
                if (inputRef.current) inputRef.current.blur();
              }, 0);
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4"
          />
        );
      default:
        return (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={handleKeyDown}
            className={baseClass}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full" ref={tableRef}>
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
                  const isPreview =
                    previewCell?.row === rowIdx &&
                    previewCell?.col === cellIdx;
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

                  const dataType =
                    tableStructure?.columns[cellIdx]?.data_type || "";
                  const editorType = getEditorType(dataType);

                  return (
                    <td
                      key={cellIdx}
                      className={`border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis relative ${
                        isModified ? "bg-amber-500/10" : ""
                      } ${isPk ? "font-medium text-primary/80" : ""} ${
                        !isPk && !isEditing ? "cursor-pointer" : ""
                      }`}
                      title={displayValue}
                      onDoubleClick={() =>
                        handleCellDoubleClick(rowIdx, cellIdx, colName, cell)
                      }
                    >
                      {isEditing ? (
                        renderEditor(editorType)
                      ) : isPreview ? (
                        <div
                          className="flex items-center justify-between gap-1 w-full h-full cursor-pointer rounded px-1 py-0.5 bg-primary/10 hover:bg-primary/20 transition-colors"
                          onClick={handleOpenDatePicker}
                        >
                          <span className="truncate">{displayValue}</span>
                          <Calendar className="h-3 w-3 shrink-0 text-primary" />
                        </div>
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
