# 书签分组管理 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将书签页面默认改为列表视图，新增独立的分组管理功能，支持新建/重命名/删除分组，书签可分配到分组。

**Architecture:** 后端新增 `groups` 独立表 + `bookmarks.group_id` 外键，前端书签页面重构为左侧分组导航 + 右侧书签列表视图。

**Tech Stack:** Tauri (Rust + SQLite) + React + TypeScript + Tailwind CSS + shadcn/ui

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src-tauri/src/database.rs` | 修改 | 新增 groups 表结构、Group 类型、分组 CRUD、数据迁移 |
| `src-tauri/src/commands.rs` | 修改 | 新增分组命令 (list/create/update/delete_groups) |
| `src-tauri/src/main.rs` | 修改 | 注册新分组命令到 invoke_handler |
| `src/types/index.ts` | 修改 | 新增 Group 接口，更新 Bookmark 接口（group_id 替代 category） |
| `src/lib/api.ts` | 修改 | 新增分组 API 函数 |
| `src/pages/Bookmarks.tsx` | 重写 | 重构书签页面：侧边分组导航 + 默认列表视图 + 分组管理 |

---

## Task 1: 后端数据库 - groups 表结构 + Group 类型

**Files:**
- Modify: `src-tauri/src/database.rs`

- [ ] **Step 1: 新增 Group 结构体**

在 `database.rs` 中 `Bookmark` 结构体之后、Database impl 之前添加：

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

- [ ] **Step 2: 修改 init() 方法 - 创建 groups 表**

在 `init()` 方法中现有表创建之后添加：

```rust
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 3: 修改 init() 方法 - 添加 group_id 列 + 数据迁移**

在 init() 方法末尾（现有 ALTER TABLE 之后）添加数据迁移逻辑：

```rust
// Add group_id column if it doesn't exist
let _ = conn.execute("ALTER TABLE bookmarks ADD COLUMN group_id INTEGER", []);
let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_group_id ON bookmarks(group_id)", []);

// Migrate existing category values to groups table
let categories_result: Result<Vec<String>> = conn
    .prepare("SELECT DISTINCT category FROM bookmarks WHERE category IS NOT NULL AND category != '' AND category != 'default'")?
    .query_map([], |row| row.get(0))?
    .collect();

if let Ok(categories) = categories_result {
    for cat in categories {
        // Check if group already exists
        let exists: Result<i64> = conn.query_row(
            "SELECT COUNT(*) FROM groups WHERE name = ?1",
            params![&cat],
            |row| row.get(0),
        );
        if let Ok(0) = exists {
            // Insert new group
            let _ = conn.execute(
                "INSERT INTO groups (name, sort_order) VALUES (?1, ?2)",
                params![&cat, 0i64],
            );
        }
    }

    // Map category to group_id for existing bookmarks
    let _ = conn.execute(
        "UPDATE bookmarks SET group_id = (
            SELECT id FROM groups WHERE groups.name = bookmarks.category LIMIT 1
        ) WHERE group_id IS NULL AND category IS NOT NULL AND category != '' AND category != 'default'",
        [],
    );
}
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/database.rs
git commit -m "feat: add groups table structure and data migration"
```

---

## Task 2: 后端数据库 - 分组 CRUD 方法

**Files:**
- Modify: `src-tauri/src/database.rs`

- [ ] **Step 1: 新增 list_groups 方法**

在 Bookmark CRUD 之前添加：

```rust
// === Group CRUD ===

pub fn list_groups(&self) -> Result<Vec<Group>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order, created_at, updated_at FROM groups ORDER BY sort_order, name"
    )?;
    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(groups)
}
```

- [ ] **Step 2: 新增 create_group 方法**

```rust
pub fn create_group(&self, name: &str, sort_order: i64) -> Result<i64> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO groups (name, sort_order) VALUES (?1, ?2)",
        params![name, sort_order],
    )?;
    Ok(conn.last_insert_rowid())
}
```

- [ ] **Step 3: 新增 update_group 方法**

```rust
pub fn update_group(&self, id: i64, name: &str, sort_order: i64) -> Result<()> {
    self.conn.lock().unwrap().execute(
        "UPDATE groups SET name = ?1, sort_order = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
        params![name, sort_order, id],
    )?;
    Ok(())
}
```

