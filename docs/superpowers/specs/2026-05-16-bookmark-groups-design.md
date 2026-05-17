# 书签分组管理 - 设计文档

## 目标

将现有的书签 "category" 文本字段升级为独立的 `groups` 表，支持新建/重命名/删除分组，书签可分配到分组下，书签页面默认列表视图。

## 架构

- **后端**：新建 `groups` 独立表，通过 `group_id` 外键关联 bookmarks
- **前端**：左侧分组导航面板 + 右侧书签列表/网格视图，默认列表视图
- **数据迁移**：自动将现有 `category` 值迁移为分组

## 技术栈

Tauri (Rust + SQLite) + React + TypeScript + Tailwind CSS + shadcn/ui

---

## 数据模型

### 新增表 `groups`

```sql
CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### bookmarks 表变更

```sql
ALTER TABLE bookmarks ADD COLUMN group_id INTEGER;
CREATE INDEX idx_bookmarks_group_id ON bookmarks(group_id);
```

**关系说明：**
- `groups` 独立管理分组，包含名称和排序字段
- `bookmarks.group_id` 外键关联分组（nullable，未分组的书签 group_id 为 null）
- 重命名分组只需改 `groups` 表一条记录
- 排序通过 `sort_order` 控制

**数据迁移：**
- 初始化时自动迁移（如果 `group_id` 列不存在）
- 将现有书签的 `category` 值自动转为分组（去重后插入 groups 表）
- 将每个书签的 category 映射到对应的 group_id

---

## 后端 API

### 新增 Rust 类型

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}
```

### 新增命令

```rust
// 分组 CRUD
list_groups() -> Result<Vec<Group>, String>
create_group(name: String, sort_order: i64) -> Result<i64, String>
update_group(id: i64, name: String, sort_order: i64) -> Result<(), String>
delete_group(id: i64) -> Result<(), String>

// 书签命令更新
// list_bookmarks 改为支持按 group_id 过滤
// create_bookmark / update_bookmark 新增 group_id 参数
```

### 数据库方法

```rust
// groups
list_groups() -> Result<Vec<Group>>
create_group(name: &str, sort_order: i64) -> Result<i64>
update_group(id: i64, name: &str, sort_order: i64) -> Result<()>
delete_group(id: i64) -> Result<()>

// bookmarks 更新
list_bookmarks(group_id: Option<i64>) -> Result<Vec<Bookmark>>
// create_bookmark / update_bookmark 新增 group_id 参数
```

### 数据迁移方法

在 `Database::init()` 中自动执行：
1. 检查 `group_id` 列是否存在，不存在则添加
2. 检查 `groups` 表是否存在，不存在则创建
3. 将 bookmarks 表中现有的 category 值去重后插入 groups 表
4. 将每个书签的 category 映射到对应的 group_id
5. 删除 bookmarks 表的 category 列索引

---

## 前端类型

```typescript
export interface Group {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: number;
  name: string;
  url: string;
  description: string;
  // category: string; // deprecated, replaced by group_id
  group_id: number | null;
  icon: string;
  service_id: number | null;
  health_check_url: string;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}
```

---

## UI 设计

### 页面布局

```
+--------------------------------------------------+
| 服务导航                              [添加书签] |
+--------------------------------------------------+
| 分组列表  | [搜索框]           [列表] [网格]      |
| ├ 全部(12)                                       |
| ├ 开发工具(4)    ✏️ 🗑️                            |
| ├ 数据库(2)                                       |
| ├ AI服务(3)                                       |
| ├ [+ 新建分组]                                    |
|           |                                      |
|           | [书签列表/网格内容...]                 |
+--------------------------------------------------+
```

### 交互细节

| 操作 | 交互方式 |
|---|---|
| **新建分组** | 点击侧边栏底部的 "+ 新建分组"，弹出小输入框 |
| **重命名分组** | 分组项悬停显示编辑图标，点击后名称变输入框，失焦/回车保存 |
| **删除分组** | 分组项悬停显示删除图标，点击确认："该分组下的书签将变为未分组" |
| **分配分组** | 编辑书签时，"分类"字段改为下拉选择（未分组 + 所有分组） |
| **筛选** | 点击分组即筛选显示该分组下的书签 |
| **视图切换** | 默认列表视图，保留网格视图切换按钮 |

### 空状态

- 无分组时显示"还没有分组，创建第一个分组"
- 无书签时保持现有空状态

---

## API 接口 (前端)

```typescript
// api.ts 新增
export async function listGroups(): Promise<Group[]>;
export async function createGroup(data: Omit<Group, "id" | "created_at" | "updated_at">): Promise<number>;
export async function updateGroup(data: Group): Promise<void>;
export async function deleteGroup(id: number): Promise<void>;
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/types/index.ts` | 修改 | 新增 Group 接口，更新 Bookmark 接口 |
| `src/lib/api.ts` | 修改 | 新增分组 API |
| `src/pages/Bookmarks.tsx` | 修改 | 重写书签页面，添加分组管理 |
| `src-tauri/src/database.rs` | 修改 | 新增 groups 表，迁移逻辑 |
| `src-tauri/src/commands.rs` | 修改 | 新增分组命令 |
| `src-tauri/src/main.rs` | 修改 | 注册新命令 |
