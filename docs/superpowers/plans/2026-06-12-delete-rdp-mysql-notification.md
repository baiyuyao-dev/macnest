# 删除 RDP、MySQL 数据库管理、通知功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 MacNest 中彻底删除 RDP、MySQL 数据库管理、通知三个功能的前端、后端、数据库表及项目依赖。

**Architecture:** 按前端 → 后端 → 依赖 → 验证的顺序分任务删除。前端先移除路由和菜单入口，再删除页面组件与 API；后端先删除独立模块目录，再从 `commands.rs`、`database.rs`、`main.rs` 中移除注册与数据结构；最后清理 Cargo/npm 依赖并运行编译验证。

**Tech Stack:** React + TypeScript + Vite（前端），Rust + Tauri v2（后端），SQLite（本地数据库），pnpm + cargo。

---

## 文件结构变更

### 前端删除文件

- `src/pages/Rdp.tsx`
- `src/pages/DatabaseManager.tsx`
- `src/pages/Notifications.tsx`
- `src/components/rdp/RdpCanvas.tsx`
- `src/components/mysql/BackupDialog.tsx`
- `src/components/mysql/BackupPanel.tsx`
- `src/components/mysql/ConnectionDialog.tsx`
- `src/components/mysql/ConnectionPanel.tsx`
- `src/components/mysql/ErrorBoundary.tsx`
- `src/components/mysql/ObjectTree.tsx`
- `src/components/mysql/QueryEditor.tsx`
- `src/components/mysql/ResultTable.tsx`
- `src/components/mysql/TabBar.tsx`
- `src/components/mysql/TableStructureView.tsx`
- `src/lib/mysql-api.ts`
- `src/lib/notification.tsx`
- `src/stores/mysql.ts`

### 前端修改文件

- `src/App.tsx`：移除相关页面 import、路由、`initNotificationListener`
- `src/components/Layout.tsx`：从 `navItems` 移除三个菜单项，清理未使用图标 import
- `src/lib/api.ts`：移除 RDP/通知相关 API 函数与类型 import
- `src/types/index.ts`：移除 RDP/通知/MySQL 类型定义
- `src/pages/Settings.tsx`：移除通知测试区块与相关 hooks/import

### 后端删除文件/目录

- `src-tauri/src/rdp/`（整个目录）
- `src-tauri/src/mysql/`（整个目录）
- `src-tauri/src/notification_scheduler.rs`

### 后端修改文件

- `src-tauri/src/commands.rs`：移除 RDP/通知/MySQL 命令函数与 `use crate::mysql;`
- `src-tauri/src/database.rs`：移除相关 structs/CRUD/CREATE TABLE，添加 DROP TABLE 迁移
- `src-tauri/src/main.rs`：移除模块声明、AppState 字段、命令注册、调度器启动

### 依赖文件

- `src-tauri/Cargo.toml`
- `package.json`

---

## Task 1: 前端路由与菜单清理

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: 修改 `src/App.tsx`**

删除以下 import：

```tsx
import Rdp from "./pages/Rdp";
import DatabaseManager from "./pages/DatabaseManager";
import Notifications from "./pages/Notifications";
import { initNotificationListener } from "./lib/notification";
```

删除 `/rdp`、`/database`、`/notifications` 三条 Route：

```tsx
<Route path="rdp" element={<Rdp />} />
<Route path="database" element={<DatabaseManager />} />
<Route path="notifications" element={<Notifications />} />
```

删除通知监听器 useEffect：

```tsx
// 初始化通知事件监听（后端推送 → 系统通知 + Toast）
useEffect(() => {
  let cleanup: (() => void) | undefined;
  initNotificationListener().then((fn) => {
    cleanup = fn;
  });
  return () => {
    cleanup?.();
  };
}, []);
```

- [ ] **Step 2: 修改 `src/components/Layout.tsx`**

从 `navItems` 数组中删除：

```tsx
{ to: "/rdp", icon: ScreenShare, label: "RDP" },
{ to: "/database", icon: DatabaseIcon, label: "数据库管理" },
{ to: "/notifications", icon: Bell, label: "通知" },
```

从 lucide-react import 中移除 `ScreenShare`、`Bell`、`DatabaseIcon`（确认无其他使用后）。

- [ ] **Step 3: 验证前端 TypeScript 编译**

