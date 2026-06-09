# 数据库管理器重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有的 MySQL 管理模块重设计为 Navicat 风格的标签页式数据库管理器，支持标签页持久化状态、后端真分页、行/列选中、右键菜单、列筛选、整列粘贴覆盖等功能。

**Architecture:** 采用 Store 集中管理标签状态模式，每个标签页独立维护 `TabState`（含筛选、排序、分页、选中、pending edits）。标签页关闭即丢弃状态。前端通过新增 API 与后端交互实现真分页。

**Tech Stack:** React 18, Zustand, Tailwind CSS, shadcn/ui, Tauri (Rust), TypeScript

---

## File Structure Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/types/index.ts` | 修改 | 新增 `TabState`, `PendingEdit`, `LoadTableDataRequest`, `LoadTableDataResponse` 类型 |
| `src/lib/mysql-api.ts` | 修改 | 新增 `loadTableDataPaged` API（带分页/筛选/排序） |
| `src/stores/mysql.ts` | 大幅修改 | 引入 `TabState`, `openTabs`, `activeTabIndex`；移除全局 `selectedTable/viewMode/queryResult` 等 |
| `src/components/mysql/TabBar.tsx` | 新增 | 标签栏：显示所有打开的标签，可关闭/切换 |
| `src/components/mysql/DataTab.tsx` | 新增 | 数据子标签页容器（整合工具栏、表格、分页） |
| `src/components/mysql/ResultTable.tsx` | 大幅修改 | 支持行/列选中、筛选行、右键菜单、整列粘贴 |
| `src/components/mysql/TableStructureView.tsx` | 小幅修改 | 通过 props 接收 `table` 和 `structure`，不再依赖 store |
| `src/components/mysql/QueryEditor.tsx` | 小幅修改 | 通过 props 接收 `initialSql` 和 `onExecuteResult`，不再依赖 store 的 selectedTable |
| `src/components/mysql/ObjectTree.tsx` | 小幅修改 | 点击表名调用 `openTableTab` 打开标签 |
| `src/pages/DatabaseManager.tsx` | 新增（从 Mysql.tsx 重写） | 标签页容器：左侧 ObjectTree + 右侧 TabBar + TabContent |
| `src/pages/Mysql.tsx` | 删除 | 被 DatabaseManager.tsx 替代 |
| `src/components/Layout.tsx` | 修改 | 菜单名改为"数据库管理"，路由改为 `/database` |
| `src/App.tsx` | 修改 | 路由 `/mysql` 改为 `/database` |

---

### Task 1: 新增类型定义

**Files:**
- Modify: `src/types/index.ts`

**Context:** 现有 `types/index.ts` 已定义 `MysqlQueryResult`, `TableStructure` 等类型，但缺少标签页相关的类型。

- [ ] **Step 1: 在 `src/types/index.ts` 末尾追加新类型**

```typescript
// ===== 数据库管理器标签页状态 =====

export type PendingEdit =
  | { type: "cell"; rowIndex: number; colName: string; oldValue: unknown; newValue: string }
  | { type: "delete"; rowIndex: number };

export interface TabState {
  table: string;
  subTab: "data" | "structure" | "sql";
  filters: Record<string, string>;
  sortCol: string | null;
  sortDir: "asc" | "desc" | null;
  page: number;
  pageSize: number;
  selectedRows: Set<number>;
  selectedCols: Set<string>;
  pendingEdits: Map<string, PendingEdit>;
  queryResult: MysqlQueryResult | null;
  tableStructure: TableStructure | null;
  totalRows: number;
  sqlEditorContent: string;
}

export interface LoadTableDataRequest {
  connection_id: number;
  database: string;
  table: string;
  page: number;
  page_size: number;
  filters: Record<string, string>;
  sort_col: string | null;
  sort_dir: "asc" | "desc" | null;
}

export interface LoadTableDataResponse {
  columns: string[];
  rows: any[][];
  total_rows: number;
  execution_time_ms: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(database): add TabState, PendingEdit, and paged load types"
```

---

### Task 2: 新增分页 API

**Files:**
- Modify: `src/lib/mysql-api.ts`

**Context:** 现有 `mysql-api.ts` 有 `getMysqlTableStructure` 和 `executeMysqlQuery`，需要新增一个支持分页/筛选/排序的表数据加载 API。

- [ ] **Step 1: 在 `src/lib/mysql-api.ts` 中添加新函数**

在 `getMysqlTableStructure` 之后、`executeMysqlQuery` 之前插入：

