import { useState, useRef, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  RotateCcw,
  CalendarDays,
  X,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Eraser,
  Database,
  FileJson,
} from "lucide-react";
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

/** Format cell value for display and comparison */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

type DisplayRow = { origIndex: number; data: unknown[] };

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
    executeQuery,
    loadTableData,
  } = useMysqlStore();

  const [page, setPage] = useState(0);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
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

  // Row / column selection (mutually exclusive)
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);

  // Sorting
  const [sortConfig, setSortConfig] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);

  // Column filters
  const [filters, setFilters] = useState<string[]>([]);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "cell" | "table";
    rowIdx?: number;
    colIdx?: number;
    cellValue?: unknown;
  } | null>(null);

  const hasEdits = pendingEdits.size > 0;

  // ── Effects ──────────────────────────────────────────

  // Reset filters / selection when queryResult changes
  useEffect(() => {
    if (queryResult) {
      setFilters(new Array(queryResult.columns.length).fill(""));
    }
    setSelectedRow(null);
    setSelectedCol(null);
    setSortConfig(null);
    setPage(0);
  }, [queryResult?.columns.join(",")]);

  // Click outside: popup auto-save, edit blur
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
        if (editingCell) handleCellBlur();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingCell, popupCell]);

  // Escape / Enter key handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
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
          // ignore
        }
      }, 50);
    }
  }, [popupCell]);

  // ── Derived data ─────────────────────────────────────

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

  const pkColIndex = tableStructure
    ? tableStructure.columns.findIndex(
        (c) => c.key === "PRI" || c.extra?.toLowerCase().includes("auto_increment")
      )
    : -1;

  // Filter → Sort → Paginate
  const processedRows = useMemo(() => {
    let rows: DisplayRow[] = queryResult.rows.map((data, i) => ({ origIndex: i, data }));

    // Filter
    if (filters.some((f) => f)) {
      rows = rows.filter((row) =>
        row.data.every((cell, ci) => {
          const filter = filters[ci]?.trim().toLowerCase();
          if (!filter) return true;
          if (filter === "null") return cell === null;
          if (filter === "!null" || filter === "not null") return cell !== null;
          const val = formatValue(cell).toLowerCase();
          return val.includes(filter);
        })
      );
    }

    // Sort
    if (sortConfig) {
      rows.sort((a, b) => {
        const va = formatValue(a.data[sortConfig.col]);
        const vb = formatValue(b.data[sortConfig.col]);
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb) && va !== "NULL" && vb !== "NULL") {
          return sortConfig.dir === "asc" ? na - nb : nb - na;
        }
        if (va < vb) return sortConfig.dir === "asc" ? -1 : 1;
        if (va > vb) return sortConfig.dir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }, [queryResult.rows, filters, sortConfig]);

  const totalPages = Math.ceil(processedRows.length / pageSize);
  const start = page * pageSize;
  const visibleRows = processedRows.slice(start, start + pageSize);

  const getEditKey = (rowIdx: number, colName: string) => `${rowIdx + start}:${colName}`;

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

  // ── Handlers ─────────────────────────────────────────

  const handleRowClick = (rowIdx: number) => {
    setSelectedCol(null);
    setSelectedRow((prev) => (prev === rowIdx ? null : rowIdx));
  };

  const handleColClick = (colIdx: number) => {
    setSelectedRow(null);
    setSelectedCol((prev) => (prev === colIdx ? null : colIdx));
    setSortConfig((prev) => {
      if (!prev || prev.col !== colIdx) return { col: colIdx, dir: "asc" };
      if (prev.dir === "asc") return { col: colIdx, dir: "desc" };
      return null;
    });
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
      setCellEdit({ rowIndex: start + row, colName, oldValue: rawValue, newValue });
    } else {
      removeCellEdit(start + row, colName);
    }
    setPopupCell(null);
  };

  const clearPopupValue = () => {
    if (!popupCell || !selectedTable || !queryResult) return;
    const { row, col, colName } = popupCell;
    const rawValue = queryResult.rows[start + row][col];
    setCellEdit({ rowIndex: start + row, colName, oldValue: rawValue, newValue: "NULL" });
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
    }
  };

  const handleFilterChange = (colIdx: number, value: string) => {
    setFilters((prev) => {
      const next = [...prev];
      next[colIdx] = value;
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = () => {
    setFilters(new Array(queryResult.columns.length).fill(""));
    setPage(0);
  };

  // ── Context menu actions ─────────────────────────────

  const handleContextMenu = (
    e: React.MouseEvent,
    type: "cell" | "table",
    extra?: { rowIdx?: number; colIdx?: number; cellValue?: unknown }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, ...extra });
  };

  const handleDeleteRow = async (origIndex: number) => {
    if (!selectedTable || !queryResult) return;
    const pkCol = queryResult.columns[0];
    const pkValue = queryResult.rows[origIndex][0];
    if (pkValue === undefined) return;

    const sql = `DELETE FROM \`${selectedTable}\` WHERE \`${pkCol}\` = ${
      typeof pkValue === "string" ? `'${pkValue.replace(/'/g, "''")}'` : pkValue
    }`;
    await executeQuery(sql);
    if (selectedTable) await loadTableData(selectedTable);
    setContextMenu(null);
  };

  const handleFilterByCell = (colIdx: number, value: unknown) => {
    const strVal = formatValue(value);
    setFilters((prev) => {
      const next = [...prev];
      next[colIdx] = strVal === "NULL" ? "null" : strVal;
      return next;
    });
    setPage(0);
    setContextMenu(null);
  };

  const handleDump = async (dumpType: "structure_and_data" | "structure_only") => {
    if (!selectedTable) return;
    const { currentConnectionId, currentDatabase } = useMysqlStore.getState();
    if (!currentConnectionId || !currentDatabase) return;

    try {
      const path: string = await (window as any).__TAURI__.core.invoke("mysql_dump_table", {
        connectionId: currentConnectionId,
        databaseName: currentDatabase,
        tableName: selectedTable,
        dumpType,
      });
      alert(`转储完成: ${path}`);
    } catch (e: any) {
      alert(`转储失败: ${e}`);
    }
    setContextMenu(null);
  };

  // ── Render helpers ───────────────────────────────────

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

  const sortIcon = (ci: number) => {
    if (!sortConfig || sortConfig.col !== ci) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    if (sortConfig.dir === "asc") return <ArrowUp className="h-3 w-3 text-primary" />;
    return <ArrowDown className="h-3 w-3 text-primary" />;
  };

  return (
    <div className="flex flex-col h-full relative" ref={tableRef}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
        <div className="flex items-center gap-2">
          {selectedTable && (
            <>
              <span className="text-xs text-muted-foreground">
                {processedRows.length} 行
                {processedRows.length !== queryResult.rows.length && ` / 共 ${queryResult.rows.length} 行`}
              </span>
              {filters.some((f) => f) && (
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={clearAllFilters}>
                  <Eraser className="h-3 w-3" />
                  清除筛选
                </Button>
              )}
              {hasEdits && (
                <>
                  <span className="text-xs text-amber-500 font-medium">{pendingEdits.size} 处修改</span>
                  <Button size="sm" className="h-6 text-xs gap-1" onClick={commitEdits} disabled={isExecuting}>
                    <Save className="h-3 w-3" />
                    提交
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={cancelEdits}>
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
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" onContextMenu={(e) => handleContextMenu(e, "table")}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Header row */}
            <tr>
              {queryResult.columns.map((col, ci) => (
                <th
                  key={col}
                  onClick={() => handleColClick(ci)}
                  className={`border border-[var(--glass-border)] px-2 py-1.5 text-left font-semibold whitespace-nowrap cursor-pointer select-none transition-colors ${
                    selectedCol === ci
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/50 hover:bg-muted"
                  } ${tableStructure?.columns[ci]?.key === "PRI" ? "text-primary" : ""}`}
                  title={
                    tableStructure?.columns[ci]
                      ? `${tableStructure.columns[ci].data_type}${
                          tableStructure.columns[ci].is_nullable === "NO" ? " NOT NULL" : ""
                        }`
                      : undefined
                  }
                >
                  <div className="flex items-center gap-1">
                    {sortIcon(ci)}
                    {col}
                  </div>
                </th>
              ))}
            </tr>

            {/* Filter row */}
            <tr>
              {queryResult.columns.map((col, ci) => (
                <th key={`filter-${col}`} className="border border-[var(--glass-border)] p-0 bg-muted/30">
                  <div className="relative">
                    <Filter className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={filters[ci] || ""}
                      onChange={(e) => handleFilterChange(ci, e.target.value)}
                      placeholder="筛选..."
                      className="w-full h-6 text-[10px] pl-5 pr-1 bg-transparent outline-none placeholder:text-muted-foreground/50"
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row, rowIdx) => {
              const isSelectedRow = selectedRow === rowIdx;
              return (
                <tr
                  key={row.origIndex}
                  onClick={() => handleRowClick(rowIdx)}
                  className={`transition-colors ${
                    isSelectedRow ? "bg-primary/[0.08]" : "hover:bg-accent/20 even:bg-muted/20"
                  }`}
                >
                  {row.data.map((cell, cellIdx) => {
                    const colName = queryResult.columns[cellIdx];
                    const isEditing = editingCell?.row === rowIdx && editingCell?.col === cellIdx;
                    const isModified = pendingEdits.has(getEditKey(rowIdx, colName));
                    const displayValue = getCellDisplayValue(rowIdx, colName, cell);
                    const isPk = pkColIndex >= 0 ? cellIdx === pkColIndex : cellIdx === 0;
                    const isSelectedCol = selectedCol === cellIdx;

                    const dataType = tableStructure?.columns[cellIdx]?.data_type || "";
                    const editorType = getEditorType(dataType);

                    return (
                      <td
                        key={cellIdx}
                        onContextMenu={(e) =>
                          handleContextMenu(e, "cell", {
                            rowIdx: row.origIndex,
                            colIdx: cellIdx,
                            cellValue: cell,
                          })
                        }
                        onDoubleClick={(e) =>
                          handleCellDoubleClick(rowIdx, cellIdx, colName, cell, e.currentTarget as HTMLElement)
                        }
                        className={`border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis relative transition-colors ${
                          isModified
                            ? "bg-amber-500/[0.18] text-amber-700 dark:text-amber-300 border-l-[3px] border-l-amber-500"
                            : ""
                        } ${isSelectedCol && !isModified ? "bg-primary/[0.06]" : ""} ${
                          isPk ? "font-medium text-primary/80" : ""
                        } ${!isPk && !isEditing ? "cursor-pointer" : ""}`}
                        title={displayValue}
                      >
                        {isEditing ? (
                          renderEditor(editorType)
                        ) : cell === null ? (
                          <span className="text-muted-foreground italic">NULL</span>
                        ) : (
                          displayValue
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">{popupCell.colName}</span>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
              onClick={() => setPopupCell(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

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
              step={popupCell.editorType === "datetime" || popupCell.editorType === "time" ? 1 : undefined}
            />
            <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>

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

          <div className="text-[10px] text-muted-foreground text-center">按 Enter 确认 · 点击外部保存 · Esc 取消</div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-[200] bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === "cell" ? (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 transition-colors"
                onClick={() => {
                  if (contextMenu.colIdx !== undefined && contextMenu.cellValue !== undefined) {
                    handleFilterByCell(contextMenu.colIdx, contextMenu.cellValue);
                  }
                }}
              >
                <Filter className="h-3 w-3" />
                以此值筛选
              </button>
              <div className="h-px bg-border mx-2 my-0.5" />
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-destructive flex items-center gap-2 transition-colors"
                onClick={() => {
                  if (contextMenu.rowIdx !== undefined) handleDeleteRow(contextMenu.rowIdx);
                }}
              >
                <Trash2 className="h-3 w-3" />
                删除此行
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 transition-colors"
                onClick={() => handleDump("structure_and_data")}
              >
                <Database className="h-3 w-3" />
                转储结构和数据
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 transition-colors"
                onClick={() => handleDump("structure_only")}
              >
                <FileJson className="h-3 w-3" />
                仅转储结构
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