Run: `pnpm tsc --noEmit`
Expected: 仍可能报错（因为 RDP/数据库/通知页面和 API 仍存在），但路由与菜单相关错误应已消除。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "chore(ui): remove RDP, database, notification routes and menu entries"
```

---

## Task 2: 前端页面、组件、API 删除

**Files:**
- Delete: `src/pages/Rdp.tsx`
- Delete: `src/pages/DatabaseManager.tsx`
- Delete: `src/pages/Notifications.tsx`
- Delete: `src/components/rdp/RdpCanvas.tsx`
- Delete: `src/components/mysql/BackupDialog.tsx`
- Delete: `src/components/mysql/BackupPanel.tsx`
- Delete: `src/components/mysql/ConnectionDialog.tsx`
- Delete: `src/components/mysql/ConnectionPanel.tsx`
- Delete: `src/components/mysql/ErrorBoundary.tsx`
- Delete: `src/components/mysql/ObjectTree.tsx`
- Delete: `src/components/mysql/QueryEditor.tsx`
- Delete: `src/components/mysql/ResultTable.tsx`
- Delete: `src/components/mysql/TabBar.tsx`
- Delete: `src/components/mysql/TableStructureView.tsx`
- Delete: `src/lib/mysql-api.ts`
- Delete: `src/lib/notification.tsx`
- Delete: `src/stores/mysql.ts`

- [ ] **Step 1: 删除上述文件**

Run:

```bash
rm -f src/pages/Rdp.tsx
rm -f src/pages/DatabaseManager.tsx
rm -f src/pages/Notifications.tsx
rm -f src/components/rdp/RdpCanvas.tsx
rm -rf src/components/mysql
rm -f src/lib/mysql-api.ts
rm -f src/lib/notification.tsx
rm -f src/stores/mysql.ts
```

- [ ] **Step 2: 验证删除**

Run: `ls src/components/rdp src/components/mysql src/lib/mysql-api.ts src/lib/notification.tsx src/stores/mysql.ts`
Expected: 文件不存在或目录为空。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(ui): delete RDP, MySQL manager, notification pages, components and API files"
```

---

## Task 3: 前端 API 与类型清理

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: 修改 `src/lib/api.ts`**

从第 4 行的类型 import 中移除 `RdpConnection`、`Notification`、`NotificationLog`：

```tsx
import type { Service, DockerContainer, DockerImage, ContainerInspect, DockerSystemDf, DockerVolume, DockerNetwork, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, CpuDetailedUsage, SshConnection, SftpFile, TransferProgress, LocalFileNode, RemoteSystemInfo } from "@/types";
```

删除 `// ===== RDP 管理 =====` 到 `// ===== 通知管理 =====` 之间的所有函数与类型定义（约第 633-718 行）。

- [ ] **Step 2: 修改 `src/types/index.ts`**

删除以下类型区块：

```ts
// ===== RDP 管理 =====
export interface RdpConnection { ... }

// ===== 通知管理 =====
export interface Notification { ... }
export interface NotificationLog { ... }

// ===== MySQL 管理 =====
export interface MysqlConnection { ... }
export interface MysqlConnectionConfig { ... }
export interface DatabaseInfo { ... }
export interface TableInfo { ... }
export interface ViewInfo { ... }
export interface TriggerInfo { ... }
export interface FunctionInfo { ... }
export interface EventInfo { ... }
export interface ColumnInfo { ... }
export interface IndexInfo { ... }
export interface TableStructure { ... }
export interface MysqlQueryResult { ... }
export interface MysqlBackupTask { ... }
export type MysqlObjectType = ...
export interface MysqlObject { ... }

// ===== 数据库管理器标签页状态 =====
export type PendingEdit = ...
export interface TabState { ... }
export interface LoadTableDataRequest { ... }
export interface LoadTableDataResponse { ... }
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `pnpm tsc --noEmit`
Expected: 可能仍有 `Settings.tsx` 相关错误，但 `api.ts` 与 `types/index.ts` 应无残留引用错误。

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/types/index.ts
git commit -m "chore(ui): remove RDP, MySQL, notification types and API bindings"
```

---

## Task 4: Settings.tsx 通知测试清理

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: 修改 import**

删除整行：

```tsx
import { notify, notifyThrottled, initNotificationPermission } from "@/lib/notification";
import { Bell, BellRing, BellDot, Megaphone, FolderOpen, RotateCcw } from "lucide-react";
```

`FolderOpen` 在文件中无其他使用。

- [ ] **Step 2: 移除 notification 相关 state**

删除以下 state 声明（约第 41-44 行）：

```tsx
const [notifPermission, setNotifPermission] = useState<boolean | null>(null);
const [appPath, setAppPath] = useState<string>("");
const [inApplications, setInApplications] = useState<boolean | null>(null);
const [reinstalling, setReinstalling] = useState(false);
```