```typescript
export async function loadTableDataPaged(
  connectionId: number,
  database: string,
  table: string,
  page: number,
  pageSize: number,
  filters: Record<string, string>,
  sortCol: string | null,
  sortDir: "asc" | "desc" | null
): Promise<LoadTableDataResponse> {
  return invokeSafe("mysql_load_table_data_paged", {
    req: {
      connection_id: connectionId,
      database,
      table,
      page,
      page_size: pageSize,
      filters,
      sort_col: sortCol,
      sort_dir: sortDir,
    },
  });
}
```

- [ ] **Step 2: 确保 `LoadTableDataResponse` 类型已导入**

文件顶部已有 `import type { ... } from "@/types";`，确认已将 `LoadTableDataResponse` 加入导入列表：

```typescript
import type {
  MysqlConnection,
  MysqlConnectionConfig,
  DatabaseInfo,
  TableInfo,
  ViewInfo,
  TriggerInfo,
  FunctionInfo,
  EventInfo,
  TableStructure,
  MysqlQueryResult,
  MysqlBackupTask,
  LoadTableDataResponse,  // 新增
} from "@/types";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mysql-api.ts
git commit -m "feat(database): add loadTableDataPaged API for server-side pagination"
```

---

### Task 3: Store 重构 — 引入 TabState

**Files:**
- Modify: `src/stores/mysql.ts`

**Context:** 现有 store 使用全局 `selectedTable`, `viewMode`, `queryResult`, `tableStructure`, `pageSize`, `pendingEdits`。需要重构为以 `TabState` 为核心的标签页管理模式。

**策略：** 保留所有连接管理相关的 state 和 action 不变，将表数据相关的 state 迁移到 `TabState` 中。为避免破坏现有其他组件（如 ObjectTree、ConnectionDialog 等），保留原有 action 签名但内部实现改为操作 tab 状态。

- [ ] **Step 1: 修改 store 状态定义**

替换 `interface MysqlState` 中的表数据相关字段：

**移除以下字段：**
- `selectedTable: string | null`
- `tableStructure: TableStructure | null`
- `queryResult: MysqlQueryResult | null`
- `viewMode: "data" | "structure"`
- `showQueryEditor: boolean`
- `pendingEdits: Map<string, CellEdit>`
- `pageSize: number`

**新增字段：**
- `openTabs: TabState[]`
- `activeTabIndex: number`

**保留的字段（连接管理）：**
- `connections`, `currentConnectionId`, `currentDatabase`, `databases`, `tables`, `views`, `triggers`, `functions`, `events`, `queryHistory`, `isExecuting`, `isConnecting`, `backupTasks`

**需要修改的 action 签名：**
- `loadTableStructure` → 改为内部辅助方法，不再直接修改 state
- `loadTableData` → 改为 `loadTableDataForTab(tabIndex: number, ...)`
- `executeQuery` → 改为 `executeQueryForTab(tabIndex: number, sql: string)`
- `setViewMode` → 改为 `setTabSubTab(tabIndex: number, subTab: "data" | "structure" | "sql")`
- `setShowQueryEditor` → 移除
- `setCellEdit` → 改为 `setTabCellEdit(tabIndex: number, ...)`
- `removeCellEdit` → 改为 `removeTabCellEdit(tabIndex: number, ...)`
- `commitEdits` → 改为 `commitTabEdits(tabIndex: number)`
- `cancelEdits` → 改为 `cancelTabEdits(tabIndex: number)`
- `setPageSize` → 改为 `setTabPageSize(tabIndex: number, size: number)`

**新增的 action：**
- `openTab(table: string): number` — 打开新标签或切换到已有标签，返回 tab index
- `closeTab(index: number): void` — 关闭标签
- `switchTab(index: number): void` — 切换激活标签
- `setTabFilter(tabIndex: number, col: string, value: string): void`
- `clearTabFilter(tabIndex: number, col: string): void`
- `setTabSort(tabIndex: number, col: string | null, dir: "asc" | "desc" | null): void`
- `setTabPage(tabIndex: number, page: number): void`
- `toggleRowSelection(tabIndex: number, rowIndex: number): void`
- `toggleColSelection(tabIndex: number, col: string): void`
- `setTabSqlContent(tabIndex: number, sql: string): void`

- [ ] **Step 2: 实现 `createTabState` 辅助函数**

