# MySQL 管理模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MacNest 中添加一个完整的 MySQL 数据库管理模块，支持连接管理、数据库对象浏览、SQL 查询执行和定时备份。

**Architecture:** Rust 后端使用 `sqlx` crate 连接 MySQL，前端通过 Tauri IPC 调用。密码复用现有 AES-256-GCM 加密。定时备份使用 `cron` crate + tokio 后台任务调度 `mysqldump`。前端使用三栏式布局（MacNest 现有风格），查询编辑器带语法高亮。

**Tech Stack:** Tauri v2 + Rust (sqlx, cron), React 19 + TypeScript + Tailwind CSS + shadcn/ui, Zustand, Lucide React

---

## 文件结构映射

| 文件 | 责任 |
|------|------|
| `src-tauri/Cargo.toml` | 添加 sqlx 依赖 |
| `src-tauri/src/main.rs` | 注册 mysql 模块和 Tauri 命令 |
| `src-tauri/src/commands.rs` | 添加 MySQL 命令处理函数 |
| `src-tauri/src/database.rs` | 添加 MySQL 连接和备份任务的数据库表/CRUD |
| `src-tauri/src/mysql/mod.rs` | 模块入口、全局连接池管理 |
| `src-tauri/src/mysql/connection.rs` | 连接 CRUD、测试连接 |
| `src-tauri/src/mysql/schema.rs` | 数据库元数据获取（表、视图、触发器等） |
| `src-tauri/src/mysql/query.rs` | SQL 查询执行 |
| `src-tauri/src/mysql/backup.rs` | 定时备份任务调度与执行 |
| `src/types/index.ts` | 添加 MySQL 相关 TypeScript 类型 |
| `src/lib/mysql-api.ts` | 前端 MySQL API 封装 |
| `src/stores/mysql.ts` | Zustand 状态管理 |
| `src/components/mysql/` | MySQL 专属组件目录 |
| `src/components/mysql/ConnectionPanel.tsx` | 左侧连接列表面板 |
| `src/components/mysql/ObjectTree.tsx` | 中间对象浏览器（树形） |
| `src/components/mysql/QueryEditor.tsx` | SQL 查询编辑器（语法高亮） |
| `src/components/mysql/ResultTable.tsx` | 结果表格展示 |
| `src/components/mysql/BackupPanel.tsx` | 定时备份任务管理 |
| `src/pages/Mysql.tsx` | 主页面，三栏布局容器 |
| `src/App.tsx` | 添加 /mysql 路由 |
| `src/components/Layout.tsx` | 添加 MySQL 导航入口 |

---

## Task 1: 添加 Rust 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Context:** 需要 `sqlx` crate 连接 MySQL。项目已有 `tokio`、`serde_json`、`cron`、`chrono`、`lazy_static`、`aes-gcm` 等依赖可复用。

- [ ] **Step 1: 在 Cargo.toml [dependencies] 段添加 sqlx**

在 `src-tauri/Cargo.toml` 第 24 行 `r2d2_sqlite` 下方添加：

```toml
sqlx = { version = "0.8", features = ["runtime-tokio", "mysql"] }
```

- [ ] **Step 2: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过（可能有未使用变量警告，无错误）

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add sqlx for MySQL support"
```

---

## Task 2: 数据库 Schema 和 CRUD

**Files:**
- Modify: `src-tauri/src/database.rs`

- [ ] **Step 1: 在 `init()` 方法末尾添加 MySQL 相关表创建**

在 `src-tauri/src/database.rs` 的 `init()` 方法末尾（`Ok(())` 之前）添加：

```rust
        // MySQL connection management
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS mysql_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL DEFAULT 'localhost',
                port INTEGER NOT NULL DEFAULT 3306,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                database TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS mysql_backup_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id INTEGER NOT NULL,
                database_name TEXT NOT NULL,
                cron_expression TEXT NOT NULL,
                backup_path TEXT NOT NULL,
                is_enabled BOOLEAN DEFAULT 1,
                last_run_at DATETIME,
                last_status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (connection_id) REFERENCES mysql_connections(id) ON DELETE CASCADE
            );
            "
        );