- [ ] **Step 3: 移除 notification 相关 useEffect 逻辑**

删除 `useEffect` 中的以下内容：

```tsx
// 初始化时检查通知权限
initNotificationPermission().then((granted) => {
  setNotifPermission(granted);
}).catch(() => {
  setNotifPermission(false);
});
// 获取应用路径和安装状态
import("@tauri-apps/api/core").then(({ invoke }) => {
  invoke<string>("get_app_path").then(setAppPath).catch(() => setAppPath("unknown"));
  invoke<boolean>("is_in_applications").then(setInApplications).catch(() => setInApplications(null));
});
```

- [ ] **Step 4: 移除通知测试 UI 区块**

删除 `{/* 通知测试 */}` 到 `{/* 关于 */}` 之间的整个 `<div className="card-macos ...">...</div>` 区块（约第 374-562 行）。

- [ ] **Step 5: 验证 TypeScript 编译**

Run: `pnpm tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "chore(ui): remove notification test section from Settings"
```

---

## Task 5: 后端模块删除

**Files:**
- Delete: `src-tauri/src/rdp/`
- Delete: `src-tauri/src/mysql/`
- Delete: `src-tauri/src/notification_scheduler.rs`

- [ ] **Step 1: 删除后端模块**

Run:

```bash
rm -rf src-tauri/src/rdp
rm -rf src-tauri/src/mysql
rm -f src-tauri/src/notification_scheduler.rs
```

- [ ] **Step 2: 验证删除**

Run: `ls src-tauri/src/rdp src-tauri/src/mysql src-tauri/src/notification_scheduler.rs`
Expected: 不存在。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(rust): delete rdp, mysql, notification_scheduler backend modules"
```

---

## Task 6: commands.rs 清理

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 移除 `mysql` 模块 import**

删除第 8 行：

```rust
use crate::mysql;
```

- [ ] **Step 2: 移除 RDP 命令区块**

删除 `// === RDP Commands ===`（第 2138 行）到 `// === Notification Commands ===`（第 2331 行）之前的全部内容，即第 2138-2319 行。

- [ ] **Step 3: 移除通知命令区块**

删除 `// === Notification Commands ===`（第 2331 行）到 `// === MySQL Commands ===`（第 2526 行）之前的全部内容，即第 2331-2524 行。

- [ ] **Step 4: 移除 MySQL 命令区块**

删除 `// === MySQL Commands ===`（第 2526 行）到文件末尾（第 2734 行）的全部内容，即第 2526-2734 行。

- [ ] **Step 5: 检查并删除 `chrono` 相关引用（若不再使用）**

删除后，检查 `commands.rs` 中是否还有 `chrono::` 引用。当前文件仅剩 `dismiss_notification_today`（第 2519 行）和 `mysql_dump_table`（第 2699 行）使用 `chrono::Local::now()`，这两个函数均已删除，因此 `chrono` 引用应自然消失。

- [ ] **Step 6: 运行 cargo check**

Run: `cd src-tauri && cargo check`
Expected: 仍可能报错（main.rs 与 database.rs 尚未清理），但 commands.rs 内部引用错误应已消除。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "chore(rust): remove RDP, MySQL, notification commands from commands.rs"
```

---

## Task 7: database.rs 清理

**Files:**
- Modify: `src-tauri/src/database.rs`

- [ ] **Step 1: 移除相关 structs**

删除以下 struct 定义：

```rust
pub struct RdpConnection { ... }
pub struct Notification { ... }
pub struct NotificationLog { ... }
pub struct MysqlConnection { ... }
pub struct MysqlBackupTask { ... }
```

- [ ] **Step 2: 移除 init() 中的 CREATE TABLE 语句**

删除以下 `CREATE TABLE IF NOT EXISTS` 块：

- `rdp_connections`
- `notifications`
- `notification_logs`
- `notification_dismiss`
- `mysql_connections`
- `mysql_backup_tasks`

以及相关的 `CREATE INDEX` 语句（如 `idx_notification_logs_notification_id`、`idx_notification_logs_triggered_at`、`idx_notification_dismiss_date`）。

- [ ] **Step 3: 移除 CRUD 方法**

删除以下方法：

RDP：
- `create_rdp_connection`
- `list_rdp_connections`
- `get_rdp_connection`
- `update_rdp_connection`
- `delete_rdp_connection`

Notification：
- `create_notification`
- `list_notifications`
- `get_notification`
- `update_notification`
- `toggle_notification`
- `delete_notification`
- `add_notification_log`
- `list_notification_logs`
- `dismiss_notification_for_today`
- `is_notification_dismissed_today`
- `clean_old_notification_dismiss`

MySQL：
- `create_mysql_connection`
- `list_mysql_connections`
- `get_mysql_connection`
- `update_mysql_connection`
- `delete_mysql_connection`
- `create_mysql_backup_task`
- `list_mysql_backup_tasks`
- `update_mysql_backup_task_enabled`
- `update_mysql_backup_task_status`
- `delete_mysql_backup_task`

- [ ] **Step 4: 清理 delete_group 中的 rdp_connections 引用**

在 `delete_group` 方法中删除：

```rust
// Set group_id to NULL for rdp_connections in this group
conn.execute(
    "UPDATE rdp_connections SET group_id = NULL WHERE group_id = ?1",
    params![id],
)?;
```

- [ ] **Step 5: 添加 DROP TABLE 迁移**

在 `init()` 方法末尾、`Ok(())` 之前添加：

```rust
// Migration: drop removed feature tables
let _ = conn.execute_batch(
    "DROP TABLE IF EXISTS rdp_connections;
     DROP TABLE IF EXISTS notification_logs;
     DROP TABLE IF EXISTS notification_dismiss;
     DROP TABLE IF EXISTS notifications;
     DROP TABLE IF EXISTS mysql_backup_tasks;
     DROP TABLE IF EXISTS mysql_connections;"
);
```

- [ ] **Step 6: 运行 cargo check**

Run: `cd src-tauri && cargo check`
Expected: 仍可能因 main.rs 引用报错，但 database.rs 自身应无错误。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/database.rs
git commit -m "chore(rust): remove RDP/MySQL/notification DB structs, CRUD and tables"
```

