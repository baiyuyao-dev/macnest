# MySQL 管理模块设计文档

## 1. 概述

在 MacNest 中新增一个 MySQL 数据库管理模块，支持连接管理、数据库对象浏览、SQL 查询执行和定时备份。

## 2. 整体架构

```
前端 (React)
├── MySQL 页面组件 (src/pages/Mysql.tsx)
│   ├── 连接列表面板
│   ├── 数据库对象浏览器（树形）
│   └── 查询编辑器 + 结果表格
│
├── 状态管理 (src/stores/mysql.ts)
│   └── 连接列表、当前选中、查询历史
│
└── API 层 (src/lib/mysql-api.ts)
    └── invoke 调用 Rust 命令

Rust 后端 (src-tauri/src/)
├── mysql/                  # 新增模块
│   ├── mod.rs              # 模块入口，连接池管理
│   ├── connection.rs       # 连接 CRUD、测试连接
│   ├── query.rs            # 查询执行
│   ├── schema.rs           # 元数据获取（表、视图、触发器等）
│   └── backup.rs           # 备份任务、定时调度
│
└── commands.rs             # 注册 Tauri 命令

SQLite 数据库
├── mysql_connections       # 连接配置表
└── mysql_backup_tasks      # 定时备份任务表
```

**数据流**：前端通过 Tauri IPC 调用 Rust 命令 → Rust 使用 sqlx 连接 MySQL → 结构化结果 JSON 返回前端 → 前端渲染表格/树形视图

## 3. 页面布局

三栏式布局（与现有模块一致）：

```
┌──────────────────────────────────────────────────────────────┐
│  MySQL                                                      │
├──────────┬───────────────────────────┬───────────────────────┤
│ 连接列表  │    数据库对象浏览器         │     主内容区          │
│          │    （树形）                 │                       │
│ [+ 添加] │                           │  ┌─────────────────┐  │
│ ┌──────┐ │  ▼ 连接名称               │  │ 查询编辑器       │  │
│ │ conn1│ │    ▼ database1            │  │ (带语法高亮)     │  │
│ │ conn2│ │      ├─ 表                │  │                 │  │
│ └──────┘ │      │   ├─ users         │  │ [执行] [清空]    │  │
│          │      │   └─ orders        │  └─────────────────┘  │
│          │      ├─ 视图              │  ┌─────────────────┐  │
│          │      ├─ 触发器            │  │ 结果表格         │  │
│          │      ├─ 函数              │  │ (分页展示)       │  │
│          │      ├─ 事件              │  └─────────────────┘  │
│          │      └─ 查询              │                       │
├──────────┴───────────────────────────┴───────────────────────┤
│ 底部信息栏：连接状态、执行时间、行数                             │
└──────────────────────────────────────────────────────────────┘
```

## 4. 前端设计

### 4.1 页面组件

- `Mysql.tsx` — 主页面，三栏布局容器
- `MysqlConnectionPanel.tsx` — 左侧连接列表，增删改查
- `MysqlObjectTree.tsx` — 中间对象浏览器，树形结构
- `MysqlQueryEditor.tsx` — 查询编辑器（语法高亮）
- `MysqlResultTable.tsx` — 结果表格展示
- `MysqlBackupPanel.tsx` — 定时备份任务管理（弹窗/侧边面板）

### 4.2 状态管理 (Zustand)

```typescript
interface MysqlState {
  connections: MysqlConnection[];
  currentConnectionId: string | null;
  currentDatabase: string | null;
  selectedObject: MysqlObject | null;
  queryHistory: string[];
  queryResult: QueryResult | null;
  isExecuting: boolean;
  
  loadConnections: () => Promise<void>;
  createConnection: (config: MysqlConnectionConfig) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (config: MysqlConnectionConfig) => Promise<boolean>;
  executeQuery: (sql: string) => Promise<QueryResult>;
  loadDatabases: (connectionId: string) => Promise<string[]>;
  loadObjects: (connectionId: string, database: string, type: ObjectType) => Promise<MysqlObject[]>;
}
```

### 4.3 语法高亮

使用 Prism.js 或自定义简单正则实现，支持：
- 关键字高亮（SELECT, INSERT, UPDATE, DELETE, CREATE, DROP 等）
- 字符串高亮
- 注释高亮
- 行号显示

## 5. Rust 后端设计

### 5.1 新增依赖

```toml
[dependencies]
sqlx = { version = "0.7", features = ["runtime-tokio", "mysql", "chrono"] }
chrono = "0.4"
serde_json = "1.0"
```

### 5.2 模块结构

```rust
// mysql/mod.rs
pub mod connection;
pub mod query;
pub mod schema;
pub mod backup;

use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

lazy_static! {
    static ref CONNECTION_POOLS: Arc<Mutex<HashMap<String, MySqlPool>>> = 
        Arc::new(Mutex::new(HashMap::new()));
}

pub async fn get_or_create_pool(connection_id: &str) -> Result<MySqlPool, String> {
    // 从 SQLite 读取连接配置，创建/复用连接池
}
```

### 5.3 API 命令