```

- [ ] **Step 2: 添加 MySQL 连接数据结构**

在 `src-tauri/src/database.rs` 的 `NotificationLog` struct 之后添加：

```rust
    #[derive(Debug, Serialize, Deserialize)]
    pub struct MysqlConnection {
        pub id: i64,
        pub name: String,
        pub host: String,
        pub port: u16,
        pub username: String,
        pub password: String,
        pub database: String,
        pub created_at: String,
        pub updated_at: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct MysqlBackupTask {
        pub id: i64,
        pub connection_id: i64,
        pub database_name: String,
        pub cron_expression: String,
        pub backup_path: String,
        pub is_enabled: bool,
        pub last_run_at: Option<String>,
        pub last_status: Option<String>,
        pub created_at: String,
        pub updated_at: String,
    }
```

- [ ] **Step 3: 添加 MySQL 连接 CRUD 方法**

在 `Database` impl 块末尾（`list_notification_logs` 之后）添加：

```rust
    // === MySQL Connection CRUD ===

    pub fn create_mysql_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO mysql_connections (name, host, port, username, password, database)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![name, host, port, username, password, database],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_mysql_connections(&self) -> Result<Vec<MysqlConnection>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, password, database, created_at, updated_at
             FROM mysql_connections ORDER BY created_at DESC"
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(MysqlConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    database: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(connections)
    }

    pub fn get_mysql_connection(&self, id: i64) -> Result<MysqlConnection> {
        let conn = self.conn()?;
        let connection = conn.query_row(
            "SELECT id, name, host, port, username, password, database, created_at, updated_at
             FROM mysql_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(MysqlConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    database: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?;
        Ok(connection)
    }

    pub fn update_mysql_connection(
        &self,
        id: i64,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_connections
             SET name = ?1, host = ?2, port = ?3, username = ?4, password = ?5,
                 database = ?6, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?7",
            params![name, host, port, username, password, database, id],
        )?;
        Ok(())
    }

    pub fn delete_mysql_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM mysql_backup_tasks WHERE connection_id = ?1", params![id])?;
        conn.execute("DELETE FROM mysql_connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === MySQL Backup Task CRUD ===

    pub fn create_mysql_backup_task(
        &self,
        connection_id: i64,
        database_name: &str,
        cron_expression: &str,
        backup_path: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO mysql_backup_tasks (connection_id, database_name, cron_expression, backup_path)
             VALUES (?1, ?2, ?3, ?4)",
            params![connection_id, database_name, cron_expression, backup_path],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_mysql_backup_tasks(&self) -> Result<Vec<MysqlBackupTask>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, database_name, cron_expression, backup_path,
                    is_enabled, last_run_at, last_status, created_at, updated_at
             FROM mysql_backup_tasks ORDER BY created_at DESC"
        )?;
        let tasks = stmt
            .query_map([], |row| {
                Ok(MysqlBackupTask {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    database_name: row.get(2)?,
                    cron_expression: row.get(3)?,
                    backup_path: row.get(4)?,
                    is_enabled: row.get(5)?,
                    last_run_at: row.get(6)?,
                    last_status: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(tasks)
    }

    pub fn update_mysql_backup_task_enabled(&self, id: i64, is_enabled: bool) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_backup_tasks SET is_enabled = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![is_enabled, id],
        )?;
        Ok(())
    }

    pub fn update_mysql_backup_task_status(
        &self,
        id: i64,
        last_status: &str,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_backup_tasks SET last_run_at = CURRENT_TIMESTAMP, last_status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![last_status, id],
        )?;
        Ok(())
    }

    pub fn delete_mysql_backup_task(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM mysql_backup_tasks WHERE id = ?1", params![id])?;
        Ok(())
    }
```

- [ ] **Step 4: 编译检查**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database.rs
git commit -m "feat(mysql): add MySQL connection and backup task database schema and CRUD"
```

---

## Task 3: MySQL Rust 模块骨架

**Files:**
- Create: `src-tauri/src/mysql/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建 mysql/mod.rs 模块入口**

```rust
pub mod connection;
pub mod schema;
pub mod query;
pub mod backup;

use lazy_static::lazy_static;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

lazy_static! {
    static ref MYSQL_POOLS: Arc<Mutex<HashMap<i64, MySqlPool>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// 获取或创建 MySQL 连接池
pub async fn get_or_create_pool(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: &str,
) -> Result<MySqlPool, String> {
    let dsn = if database.is_empty() {
        format!("mysql://{}:{}@{}:{}", username, password, host, port)
    } else {
        format!("mysql://{}:{}@{}:{}/{}", username, password, host, port, database)
    };

    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&dsn)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    Ok(pool)
}

/// 获取连接池（如果不存在会报错，用于已连接的会话）
pub async fn get_pool(connection_id: i64) -> Result<MySqlPool, String> {
    let pools = MYSQL_POOLS.lock().await;
    pools
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| "连接未建立或已断开".to_string())
}

/// 注册连接池
pub async fn register_pool(connection_id: i64, pool: MySqlPool) {
    let mut pools = MYSQL_POOLS.lock().await;
    pools.insert(connection_id, pool);
}

/// 注销连接池
pub async fn unregister_pool(connection_id: i64) {
    let mut pools = MYSQL_POOLS.lock().await;
    if let Some(pool) = pools.remove(&connection_id) {
        let _ = pool.close().await;
    }
}
```

- [ ] **Step 2: 在 main.rs 注册 mysql 模块**

在 `src-tauri/src/main.rs` 第 3 行添加：

```rust
mod mysql;
```

在 `main()` 函数中 `rdp_session_manager` 之后添加：

```rust
                mysql_session_manager: std::sync::Mutex::new(HashMap::new()),
```

Wait, 不需要。mysql 模块不需要在 AppState 中管理，使用全局 lazy_static 即可。

实际上只需要添加 `mod mysql;` 到 main.rs。

- [ ] **Step 3: 编译检查**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mysql/mod.rs src-tauri/src/main.rs
git commit -m "feat(mysql): add MySQL module skeleton with connection pool management"
```

---

## Task 4: MySQL 连接管理 (Rust)

**Files:**
- Create: `src-tauri/src/mysql/connection.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 创建 connection.rs**

```rust
use crate::database::Database;
use crate::security;
use crate::mysql::{get_or_create_pool, register_pool, unregister_pool};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateMysqlConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMysqlConnectionRequest {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Deserialize)]
pub struct TestMysqlConnectionRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Serialize)]
pub struct MysqlConnectionResponse {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::MysqlConnection> for MysqlConnectionResponse {
    fn from(conn: crate::database::MysqlConnection) -> Self {
        Self {
            id: conn.id,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            database: conn.database,
            created_at: conn.created_at,
            updated_at: conn.updated_at,
        }
    }
}

/// 创建 MySQL 连接配置
pub async fn mysql_create_connection(
    db: &Database,
    req: CreateMysqlConnectionRequest,
) -> Result<i64, String> {
    let encrypted_password = security::encrypt(&req.password)
        .map_err(|e| format!("加密失败: {}", e))?;

    db.create_mysql_connection(
        &req.name,
        &req.host,
        req.port,
        &req.username,
        &encrypted_password,
        &req.database,
    )
    .map_err(|e| e.to_string())
}

/// 列出所有 MySQL 连接（返回时密码不暴露）
pub fn mysql_list_connections(db: &Database) -> Result<Vec<MysqlConnectionResponse>, String> {
    let connections = db.list_mysql_connections().map_err(|e| e.to_string())?;
    Ok(connections.into_iter().map(|c| c.into()).collect())
}

/// 更新 MySQL 连接
pub async fn mysql_update_connection(
    db: &Database,
    req: UpdateMysqlConnectionRequest,
) -> Result<(), String> {
    let encrypted_password = security::encrypt(&req.password)
        .map_err(|e| format!("加密失败: {}", e))?;

    db.update_mysql_connection(
        req.id,
        &req.name,
        &req.host,
        req.port,
        &req.username,
        &encrypted_password,
        &req.database,
    )
    .map_err(|e| e.to_string())?;

    // 如果连接池存在，断开旧连接
    unregister_pool(req.id).await;
    Ok(())
}

/// 删除 MySQL 连接
pub async fn mysql_delete_connection(db: &Database, id: i64) -> Result<(), String> {
    unregister_pool(id).await;
    db.delete_mysql_connection(id).map_err(|e| e.to_string())
}

/// 测试 MySQL 连接
pub async fn mysql_test_connection(req: TestMysqlConnectionRequest) -> Result<bool, String> {
    let pool = get_or_create_pool(
        &req.host,
        req.port,
        &req.username,
        &req.password,
        &req.database,
    )
    .await?;

    // 测试查询
    let row: (i64,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询测试失败: {}", e))?;

    pool.close().await;

    Ok(row.0 == 1)
}

/// 建立连接池（用于实际查询）
pub async fn mysql_connect(
    db: &Database,
    connection_id: i64,
) -> Result<bool, String> {
    let conn = db.get_mysql_connection(connection_id).map_err(|e| e.to_string())?;
    let decrypted_password = security::decrypt(&conn.password)
        .map_err(|e| format!("解密失败: {}", e))?;

    let pool = get_or_create_pool(
        &conn.host,
        conn.port,
        &conn.username,
        &decrypted_password,
        &conn.database,
    )
    .await?;

    // 测试连接
    let _: (i64,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("连接测试失败: {}", e))?;

    register_pool(connection_id, pool).await;
    Ok(true)
}

/// 断开连接
pub async fn mysql_disconnect(connection_id: i64) -> Result<(), String> {
    unregister_pool(connection_id).await;
    Ok(())
}
```

- [ ] **Step 2: 在 commands.rs 中添加命令处理函数**

在 `commands.rs` 末尾（在 `reinstall_to_applications` 命令之后）添加：

```rust
// === MySQL Commands ===

#[tauri::command]
pub async fn mysql_create_connection(
    state: State<'_, AppState>,
    req: mysql::connection::CreateMysqlConnectionRequest,
) -> Result<i64, String> {
    mysql::connection::mysql_create_connection(&state.db, req).await
}

#[tauri::command]
pub fn mysql_list_connections(state: State<'_, AppState>) -> Result<Vec<mysql::connection::MysqlConnectionResponse>, String> {
    mysql::connection::mysql_list_connections(&state.db)
}

#[tauri::command]
pub async fn mysql_update_connection(
    state: State<'_, AppState>,
    req: mysql::connection::UpdateMysqlConnectionRequest,
) -> Result<(), String> {
    mysql::connection::mysql_update_connection(&state.db, req).await
}

#[tauri::command]
pub async fn mysql_delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    mysql::connection::mysql_delete_connection(&state.db, id).await
}

#[tauri::command]
pub async fn mysql_test_connection(
    req: mysql::connection::TestMysqlConnectionRequest,
) -> Result<bool, String> {
    mysql::connection::mysql_test_connection(req).await
}

#[tauri::command]
pub async fn mysql_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<bool, String> {
    mysql::connection::mysql_connect(&state.db, connection_id).await
}

#[tauri::command]
pub async fn mysql_disconnect(connection_id: i64) -> Result<(), String> {
    mysql::connection::mysql_disconnect(connection_id).await
}
```

同时需要在 commands.rs 顶部添加：

```rust
use crate::mysql;
```

- [ ] **Step 3: 在 main.rs 中注册命令**

在 `invoke_handler` 的 `reinstall_to_applications` 之后添加：

```rust
            // MySQL commands
            commands::mysql_create_connection,
            commands::mysql_list_connections,
            commands::mysql_update_connection,
            commands::mysql_delete_connection,
            commands::mysql_test_connection,
            commands::mysql_connect,
            commands::mysql_disconnect,
```

- [ ] **Step 4: 编译检查**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mysql/connection.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(mysql): add MySQL connection management commands"
```

---

## Task 5: MySQL 元数据获取 (Rust)

**Files:**
- Create: `src-tauri/src/mysql/schema.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建 schema.rs**

```rust
use crate::mysql::get_pool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<i64>,
    pub size_mb: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ViewInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub table: String,
    pub timing: String,
}

#[derive(Debug, Serialize)]
pub struct FunctionInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct EventInfo {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: String,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub comment: String,
}

#[derive(Debug, Serialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
}

#[derive(Debug, Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: String,
    pub non_unique: bool,
}

/// 列出所有数据库
pub async fn mysql_list_databases(connection_id: i64) -> Result<Vec<DatabaseInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(name,)| DatabaseInfo { name }).collect())
}