---

## Task 8: main.rs 清理

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 移除模块声明**

删除：

```rust
mod notification_scheduler;
mod rdp;
mod mysql;
```

- [ ] **Step 2: 移除 AppState 中的 rdp_session_manager**

修改 `AppState` 结构体，删除字段：

```rust
pub rdp_session_manager: rdp::RdpSessionManager,
```

- [ ] **Step 3: 移除 rdp_session_manager 初始化**

在 `setup` 闭包中，删除：

```rust
rdp_session_manager: rdp::RdpSessionManager::new(),
```

- [ ] **Step 4: 移除通知调度器启动**

删除：

```rust
// Start notification scheduler
let db_path_for_scheduler = db_path_str.to_string();
let app_handle_for_scheduler = app_handle.clone();
notification_scheduler::start_scheduler(db_path_for_scheduler, app_handle_for_scheduler);
```

- [ ] **Step 5: 移除 tauri-plugin-notification 初始化**

删除：

```rust
.plugin(tauri_plugin_notification::init())
```

- [ ] **Step 6: 移除 generate_handler! 中的相关命令**

删除以下命令注册：

```rust
// RDP commands
commands::create_rdp_connection,
commands::list_rdp_connections,
commands::update_rdp_connection,
commands::delete_rdp_connection,
commands::rdp_start_session,
commands::rdp_stop_session,
commands::rdp_send_input,
// Notification commands (osascript fallback)
commands::send_osascript_notification,
commands::check_macos_notification_permission,
commands::get_bundle_id,
commands::get_app_path,
commands::is_in_applications,
commands::reinstall_to_applications,
// Notification management commands
commands::create_notification,
commands::list_notifications,
commands::update_notification,
commands::delete_notification,
commands::toggle_notification,
commands::list_notification_logs,
commands::dismiss_notification_today,
// MySQL commands
commands::mysql_create_connection,
commands::mysql_list_connections,
commands::mysql_update_connection,
commands::mysql_delete_connection,
commands::mysql_test_connection,
commands::mysql_connect,
commands::mysql_disconnect,
commands::mysql_switch_database,
commands::mysql_list_databases,
commands::mysql_list_tables,
commands::mysql_list_views,
commands::mysql_list_triggers,
commands::mysql_list_functions,
commands::mysql_list_events,
commands::mysql_get_table_structure,
commands::mysql_execute_query,
commands::mysql_load_table_data_paged,
commands::mysql_create_backup_task,
commands::mysql_list_backup_tasks,
commands::mysql_delete_backup_task,
commands::mysql_toggle_backup_task,
commands::mysql_run_backup_now,
commands::mysql_dump_table,
```

- [ ] **Step 7: 运行 cargo check**

Run: `cd src-tauri && cargo check`
Expected: 可能因依赖项未清理而报未使用依赖警告或错误，但代码引用错误应已消除。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "chore(rust): remove RDP/MySQL/notification wiring from main.rs"
```

---

## Task 9: 依赖清理

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`