- [ ] **Step 4: 新增 delete_group 方法**

```rust
pub fn delete_group(&self, id: i64) -> Result<()> {
    let conn = self.conn.lock().unwrap();
    // Set group_id to NULL for bookmarks in this group
    conn.execute(
        "UPDATE bookmarks SET group_id = NULL WHERE group_id = ?1",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM groups WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}
```

- [ ] **Step 5: 修改 Bookmark 结构体 - 新增 group_id 字段**

在 `Bookmark` 结构体中，将 `category: String` 替换为 `group_id: Option<i64>`：

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub service_id: Option<i64>,
    pub health_check_url: String,
    pub is_online: bool,
    pub created_at: String,
    pub updated_at: String,
}
```

- [ ] **Step 6: 修改 list_bookmarks - 新增 group_id 过滤**

将 `list_bookmarks` 方法改为支持按 group_id 过滤：

```rust
pub fn list_bookmarks(&self, group_id: Option<i64>) -> Result<Vec<Bookmark>> {
    let conn = self.conn.lock().unwrap();
    let query = if let Some(gid) = group_id {
        "SELECT id, name, url, description, group_id, icon, service_id, health_check_url, is_online, created_at, updated_at FROM bookmarks WHERE group_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, name, url, description, group_id, icon, service_id, health_check_url, is_online, created_at, updated_at FROM bookmarks ORDER BY created_at DESC"
    };
    let mut stmt = conn.prepare(query)?;
    let bookmarks = if let Some(gid) = group_id {
        stmt
            .query_map(params![gid], |row| {
                Ok(Bookmark {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    description: row.get(3)?,
                    group_id: row.get(4)?,
                    icon: row.get(5)?,
                    service_id: row.get(6)?,
                    health_check_url: row.get(7)?,
                    is_online: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?
    } else {
        stmt
            .query_map([], |row| {
                Ok(Bookmark {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    url: row.get(2)?,
                    description: row.get(3)?,
                    group_id: row.get(4)?,
                    icon: row.get(5)?,
                    service_id: row.get(6)?,
                    health_check_url: row.get(7)?,
                    is_online: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?
    };
    Ok(bookmarks)
}
```

- [ ] **Step 7: 修改 create_bookmark - 新增 group_id 参数**

```rust
pub fn create_bookmark(
    &self,
    name: &str,
    url: &str,
    description: &str,
    group_id: Option<i64>,
    icon: &str,
    service_id: Option<i64>,
    health_check_url: &str,
) -> Result<i64> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO bookmarks (name, url, description, group_id, icon, service_id, health_check_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![name, url, description, group_id, icon, service_id, health_check_url],
    )?;
    Ok(conn.last_insert_rowid())
}
```

- [ ] **Step 8: 修改 update_bookmark - 新增 group_id 参数**

```rust
pub fn update_bookmark(
    &self,
    id: i64,
    name: &str,
    url: &str,
    description: &str,
    group_id: Option<i64>,
    icon: &str,
    health_check_url: &str,
) -> Result<()> {
    self.conn.lock().unwrap().execute(
        "UPDATE bookmarks SET name = ?1, url = ?2, description = ?3, group_id = ?4, icon = ?5, health_check_url = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
        params![name, url, description, group_id, icon, health_check_url, id],
    )?;
    Ok(())
}
```

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/database.rs
git commit -m "feat: add group CRUD and update bookmark to use group_id"
```

---

## Task 3: 后端命令 - 分组 CRUD 命令

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 新增分组命令函数**

在 Bookmark Commands 部分（// === Bookmark Commands ===）之前添加：

```rust
// === Group Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
}

#[tauri::command]
pub fn list_groups(state: State<AppState>) -> Result<Vec<database::Group>, String> {
    state.db.list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(
    state: State<AppState>,
    req: CreateGroupRequest,
) -> Result<i64, String> {
    state
        .db
        .create_group(&req.name, req.sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    state: State<AppState>,
    req: UpdateGroupRequest,
) -> Result<(), String> {
    state
        .db
        .update_group(req.id, &req.name, req.sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_group(id).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 修改 list_bookmarks 命令**

将 `list_bookmarks` 改为支持可选的 group_id 过滤：

```rust
#[tauri::command]
pub fn list_bookmarks(
    state: State<AppState>,
    group_id: Option<i64>,
) -> Result<Vec<database::Bookmark>, String> {
    state.db.list_bookmarks(group_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 修改 CreateBookmarkRequest - 新增 group_id**

```rust
#[derive(Debug, Deserialize)]
pub struct CreateBookmarkRequest {
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub service_id: Option<i64>,
    pub health_check_url: String,
}
```

- [ ] **Step 4: 修改 create_bookmark 命令**

```rust
#[tauri::command]
pub fn create_bookmark(
    state: State<AppState>,
    req: CreateBookmarkRequest,
) -> Result<i64, String> {
    state
        .db
        .create_bookmark(
            &req.name,
            &req.url,
            &req.description,
            req.group_id,
            &req.icon,
            req.service_id,
            &req.health_check_url,
        )
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 5: 修改 UpdateBookmarkRequest - 新增 group_id**

```rust
#[derive(Debug, Deserialize)]
pub struct UpdateBookmarkRequest {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub health_check_url: String,
}
```

- [ ] **Step 6: 修改 update_bookmark 命令**

```rust
#[tauri::command]
pub fn update_bookmark(
    state: State<AppState>,
    req: UpdateBookmarkRequest,
) -> Result<(), String> {
    state
        .db
        .update_bookmark(
            req.id,
            &req.name,
            &req.url,
            &req.description,
            req.group_id,
            &req.icon,
            &req.health_check_url,
        )
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: add group commands and update bookmark commands for group_id"
```

---

## Task 4: 后端 - main.rs 注册新命令

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 在 invoke_handler 中添加分组命令**

在 Bookmark commands 之前添加：

```rust
// Group commands
commands::list_groups,
commands::create_group,
commands::update_group,
commands::delete_group,
```

- [ ] **Step 2: 提交**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: register group commands in main.rs"
```

---

## Task 5: 前端类型 - 更新 Bookmark + 新增 Group

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 在 Bookmark 接口之前添加 Group 接口**

```typescript
export interface Group {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: 修改 Bookmark 接口**

将 `category: string;` 替换为 `group_id: number | null;`：

```typescript
export interface Bookmark {
  id: number;
  name: string;
  url: string;
  description: string;
  group_id: number | null;
  icon: string;
  service_id: number | null;
  health_check_url: string;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts
git commit -m "feat: add Group type, update Bookmark to use group_id"
```

---

## Task 6: 前端 API - 新增分组 API

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 导入 Group 类型**

修改 import：

```typescript
import type { Service, DockerContainer, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo } from "@/types";
```

- [ ] **Step 2: 在书签管理部分新增分组 API**

在 `// ===== 书签管理 =====` 之前添加：

```typescript
// ===== 分组管理 =====

export async function listGroups(): Promise<Group[]> {
  return invoke("list_groups");
}

export async function createGroup(
  data: Omit<Group, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_group", { req: data });
}

export async function updateGroup(data: Group): Promise<void> {
  return invoke("update_group", { req: data });
}

export async function deleteGroup(id: number): Promise<void> {
  return invoke("delete_group", { id });
}
```

- [ ] **Step 3: 修改 createBookmark - 使用 group_id**

```typescript
export async function createBookmark(
  data: Omit<Bookmark, "id" | "is_online" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_bookmark", { req: data });
}
```

- [ ] **Step 4: 修改 updateBookmark - 使用 group_id**

```typescript
export async function updateBookmark(
  data: Partial<Bookmark> & { id: number }
): Promise<void> {
  return invoke("update_bookmark", {
    req: {
      id: data.id,
      name: data.name,
      url: data.url,
      description: data.description,
      group_id: data.group_id,
      icon: data.icon,
      health_check_url: data.health_check_url,
      service_id: data.service_id,
    },
  });
}
```

- [ ] **Step 5: 修改 listBookmarks - 支持 group_id 过滤**

```typescript
export async function listBookmarks(groupId?: number): Promise<Bookmark[]> {
  return invoke("list_bookmarks", { groupId });
}
```

- [ ] **Step 6: 提交**

```bash
git add src/lib/api.ts
git commit -m "feat: add group API functions, update bookmark API for group_id"
```

---

## Task 7: 前端页面 - 重构 Bookmarks.tsx

**Files:**
- Modify: `src/pages/Bookmarks.tsx`

- [ ] **Step 1: 修改导入**

在现有导入中添加：`Folder, X`：

```typescript
import {
  LayoutDashboard, Server, Database, Globe, Terminal,
  Cpu, HardDrive, Code, Box, Layers, Zap, Shield,
  Settings, FileText, Link, BookOpen, BarChart3, FlaskConical,
  Cloud, MessageSquare, Image, Music, Video, Mail, Calendar,
  Plus, Search, Grid3X3, List, ExternalLink, Trash2, Edit, Bookmark,
  Folder, X, type LucideIcon
} from "lucide-react";
```

更新类型导入：

```typescript
import type { Bookmark as BookmarkType, Group } from "@/types";
```

更新 API 导入：

```typescript
import {
  listBookmarks,
  createBookmark,
  updateBookmark,
  deleteBookmark,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  listServices,
} from "@/lib/api";
```

- [ ] **Step 2: 修改状态管理**

将 `activeCategory` 替换为 `activeGroupId`：

```typescript
// Filter & view
const [searchQuery, setSearchQuery] = useState("");
const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
const [viewMode, setViewMode] = useState<ViewMode>("list"); // 默认列表视图
```

- [ ] **Step 3: 新增 groups 状态**

```typescript
const [groups, setGroups] = useState<Group[]>([]);
```

- [ ] **Step 4: 修改 formData - category 改为 group_id**

```typescript
const [formData, setFormData] = useState({
  name: "",
  url: "",
  description: "",
  group_id: null as number | null,
  icon: "link",
  service_id: null as number | null,
  health_check_url: "",
});
```

- [ ] **Step 5: 新增分组管理状态**

```typescript
// Group management
const [newGroupName, setNewGroupName] = useState("");
const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
const [editingGroupName, setEditingGroupName] = useState("");
```

- [ ] **Step 6: 修改 loadBookmarks - 支持 group_id 过滤**

```typescript
const loadBookmarks = useCallback(async (groupId?: number) => {
  setLoading(true);
  try {
    const data = await listBookmarks(groupId);
    setBookmarks(data);
  } catch (error) {
    console.error("Failed to load bookmarks:", error);
  } finally {
    setLoading(false);
  }
}, []);
```

- [ ] **Step 7: 新增 loadGroups 方法**

```typescript
const loadGroups = useCallback(async () => {
  try {
    const data = await listGroups();
    setGroups(data);
  } catch (error) {
    console.error("Failed to load groups:", error);
  }
}, []);
```

- [ ] **Step 8: 修改 useEffect 加载数据**

```typescript
useEffect(() => {
  loadGroups();
  loadServices();
}, [loadGroups, loadServices]);

useEffect(() => {
  loadBookmarks(activeGroupId ?? undefined);
}, [loadBookmarks, activeGroupId]);
```

- [ ] **Step 9: 删除 categories 相关的 useMemo**

删除整个 `categories` 和 `categoryCounts` 的 useMemo 块（约 10 行）。

- [ ] **Step 10: 修改 filteredBookmarks - 移除 category 过滤**

```typescript
const filteredBookmarks = useMemo(() => {
  let result = bookmarks;

  // Search filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    result = result.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        (b.description && b.description.toLowerCase().includes(q))
    );
  }

  return result;
}, [bookmarks, searchQuery]);
```

- [ ] **Step 11: 修改 resetForm - category 改为 group_id**

```typescript
const resetForm = () => {
  setFormData({
    name: "",
    url: "",
    description: "",
    group_id: null,
    icon: "link",
    service_id: null,
    health_check_url: "",
  });
  setEditingId(null);
  setDialogMode(null);
};
```

- [ ] **Step 12: 修改 openEditDialog - category 改为 group_id**

```typescript
const openEditDialog = (bookmark: BookmarkType) => {
  setFormData({
    name: bookmark.name,
    url: bookmark.url,
    description: bookmark.description || "",
    group_id: bookmark.group_id,
    icon: bookmark.icon || "link",
    service_id: bookmark.service_id,
    health_check_url: bookmark.health_check_url || "",
  });
  setEditingId(bookmark.id);
  setDialogMode("edit");
  setDialogOpen(true);
};
```

- [ ] **Step 13: 修改 openCreateDialog - 预置当前分组**

```typescript
const openCreateDialog = () => {
  resetForm();
  // 预置当前选中的分组
  setFormData(prev => ({ ...prev, group_id: activeGroupId }));
  setDialogMode("create");
  setDialogOpen(true);
};
```

- [ ] **Step 14: 新增分组管理方法**

```typescript
const handleCreateGroup = async () => {
  if (!newGroupName.trim()) return;
  try {
    await createGroup({ name: newGroupName.trim(), sort_order: groups.length });
    setNewGroupName("");
    loadGroups();
  } catch (error) {
    console.error("Failed to create group:", error);
  }
};

const handleUpdateGroup = async (id: number) => {
  if (!editingGroupName.trim()) return;
  try {
    const group = groups.find(g => g.id === id);
    if (group) {
      await updateGroup({ ...group, name: editingGroupName.trim() });
      setEditingGroupId(null);
      setEditingGroupName("");
      loadGroups();
    }
  } catch (error) {
    console.error("Failed to update group:", error);
  }
};

const handleDeleteGroup = async (id: number) => {
  if (!confirm("确定删除该分组吗？该分组下的书签将变为未分组。")) return;
  try {
    await deleteGroup(id);
    if (activeGroupId === id) {
      setActiveGroupId(null);
    }
    loadGroups();
    loadBookmarks(activeGroupId === id ? undefined : activeGroupId ?? undefined);
  } catch (error) {
    console.error("Failed to delete group:", error);
  }
};
```

- [ ] **Step 15: 修改 GridView 中 category 改为 group 名称**

在 GridView 中，将 Badge 的显示从 `bookmark.category` 改为根据 `group_id` 查找分组名：

由于 GridView 和 ListView 需要访问 groups 数据，需要将它们作为 props 传入或在外部计算显示名。这里选择将 groups 传入：

修改 `BookmarkViewProps`：

```typescript
interface BookmarkViewProps {
  bookmarks: BookmarkType[];
  groups: Group[];
  onOpen: (url: string) => void;
  onEdit: (bm: BookmarkType) => void;
  onDelete: (id: number) => void;
}
```

在 GridView 中，找到 Badge 部分改为：

```tsx
{/* Group */}
<div className="flex justify-center mt-2">
  <Badge variant="secondary" className="text-[10px]">
    {groups.find(g => g.id === bookmark.group_id)?.name || "未分组"}
  </Badge>
</div>
```

在 ListView 中同样修改。

- [ ] **Step 16: 修改主渲染 - 替换 Category filters 为 Group sidebar**

将主 render 中的 category filters 区域替换为侧边栏布局。以下是关键修改：

```tsx
<div className="flex gap-6">
  {/* 左侧分组导航 */}
  <div className="w-48 shrink-0 space-y-2">
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-muted-foreground">分组</h2>
    </div>

    <button
      onClick={() => setActiveGroupId(null)}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
        activeGroupId === null
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between">
        <span>全部</span>
        <span className="text-xs opacity-70">({bookmarks.length})</span>
      </div>
    </button>

    {groups.map((group) => {
      const count = bookmarks.filter(b => b.group_id === group.id).length;
      const isEditing = editingGroupId === group.id;

      return (
        <div key={group.id} className="group relative">
          {isEditing ? (
            <div className="flex items-center gap-1 px-2">
              <Input
                value={editingGroupName}
                onChange={(e) => setEditingGroupName(e.target.value)}
                onBlur={() => handleUpdateGroup(group.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUpdateGroup(group.id);
                  if (e.key === "Escape") {
                    setEditingGroupId(null);
                    setEditingGroupName("");
                  }
                }}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => setActiveGroupId(group.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                activeGroupId === group.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <span className="truncate">{group.name}</span>
              <span className="text-xs opacity-70 ml-1">({count})</span>
            </button>
          )}

          {/* Hover actions */}
          {!isEditing && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingGroupId(group.id);
                  setEditingGroupName(group.name);
                }}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteGroup(group.id);
                }}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          )}
        </div>
      );
    })}

    {/* 新建分组 */}
    <div className="pt-2 border-t">
      <div className="flex items-center gap-1">
        <Input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateGroup();
          }}
          placeholder="新建分组..."
          className="h-8 text-sm"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleCreateGroup}
          disabled={!newGroupName.trim()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>

  {/* 右侧内容 */}
  <div className="flex-1 min-w-0">
    {/* 搜索 + 视图切换 */}
    <div className="flex items-center gap-3 mb-4">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索书签名称、URL..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex items-center border rounded-md overflow-hidden">
        <Button
          variant={viewMode === "list" ? "default" : "ghost"}
          size="icon"
          className="h-9 w-9 rounded-none"
          onClick={() => setViewMode("list")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === "grid" ? "default" : "ghost"}
          size="icon"
          className="h-9 w-9 rounded-none"
          onClick={() => setViewMode("grid")}
        >
          <Grid3X3 className="h-4 w-4" />
        </Button>
      </div>
    </div>

    {/* 内容区域 */}
    {bookmarks.length === 0 ? (
      <EmptyState onCreate={openCreateDialog} />
    ) : filteredBookmarks.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16">
        <Search className="h-10 w-10 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">
          没有找到匹配的书签
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            setSearchQuery("");
          }}
        >
          清除筛选
        </Button>
      </div>
    ) : viewMode === "grid" ? (
      <GridView
        bookmarks={filteredBookmarks}
        groups={groups}
        onOpen={openUrl}
        onEdit={openEditDialog}
        onDelete={handleDelete}
      />
    ) : (
      <ListView
        bookmarks={filteredBookmarks}
        groups={groups}
        onOpen={openUrl}
        onEdit={openEditDialog}
        onDelete={handleDelete}
      />
    )}
  </div>
</div>
```

- [ ] **Step 17: 修改 Dialog 中的 Category 字段为 Group 选择**

将 Dialog 中的 Category 部分替换为 Group 下拉选择：

```tsx
{/* Group */}
<div className="space-y-2">
  <Label>分组</Label>
  <Select
    value={formData.group_id?.toString() || ""}
    onChange={(e) =>
      setFormData({
        ...formData,
        group_id: e.target.value ? Number(e.target.value) : null,
      })
    }
  >
    <option value="">未分组</option>
    {groups.map((g) => (
      <option key={g.id} value={g.id}>
        {g.name}
      </option>
    ))}
  </Select>
</div>
```

- [ ] **Step 18: 提交**

```bash
git add src/pages/Bookmarks.tsx
git commit -m "feat:重构书签页面，左侧分组导航+默认列表视图+分组管理"
```

---

## Task 8: 验证与测试

- [ ] **Step 1: 检查编译**

```bash
cd src-tauri && cargo check
cd .. && npm run build
```

- [ ] **Step 2: 手动测试清单**

启动应用后测试：
- [ ] 书签页面默认显示列表视图
- [ ] 左侧显示分组导航
- [ ] 点击"全部"显示所有书签
- [ ] 点击分组只显示该分组的书签
- [ ] 新建分组功能正常
- [ ] 重命名分组功能正常
- [ ] 删除分组后书签变为未分组
- [ ] 添加书签时可以选择分组
- [ ] 编辑书签时可以修改分组
- [ ] 网格/列表视图切换正常

- [ ] **Step 3: 提交（如有修复）**

```bash
git add .
git commit -m "fix: address compilation and runtime issues"
```

---

## Spec 覆盖检查

| 需求 | 对应任务 |
|---|---|
| 默认列表视图 | Task 7 Step 3 |
| 新建分组 | Task 7 Step 14 |
| 书签可编辑选择分组 | Task 7 Step 17 |
| 独立 groups 表 | Task 1 |
| group_id 外键关联 | Task 2 |
| 数据迁移 | Task 1 Step 3 |
| 分组 CRUD | Task 2 + Task 3 |
| 按分组筛选书签 | Task 7 |

---

## Placeholder 检查

- [x] 无 TBD/TODO
- [x] 无 "add appropriate error handling"
- [x] 无 "similar to Task N"
- [x] 所有步骤包含完整代码
- [x] 所有文件路径精确
