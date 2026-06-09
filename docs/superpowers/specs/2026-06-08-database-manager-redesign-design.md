# 数据库管理器重设计文档

## 1. 概述

对现有 MySQL 管理模块进行全面重设计，引入 Navicat 风格的标签页交互、后端真分页、行/列持久化选中、右键菜单等功能，提升数据库管理体验。

## 2. 设计决策

- **菜单更名**：侧栏菜单从 "MySQL" 改为 "数据库管理"，路由从 `/mysql` 改为 `/database`。新增连接对话框标题保持 "添加 MySQL 连接"。
- **标签页关闭即丢弃**：关闭标签页后清除该表的所有状态（筛选、排序、分页、选中）。
- **行/列着色仅会话内持久**：切换标签页后保留，但刷新页面后重置。
- **删除行标记 pending**：和单元格编辑共用 `pendingEdits` 机制，提交时批量执行。
- **整列粘贴覆盖**：在表头列名上右键选择"粘贴覆盖"，将剪贴板内容按行覆盖到该列所有行。
- **后端真分页**：使用 `LIMIT` + `OFFSET` 实现，额外查询 `COUNT(*)` 获取总行数。

## 3. 整体架构

### 3.1 状态模型（Store 层）

新增 `TabState` 接口，每个打开的标签页独立管理自己的完整状态：

```typescript
type PendingEdit =
  | { type: "cell"; rowIndex: number; colName: string; oldValue: unknown; newValue: string }
  | { type: "delete"; rowIndex: number };

interface TabState {
  table: string;
  subTab: "data" | "structure" | "sql";
  // data subtab state
  filters: Record<string, string>;      // 列名 → 筛选值
  sortCol: string | null;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  selectedRows: Set<number>;            // 全局行索引（基于 OFFSET 的绝对行号）
  selectedCols: Set<string>;            // 列名
  pendingEdits: Map<string, PendingEdit>; // 单元格修改 + 行删除标记
  // data cache
  queryResult: MysqlQueryResult | null;
  tableStructure: TableStructure | null;
  totalRows: number;                    // COUNT(*) 结果，用于计算总页数
}
```

Store 新增字段：
- `openTabs: TabState[]` — 所有打开的标签页
- `activeTabIndex: number` — 当前激活的标签页索引

原有的 `selectedTable`、`viewMode`、`queryResult`、`tableStructure`、`pageSize`、`pendingEdits` 等状态迁移到 `TabState` 中管理，全局 store 只保留连接管理相关状态。

### 3.2 组件结构

```
DatabaseManager.tsx (原 Mysql.tsx)
├── TabBar.tsx                    # 标签栏：显示所有打开的标签，可关闭/切换
│   └── TabItem.tsx               # 单个标签项
├── TabContent.tsx                # 标签内容容器
│   ├── DataTab.tsx               # 数据子标签页
│   │   ├── DataToolbar.tsx       # 工具栏：SQL编辑器展开、表名、修改计数、提交/取消
│   │   ├── DataTable.tsx         # 数据表格
│   │   │   ├── TableHeader.tsx   # 表头：列名 + 筛选输入框
│   │   │   ├── TableBody.tsx     # 表格行
│   │   │   └── TableCell.tsx     # 单元格（含编辑器）
│   │   └── Pagination.tsx        # 分页控件
│   ├── StructureTab.tsx          # 结构子标签页（复用 TableStructureView）
│   └── SqlTab.tsx                # SQL子标签页（复用 QueryEditor）
└── ObjectTree.tsx                # 左侧对象树（基本不变）
```

## 4. 标签页系统

### 4.1 打开标签

- 点击 ObjectTree 中的表名：打开一个新标签（如果已打开则切换到该标签）
- 每个标签显示表名，可关闭

### 4.2 切换标签

- 点击标签项切换到对应标签
- 切换时完整恢复该标签的所有状态（筛选、排序、分页、选中行/列、pending edits）

### 4.3 关闭标签

- 点击标签上的关闭按钮
- 关闭后丢弃该标签的所有状态
- 关闭最后一个标签时显示空状态提示

### 4.4 标签栏布局

- 标签栏位于右侧内容区顶部
- 标签项显示表名，过长时截断
- 当前激活标签高亮显示

## 5. 三个子标签页

### 5.1 数据子标签页

**布局**：
```
┌────────────────────────────────────────────┐
│ [SQL▼] 表名          [提交] [取消]           │  ← 工具栏
├────────────────────────────────────────────┤
│ 列名1      │ 列名2      │ 列名3      │ ...   │  ← 表头
│ [筛选输入] │ [筛选输入] │ [筛选输入] │ ...   │  ← 筛选行
├────────────┼────────────┼────────────┼───────┤
│ 数据1      │ 数据2      │ 数据3      │ ...   │  ← 数据行
│ 数据1      │ 数据2      │ 数据3      │ ...   │
├────────────┴────────────┴────────────┴───────┤
│ 50条/页  [◀]  第 2 / 20 页  [▶]             │  ← 分页
└────────────────────────────────────────────┘
```

**筛选行**：
- 每个列名下方有一个 `<input>` 输入框
- 输入内容实时触发后端筛选
- 输入框右侧有清除按钮（X），点击清空该列筛选
- 筛选条件使用 `LIKE` 模糊匹配（字符串列）或 `=` 精确匹配（数值列）

**分页**：
- 后端真分页：`SELECT * FROM \`table\` WHERE ... ORDER BY ... LIMIT ${pageSize} OFFSET ${page * pageSize}`
- 首次加载时额外执行 `SELECT COUNT(*) FROM \`table\` WHERE ...` 获取总行数
- 分页控件位于表格底部：每页条数选择器（10/50/100/200/500/1000）、上一页/下一页按钮、当前页码 / 总页数
- 切换页码时重新加载数据，保留当前筛选和排序条件