```typescript
function createTabState(table: string): TabState {
  return {
    table,
    subTab: "data",
    filters: {},
    sortCol: null,
    sortDir: null,
    page: 0,
    pageSize: 100,
    selectedRows: new Set(),
    selectedCols: new Set(),
    pendingEdits: new Map(),
    queryResult: null,
    tableStructure: null,
    totalRows: 0,
    sqlEditorContent: `SELECT * FROM \`${table}\``,
  };
}
```

- [ ] **Step 3: 重写 store 实现**

Store 的 `create` 调用中：

1. **初始化 state：** `openTabs: []`, `activeTabIndex: -1`

2. **`openTab(table)`：**
   - 遍历 `openTabs` 查找 `t.table === table` 的已有 tab
   - 如果找到，设置 `activeTabIndex` 为该索引，返回索引
   - 如果没找到，push `createTabState(table)`，设置 `activeTabIndex` 为新索引，然后异步加载表结构和数据
   - 返回新索引

3. **`closeTab(index)`：**
   - `openTabs.splice(index, 1)`
   - 如果 `activeTabIndex >= index` 且 `activeTabIndex > 0`，`activeTabIndex--`
   - 如果 `openTabs` 为空，`activeTabIndex = -1`

4. **`switchTab(index)`：** `set({ activeTabIndex: index })`

5. **`loadTableDataForTab(tabIndex, ...)`：**
   - 获取对应 tab 的 `filters`, `sortCol`, `sortDir`, `page`, `pageSize`
   - 调用 `loadTableDataPaged`
   - 更新 `tab.queryResult` 和 `tab.totalRows`
   - 同时调用 `getMysqlTableStructure` 更新 `tab.tableStructure`

6. **`commitTabEdits(tabIndex)`：**
   - 获取对应 tab 的 `pendingEdits`
   - 分离 cell edits 和 delete edits
   - 先执行 DELETE（按行分组，使用主键）
   - 再执行 UPDATE（按行分组）
   - 成功后重新加载当前 tab 数据
   - 清空 pendingEdits

7. **`cancelTabEdits(tabIndex)`：**
   - 清空对应 tab 的 `pendingEdits`
   - 重新加载当前 tab 数据

8. **`setTabCellEdit(tabIndex, edit)`：**
   - 获取 tab，更新 `tab.pendingEdits.set(editKey, { type: "cell", ...edit })`

9. **`removeTabCellEdit(tabIndex, rowIndex, colName)`：**
   - 获取 tab，`tab.pendingEdits.delete(editKey)`

10. **`setTabFilter(tabIndex, col, value)`：**
    - 更新 tab.filters，`tab.page = 0`，重新加载数据

11. **`setTabSort(tabIndex, col, dir)`：**
    - 更新 tab.sortCol/sortDir，`tab.page = 0`，重新加载数据

12. **`setTabPage(tabIndex, page)`：**
    - 更新 tab.page，重新加载数据

13. **`setTabPageSize(tabIndex, size)`：**
    - 更新 tab.pageSize，`tab.page = 0`，重新加载数据

- [ ] **Step 4: 保留向后兼容的 action 包装（可选）**

为最小化其他组件的改动，可以保留一些 action 但内部委托给 tab 版本：

```typescript
// 为了兼容 ObjectTree 等组件，保留简化的 action
loadTableData: async (table, limit) => {
  const idx = get().openTab(table);
  await get().loadTableDataForTab(idx);
},
```

但更好的做法是直接修改调用方（ObjectTree、QueryEditor 等）使用新的 tab 版本。

- [ ] **Step 5: Commit**

```bash
git add src/stores/mysql.ts
git commit -m "feat(database): refactor store with TabState and openTabs management"
```

---

### Task 4: TabBar 组件

**Files:**
- Create: `src/components/mysql/TabBar.tsx`

**Context:** 标签栏位于右侧内容区顶部，显示所有打开的标签页。

- [ ] **Step 1: 创建 `src/components/mysql/TabBar.tsx`**

```typescript
import { X } from "lucide-react";
import { TabState } from "@/types";

interface TabBarProps {
  tabs: TabState[];
  activeIndex: number;
  onSwitch: (index: number) => void;
  onClose: (index: number) => void;
}

