import { useState, useRef, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { showSuccess, showError } from "@/lib/api";

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 500, 1000];

type EditorType = "text" | "number" | "date" | "datetime" | "time" | "checkbox";

function getEditorType(dataType: string | undefined): EditorType {
  if (!dataType) return "text";
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
    setTabPage,
    setTabCellEdit,
    removeTabCellEdit,
    commitTabEdits,
    cancelTabEdits,
    reloadTabData,
    toggleRowSelection,
    toggleColSelection,
    setTabFilter,
    setTabSort,
  } = useMysqlStore();

  const tab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;
  const queryResult = tab?.queryResult ?? null;
  const selectedTable = tab?.table ?? null;
  const tableStructure = tab?.tableStructure ?? null;
  const pendingEdits = tab?.pendingEdits ?? new Map();
  const pageSize = tab?.pageSize ?? 100;
  const totalRows = tab?.totalRows ?? 0;
  const page = tab?.page ?? 0;
  const filters = tab?.filters ?? {};
  const sortCol = tab?.sortCol ?? null;
  const sortDir = tab?.sortDir ?? null;
  const selectedRows = tab?.selectedRows ?? new Set();
  const selectedCols = tab?.selectedCols ?? new Set();

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

  // Context menus
  const [colMenu, setColMenu] = useState<{
    col: string;
    colIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    rowIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [cellMenu, setCellMenu] = useState<{
    rowIndex: number;
    colName: string;
    value: unknown;
    x: number;
    y: number;
  } | null>(null);

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
        pkValue: queryResult.rows[start + row][0],
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
      pkValue: queryResult.rows[start + row][0],
    });
    setPopupCell(null);
  };

  // Column header click → sort cycle
  const handleColHeaderClick = (colName: string) => {
    if (!selectedTable || activeTabIndex < 0) return;
    if (sortCol === colName) {
      // cycle: asc → desc → null
      const nextDir = sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc";
      setTabSort(activeTabIndex, nextDir ? colName : null, nextDir);
    } else {
      setTabSort(activeTabIndex, colName, "asc");
    }
  };

  // Column header right-click
  const handleColHeaderContextMenu = (e: React.MouseEvent, colName: string, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setColMenu({ col: colName, colIndex, x: e.clientX, y: e.clientY });
    setRowMenu(null);
    setCellMenu(null);
  };

  // Row click → select
  const handleRowClick = (e: React.MouseEvent, rowIndex: number) => {
    if (activeTabIndex < 0) return;
    const globalRowIndex = page * pageSize + rowIndex;
    if (e.ctrlKey || e.metaKey) {
      toggleRowSelection(activeTabIndex, globalRowIndex);
    } else {
      // single select: clear others, select this one
      const tab = openTabs[activeTabIndex];
      if (tab) {
        const newSelected = new Set(tab.selectedRows);
        if (newSelected.size === 1 && newSelected.has(globalRowIndex)) {
          newSelected.clear();
        } else {
          newSelected.clear();
          newSelected.add(globalRowIndex);
        }
        useMysqlStore.setState((state) => {
          const tabs = [...state.openTabs];
          tabs[activeTabIndex] = { ...tabs[activeTabIndex], selectedRows: newSelected };
          return { openTabs: tabs };
        });
      }
    }
  };

  // Row right-click
  const handleRowContextMenu = (e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const globalRowIndex = page * pageSize + rowIndex;
    setRowMenu({ rowIndex: globalRowIndex, x: e.clientX, y: e.clientY });
    setColMenu(null);
    setCellMenu(null);
  };

  // Cell right-click
  const handleCellContextMenu = (e: React.MouseEvent, rowIndex: number, colName: string, value: unknown) => {
    e.preventDefault();
    e.stopPropagation();
    const globalRowIndex = page * pageSize + rowIndex;
    setCellMenu({ rowIndex: globalRowIndex, colName, value, x: e.clientX, y: e.clientY });
    setColMenu(null);
    setRowMenu(null);
  };

  // Close all context menus on click outside
  useEffect(() => {
    const handler = () => {
      setColMenu(null);
      setRowMenu(null);
      setCellMenu(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Copy row to clipboard
  const copyRowToClipboard = useCallback(async (rowIndex: number, format: "json" | "csv") => {
    if (!queryResult) return;
    const localRowIndex = rowIndex - page * pageSize;
    if (localRowIndex < 0 || localRowIndex >= queryResult.rows.length) return;
    const row = queryResult.rows[localRowIndex];
    try {
      if (format === "json") {
        const obj: Record<string, unknown> = {};
        queryResult.columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        await writeText(JSON.stringify(obj, null, 2));
      } else {
        const values = row.map((v) => (v === null ? "NULL" : String(v)));
        await writeText(values.join(","));
      }
      showSuccess("已复制到剪贴板");
    } catch {
      showError("复制失败");
    }
  }, [queryResult, page, pageSize]);

  // Paste column values
  const handlePasteColumn = async (colName: string) => {
    try {
      const text = await navigator.clipboard.readText();
      const values = text.split(/\r?\n/).filter((v) => v !== "");
      if (!queryResult || activeTabIndex < 0) return;
      const tab = openTabs[activeTabIndex];
      if (!tab) return;
      const colIndex = queryResult.columns.indexOf(colName);
      if (colIndex < 0) return;

      const pendingEdits = new Map(tab.pendingEdits);
      values.forEach((val, i) => {
        const rowIndex = page * pageSize + i;
        if (i < queryResult.rows.length) {
          const oldValue = queryResult.rows[i][colIndex];
          pendingEdits.set(`${rowIndex}:${colName}`, {
            type: "cell",
            rowIndex,
            colName,
            oldValue,
            newValue: val,
            pkValue: queryResult.rows[i][0],
          });
        }
      });

      useMysqlStore.setState((state) => {
        const tabs = [...state.openTabs];
        tabs[activeTabIndex] = { ...tabs[activeTabIndex], pendingEdits };
        return { openTabs: tabs };
      });
      showSuccess(`已粘贴 ${Math.min(values.length, queryResult.rows.length)} 个值`);
    } catch {
      showError("读取剪贴板失败");
    }
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
        pkValue: queryResult.rows[start + editingCell.row][0],
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
            {/* Column headers */}
            <tr>
              {queryResult.columns.map((col: string, ci: number) => {
                const isSelectedCol = selectedCols.has(col);
                const isSortCol = sortCol === col;
                return (
                  <th
                    key={col}
                    className={`border border-[var(--glass-border)] px-2 py-1 text-left font-semibold whitespace-nowrap select-none ${
                      isSelectedCol ? "bg-primary/10" : ""
                    } ${tableStructure?.columns[ci]?.key === "PRI" ? "text-primary" : ""} ${
                      !isSelectedCol ? "cursor-pointer hover:bg-accent/30" : ""
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
                    onClick={() => {
                      if (!isSelectedCol) {
                        handleColHeaderClick(col);
                      }
                    }}
                    onContextMenu={(e) => handleColHeaderContextMenu(e, col, ci)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (activeTabIndex >= 0) toggleColSelection(activeTabIndex, col);
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col}</span>
                      {isSortCol && (
                        <span className="text-[10px] opacity-70">
                          {sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : null}
                        </span>
                      )}
                      {isSelectedCol && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
            {/* Filter row */}
            <tr>
              {queryResult.columns.map((col: string) => {
                const filterVal = filters[col] || "";
                return (
                  <th
                    key={`filter-${col}`}
                    className="border border-[var(--glass-border)] px-1 py-0.5 bg-muted/30"
                  >
                    <div className="relative flex items-center">
                      <Filter className="absolute left-1 h-3 w-3 text-muted-foreground/50" />
                      <input
                        type="text"
                        value={filterVal}
                        onChange={(e) => {
                          if (activeTabIndex >= 0) {
                            setTabFilter(activeTabIndex, col, e.target.value);
                          }
                        }}
                        className="w-full h-5 pl-5 pr-4 text-[11px] bg-transparent border-0 outline-none placeholder:text-muted-foreground/40"
                        placeholder="筛选..."
                      />
                      {filterVal && (
                        <button
                          className="absolute right-0.5 text-muted-foreground/50 hover:text-foreground"
                          onClick={() => {
                            if (activeTabIndex >= 0) {
                              setTabFilter(activeTabIndex, col, "");
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row: unknown[], rowIdx: number) => {
              const globalRowIndex = page * pageSize + rowIdx;
              const isSelectedRow = selectedRows.has(globalRowIndex);
              return (
                <tr
                  key={globalRowIndex}
                  className={`${isSelectedRow ? "bg-primary/10" : "hover:bg-accent/20 even:bg-muted/20"} cursor-pointer select-none`}
                  onClick={(e) => handleRowClick(e, rowIdx)}
                  onContextMenu={(e) => handleRowContextMenu(e, rowIdx)}
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
                    const isSelectedCol = selectedCols.has(colName);

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
                          isSelectedCol && !isModified ? "bg-primary/[0.06]" : ""
                        } ${!isPk && !isEditing ? "cursor-pointer" : ""}`}
                        title={displayValue}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleCellDoubleClick(rowIdx, cellIdx, colName, cell, e.currentTarget as HTMLElement);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          handleCellContextMenu(e, rowIdx, colName, cell);
                        }}
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

      {/* Column context menu */}
      {colMenu && (
        <div
          className="fixed z-[200] bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: colMenu.x, top: colMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2"
            onClick={() => {
              if (activeTabIndex >= 0) setTabSort(activeTabIndex, colMenu.col, "asc");
              setColMenu(null);
            }}
          >
            <ArrowUp className="h-3 w-3" /> 正序排列
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2"
            onClick={() => {
              if (activeTabIndex >= 0) setTabSort(activeTabIndex, colMenu.col, "desc");
              setColMenu(null);
            }}
          >
            <ArrowDown className="h-3 w-3" /> 倒序排列
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2"
            onClick={() => {
              if (activeTabIndex >= 0) {
                const tab = openTabs[activeTabIndex];
                if (tab) {
                  Object.keys(tab.filters).forEach((col) => {
                    setTabFilter(activeTabIndex, col, "");
                  });
                }
              }
              setColMenu(null);
            }}
          >
            <Filter className="h-3 w-3" /> 清除所有筛选
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2"
            onClick={() => {
              handlePasteColumn(colMenu.col);
              setColMenu(null);
            }}
          >
            <Trash2 className="h-3 w-3" /> 粘贴覆盖
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2 text-destructive"
            onClick={() => {
              if (activeTabIndex >= 0) toggleColSelection(activeTabIndex, colMenu.col);
              setColMenu(null);
            }}
          >
            {selectedCols.has(colMenu.col) ? "取消列选中" : "选中整列"}
          </button>
        </div>
      )}

      {/* Row context menu */}
      {rowMenu && (
        <div
          className="fixed z-[200] bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: rowMenu.x, top: rowMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40 flex items-center gap-2 text-destructive"
            onClick={() => {
              if (activeTabIndex >= 0 && queryResult) {
                const localIdx = rowMenu.rowIndex - start;
                setTabCellEdit(activeTabIndex, {
                  type: "delete",
                  rowIndex: rowMenu.rowIndex,
                  pkValue: queryResult.rows[localIdx]?.[0],
                });
              }
              setRowMenu(null);
            }}
          >
            <Trash2 className="h-3 w-3" /> 删除行
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40"
            onClick={() => {
              copyRowToClipboard(rowMenu.rowIndex, "json");
              setRowMenu(null);
            }}
          >
            复制行 (JSON)
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40"
            onClick={() => {
              copyRowToClipboard(rowMenu.rowIndex, "csv");
              setRowMenu(null);
            }}
          >
            复制行 (CSV)
          </button>
        </div>
      )}

      {/* Cell context menu */}
      {cellMenu && (
        <div
          className="fixed z-[200] bg-background border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: cellMenu.x, top: cellMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40"
            onClick={() => {
              if (queryResult) {
                const localIdx = cellMenu.rowIndex - start;
                setTabCellEdit(activeTabIndex, {
                  type: "cell",
                  rowIndex: cellMenu.rowIndex,
                  colName: cellMenu.colName,
                  oldValue: cellMenu.value,
                  newValue: "NULL",
                  pkValue: queryResult.rows[localIdx]?.[0],
                });
              }
              setCellMenu(null);
            }}
          >
            设置为 NULL
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/40"
            onClick={() => {
              if (activeTabIndex >= 0) {
                setTabFilter(activeTabIndex, cellMenu.colName, String(cellMenu.value ?? ""));
              }
              setCellMenu(null);
            }}
          >
            设置为字段筛选项
          </button>
        </div>
      )}
    </div>
  );
}