**排序**：
- 点击列名切换排序：第一次点击正序，第二次倒序，第三次取消排序
- 排序图标显示在列名右侧
- 排序和筛选组合使用：`WHERE ... ORDER BY ... LIMIT ... OFFSET ...`

### 5.2 结构子标签页

- 复用现有 `TableStructureView`
- 每个标签独立缓存各自的 `tableStructure`
- 展示字段信息和索引信息

### 5.3 SQL子标签页

- 复用现有 `QueryEditor`
- 在每个标签内独立渲染
- 执行结果展示在当前标签的数据区域（临时切换到数据视图显示结果）
- SQL 编辑器内容随标签持久化

## 6. 行/列交互

### 6.1 行选中

- **点击行**：选中/取消选中整行（使用 Ctrl/Cmd 键可多选）
- **选中样式**：`bg-primary/10` 作为持久化背景色
- **右键菜单**：
  - 删除行（标记为 pending delete）
  - 复制行数据（JSON 格式）
  - 复制行数据（CSV 格式）

### 6.2 列选中

- **点击列名**：选中/取消选中整列
- **选中样式**：`bg-primary/10` 作为持久化背景色
- **右键菜单**：
  - 正序排列
  - 倒序排列
  - 清除所有筛选
  - 粘贴覆盖（整列粘贴）

### 6.3 单元格右键

- **设置为 NULL**：将该单元格值设为 NULL，标记为 pending edit
- **设置为字段筛选项**：将当前单元格值填入该列的筛选输入框，触发筛选

### 6.4 整列粘贴覆盖

1. 用户从外部（如 Excel、文本编辑器）复制一列数据到剪贴板
2. 在目标列的列名上右键 → "粘贴覆盖"
3. 读取剪贴板内容，按行分割
4. 逐行覆盖当前列对应行的 pendingEdits
5. 超出表格行数的部分忽略
6. 剪贴板行数少于表格行数的部分保持原值

## 7. 提交/取消机制

### 7.1 Pending Edits（每标签独立）

原有全局 `pendingEdits` Map 迁移到 `TabState` 中，每个标签页独立管理自己的 pending edits：

```typescript
pendingEdits: Map<string, PendingEdit>;  // key: `${rowIndex}:${colName}` 或 `${rowIndex}:__delete__`
```

### 7.2 提交流程

1. 收集当前标签的所有 pending edits
2. 先执行 DELETE 操作（按行分组）
3. 再执行 UPDATE 操作（按行分组）
4. 使用事务包裹，任一失败则全部回滚
5. 成功后刷新当前标签数据，清空 pending edits
6. 失败时显示错误信息，保留 pending edits

### 7.3 取消流程

- 清空当前标签的所有 pending edits 和 pending deletes
- 恢复原始数据（重新加载当前页）

## 8. 后端 API 变更

### 8.1 新增/修改的命令

```typescript
// 获取表数据（带分页、筛选、排序）
interface LoadTableDataRequest {
  connection_id: number;
  database: string;
  table: string;
  page: number;
  page_size: number;
  filters: Record<string, string>;  // 列名 → 筛选值
  sort_col: string | null;
  sort_dir: "asc" | "desc" | null;
}

interface LoadTableDataResponse {
  columns: string[];
  rows: any[][];
  total_rows: number;
  execution_time_ms: number;
}
```

### 8.2 现有命令调整

- `loadTableData`：改为支持分页参数，返回包含 `total_rows`
- `executeMysqlQuery`：保持不变，SQL 标签页直接使用

## 9. 错误处理

- **筛选错误**：某列筛选条件导致 SQL 错误时，显示错误提示，保留其他列的筛选条件
- **分页错误**：页码超出范围时自动调整到最后一页
- **提交错误**：DELETE/UPDATE 失败时显示具体错误，保留 pending edits 供用户修正
- **粘贴错误**：剪贴板内容格式不正确时显示错误提示

## 10. 性能考虑

- 筛选输入框使用 debounce（300ms）避免频繁请求
- 分页数据按需加载，不缓存所有页
- 标签切换时如果数据未修改则不重新加载
- COUNT(*) 查询仅在筛选条件变化时执行

## 11. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/mysql.ts` | 大幅修改 | 引入 TabState，重构状态管理 |
| `src/pages/Mysql.tsx` | 重写 | 改为 DatabaseManager，标签页容器 |
| `src/components/mysql/TabBar.tsx` | 新增 | 标签栏组件 |
| `src/components/mysql/TabContent.tsx` | 新增 | 标签内容容器 |
| `src/components/mysql/DataTab.tsx` | 新增 | 数据子标签页 |
| `src/components/mysql/StructureTab.tsx` | 新增 | 结构子标签页包装 |
| `src/components/mysql/SqlTab.tsx` | 新增 | SQL子标签页包装 |
| `src/components/mysql/ResultTable.tsx` | 大幅修改 | 支持行/列选中、筛选行、右键菜单 |
| `src/components/mysql/TableStructureView.tsx` | 小幅修改 | 适配标签页上下文 |
| `src/components/mysql/QueryEditor.tsx` | 小幅修改 | 适配标签页上下文 |
| `src/components/mysql/ObjectTree.tsx` | 小幅修改 | 点击表名改为打开标签 |
| `src/components/Layout.tsx` | 修改 | 菜单名改为"数据库管理"，路由改为 `/database` |
| `src/App.tsx` | 修改 | 路由改为 `/database` |
| `src/types/index.ts` | 修改 | 新增 TabState 相关类型 |
| `src/lib/mysql-api.ts` | 修改 | 新增带分页/筛选/排序的 loadTableData API |