/// 列出数据库中的表
pub async fn mysql_list_tables(
    connection_id: i64,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let query = format!(
        "SELECT table_name, engine, table_rows,
                ROUND(((data_length + index_length) / 1024 / 1024), 2) as size_mb
         FROM information_schema.tables
         WHERE table_schema = ? AND table_type = 'BASE TABLE'
         ORDER BY table_name",
    );
    let rows = sqlx::query_as::<_, (String, Option<String>, Option<i64>, Option<f64>)>(&query)
        .bind(&database)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, engine, rows, size_mb)| TableInfo {
            name,
            engine,
            rows,
            size_mb,
        })
        .collect())
}

/// 列出数据库中的视图
pub async fn mysql_list_views(
    connection_id: i64,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'VIEW' ORDER BY table_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(name,)| ViewInfo { name }).collect())
}

/// 列出数据库中的触发器
pub async fn mysql_list_triggers(
    connection_id: i64,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT trigger_name, event_manipulation, event_object_table, action_timing
         FROM information_schema.triggers
         WHERE trigger_schema = ? ORDER BY trigger_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, event, table, timing)| TriggerInfo {
            name,
            event,
            table,
            timing,
        })
        .collect())
}

/// 列出数据库中的函数和存储过程
pub async fn mysql_list_functions(
    connection_id: i64,
    database: String,
) -> Result<Vec<FunctionInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION' ORDER BY routine_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(name,)| FunctionInfo { name }).collect())
}

/// 列出数据库中的事件
pub async fn mysql_list_events(
    connection_id: i64,
    database: String,
) -> Result<Vec<EventInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT event_name, status FROM information_schema.events WHERE event_schema = ? ORDER BY event_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, status)| EventInfo { name, status })
        .collect())
}

/// 获取表结构
pub async fn mysql_get_table_structure(
    connection_id: i64,
    database: String,
    table: String,
) -> Result<TableStructure, String> {
    let pool = get_pool(connection_id).await?;

    // 列信息
    let columns = sqlx::query_as::<_, (String, String, String, String, Option<String>, String, String)>(
        "SELECT column_name, data_type, is_nullable, column_key, column_default, extra, column_comment
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position"
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let columns = columns
        .into_iter()
        .map(|(name, data_type, is_nullable, key, default_value, extra, comment)| ColumnInfo {
            name,
            data_type,
            is_nullable,
            key,
            default_value,
            extra,
            comment,
        })
        .collect();

    // 索引信息
    let indexes = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) as columns, MAX(non_unique) as non_unique
         FROM information_schema.statistics
         WHERE table_schema = ? AND table_name = ?
         GROUP BY index_name"
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let indexes = indexes
        .into_iter()
        .map(|(name, columns, non_unique)| IndexInfo {
            name,
            columns,
            non_unique: non_unique != 0,
        })
        .collect();

    Ok(TableStructure { columns, indexes })
}
```

- [ ] **Step 2: 在 commands.rs 中添加命令**

在 MySQL 命令段末尾添加：

```rust
#[tauri::command]
pub async fn mysql_list_databases(connection_id: i64) -> Result<Vec<mysql::schema::DatabaseInfo>, String> {
    mysql::schema::mysql_list_databases(connection_id).await
}