```rust
// 连接管理
#[tauri::command]
async fn mysql_create_connection(config: MysqlConnectionConfig) -> Result<String, String>

#[tauri::command]
async fn mysql_update_connection(id: String, config: MysqlConnectionConfig) -> Result<(), String>

#[tauri::command]
async fn mysql_delete_connection(id: String) -> Result<(), String>

#[tauri::command]
async fn mysql_list_connections() -> Result<Vec<MysqlConnection>, String>

#[tauri::command]
async fn mysql_test_connection(config: MysqlConnectionConfig) -> Result<bool, String>

// 数据库和对象
#[tauri::command]
async fn mysql_list_databases(connection_id: String) -> Result<Vec<String>, String>

#[tauri::command]
async fn mysql_list_tables(connection_id: String, database: String) -> Result<Vec<TableInfo>, String>

#[tauri::command]
async fn mysql_list_views(connection_id: String, database: String) -> Result<Vec<ViewInfo>, String>

#[tauri::command]
async fn mysql_list_triggers(connection_id: String, database: String) -> Result<Vec<TriggerInfo>, String>

#[tauri::command]
async fn mysql_list_functions(connection_id: String, database: String) -> Result<Vec<FunctionInfo>, String>

#[tauri::command]
async fn mysql_list_events(connection_id: String, database: String) -> Result<Vec<EventInfo>, String>

#[tauri::command]
async fn mysql_get_table_structure(connection_id: String, database: String, table: String) -> Result<TableStructure, String>

// 查询执行
#[tauri::command]
async fn mysql_execute_query(connection_id: String, database: String, sql: String) -> Result<QueryResult, String>

// 备份
#[tauri::command]
async fn mysql_create_backup_task(task: BackupTask) -> Result<String, String>

#[tauri::command]
async fn mysql_list_backup_tasks() -> Result<Vec<BackupTask>, String>

#[tauri::command]
async fn mysql_delete_backup_task(id: String) -> Result<(), String>

#[tauri::command]
async fn mysql_run_backup_now(task_id: String) -> Result<String, String>
```

## 6. SQLite Schema

```sql
-- MySQL 连接配置表
CREATE TABLE mysql_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT 'localhost',
    port INTEGER NOT NULL DEFAULT 3306,
    username TEXT NOT NULL,
    password TEXT NOT NULL,  -- AES 加密存储
    database TEXT,           -- 默认数据库（可选）
    created_at INTEGER,
    updated_at INTEGER
);

-- MySQL 备份任务表
CREATE TABLE mysql_backup_tasks (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,  -- cron 表达式
    backup_path TEXT NOT NULL,      -- 备份文件保存路径
    is_enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    last_status TEXT,               -- success / failed
    created_at INTEGER,
    FOREIGN KEY (connection_id) REFERENCES mysql_connections(id)
);
```

## 7. 数据模型

### 7.1 前端类型

```typescript
interface MysqlConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  // 密码不在前端存储
  database?: string;
  createdAt: number;
}

interface MysqlConnectionConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
}

type ObjectType = 'table' | 'view' | 'trigger' | 'function' | 'event' | 'query';

interface MysqlObject {
  name: string;
  type: ObjectType;
  database: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  affectedRows?: number;
  executionTime: number;  // ms
}

interface BackupTask {
  id: string;
  connectionId: string;
  databaseName: string;
  cronExpression: string;
  backupPath: string;
  isEnabled: boolean;
  lastRunAt?: number;
  lastStatus?: 'success' | 'failed';
}
```

### 7.2 Rust 类型

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MysqlConnectionConfig {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<i64>,
    pub size_mb: Option<f64>,
}
```

## 8. 功能列表

### 8.1 连接管理
- [x] 创建连接（名称、主机、端口、用户名、密码、默认数据库）
- [x] 编辑连接
- [x] 删除连接
- [x] 测试连接
- [x] 连接列表展示

### 8.2 数据库对象浏览
- [x] 树形展示：连接 → 数据库 → 对象类型（表/视图/触发器/函数/事件）
- [x] 点击表名查看表结构（字段、类型、键、注释）
- [x] 双击表名自动生成 SELECT 语句

### 8.3 SQL 查询
- [x] 多行文本编辑器，支持语法高亮
- [x] 执行 SQL（支持 SELECT/INSERT/UPDATE/DELETE/CREATE/DROP）
- [x] 结果以表格形式展示，支持横向滚动
- [x] 显示执行时间和影响行数
- [x] 查询历史记录

### 8.4 定时备份
- [x] 创建备份任务（选择数据库、cron 表达式、备份路径）
- [x] 启用/禁用备份任务
- [x] 手动执行备份
- [x] 备份任务列表和历史状态

## 9. 路由

```typescript
// App.tsx 中添加
<Route path="mysql" element={<Mysql />} />
```

左侧导航添加 "MySQL" 菜单项，图标使用 `Database`（lucide-react）。

## 10. 安全

- 密码使用现有 AES-256-GCM 加密存储在 SQLite 中
- 连接密码仅在 Rust 后端解密，前端从不传输/存储明文密码
- 连接池在 Rust 端管理，前端通过 connection_id 引用

## 11. 错误处理

- 连接失败：显示具体错误信息（网络、认证、权限等）
- 查询失败：显示 SQL 错误信息和位置
- 备份失败：记录错误日志并更新任务状态