export default function TabBar({ tabs, activeIndex, onSwitch, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-[var(--glass-border)] bg-muted/30 overflow-x-auto">
      {tabs.map((tab, index) => (
        <div
          key={tab.table + index}
          className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--glass-border)] whitespace-nowrap transition-colors ${
            index === activeIndex
              ? "bg-background text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/30"
          }`}
          onClick={() => onSwitch(index)}
        >
          <span className="truncate max-w-[120px]">{tab.table}</span>
          <button
            className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-0.5 rounded"
            onClick={(e) => {
              e.stopPropagation();
              onClose(index);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mysql/TabBar.tsx
git commit -m "feat(database): add TabBar component for table tabs"
```

---

### Task 5: DataTab 组件

**Files:**
- Create: `src/components/mysql/DataTab.tsx`

**Context:** 数据子标签页整合工具栏、ResultTable 和分页控件。接收完整的 `TabState` 和一组操作回调。

- [ ] **Step 1: 创建 `src/components/mysql/DataTab.tsx`**

```typescript
import { useState } from "react";
import { Terminal, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabState } from "@/types";
import ResultTable from "./ResultTable";

interface DataTabProps {
  tab: TabState;
  tabIndex: number;
  isExecuting: boolean;
  onSetFilter: (col: string, value: string) => void;
  onClearFilter: (col: string) => void;
  onSetSort: (col: string | null, dir: "asc" | "desc" | null) => void;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onToggleRowSelection: (rowIndex: number) => void;
  onToggleColSelection: (col: string) => void;
  onCellEdit: (rowIndex: number, colName: string, oldValue: unknown, newValue: string) => void;
  onRemoveCellEdit: (rowIndex: number, colName: string) => void;
  onSetNull: (rowIndex: number, colName: string, oldValue: unknown) => void;
  onSetColumnFilter: (colName: string, value: string) => void;
  onPasteColumn: (colName: string, values: string[]) => void;
  onDeleteRows: (rowIndices: number[]) => void;
  onCommit: () => void;
  onCancel: () => void;
  onShowSqlEditor: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 500, 1000];

export default function DataTab({
  tab,
  isExecuting,
  onSetFilter,
  onClearFilter,
  onSetSort,
  onSetPage,
  onSetPageSize,
  onToggleRowSelection,
  onToggleColSelection,
  onCellEdit,
  onRemoveCellEdit,
  onSetNull,
  onSetColumnFilter,
  onPasteColumn,
  onDeleteRows,
  onCommit,
  onCancel,
  onShowSqlEditor,
}: DataTabProps) {
  const [showFilters, setShowFilters] = useState(true);

  const hasEdits = tab.pendingEdits.size > 0;
  const totalPages = Math.max(1, Math.ceil(tab.totalRows / tab.pageSize));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs gap-1"
            onClick={onShowSqlEditor}
          >
            <Terminal className="h-3 w-3" />
            SQL
          </Button>
          <span className="text-sm font-medium truncate">{tab.table}</span>
          {hasEdits && (
            <>
              <span className="text-xs text-amber-500 font-medium">
                {tab.pendingEdits.size} 处修改
              </span>
              <Button size="sm" className="h-6 text-xs gap-1" onClick={onCommit} disabled={isExecuting}>
                <Save className="h-3 w-3" />
                提交
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={onCancel}>
                <RotateCcw className="h-3 w-3" />
                取消
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            共 {tab.totalRows} 行
          </span>
        </div>
      </div>

      {/* Result Table */}
      <div className="flex-1 overflow-hidden">
        <ResultTable
          tab={tab}
          onSetFilter={onSetFilter}
          onClearFilter={onClearFilter}
          onSetSort={onSetSort}
          onToggleRowSelection={onToggleRowSelection}
          onToggleColSelection={onToggleColSelection}
          onCellEdit={onCellEdit}
          onRemoveCellEdit={onRemoveCellEdit}
          onSetNull={onSetNull}
          onSetColumnFilter={onSetColumnFilter}
          onPasteColumn={onPasteColumn}
          onDeleteRows={onDeleteRows}
        />
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--glass-border)]">
        <div className="flex items-center gap-2">
          <select
            value={tab.pageSize}
            onChange={(e) => onSetPageSize(Number(e.target.value))}
            className="h-6 text-xs rounded border border-input bg-transparent px-2"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s} 条/页</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost" className="h-6 w-6 p-0"
            disabled={tab.page === 0}
            onClick={() => onSetPage(tab.page - 1)}
          >
            ‹
          </Button>
          <span className="text-xs text-muted-foreground">
            {tab.page + 1} / {totalPages}
          </span>
          <Button
            size="sm" variant="ghost" className="h-6 w-6 p-0"
            disabled={tab.page >= totalPages - 1}
            onClick={() => onSetPage(tab.page + 1)}
          >
            ›
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mysql/DataTab.tsx
git commit -m "feat(database): add DataTab component with toolbar and pagination"
```

---

### Task 6: ResultTable 重构

**Files:**
- Modify: `src/components/mysql/ResultTable.tsx`

**Context:** 现有 ResultTable 直接从 store 读取 `queryResult`, `selectedTable`, `tableStructure`, `pendingEdits`。需要改为通过 props 接收 `TabState`，并新增行/列选中、筛选行、右键菜单、整列粘贴覆盖功能。

**策略：** 这是一个大幅修改。由于变化太大，建议将现有 ResultTable.tsx 重命名为 ResultTableOld.tsx 备份，然后重写新的 ResultTable.tsx。

实际上，更好的做法是直接修改，保留现有的单元格编辑和日期弹出选择器逻辑，只重构数据流和新增功能。

- [ ] **Step 1: 重写 ResultTable 的 props 接口**

```typescript
import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Save, RotateCcw, CalendarDays, X, Trash2, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabState } from "@/types";

interface ResultTableProps {
  tab: TabState;
  onSetFilter: (col: string, value: string) => void;
  onClearFilter: (col: string) => void;
  onSetSort: (col: string | null, dir: "asc" | "desc" | null) => void;
  onToggleRowSelection: (rowIndex: number) => void;
  onToggleColSelection: (col: string) => void;
  onCellEdit: (rowIndex: number, colName: string, oldValue: unknown, newValue: string) => void;
  onRemoveCellEdit: (rowIndex: number, colName: string) => void;
  onSetNull: (rowIndex: number, colName: string, oldValue: unknown) => void;
  onSetColumnFilter: (colName: string, value: string) => void;
  onPasteColumn: (colName: string, values: string[]) => void;
  onDeleteRows: (rowIndices: number[]) => void;
}
```

- [ ] **Step 2: 重构表格渲染逻辑**

1. 从 `tab.queryResult` 获取列和数据
2. 从 `tab.tableStructure` 获取列类型信息
3. 从 `tab.pendingEdits` 获取修改标记
4. 从 `tab.selectedRows` 和 `tab.selectedCols` 获取选中状态
5. 从 `tab.filters` 获取筛选值

表格结构改为：
- thead 第一行：列名（可点击排序，可右键）+ 排序箭头
- thead 第二行：筛选输入框 + 清除按钮
- tbody：数据行（可点击选中，可右键）

- [ ] **Step 3: 实现列名右键菜单**

使用一个局部状态管理右键菜单位置和可见性：

```typescript
const [colContextMenu, setColContextMenu] = useState<{
  col: string;
  x: number;
  y: number;
} | null>(null);
```

右键菜单项：
- 正序排列 → `onSetSort(col, "asc")`
- 倒序排列 → `onSetSort(col, "desc")`
- 清除所有筛选 → 遍历所有 filters 调用 `onClearFilter`
- 粘贴覆盖 → 读取剪贴板，调用 `onPasteColumn(col, values)`

- [ ] **Step 4: 实现行右键菜单**

```typescript
const [rowContextMenu, setRowContextMenu] = useState<{
  rowIndex: number;
  x: number;
  y: number;
} | null>(null);
```

右键菜单项：
- 删除行 → `onDeleteRows([rowIndex])`
- 复制行(JSON) → 将整行数据转为 JSON 写入剪贴板
- 复制行(CSV) → 将整行数据转为 CSV 写入剪贴板

- [ ] **Step 5: 实现单元格右键菜单**

```typescript
const [cellContextMenu, setCellContextMenu] = useState<{
  rowIndex: number;
  colName: string;
  oldValue: unknown;
  x: number;
  y: number;
} | null>(null);
```

右键菜单项：
- 设置为 NULL → `onSetNull(rowIndex, colName, oldValue)`
- 设置为字段筛选项 → `onSetColumnFilter(colName, String(oldValue))`

- [ ] **Step 6: 实现整列粘贴覆盖**

在列名右键菜单的"粘贴覆盖"中：

```typescript
const handlePasteColumn = async (colName: string) => {
  try {
    const text = await navigator.clipboard.readText();
    const values = text.split(/\r?\n/).filter(v => v !== "");
    onPasteColumn(colName, values);
  } catch {
    showError("读取剪贴板失败");
  }
};
```

- [ ] **Step 7: 保留现有的单元格编辑和日期弹出选择器逻辑**

将现有 `ResultTable.tsx` 中的 `handleCellDoubleClick`, `savePopupValue`, `clearPopupValue`, `handleCellBlur`, `handleKeyDown`, `renderEditor` 等逻辑复制到新组件中，适配新的 props 接口。

- [ ] **Step 8: Commit**

```bash
git add src/components/mysql/ResultTable.tsx
git commit -m "feat(database): refactor ResultTable with row/col selection, filters, context menus, column paste"
```

---

### Task 7: StructureTab 和 SqlTab 包装组件

**Files:**
- Create: `src/components/mysql/StructureTab.tsx`
- Create: `src/components/mysql/SqlTab.tsx`

- [ ] **Step 1: 创建 `src/components/mysql/StructureTab.tsx`**

```typescript
import { TableStructure } from "@/types";
import TableStructureView from "./TableStructureView";

interface StructureTabProps {
  table: string;
  structure: TableStructure | null;
}

export default function StructureTab({ table, structure }: StructureTabProps) {
  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4">
      {structure ? (
        <TableStructureView table={table} structure={structure} />
      ) : (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          加载中...
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 修改 `TableStructureView.tsx` 接收 props**

将 `TableStructureView` 从使用 `useMysqlStore` 改为通过 props 接收数据：

```typescript
interface TableStructureViewProps {
  table: string;
  structure: TableStructure;
}

export default function TableStructureView({ table, structure }: TableStructureViewProps) {
  // 移除 useMysqlStore 调用
  // 直接使用 props
}
```

- [ ] **Step 3: 创建 `src/components/mysql/SqlTab.tsx`**

```typescript
import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MysqlQueryResult } from "@/types";

interface SqlTabProps {
  initialSql: string;
  onExecute: (sql: string) => Promise<MysqlQueryResult | null>;
}

export default function SqlTab({ initialSql, onExecute }: SqlTabProps) {
  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<MysqlQueryResult | null>(null);
  const [executing, setExecuting] = useState(false);

  const handleExecute = async () => {
    if (!sql.trim()) return;
    setExecuting(true);
    try {
      const res = await onExecute(sql);
      setResult(res);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--glass-border)]">
        <Button size="sm" onClick={handleExecute} disabled={executing} className="gap-1">
          <Play className="h-3.5 w-3.5" />
          {executing ? "执行中..." : "执行"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSql("")} className="gap-1">
          <RotateCcw className="h-3.5 w-3.5" />
          清空
        </Button>
      </div>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        className="flex-1 p-2 text-sm font-mono bg-transparent resize-none outline-none"
        spellCheck={false}
        placeholder="输入 SQL 查询..."
      />
      {result && (
        <div className="border-t border-[var(--glass-border)] p-2 text-xs text-muted-foreground">
          {result.affected_rows !== null
            ? `影响 ${result.affected_rows} 行`
            : `共 ${result.rows.length} 行`} · {result.execution_time_ms}ms
        </div>
      )}
    </div>
  );
}
```

注：这里使用了简化版的 SQL 编辑器。如果需要保留现有 QueryEditor 的语法高亮功能，后续可以替换。

- [ ] **Step 4: Commit**

```bash
git add src/components/mysql/StructureTab.tsx src/components/mysql/SqlTab.tsx src/components/mysql/TableStructureView.tsx
git commit -m "feat(database): add StructureTab and SqlTab wrappers, make TableStructureView props-driven"
```

---

### Task 8: DatabaseManager 页面（重写主页面）

**Files:**
- Create: `src/pages/DatabaseManager.tsx`
- Delete: `src/pages/Mysql.tsx`

**Context:** 新页面替代 `Mysql.tsx`，作为标签页容器。左侧保留 ObjectTree，右侧是 TabBar + TabContent。

- [ ] **Step 1: 创建 `src/pages/DatabaseManager.tsx`**

```typescript
import { useEffect } from "react";
import ObjectTree from "@/components/mysql/ObjectTree";
import TabBar from "@/components/mysql/TabBar";
import DataTab from "@/components/mysql/DataTab";
import StructureTab from "@/components/mysql/StructureTab";
import SqlTab from "@/components/mysql/SqlTab";
import { useMysqlStore } from "@/stores/mysql";

export default function DatabaseManager() {
  const {
    loadConnections,
    openTabs,
    activeTabIndex,
    isExecuting,
    openTab,
    closeTab,
    switchTab,
    loadTableDataForTab,
    setTabFilter,
    clearTabFilter,
    setTabSort,
    setTabPage,
    setTabPageSize,
    toggleRowSelection,
    toggleColSelection,
    setTabCellEdit,
    removeTabCellEdit,
    setTabNull,
    setTabColumnFilter,
    pasteColumnValues,
    deleteRows,
    commitTabEdits,
    cancelTabEdits,
    setTabSubTab,
    executeQueryForTab,
  } = useMysqlStore();

  useEffect(() => {
    loadConnections();
  }, []);

  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  return (
    <div className="flex h-full">
      <ObjectTree onOpenTable={openTab} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <TabBar
          tabs={openTabs}
          activeIndex={activeTabIndex}
          onSwitch={switchTab}
          onClose={closeTab}
        />

        {activeTab ? (
          <div className="flex-1 overflow-hidden">
            {/* Sub-tab navigation */}
            <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--glass-border)]">
              {(["data", "structure", "sql"] as const).map((sub) => (
                <button
                  key={sub}
                  className={`text-xs px-2 py-0.5 rounded ${
                    activeTab.subTab === sub
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent/30"
                  }`}
                  onClick={() => setTabSubTab(activeTabIndex, sub)}
                >
                  {sub === "data" ? "数据" : sub === "structure" ? "结构" : "SQL"}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden h-[calc(100%-28px)]">
              {activeTab.subTab === "data" && (
                <DataTab
                  tab={activeTab}
                  tabIndex={activeTabIndex}
                  isExecuting={isExecuting}
                  onSetFilter={(col, value) => setTabFilter(activeTabIndex, col, value)}
                  onClearFilter={(col) => clearTabFilter(activeTabIndex, col)}
                  onSetSort={(col, dir) => setTabSort(activeTabIndex, col, dir)}
                  onSetPage={(page) => setTabPage(activeTabIndex, page)}
                  onSetPageSize={(size) => setTabPageSize(activeTabIndex, size)}
                  onToggleRowSelection={(row) => toggleRowSelection(activeTabIndex, row)}
                  onToggleColSelection={(col) => toggleColSelection(activeTabIndex, col)}
                  onCellEdit={(row, col, old, val) => setTabCellEdit(activeTabIndex, { rowIndex: row, colName: col, oldValue: old, newValue: val })}
                  onRemoveCellEdit={(row, col) => removeTabCellEdit(activeTabIndex, row, col)}
                  onSetNull={(row, col, old) => setTabNull(activeTabIndex, row, col, old)}
                  onSetColumnFilter={(col, val) => setTabColumnFilter(activeTabIndex, col, val)}
                  onPasteColumn={(col, vals) => pasteColumnValues(activeTabIndex, col, vals)}
                  onDeleteRows={(rows) => deleteRows(activeTabIndex, rows)}
                  onCommit={() => commitTabEdits(activeTabIndex)}
                  onCancel={() => cancelTabEdits(activeTabIndex)}
                  onShowSqlEditor={() => setTabSubTab(activeTabIndex, "sql")}
                />
              )}
              {activeTab.subTab === "structure" && (
                <StructureTab table={activeTab.table} structure={activeTab.tableStructure} />
              )}
              {activeTab.subTab === "sql" && (
                <SqlTab
                  initialSql={activeTab.sqlEditorContent}
                  onExecute={(sql) => executeQueryForTab(activeTabIndex, sql)}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            执行查询或选择表以查看数据
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 删除 `src/pages/Mysql.tsx`**

```bash
rm src/pages/Mysql.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/DatabaseManager.tsx
git rm src/pages/Mysql.tsx
git commit -m "feat(database): add DatabaseManager page with tab system"
```

---

### Task 9: 适配 ObjectTree

**Files:**
- Modify: `src/components/mysql/ObjectTree.tsx`

**Context:** 现有 ObjectTree 直接调用 `loadTableData(table)` 加载表数据。需要改为调用外部传入的 `onOpenTable` 回调。

- [ ] **Step 1: 修改 ObjectTree 接收 onOpenTable prop**

```typescript
interface ObjectTreeProps {
  onOpenTable?: (tableName: string) => void;
}

export default function ObjectTree({ onOpenTable }: ObjectTreeProps = {}) {
```

- [ ] **Step 2: 修改 handleTableClick**

```typescript
const handleTableClick = (tableName: string) => {
  if (onOpenTable) {
    onOpenTable(tableName);
  } else {
    // 回退到旧行为（兼容期）
    loadTableData(tableName);
  }
};
```

- [ ] **Step 3: 修改 ObjectTree header 文字**

```typescript
<span className="text-sm font-semibold">数据库管理</span>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mysql/ObjectTree.tsx
git commit -m "feat(database): adapt ObjectTree to open tabs instead of direct load"
```

---

### Task 10: 路由和菜单更名

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: 修改 `src/App.tsx`**

替换：
```typescript
import Mysql from "./pages/Mysql";
```
为：
```typescript
import DatabaseManager from "./pages/DatabaseManager";
```

替换路由：
```typescript
<Route path="mysql" element={<Mysql />} />
```
为：
```typescript
<Route path="database" element={<DatabaseManager />} />
```

- [ ] **Step 2: 修改 `src/components/Layout.tsx`**

替换 navItems 中：
```typescript
{ to: "/mysql", icon: DatabaseIcon, label: "MySQL" },
```
为：
```typescript
{ to: "/database", icon: DatabaseIcon, label: "数据库管理" },
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "feat(database): rename route and menu from MySQL to Database Manager"
```

---

### Task 11: 后端 Rust API 实现

**Files:**
- Modify: `src-tauri/src/commands.rs` 或 MySQL 相关模块

**Context:** 需要新增 `mysql_load_table_data_paged` 命令，支持分页、筛选和排序。

- [ ] **Step 1: 在 Rust 后端添加新命令**

找到现有的 `mysql_execute_query` 命令实现位置（可能在 `src-tauri/src/mysql/query.rs`），在其附近添加：

```rust
#[derive(Debug, Deserialize)]
pub struct LoadTableDataRequest {
    pub connection_id: u32,
    pub database: String,
    pub table: String,
    pub page: u32,
    pub page_size: u32,
    pub filters: HashMap<String, String>,
    pub sort_col: Option<String>,
    pub sort_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoadTableDataResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: u64,
    pub execution_time_ms: u64,
}

#[tauri::command]
pub async fn mysql_load_table_data_paged(
    req: LoadTableDataRequest,
) -> Result<LoadTableDataResponse, String> {
    let start = std::time::Instant::now();
    
    let pool = get_pool(req.connection_id).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    // Build WHERE clause from filters
    let mut conditions = vec![];
    let mut params: Vec<String> = vec![];
    
    for (col, val) in &req.filters {
        if !val.is_empty() {
            conditions.push(format!("`{}` LIKE ?", col));
            params.push(format!("%{}%", val));
        }
    }
    
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    
    // Count total rows
    let count_sql = format!("SELECT COUNT(*) FROM `{}` {}", req.table, where_clause);
    let total_rows: u64 = sqlx::query_scalar(&count_sql)
        .bind_all(&params)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    
    // Build ORDER BY
    let order_clause = match (&req.sort_col, req.sort_dir.as_deref()) {
        (Some(col), Some("asc")) => format!("ORDER BY `{}` ASC", col),
        (Some(col), Some("desc")) => format!("ORDER BY `{}` DESC", col),
        _ => String::new(),
    };
    
    // Build main query
    let offset = req.page * req.page_size;
    let sql = format!(
        "SELECT * FROM `{}` {} {} LIMIT {} OFFSET {}",
        req.table, where_clause, order_clause, req.page_size, offset
    );
    
    let rows = sqlx::query(&sql)
        .bind_all(&params)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    
    // Convert rows to Vec<Vec<Value>>
    let columns = rows.first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    
    let data_rows: Vec<Vec<serde_json::Value>> = rows.into_iter()
        .map(|row| {
            columns.iter().enumerate().map(|(i, _)| {
                // Convert MySqlValue to serde_json::Value
                // ... (reuse existing conversion logic)
            }).collect()
        }).collect();
    
    let execution_time_ms = start.elapsed().as_millis() as u64;
    
    Ok(LoadTableDataResponse {
        columns,
        rows: data_rows,
        total_rows,
        execution_time_ms,
    })
}
```

注：具体参数绑定语法取决于项目中使用的 sqlx 版本。如果现有代码使用字符串替换而非参数绑定，应遵循现有模式以保持代码库一致性。

- [ ] **Step 2: 注册新命令**

在 `commands.rs` 或 Tauri 构建器配置中注册 `mysql_load_table_data_paged`。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(backend): add mysql_load_table_data_paged command for server-side pagination"
```

---

### Task 12: 整合测试和 Bug 修复

**Files:**
- Modify: 多个文件按需修复

- [ ] **Step 1: 验证编译**

```bash
npm run build
```

修复所有 TypeScript 编译错误：
- 确保所有导入路径正确
- 确保类型匹配
- 确保所有必需 props 已传递

- [ ] **Step 2: 功能测试**

手动测试以下功能：
1. 打开多个表标签页
2. 切换标签页，验证状态独立
3. 关闭标签页，验证状态丢弃
4. 数据子标签页：筛选、排序、分页
5. 行选中/列选中 + 右键菜单
6. 单元格编辑 + 提交/取消
7. 行删除 + 提交
8. 整列粘贴覆盖
9. 结构子标签页正常显示
10. SQL子标签页执行查询

- [ ] **Step 3: 修复发现的问题**

根据测试结果修复问题。常见问题可能包括：
- `Set` 对象在 Zustand store 中无法正确序列化/响应式 → 使用数组代替，或确保正确创建新实例
- 右键菜单位置计算错误 → 使用 fixed positioning 或 portal
- 筛选 debounce 未实现 → 添加 useDebounce hook
- 分页加载时页码越界 → 添加边界检查

- [ ] **Step 4: Commit 修复**

```bash
git add -A
git commit -m "fix(database): resolve integration issues and type errors"
```

---

## Spec Coverage Checklist

| Spec 需求 | 对应 Task |
|-----------|-----------|
| 菜单更名 "数据库管理" | Task 10 |
| 路由 `/database` | Task 10 |
| TabState 状态模型 | Task 3 |
| 标签页打开/切换/关闭 | Task 3, 4, 8 |
| 数据/结构/SQL 三个子标签 | Task 5, 7, 8 |
| 后端真分页（LIMIT+OFFSET） | Task 2, 11 |
| 列筛选输入框 | Task 5, 6 |
| 排序（正序/倒序/取消） | Task 3, 5, 6 |
| 行持久化选中 + 右键菜单 | Task 6 |
| 列持久化选中 + 右键菜单 | Task 6 |
| 单元格右键（设为NULL、设为筛选项） | Task 6 |
| 整列粘贴覆盖 | Task 6 |
| 删除行标记 pending + 提交 | Task 3, 6 |
| 标签页关闭即丢弃状态 | Task 3 |
| 着色仅会话内持久 | Task 3 (Set 在内存中) |
| COUNT(*) 获取总行数 | Task 11 |
| 筛选 debounce | Task 6 (ResultTable 中实现) |