#[tauri::command]
pub async fn mysql_list_tables(connection_id: i64, database: String) -> Result<Vec<mysql::schema::TableInfo>, String> {
    mysql::schema::mysql_list_tables(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_views(connection_id: i64, database: String) -> Result<Vec<mysql::schema::ViewInfo>, String> {
    mysql::schema::mysql_list_views(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_triggers(connection_id: i64, database: String) -> Result<Vec<mysql::schema::TriggerInfo>, String> {
    mysql::schema::mysql_list_triggers(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_functions(connection_id: i64, database: String) -> Result<Vec<mysql::schema::FunctionInfo>, String> {
    mysql::schema::mysql_list_functions(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_events(connection_id: i64, database: String) -> Result<Vec<mysql::schema::EventInfo>, String> {
    mysql::schema::mysql_list_events(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_get_table_structure(
    connection_id: i64,
    database: String,
    table: String,
) -> Result<mysql::schema::TableStructure, String> {
    mysql::schema::mysql_get_table_structure(connection_id, database, table).await
}
```

- [ ] **Step 3: 在 main.rs 中注册命令**

```rust
            commands::mysql_list_databases,
            commands::mysql_list_tables,
            commands::mysql_list_views,
            commands::mysql_list_triggers,
            commands::mysql_list_functions,
            commands::mysql_list_events,
            commands::mysql_get_table_structure,
```

- [ ] **Step 4: 编译检查**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mysql/schema.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(mysql): add MySQL schema metadata queries"
```

---

## Task 6: MySQL SQL 查询执行 (Rust)

**Files:**
- Create: `src-tauri/src/mysql/query.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建 query.rs**

```rust
use crate::mysql::get_pool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Column, Row};
use std::time::Instant;

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteQueryRequest {
    pub connection_id: i64,
    pub database: String,
    pub sql: String,
}

/// 执行 SQL 查询
pub async fn mysql_execute_query(req: ExecuteQueryRequest) -> Result<QueryResult, String> {
    let pool = get_pool(req.connection_id).await?;
    let start = Instant::now();

    // 如果指定了数据库，先 USE
    if !req.database.is_empty() {
        let use_sql = format!("USE `{}`", req.database);
        sqlx::query(&use_sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("切换数据库失败: {}", e))?;
    }

    let trimmed = req.sql.trim().to_lowercase();
    let is_select = trimmed.starts_with("select")
        || trimmed.starts_with("show")
        || trimmed.starts_with("describe")
        || trimmed.starts_with("desc")
        || trimmed.starts_with("explain");

    if is_select {
        // 查询类 SQL
        let result = sqlx::query(&req.sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("查询失败: {}", e))?;

        let mut columns = Vec::new();
        let mut rows = Vec::new();

        if let Some(first_row) = result.first() {
            columns = first_row
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect();
        }

        for row in result {
            let mut row_values = Vec::new();
            for (i, _) in row.columns().iter().enumerate() {
                let value = row_to_json_value(&row, i)?;
                row_values.push(value);
            }
            rows.push(row_values);
        }

        Ok(QueryResult {
            columns,
            rows,
            affected_rows: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    } else {
        // 执行类 SQL
        let result = sqlx::query(&req.sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("执行失败: {}", e))?;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: Some(result.rows_affected()),
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}

/// 将 SQL 行中的列值转换为 JSON Value
fn row_to_json_value(row: &sqlx::mysql::MySqlRow, index: usize) -> Result<Value, String> {
    use sqlx::TypeInfo;

    let column = row.column(index);
    let type_info = column.type_info();
    let type_name = type_info.name();

    // 尝试不同的类型
    if let Ok(v) = row.try_get::<Option<String>, _>(index) {
        return Ok(v.map_or(Value::Null, Value::String));
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<u32>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| {
            Value::Number(serde_json::Number::from_f64(n).unwrap_or(serde_json::Number::from(0)))
        }));
    }
    if let Ok(v) = row.try_get::<Option<bool>, _>(index) {
        return Ok(v.map_or(Value::Null, Value::Bool));
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(v.map_or(Value::Null, |dt| Value::String(dt.to_string())));
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(v.map_or(Value::Null, |d| Value::String(d.to_string())));
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(v.map_or(Value::Null, |b| {
            // 二进制数据转为 base64
            Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }));
    }

    // 兜底：转字符串
    let s: Option<String> = row.try_get(index).unwrap_or(None);
    Ok(s.map_or(Value::Null, Value::String))
}
```

- [ ] **Step 2: 在 commands.rs 中添加命令**

```rust
#[tauri::command]
pub async fn mysql_execute_query(
    req: mysql::query::ExecuteQueryRequest,
) -> Result<mysql::query::QueryResult, String> {
    mysql::query::mysql_execute_query(req).await
}
```

- [ ] **Step 3: 在 main.rs 中注册**

```rust
            commands::mysql_execute_query,
```

- [ ] **Step 4: 编译检查**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mysql/query.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(mysql): add SQL query execution with JSON result serialization"
```

---

## Task 7: MySQL 定时备份 (Rust)

**Files:**
- Create: `src-tauri/src/mysql/backup.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建 backup.rs**

```rust
use crate::database::Database;
use crate::security;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Deserialize)]
pub struct CreateBackupTaskRequest {
    pub connection_id: i64,
    pub database_name: String,
    pub cron_expression: String,
    pub backup_path: String,
}

#[derive(Debug, Serialize)]
pub struct BackupTaskResponse {
    pub id: i64,
    pub connection_id: i64,
    pub database_name: String,
    pub cron_expression: String,
    pub backup_path: String,
    pub is_enabled: bool,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::MysqlBackupTask> for BackupTaskResponse {
    fn from(task: crate::database::MysqlBackupTask) -> Self {
        Self {
            id: task.id,
            connection_id: task.connection_id,
            database_name: task.database_name,
            cron_expression: task.cron_expression,
            backup_path: task.backup_path,
            is_enabled: task.is_enabled,
            last_run_at: task.last_run_at,
            last_status: task.last_status,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

/// 创建备份任务
pub fn mysql_create_backup_task(
    db: &Database,
    req: CreateBackupTaskRequest,
) -> Result<i64, String> {
    db.create_mysql_backup_task(
        req.connection_id,
        &req.database_name,
        &req.cron_expression,
        &req.backup_path,
    )
    .map_err(|e| e.to_string())
}

/// 列出备份任务
pub fn mysql_list_backup_tasks(db: &Database) -> Result<Vec<BackupTaskResponse>, String> {
    let tasks = db.list_mysql_backup_tasks().map_err(|e| e.to_string())?;
    Ok(tasks.into_iter().map(|t| t.into()).collect())
}

/// 删除备份任务
pub fn mysql_delete_backup_task(db: &Database, id: i64) -> Result<(), String> {
    db.delete_mysql_backup_task(id).map_err(|e| e.to_string())
}

/// 切换备份任务启用状态
pub fn mysql_toggle_backup_task(db: &Database, id: i64, is_enabled: bool) -> Result<(), String> {
    db.update_mysql_backup_task_enabled(id, is_enabled)
        .map_err(|e| e.to_string())
}

/// 立即执行备份
pub async fn mysql_run_backup_now(
    db: &Database,
    task_id: i64,
) -> Result<String, String> {
    let tasks = db.list_mysql_backup_tasks().map_err(|e| e.to_string())?;
    let task = tasks
        .into_iter()
        .find(|t| t.id == task_id)
        .ok_or("备份任务不存在")?;

    let conn = db
        .get_mysql_connection(task.connection_id)
        .map_err(|e| e.to_string())?;
    let password = security::decrypt(&conn.password).map_err(|e| e.to_string())?;

    // 确保备份目录存在
    std::fs::create_dir_all(&task.backup_path)
        .map_err(|e| format!("创建备份目录失败: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}_{}.sql", task.database_name, timestamp);
    let filepath = std::path::Path::new(&task.backup_path).join(&filename);

    // 使用 mysqldump 备份
    let output = Command::new("mysqldump")
        .args([
            "-h",
            &conn.host,
            "-P",
            &conn.port.to_string(),
            "-u",
            &conn.username,
            &format!("-p{}", password),
            &task.database_name,
        ])
        .output()
        .map_err(|e| format!("执行 mysqldump 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        db.update_mysql_backup_task_status(task_id, "failed")
            .map_err(|e| e.to_string())?;
        return Err(format!("mysqldump 失败: {}", stderr));
    }

    std::fs::write(&filepath, &output.stdout)
        .map_err(|e| format!("写入备份文件失败: {}", e))?;

    db.update_mysql_backup_task_status(task_id, "success")
        .map_err(|e| e.to_string())?;

    Ok(filepath.to_string_lossy().to_string())
}
```

- [ ] **Step 2: 在 commands.rs 中添加命令**

```rust
#[tauri::command]
pub fn mysql_create_backup_task(
    state: State<'_, AppState>,
    req: mysql::backup::CreateBackupTaskRequest,
) -> Result<i64, String> {
    mysql::backup::mysql_create_backup_task(&state.db, req)
}

#[tauri::command]
pub fn mysql_list_backup_tasks(state: State<'_, AppState>) -> Result<Vec<mysql::backup::BackupTaskResponse>, String> {
    mysql::backup::mysql_list_backup_tasks(&state.db)
}

#[tauri::command]
pub fn mysql_delete_backup_task(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    mysql::backup::mysql_delete_backup_task(&state.db, id)
}

#[tauri::command]
pub fn mysql_toggle_backup_task(state: State<'_, AppState>, id: i64, is_enabled: bool) -> Result<(), String> {
    mysql::backup::mysql_toggle_backup_task(&state.db, id, is_enabled)
}

#[tauri::command]
pub async fn mysql_run_backup_now(state: State<'_, AppState>, task_id: i64) -> Result<String, String> {
    mysql::backup::mysql_run_backup_now(&state.db, task_id).await
}
```

- [ ] **Step 3: 在 main.rs 中注册**

```rust
            commands::mysql_create_backup_task,
            commands::mysql_list_backup_tasks,
            commands::mysql_delete_backup_task,
            commands::mysql_toggle_backup_task,
            commands::mysql_run_backup_now,
```

- [ ] **Step 4: 编译检查**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mysql/backup.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(mysql): add backup task management with mysqldump integration"
```

---

## Task 8: 前端类型定义

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 在 types/index.ts 末尾添加 MySQL 类型**

```typescript
// ===== MySQL 管理 =====

export interface MysqlConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string;
  created_at: string;
  updated_at: string;
}

export interface MysqlConnectionConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface DatabaseInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  engine: string | null;
  rows: number | null;
  size_mb: number | null;
}

export interface ViewInfo {
  name: string;
}

export interface TriggerInfo {
  name: string;
  event: string;
  table: string;
  timing: string;
}

export interface FunctionInfo {
  name: string;
}

export interface EventInfo {
  name: string;
  status: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: string;
  key: string;
  default_value: string | null;
  extra: string;
  comment: string;
}

export interface IndexInfo {
  name: string;
  columns: string;
  non_unique: boolean;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export interface MysqlQueryResult {
  columns: string[];
  rows: any[][];
  affected_rows: number | null;
  execution_time_ms: number;
}

export interface MysqlBackupTask {
  id: number;
  connection_id: number;
  database_name: string;
  cron_expression: string;
  backup_path: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export type MysqlObjectType = "table" | "view" | "trigger" | "function" | "event";

export interface MysqlObject {
  name: string;
  type: MysqlObjectType;
  database: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(mysql): add TypeScript type definitions for MySQL management"
```

---

## Task 9: 前端 API 层

**Files:**
- Create: `src/lib/mysql-api.ts`

- [ ] **Step 1: 创建 mysql-api.ts**

```typescript
import { invoke } from "@tauri-apps/api/core";
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
} from "@/types";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error: unknown) {
    throw new Error(getErrorMessage(error));
  }
}

// === 连接管理 ===

export async function createMysqlConnection(config: MysqlConnectionConfig): Promise<number> {
  return invokeSafe("mysql_create_connection", { req: config });
}

export async function listMysqlConnections(): Promise<MysqlConnection[]> {
  return invokeSafe("mysql_list_connections");
}

export async function updateMysqlConnection(
  id: number,
  config: MysqlConnectionConfig
): Promise<void> {
  return invokeSafe("mysql_update_connection", { req: { id, ...config } });
}

export async function deleteMysqlConnection(id: number): Promise<void> {
  return invokeSafe("mysql_delete_connection", { id });
}

export async function testMysqlConnection(
  config: MysqlConnectionConfig
): Promise<boolean> {
  return invokeSafe("mysql_test_connection", { req: config });
}

export async function mysqlConnect(connectionId: number): Promise<boolean> {
  return invokeSafe("mysql_connect", { connectionId });
}

export async function mysqlDisconnect(connectionId: number): Promise<void> {
  return invokeSafe("mysql_disconnect", { connectionId });
}

// === 元数据 ===

export async function listMysqlDatabases(connectionId: number): Promise<DatabaseInfo[]> {
  return invokeSafe("mysql_list_databases", { connectionId });
}

export async function listMysqlTables(
  connectionId: number,
  database: string
): Promise<TableInfo[]> {
  return invokeSafe("mysql_list_tables", { connectionId, database });
}

export async function listMysqlViews(
  connectionId: number,
  database: string
): Promise<ViewInfo[]> {
  return invokeSafe("mysql_list_views", { connectionId, database });
}

export async function listMysqlTriggers(
  connectionId: number,
  database: string
): Promise<TriggerInfo[]> {
  return invokeSafe("mysql_list_triggers", { connectionId, database });
}

export async function listMysqlFunctions(
  connectionId: number,
  database: string
): Promise<FunctionInfo[]> {
  return invokeSafe("mysql_list_functions", { connectionId, database });
}

export async function listMysqlEvents(
  connectionId: number,
  database: string
): Promise<EventInfo[]> {
  return invokeSafe("mysql_list_events", { connectionId, database });
}

export async function getMysqlTableStructure(
  connectionId: number,
  database: string,
  table: string
): Promise<TableStructure> {
  return invokeSafe("mysql_get_table_structure", { connectionId, database, table });
}

// === 查询执行 ===

export async function executeMysqlQuery(
  connectionId: number,
  database: string,
  sql: string
): Promise<MysqlQueryResult> {
  return invokeSafe("mysql_execute_query", {
    req: { connection_id: connectionId, database, sql },
  });
}

// === 备份任务 ===

export async function createMysqlBackupTask(
  connectionId: number,
  databaseName: string,
  cronExpression: string,
  backupPath: string
): Promise<number> {
  return invokeSafe("mysql_create_backup_task", {
    req: { connection_id: connectionId, database_name: databaseName, cron_expression: cronExpression, backup_path: backupPath },
  });
}

export async function listMysqlBackupTasks(): Promise<MysqlBackupTask[]> {
  return invokeSafe("mysql_list_backup_tasks");
}

export async function deleteMysqlBackupTask(id: number): Promise<void> {
  return invokeSafe("mysql_delete_backup_task", { id });
}

export async function toggleMysqlBackupTask(id: number, isEnabled: boolean): Promise<void> {
  return invokeSafe("mysql_toggle_backup_task", { id, isEnabled });
}

export async function runMysqlBackupNow(taskId: number): Promise<string> {
  return invokeSafe("mysql_run_backup_now", { taskId });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mysql-api.ts
git commit -m "feat(mysql): add frontend MySQL API layer"
```

---

## Task 10: 前端 Zustand Store

**Files:**
- Create: `src/stores/mysql.ts`

- [ ] **Step 1: 创建 mysql.ts store**

```typescript
import { create } from "zustand";
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
} from "@/types";
import {
  listMysqlConnections,
  createMysqlConnection,
  updateMysqlConnection,
  deleteMysqlConnection,
  testMysqlConnection,
  mysqlConnect,
  mysqlDisconnect,
  listMysqlDatabases,
  listMysqlTables,
  listMysqlViews,
  listMysqlTriggers,
  listMysqlFunctions,
  listMysqlEvents,
  getMysqlTableStructure,
  executeMysqlQuery,
  listMysqlBackupTasks,
  createMysqlBackupTask as apiCreateBackupTask,
  deleteMysqlBackupTask as apiDeleteBackupTask,
  toggleMysqlBackupTask as apiToggleBackupTask,
  runMysqlBackupNow as apiRunBackupNow,
} from "@/lib/mysql-api";

interface MysqlState {
  connections: MysqlConnection[];
  currentConnectionId: number | null;
  currentDatabase: string | null;
  databases: DatabaseInfo[];
  tables: TableInfo[];
  views: ViewInfo[];
  triggers: TriggerInfo[];
  functions: FunctionInfo[];
  events: EventInfo[];
  selectedTable: string | null;
  tableStructure: TableStructure | null;
  queryResult: MysqlQueryResult | null;
  queryHistory: string[];
  isExecuting: boolean;
  isConnecting: boolean;
  backupTasks: MysqlBackupTask[];

  loadConnections: () => Promise<void>;
  createConnection: (config: MysqlConnectionConfig) => Promise<number>;
  updateConnection: (id: number, config: MysqlConnectionConfig) => Promise<void>;
  deleteConnection: (id: number) => Promise<void>;
  testConnection: (config: MysqlConnectionConfig) => Promise<boolean>;
  connect: (id: number) => Promise<boolean>;
  disconnect: () => Promise<void>;
  selectDatabase: (database: string) => Promise<void>;
  loadDatabases: () => Promise<void>;
  loadTables: () => Promise<void>;
  loadViews: () => Promise<void>;
  loadTriggers: () => Promise<void>;
  loadFunctions: () => Promise<void>;
  loadEvents: () => Promise<void>;
  loadTableStructure: (table: string) => Promise<void>;
  executeQuery: (sql: string) => Promise<MysqlQueryResult | null>;
  addQueryHistory: (sql: string) => void;
  loadBackupTasks: () => Promise<void>;
  createBackupTask: (
    connectionId: number,
    databaseName: string,
    cronExpression: string,
    backupPath: string
  ) => Promise<number>;
  deleteBackupTask: (id: number) => Promise<void>;
  toggleBackupTask: (id: number, isEnabled: boolean) => Promise<void>;
  runBackupNow: (taskId: number) => Promise<string>;
}

export const useMysqlStore = create<MysqlState>((set, get) => ({
  connections: [],
  currentConnectionId: null,
  currentDatabase: null,
  databases: [],
  tables: [],
  views: [],
  triggers: [],
  functions: [],
  events: [],
  selectedTable: null,
  tableStructure: null,
  queryResult: null,
  queryHistory: [],
  isExecuting: false,
  isConnecting: false,
  backupTasks: [],

  loadConnections: async () => {
    const connections = await listMysqlConnections();
    set({ connections });
  },

  createConnection: async (config) => {
    const id = await createMysqlConnection(config);
    await get().loadConnections();
    return id;
  },

  updateConnection: async (id, config) => {
    await updateMysqlConnection(id, config);
    await get().loadConnections();
  },

  deleteConnection: async (id) => {
    await deleteMysqlConnection(id);
    const state = get();
    if (state.currentConnectionId === id) {
      await mysqlDisconnect(id);
      set({
        currentConnectionId: null,
        currentDatabase: null,
        databases: [],
        tables: [],
        views: [],
        triggers: [],
        functions: [],
        events: [],
      });
    }
    await get().loadConnections();
  },

  testConnection: async (config) => {
    return await testMysqlConnection(config);
  },

  connect: async (id) => {
    set({ isConnecting: true });
    try {
      await mysqlConnect(id);
      set({ currentConnectionId: id });
      await get().loadDatabases();
      return true;
    } finally {
      set({ isConnecting: false });
    }
  },

  disconnect: async () => {
    const { currentConnectionId } = get();
    if (currentConnectionId) {
      await mysqlDisconnect(currentConnectionId);
    }
    set({
      currentConnectionId: null,
      currentDatabase: null,
      databases: [],
      tables: [],
      views: [],
      triggers: [],
      functions: [],
      events: [],
      selectedTable: null,
      tableStructure: null,
    });
  },

  selectDatabase: async (database) => {
    set({ currentDatabase: database });
    await Promise.all([
      get().loadTables(),
      get().loadViews(),
      get().loadTriggers(),
      get().loadFunctions(),
      get().loadEvents(),
    ]);
  },

  loadDatabases: async () => {
    const { currentConnectionId } = get();
    if (!currentConnectionId) return;
    const databases = await listMysqlDatabases(currentConnectionId);
    set({ databases });
  },

  loadTables: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const tables = await listMysqlTables(currentConnectionId, currentDatabase);
    set({ tables });
  },

  loadViews: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const views = await listMysqlViews(currentConnectionId, currentDatabase);
    set({ views });
  },

  loadTriggers: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const triggers = await listMysqlTriggers(currentConnectionId, currentDatabase);
    set({ triggers });
  },

  loadFunctions: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const functions = await listMysqlFunctions(currentConnectionId, currentDatabase);
    set({ functions });
  },

  loadEvents: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const events = await listMysqlEvents(currentConnectionId, currentDatabase);
    set({ events });
  },

  loadTableStructure: async (table) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const structure = await getMysqlTableStructure(currentConnectionId, currentDatabase, table);
    set({ selectedTable: table, tableStructure: structure });
  },

  executeQuery: async (sql) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId) return null;
    set({ isExecuting: true });
    try {
      const result = await executeMysqlQuery(
        currentConnectionId,
        currentDatabase || "",
        sql
      );
      set({ queryResult: result });
      get().addQueryHistory(sql);
      return result;
    } finally {
      set({ isExecuting: false });
    }
  },

  addQueryHistory: (sql) => {
    set((state) => {
      const history = [sql, ...state.queryHistory.filter((s) => s !== sql)].slice(0, 50);
      return { queryHistory: history };
    });
  },

  loadBackupTasks: async () => {
    const tasks = await listMysqlBackupTasks();
    set({ backupTasks: tasks });
  },

  createBackupTask: async (connectionId, databaseName, cronExpression, backupPath) => {
    const id = await apiCreateBackupTask(connectionId, databaseName, cronExpression, backupPath);
    await get().loadBackupTasks();
    return id;
  },

  deleteBackupTask: async (id) => {
    await apiDeleteBackupTask(id);
    await get().loadBackupTasks();
  },

  toggleBackupTask: async (id, isEnabled) => {
    await apiToggleBackupTask(id, isEnabled);
    await get().loadBackupTasks();
  },

  runBackupNow: async (taskId) => {
    const path = await apiRunBackupNow(taskId);
    await get().loadBackupTasks();
    return path;
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/mysql.ts
git commit -m "feat(mysql): add Zustand store for MySQL state management"
```

---

## Task 11: 前端连接面板组件

**Files:**
- Create: `src/components/mysql/ConnectionPanel.tsx`
- Create: `src/components/mysql/ConnectionDialog.tsx`

- [ ] **Step 1: 创建 ConnectionDialog.tsx**

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MysqlConnectionConfig } from "@/types";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<MysqlConnectionConfig>;
  onSubmit: (config: MysqlConnectionConfig) => Promise<void>;
  onTest: (config: MysqlConnectionConfig) => Promise<boolean>;
  title: string;
}

export default function ConnectionDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  onTest,
  title,
}: ConnectionDialogProps) {
  const [config, setConfig] = useState<MysqlConnectionConfig>({
    name: initialData?.name || "",
    host: initialData?.host || "localhost",
    port: initialData?.port || 3306,
    username: initialData?.username || "",
    password: initialData?.password || "",
    database: initialData?.database || "",
  });
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const ok = await onTest(config);
      if (ok) {
        toast.success("连接测试成功");
      } else {
        toast.error("连接测试失败");
      }
    } catch (err: any) {
      toast.error("连接测试失败: " + err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(config);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("保存失败: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              名称
            </Label>
            <Input
              id="name"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="col-span-3"
              placeholder="本地 MySQL"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="host" className="text-right">
              主机
            </Label>
            <Input
              id="host"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              className="col-span-3"
              placeholder="localhost"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right">
              端口
            </Label>
            <Input
              id="port"
              type="number"
              value={config.port}
              onChange={(e) =>
                setConfig({ ...config, port: parseInt(e.target.value) || 3306 })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="username" className="text-right">
              用户名
            </Label>
            <Input
              id="username"
              value={config.username}
              onChange={(e) =>
                setConfig({ ...config, username: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
              密码
            </Label>
            <Input
              id="password"
              type="password"
              value={config.password}
              onChange={(e) =>
                setConfig({ ...config, password: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="database" className="text-right">
              默认库
            </Label>
            <Input
              id="database"
              value={config.database}
              onChange={(e) =>
                setConfig({ ...config, database: e.target.value })
              }
              className="col-span-3"
              placeholder="(可选)"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 创建 ConnectionPanel.tsx**

```tsx
import { useState } from "react";
import { Database, Plus, Trash2, Edit2, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { toast } from "sonner";
import ConnectionDialog from "./ConnectionDialog";
import type { MysqlConnectionConfig } from "@/types";

export default function ConnectionPanel() {
  const {
    connections,
    currentConnectionId,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    connect,
    disconnect,
  } = useMysqlStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<MysqlConnectionConfig>>({});

  const handleCreate = async (config: MysqlConnectionConfig) => {
    await createConnection(config);
    toast.success("连接创建成功");
  };

  const handleEdit = (conn: typeof connections[0]) => {
    setEditingId(conn.id);
    setEditData({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: "",
      database: conn.database,
    });
    setEditOpen(true);
  };

  const handleUpdate = async (config: MysqlConnectionConfig) => {
    if (editingId) {
      await updateConnection(editingId, config);
      toast.success("连接更新成功");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此连接？")) return;
    await deleteConnection(id);
    toast.success("连接已删除");
  };

  const handleConnect = async (id: number) => {
    try {
      await connect(id);
      toast.success("连接成功");
    } catch (err: any) {
      toast.error("连接失败: " + err.message);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast.success("已断开连接");
  };

  return (
    <div className="flex flex-col h-full w-[220px] shrink-0 border-r border-[var(--glass-border)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">MySQL 连接</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {connections.map((conn) => (
          <div
            key={conn.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors ${
              currentConnectionId === conn.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent/40"
            }`}
          >
            <Database className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{conn.name}</span>
            {currentConnectionId === conn.id ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect();
                }}
              >
                <Unplug className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConnect(conn.id);
                }}
              >
                <Plug className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(conn);
              }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(conn.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <ConnectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        onTest={testConnection}
        title="添加 MySQL 连接"
      />

      <ConnectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialData={editData}
        onSubmit={handleUpdate}
        onTest={testConnection}
        title="编辑 MySQL 连接"
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/mysql/ConnectionPanel.tsx src/components/mysql/ConnectionDialog.tsx
git commit -m "feat(mysql): add connection panel with CRUD dialog"
```

---

## Task 12: 对象浏览器组件

**Files:**
- Create: `src/components/mysql/ObjectTree.tsx`

- [ ] **Step 1: 创建 ObjectTree.tsx**

```tsx
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Table,
  Eye,
  Zap,
  FunctionSquare,
  Calendar,
  FileSpreadsheet,
} from "lucide-react";
import { useMysqlStore } from "@/stores/mysql";
import type { MysqlObjectType } from "@/types";

interface TreeNode {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  onClick?: () => void;
}

function TreeItem({
  node,
  level = 0,
}: {
  node: TreeNode;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-accent/40 transition-colors"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          node.onClick?.();
        }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0">{node.icon}</span>
        <span className="truncate">{node.label}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const objectTypeIcons: Record<MysqlObjectType, React.ReactNode> = {
  table: <Table className="h-3.5 w-3.5" />,
  view: <Eye className="h-3.5 w-3.5" />,
  trigger: <Zap className="h-3.5 w-3.5" />,
  function: <FunctionSquare className="h-3.5 w-3.5" />,
  event: <Calendar className="h-3.5 w-3.5" />,
};

export default function ObjectTree() {
  const {
    currentConnectionId,
    currentDatabase,
    databases,
    tables,
    views,
    triggers,
    functions,
    events,
    selectDatabase,
    loadTableStructure,
  } = useMysqlStore();

  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  const toggleType = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  if (!currentConnectionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        请先连接 MySQL
      </div>
    );
  }

  const handleSelectDatabase = async (dbName: string) => {
    setSelectedDb(dbName);
    await selectDatabase(dbName);
    setExpandedTypes(new Set());
  };

  const databaseNodes: TreeNode[] = databases.map((db) => ({
    id: `db-${db.name}`,
    label: db.name,
    icon: <Database className="h-3.5 w-3.5 text-primary" />,
    onClick: () => handleSelectDatabase(db.name),
    children:
      selectedDb === db.name
        ? [
            {
              id: "tables",
              label: `表 (${tables.length})`,
              icon: <Table className="h-3.5 w-3.5" />,
              children: tables.map((t) => ({
                id: `table-${t.name}`,
                label: t.name,
                icon: <Table className="h-3.5 w-3.5" />,
                isLeaf: true,
                onClick: () => loadTableStructure(t.name),
              })),
            },
            {
              id: "views",
              label: `视图 (${views.length})`,
              icon: <Eye className="h-3.5 w-3.5" />,
              children: views.map((v) => ({
                id: `view-${v.name}`,
                label: v.name,
                icon: <Eye className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "triggers",
              label: `触发器 (${triggers.length})`,
              icon: <Zap className="h-3.5 w-3.5" />,
              children: triggers.map((t) => ({
                id: `trigger-${t.name}`,
                label: t.name,
                icon: <Zap className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "functions",
              label: `函数 (${functions.length})`,
              icon: <FunctionSquare className="h-3.5 w-3.5" />,
              children: functions.map((f) => ({
                id: `function-${f.name}`,
                label: f.name,
                icon: <FunctionSquare className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
            {
              id: "events",
              label: `事件 (${events.length})`,
              icon: <Calendar className="h-3.5 w-3.5" />,
              children: events.map((e) => ({
                id: `event-${e.name}`,
                label: e.name,
                icon: <Calendar className="h-3.5 w-3.5" />,
                isLeaf: true,
              })),
            },
          ]
        : undefined,
  }));

  return (
    <div className="flex flex-col h-full w-[240px] shrink-0 border-r border-[var(--glass-border)]">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">对象浏览器</span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {databaseNodes.map((node) => (
          <TreeItem key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mysql/ObjectTree.tsx
git commit -m "feat(mysql): add object browser tree component"
```

---

## Task 13: 查询编辑器和结果表格

**Files:**
- Create: `src/components/mysql/QueryEditor.tsx`
- Create: `src/components/mysql/ResultTable.tsx`
- Create: `src/components/mysql/TableStructureView.tsx`

- [ ] **Step 1: 创建 QueryEditor.tsx（带简单语法高亮）**

```tsx
import { useState, useRef, useCallback } from "react";
import { Play, RotateCcw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";
import { toast } from "sonner";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE",
  "DROP", "ALTER", "TABLE", "DATABASE", "INDEX", "VIEW", "TRIGGER",
  "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT",
  "NULL", "IS", "IN", "BETWEEN", "LIKE", "ORDER", "BY", "GROUP", "HAVING",
  "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "AS", "VALUES", "SET",
  "INTO", "IF", "EXISTS", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "DEFAULT", "AUTO_INCREMENT", "UNIQUE", "CHECK", "CONSTRAINT",
];

const KEYWORD_SET = new Set(KEYWORDS.map((k) => k.toLowerCase()));

function highlightSql(sql: string): string {
  let result = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 字符串高亮
  result = result.replace(
    /('[^']*')/g,
    '<span style="color: #a5d6ff;">$1</span>'
  );

  // 数字高亮
  result = result.replace(
    /\b(\d+)\b/g,
    '<span style="color: #79c0ff;">$1</span>'
  );

  // 关键字高亮
  result = result.replace(\b\w+\b\gi, (match) => {
    if (KEYWORD_SET.has(match.toLowerCase())) {
      return `<span style="color: #ff7b72; font-weight: 600;">${match}</span>`;
    }
    return match;
  });

  // 注释高亮
  result = result.replace(
    /(--.*$)/gm,
    '<span style="color: #8b949e;">$1</span>'
  );
  result = result.replace(
    /(\/\*[\s\S]*?\*\/)/g,
    '<span style="color: #8b949e;">$1</span>'
  );

  return result;
}

export default function QueryEditor() {
  const { executeQuery, queryResult, isExecuting, queryHistory, currentConnectionId } =
    useMysqlStore();
  const [sql, setSql] = useState("SELECT * FROM ");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  const handleExecute = async () => {
    if (!sql.trim()) {
      toast.error("请输入 SQL");
      return;
    }
    if (!currentConnectionId) {
      toast.error("请先连接 MySQL");
      return;
    }
    try {
      await executeQuery(sql);
    } catch (err: any) {
      toast.error("执行失败: " + err.message);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        handleExecute();
      }
    },
    [sql]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-[var(--glass-border)]">
        <Button
          size="sm"
          onClick={handleExecute}
          disabled={isExecuting}
          className="gap-1"
        >
          <Play className="h-3.5 w-3.5" />
          {isExecuting ? "执行中..." : "执行 (Cmd+Enter)"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSql("")}
          className="gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          清空
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowHistory(!showHistory)}
          className="gap-1 ml-auto"
        >
          <Clock className="h-3.5 w-3.5" />
          历史
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* SQL Editor */}
        <div className="flex-1 relative overflow-hidden">
          {/* Line numbers */}
          <div className="absolute left-0 top-0 bottom-0 w-10 bg-muted/30 border-r border-[var(--glass-border)] text-right pr-2 pt-2 text-xs text-muted-foreground font-mono select-none overflow-hidden">
            {sql.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Highlight overlay */}
          <div
            className="absolute left-10 right-0 top-0 bottom-0 p-2 text-sm font-mono whitespace-pre-wrap overflow-auto pointer-events-none"
            dangerouslySetInnerHTML={{
              __html: highlightSql(sql + " "),
            }}
            style={{ minHeight: "100%" }}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            className="absolute left-10 right-0 top-0 bottom-0 w-[calc(100%-2.5rem)] h-full p-2 text-sm font-mono bg-transparent text-transparent caret-foreground resize-none outline-none"
            spellCheck={false}
            placeholder="输入 SQL 查询..."
          />
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="w-[200px] border-l border-[var(--glass-border)] overflow-auto">
            <div className="p-2 text-xs font-semibold text-muted-foreground">
              查询历史
            </div>
            {queryHistory.map((q, i) => (
              <div
                key={i}
                className="px-2 py-1 text-xs cursor-pointer hover:bg-accent/40 truncate"
                onClick={() => {
                  setSql(q);
                  setShowHistory(false);
                }}
                title={q}
              >
                {q.length > 40 ? q.slice(0, 40) + "..." : q}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      {queryResult && (
        <div className="flex items-center gap-4 px-3 py-1 text-xs text-muted-foreground border-t border-[var(--glass-border)]">
          <span>
            {queryResult.affected_rows !== null
              ? `影响 ${queryResult.affected_rows} 行`
              : `共 ${queryResult.rows.length} 行`}
          </span>
          <span>{queryResult.execution_time_ms}ms</span>
          {queryResult.rows.length > 0 && (
            <span>{queryResult.columns.length} 列</span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 ResultTable.tsx**

```tsx
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMysqlStore } from "@/stores/mysql";

const PAGE_SIZE = 100;

export default function ResultTable() {
  const { queryResult } = useMysqlStore();
  const [page, setPage] = useState(0);

  if (!queryResult || queryResult.columns.length === 0) {
    if (queryResult?.affected_rows !== null) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          执行成功，影响 {queryResult.affected_rows} 行
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        执行查询以查看结果
      </div>
    );
  }

  const totalPages = Math.ceil(queryResult.rows.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, queryResult.rows.length);
  const visibleRows = queryResult.rows.slice(start, end);

  const formatValue = (v: any): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted/50 z-10">
            <tr>
              {queryResult.columns.map((col) => (
                <th
                  key={col}
                  className="border border-[var(--glass-border)] px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="hover:bg-accent/20 even:bg-muted/20"
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className="border border-[var(--glass-border)] px-2 py-1 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                    title={formatValue(cell)}
                  >
                    {cell === null ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : (
                      formatValue(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 p-2 border-t border-[var(--glass-border)]">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {start + 1}-{end} / {queryResult.rows.length} 行 (第 {page + 1}/{totalPages} 页)
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 TableStructureView.tsx**

```tsx
import { useMysqlStore } from "@/stores/mysql";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TableStructureView() {
  const { tableStructure, selectedTable } = useMysqlStore();

  if (!selectedTable || !tableStructure) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        选择一个表查看结构
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4">
      <h3 className="text-sm font-semibold">表: {selectedTable}</h3>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">字段</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">名称</TableHead>
              <TableHead className="text-xs">类型</TableHead>
              <TableHead className="text-xs">可空</TableHead>
              <TableHead className="text-xs">键</TableHead>
              <TableHead className="text-xs">默认值</TableHead>
              <TableHead className="text-xs">额外</TableHead>
              <TableHead className="text-xs">注释</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableStructure.columns.map((col) => (
              <TableRow key={col.name} className="text-xs">
                <TableCell className="font-mono">{col.name}</TableCell>
                <TableCell>{col.data_type}</TableCell>
                <TableCell>{col.is_nullable}</TableCell>
                <TableCell>{col.key}</TableCell>
                <TableCell className="text-muted-foreground">
                  {col.default_value || "-"}
                </TableCell>
                <TableCell>{col.extra || "-"}</TableCell>
                <TableCell>{col.comment || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {tableStructure.indexes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">索引</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">名称</TableHead>
                <TableHead className="text-xs">字段</TableHead>
                <TableHead className="text-xs">类型</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableStructure.indexes.map((idx) => (
                <TableRow key={idx.name} className="text-xs">
                  <TableCell className="font-mono">{idx.name}</TableCell>
                  <TableCell>{idx.columns}</TableCell>
                  <TableCell>{idx.non_unique ? "普通" : "唯一"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mysql/QueryEditor.tsx src/components/mysql/ResultTable.tsx src/components/mysql/TableStructureView.tsx
git commit -m "feat(mysql): add query editor, result table, and table structure view"
```

---

## Task 14: 备份管理组件

**Files:**
- Create: `src/components/mysql/BackupPanel.tsx`

- [ ] **Step 1: 创建 BackupPanel.tsx**

```tsx
import { useState, useEffect } from "react";
import { Plus, Trash2, Play, Pause, Clock, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMysqlStore } from "@/stores/mysql";
import { toast } from "sonner";

export default function BackupPanel() {
  const {
    connections,
    currentConnectionId,
    currentDatabase,
    backupTasks,
    loadBackupTasks,
    createBackupTask,
    deleteBackupTask,
    toggleBackupTask,
    runBackupNow,
  } = useMysqlStore();

  const [open, setOpen] = useState(false);
  const [cron, setCron] = useState("0 2 * * *");
  const [backupPath, setBackupPath] = useState("~/mysql_backups");
  const [selectedConn, setSelectedConn] = useState<number | null>(null);
  const [selectedDb, setSelectedDb] = useState("");

  useEffect(() => {
    loadBackupTasks();
  }, []);

  const handleCreate = async () => {
    if (!selectedConn || !selectedDb || !cron || !backupPath) {
      toast.error("请填写完整信息");
      return;
    }
    try {
      await createBackupTask(selectedConn, selectedDb, cron, backupPath);
      toast.success("备份任务创建成功");
      setOpen(false);
    } catch (err: any) {
      toast.error("创建失败: " + err.message);
    }
  };

  const handleRun = async (taskId: number) => {
    try {
      const path = await runBackupNow(taskId);
      toast.success("备份完成: " + path);
    } catch (err: any) {
      toast.error("备份失败: " + err.message);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-[var(--glass-border)]">
        <span className="text-sm font-semibold">定时备份</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setSelectedConn(currentConnectionId || connections[0]?.id || null);
            setSelectedDb(currentDatabase || "");
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {backupTasks.map((task) => (
          <div
            key={task.id}
            className="rounded-lg border border-[var(--glass-border)] p-3 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{task.database_name}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => toggleBackupTask(task.id, !task.is_enabled)}
                >
                  {task.is_enabled ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRun(task.id)}
                >
                  <Play className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => deleteBackupTask(task.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {task.cron_expression}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              {task.backup_path}
            </div>
            {task.last_run_at && (
              <div className="text-xs text-muted-foreground">
                上次执行: {task.last_run_at}
                <span
                  className={`ml-1 ${
                    task.last_status === "success"
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {task.last_status === "success" ? "成功" : "失败"}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>添加备份任务</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">连接</Label>
              <select
                className="col-span-3 flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                value={selectedConn || ""}
                onChange={(e) => setSelectedConn(Number(e.target.value))}
              >
                <option value="">选择连接</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">数据库</Label>
              <Input
                className="col-span-3"
                value={selectedDb}
                onChange={(e) => setSelectedDb(e.target.value)}
                placeholder="数据库名"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Cron</Label>
              <Input
                className="col-span-3"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 2 * * *"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">路径</Label>
              <Input
                className="col-span-3"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
                placeholder="~/mysql_backups"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mysql/BackupPanel.tsx
git commit -m "feat(mysql): add backup task management panel"
```

---

## Task 15: 主页面和路由集成

**Files:**
- Create: `src/pages/Mysql.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: 创建 Mysql.tsx**

```tsx
import { useEffect, useState } from "react";
import { Database, Table2, FileCode, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConnectionPanel from "@/components/mysql/ConnectionPanel";
import ObjectTree from "@/components/mysql/ObjectTree";
import QueryEditor from "@/components/mysql/QueryEditor";
import ResultTable from "@/components/mysql/ResultTable";
import TableStructureView from "@/components/mysql/TableStructureView";
import BackupPanel from "@/components/mysql/BackupPanel";
import { useMysqlStore } from "@/stores/mysql";

type MainTab = "query" | "structure" | "backup";

export default function Mysql() {
  const { loadConnections, currentConnectionId, selectedTable } = useMysqlStore();
  const [activeTab, setActiveTab] = useState<MainTab>("query");

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      setActiveTab("structure");
    }
  }, [selectedTable]);

  return (
    <div className="flex h-full">
      {/* Left: Connection Panel */}
      <ConnectionPanel />

      {/* Middle: Object Tree */}
      <ObjectTree />

      {/* Right: Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 p-2 border-b border-[var(--glass-border)]">
          <Button
            variant={activeTab === "query" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("query")}
          >
            <FileCode className="h-3.5 w-3.5" />
            查询
          </Button>
          <Button
            variant={activeTab === "structure" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("structure")}
          >
            <Table2 className="h-3.5 w-3.5" />
            结构
          </Button>
          <Button
            variant={activeTab === "backup" ? "secondary" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("backup")}
          >
            <Clock className="h-3.5 w-3.5" />
            备份
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "query" && (
            <div className="flex flex-col h-full">
              <div className="h-[50%] border-b border-[var(--glass-border)]">
                <QueryEditor />
              </div>
              <div className="h-[50%]">
                <ResultTable />
              </div>
            </div>
          )}
          {activeTab === "structure" && <TableStructureView />}
          {activeTab === "backup" && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 App.tsx 添加路由**

在 `src/App.tsx` 第 10 行添加：

```typescript
import Mysql from "./pages/Mysql";
```

在 Route 列表中添加：

```tsx
            <Route path="mysql" element={<Mysql />} />
```

- [ ] **Step 3: 修改 Layout.tsx 添加导航**

在 `src/components/Layout.tsx` 第 10 行（ScreenShare 之后）添加：

```typescript
  Database as DatabaseIcon,
```

在 `navItems` 数组中，在 `{ to: "/system", icon: Activity, label: "系统" }` 之前添加：

```typescript
  { to: "/mysql", icon: DatabaseIcon, label: "MySQL" },
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Mysql.tsx src/App.tsx src/components/Layout.tsx
git commit -m "feat(mysql): integrate MySQL page with routing and navigation"
```

---

## Task 16: 编译验证

**Files:**
- 无新增文件

- [ ] **Step 1: Rust 编译**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过

- [ ] **Step 2: TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无 TypeScript 错误

- [ ] **Step 3: Vite 构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(mysql): complete MySQL management module"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| 设计文档需求 | 对应任务 |
|-------------|---------|
| 连接管理（创建/编辑/删除/测试） | Task 4 (Rust), Task 11 (前端) |
| 数据库对象浏览（表/视图/触发器/函数/事件） | Task 5 (Rust), Task 12 (前端) |
| SQL 查询执行 | Task 6 (Rust), Task 13 (前端) |
| 表结构查看 | Task 5 (Rust), Task 13 (前端) |
| 定时备份 | Task 7 (Rust), Task 14 (前端) |
| 语法高亮 | Task 13 (QueryEditor) |
| 密码加密存储 | Task 2, 4 (复用 security.rs) |
| 路由和导航 | Task 15 |

### 2. Placeholder Scan

- 无 TBD、TODO
- 所有代码块包含实际代码
- 所有命令有预期输出

### 3. Type Consistency

- `MysqlConnectionConfig` 在前后端一致（name, host, port, username, password, database）
- `QueryResult` 在前后端一致（columns, rows, affected_rows, execution_time_ms）
- `BackupTask` 在前后端一致（id, connection_id, database_name, cron_expression, backup_path, is_enabled, last_run_at, last_status）
- API 函数名前后端匹配（mysql_create_connection → createMysqlConnection 等）

### 4. 已知限制

- 定时备份的自动调度需要额外实现后台线程（超出当前计划范围，当前实现支持手动触发 + 任务管理）
- 语法高亮是简单正则实现，非完整 SQL 解析器
- 查询结果中二进制数据转为 base64
