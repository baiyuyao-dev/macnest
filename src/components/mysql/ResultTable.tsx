import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Save, RotateCcw, CalendarDays, X, Trash2 } from "lucide-react";
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
    openTabs,
    activeTabIndex,
    isExecuting,
    setTabPageSize,
    setTabCellEdit,
    removeTabCellEdit,
    commitTabEdits,
    cancelTabEdits,
    reloadTabData,
  } = useMysqlStore();

  const tab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;
  const queryResult = tab?.queryResult ?? null;
  const selectedTable = tab?.table ?? null;
  const tableStructure = tab?.tableStructure ?? null;
  const pendingEdits = tab?.pendingEdits ?? new Map();
  const pageSize = tab?.pageSize ?? 100;
  const totalRows = tab?.totalRows ?? 0;
  const page = tab?.page ?? 0;
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [popupCell, setPopupCell] = useState<{
    row: number;
    col: number;
    editorType: EditorType;
    colName: string;
    value: unknown;
    rect: DOMRect;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editValueRef = useRef(editValue);
  editValueRef.current = editValue;
  const inputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const popupInputRef = useRef<HTMLInputElement>(null);

  const hasEdits = pendingEdits.size > 0;

  // 点击外部：popup 自动保存，edit 执行 blur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupCell) {
        const popupEl = document.querySelector("[data-popup='datetime-picker']");
        if (popupEl && popupEl.contains(e.target as Node)) return;
        savePopupValue();
        return;
      }
      if (!tableRef.current) return;
      if (!tableRef.current.contains(e.target as Node)) {
        if (editingCell) {
          handleCellBlur();
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingCell, popupCell]);

  // Escape 取消（不保存）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (popupCell) setPopupCell(null);
        else setEditingCell(null);
      }
      if (e.key === "Enter" && popupCell) {
        e.preventDefault();
        savePopupValue();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [popupCell]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.type === "text" || inputRef.current.type === "number") {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  useEffect(() => {
    if (popupCell && popupInputRef.current) {
      popupInputRef.current.focus();
      setTimeout(() => {
        try {
          (popupInputRef.current as any)?.showPicker?.();
        } catch {
          // 浏览器不支持 showPicker
        }
      }, 50);
    }
  }, [popupCell]);

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

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const start = 0;
  const visibleRows = queryResult.rows;

  const pkColIndex = tableStructure
    ? tableStructure.columns.findIndex(
        (c: { key: string; extra?: string }) =>
          c.key === "PRI" ||
          (c.extra ? c.extra.toLowerCase().includes("auto_increment") : false)
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
    value: unknown,
    cellEl?: HTMLElement
  ) => {
    if (!selectedTable) return;
    if (pkColIndex === -1 && colIdx === 0) return;
    if (pkColIndex >= 0 && colIdx === pkColIndex) return;

    const dataType = tableStructure?.columns[colIdx]?.data_type || "";
    const editorType = getEditorType(dataType);
    const initialValue = computeInitialEditValue(rowIdx, colIdx, colName, value, editorType);
    setEditValue(initialValue);

    if (isDateTimeType(editorType)) {
      // 日期时间类型：弹出浮动面板
      const rect = cellEl?.getBoundingClientRect();
      if (rect) {
        const tableRect = tableRef.current?.getBoundingClientRect();
        const relRect = {
          left: rect.left - (tableRect?.left ?? 0),
          top: rect.top - (tableRect?.top ?? 0),
          width: rect.width,
          height: rect.height,
        } as DOMRect;
        setPopupCell({ row: rowIdx, col: colIdx, editorType, colName, value, rect: relRect });
      }
      setEditingCell(null);
    } else {
      // 其他类型：直接进入编辑
      setPopupCell(null);
      setEditingCell({ row: rowIdx, col: colIdx });
    }
  };

  const savePopupValue = () => {
    if (!popupCell || !selectedTable || !queryResult) return;
    const { row, col, colName, editorType } = popupCell;
    const rawValue = queryResult.rows[start + row][col];
    const oldValue = formatValue(rawValue);

    let newValue = editValueRef.current;
    if (editorType === "datetime") {
      newValue = fromDatetimeLocal(newValue);
    }

    if (newValue !== oldValue) {
      setTabCellEdit(activeTabIndex, {
        type: "cell",
        rowIndex: start + row,
        colName,
        oldValue: rawValue,
        newValue,
      });
    } else {
      removeTabCellEdit(activeTabIndex, start + row, colName);
    }
    setPopupCell(null);
  };

  const clearPopupValue = () => {
    if (!popupCell || !selectedTable || !queryResult) return;
    const { row, col, colName } = popupCell;
    const rawValue = queryResult.rows[start + row][col];
    setTabCellEdit(activeTabIndex, {
      type: "cell",
      rowIndex: start + row,
      colName,
      oldValue: rawValue,
      newValue: "NULL",
    });
    setPopupCell(null);
  };

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
      setTabCellEdit(activeTabIndex, {
        type: "cell",
        rowIndex: start + editingCell.row,
        colName,
        oldValue: rawValue,
        newValue,
      });
    } else {
      removeTabCellEdit(activeTabIndex, start + editingCell.row, colName);
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
    <div className="flex flex-col h-full relative" ref={tableRef}>
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
                    onClick={() => commitTabEdits(activeTabIndex)}
                    disabled={isExecuting}
                  >
                    <Save className="h-3 w-3" />
                    提交
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs gap-1"
                    onClick={() => cancelTabEdits(activeTabIndex)}
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
              if (activeTabIndex >= 0) {
                setTabPageSize(activeTabIndex, size);
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
                onClick={() => {
                  if (activeTabIndex >= 0) {
                    useMysqlStore.getState().setTabPage(activeTabIndex, page - 1);
                  }
                }}
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
                onClick={() => {
                  if (activeTabIndex >= 0) {
                    useMysqlStore.getState().setTabPage(activeTabIndex, page + 1);
                  }
                }}
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
              {queryResult.columns.map((col: string, ci: number) => (
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
            {visibleRows.map((row: unknown[], rowIdx: number) => (
              <tr
                key={start + rowIdx}
                className="hover:bg-accent/20 even:bg-muted/20"
              >
                {row.map((cell: unknown, cellIdx: number) => {
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

                  const dataType =
                    tableStructure?.columns[cellIdx]?.data_type || "";
                  const editorType = getEditorType(dataType);

                  return (
                    <td
                      key={cellIdx}
                      className={`border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis relative ${
                        isModified
                          ? "bg-amber-500/[0.18] text-amber-700 dark:text-amber-300 border-l-[3px] border-l-amber-500"
                          : ""
                      } ${isPk ? "font-medium text-primary/80" : ""} ${
                        !isPk && !isEditing ? "cursor-pointer" : ""
                      }`}
                      title={displayValue}
                      onDoubleClick={(e) =>
                        handleCellDoubleClick(rowIdx, cellIdx, colName, cell, e.currentTarget as HTMLElement)
                      }
                    >
                      {isEditing ? (
                        renderEditor(editorType)
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

      {/* 日期时间弹出选择器 */}
      {popupCell && (
        <div
          data-popup="datetime-picker"
          className="absolute z-[100] bg-background border border-border rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] p-4 flex flex-col gap-3"
          style={{
            left: popupCell.rect.left,
            top: popupCell.rect.top + popupCell.rect.height + 4,
            minWidth: Math.max(200, popupCell.rect.width),
            maxWidth: 340,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                {popupCell.colName}
              </span>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
              onClick={() => setPopupCell(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Input */}
          <div className="relative">
            <input
              ref={popupInputRef}
              type={
                popupCell.editorType === "datetime"
                  ? "datetime-local"
                  : popupCell.editorType === "date"
                    ? "date"
                    : "time"
              }
              value={editValue === "NULL" ? "" : editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  savePopupValue();
                }
              }}
              className="w-full h-10 text-sm font-mono border border-input rounded-lg px-3 pr-9 bg-background outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              step={
                popupCell.editorType === "datetime" || popupCell.editorType === "time"
                  ? 1
                  : undefined
              }
            />
            <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>

          {/* 快捷操作 */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 flex-1"
              onClick={() => {
                const now = new Date();
                if (popupCell.editorType === "datetime") {
                  const pad = (n: number) => String(n).padStart(2, "0");
                  setEditValue(
                    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
                  );
                } else if (popupCell.editorType === "date") {
                  setEditValue(now.toISOString().slice(0, 10));
                } else if (popupCell.editorType === "time") {
                  const pad = (n: number) => String(n).padStart(2, "0");
                  setEditValue(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
                }
              }}
            >
              今天
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 flex-1 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={clearPopupValue}
            >
              <Trash2 className="h-3 w-3" />
              设为 NULL
            </Button>
          </div>

          {/* 提示 */}
          <div className="text-[10px] text-muted-foreground text-center">
            按 Enter 确认 · 点击外部保存 · Esc 取消
          </div>
        </div>
      )}
    </div>
  );
}