- [ ] **Step 1: 修改 `src-tauri/Cargo.toml`**

删除以下依赖：

```toml
tauri-plugin-notification = "2"
```

以及：

```toml
sqlx = { version = "0.8", features = ["runtime-tokio", "mysql", "chrono"] }
cron = "0.15"
```

以及：

```toml
# === URL 编码（RDP URI 构建）===
urlencoding = "2.1"

# === IronRDP（原生 RDP 客户端）===
ironrdp-pdu = "0.8"
ironrdp-connector = "0.9"
ironrdp-session = "0.9"
ironrdp-graphics = "0.8"
ironrdp-blocking = "0.9"
ironrdp = "0.9"
ironrdp-core = "0.2"
tokio-rustls = "0.26"
socket2 = "0.5"
tracing = "0.1"
url = "2.5"
rustls = { version = "0.23", default-features = false, features = ["std", "tls12"] }
webpki-roots = "0.26"
image = { version = "0.25", default-features = false, features = ["png"] }
ureq = { version = "2.12", default-features = false, features = ["tls"] }
x509-cert = "0.2"
```

保留 `chrono`（`process`、`ssh`、`tmux` 仍在使用）。

- [ ] **Step 2: 修改 `package.json`**

删除：

```json
"@tauri-apps/plugin-notification": "^2.0.0",
```

- [ ] **Step 3: 重新生成 lock 文件**

Run:

```bash
cd src-tauri && cargo update
```

Run:

```bash
pnpm install
```

- [ ] **Step 4: 运行 cargo check**

Run: `cd src-tauri && cargo check`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json pnpm-lock.yaml
# 仅当 lock 文件有变更时加入
[ -f pnpm-lock.yaml ] && git add pnpm-lock.yaml
git commit -m "chore(deps): remove unused RDP, MySQL, notification dependencies"
```

---

## Task 10: 最终验证

**Files:**
- 全项目

- [ ] **Step 1: Rust 编译验证**

Run: `cd src-tauri && cargo build`
Expected: 编译成功，无 RDP/MySQL/Notification 相关错误。

- [ ] **Step 2: TypeScript 编译验证**

Run: `pnpm tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 3: Vite 构建验证**

Run: `pnpm vite build`
Expected: 构建成功。

- [ ] **Step 4: 端到端验证**

Run: `pnpm tauri dev`（可选，需要较长时间）
Expected:
- 左侧菜单不再显示 RDP、数据库管理、通知
- 访问 `/rdp`、`/database`、`/notifications` 路由无对应页面
- 应用正常启动无崩溃

- [ ] **Step 5: 数据库表验证**

启动应用后，检查 SQLite 数据库文件（`~/Library/Application Support/com.macnest.app/MacNest.db` 或类似路径），确认以下表已不存在：

- `rdp_connections`
- `notifications`
- `notification_logs`
- `notification_dismiss`
- `mysql_connections`
- `mysql_backup_tasks`

- [ ] **Step 6: Commit 验证结果（如产生变更）**

若验证过程修复了任何遗漏的引用，单独提交：

```bash
git add -A
git commit -m "fix: resolve remaining references after feature removal"
```

---

## Self-Review

### 1. Spec coverage

对照设计文档 `docs/superpowers/specs/2026-06-12-delete-rdp-mysql-notification-design.md`：

- 前端页面/组件/API/状态删除 → Task 1-4 覆盖
- 路由与菜单移除 → Task 1 覆盖
- 后端模块删除 → Task 5 覆盖
- 后端命令清理 → Task 6 覆盖
- 数据库 structs/CRUD/表清理 → Task 7 覆盖
- main.rs 清理 → Task 8 覆盖
- 依赖清理 → Task 9 覆盖
- 验证 → Task 10 覆盖

### 2. Placeholder scan

计划中无 `TBD`、`TODO`、未填充的代码块或模糊描述。所有步骤均给出具体文件路径、删除内容或命令。

### 3. Type consistency

- 删除前端类型后，`api.ts`、`Settings.tsx` 同步清理对应 import 与函数签名。
- 删除后端 structs 后，`commands.rs` 同步移除对这些 structs 的引用。
- `database.rs` 的 `delete_group` 已移除对 `rdp_connections` 的引用。

### 4. 已知风险

- 删除 `src/lib/notification.tsx` 后，如未来仍需要系统通知需重新实现。
- `Cargo.lock` 和 `pnpm-lock.yaml` 会因依赖删除产生大量变更，需单独审查。
- 数据库 DROP TABLE 会在下次启动时删除用户历史数据，不可逆。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-12-delete-rdp-mysql-notification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
