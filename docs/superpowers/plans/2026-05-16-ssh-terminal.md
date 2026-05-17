# SSH 终端功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MacOps 增加 SSH 终端功能，支持保存连接配置、通过 xterm.js 连接远程服务器并执行命令。

**Architecture:** Rust 后端使用 russh 0.49 建立 SSH 连接，通过本地 WebSocket 服务器桥接 PTY 数据流；前端使用 xterm.js 渲染终端，通过 WebSocket 与后端通信。

**Tech Stack:** russh 0.49, tokio-tungstenite 0.29, xterm.js 5.3, React 19, Tauri 2, SQLite

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/ssh/mod.rs` | SSH 模块入口，导出公共类型和函数 |
| `src-tauri/src/ssh/types.rs` | SSH 相关数据结构（SshConnection, SshAuthType, SshSessionInfo） |
| `src-tauri/src/ssh/client.rs` | SSH 客户端核心：连接建立、认证、PTY 打开 |
| `src-tauri/src/ssh/session.rs` | 会话管理器：内存中管理活动 SSH 会话 |
| `src-tauri/src/ssh/websocket.rs` | WebSocket PTY 服务器：桥接 SSH channel 和 WebSocket |
| `src/pages/Terminal.tsx` | 终端页面：连接选择器 + xterm.js 终端区域 |
| `src/components/terminal/XTerm.tsx` | xterm.js 封装组件：WebSocket 连接、终端渲染 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src-tauri/Cargo.toml` | 追加 russh、tokio-tungstenite、futures、async-trait 依赖 |
| `src-tauri/src/main.rs` | 注册 SSH 模块、扩展 AppState、注册新 IPC 命令 |
| `src-tauri/src/commands.rs` | 追加 SSH IPC 命令（create/list/delete 连接、connect/disconnect） |
| `src-tauri/src/database.rs` | 追加 ssh_connections 表和 CRUD 方法 |
| `src/App.tsx` | 追加 `/terminal` 路由 |
| `src/components/Layout.tsx` | 侧边栏追加「终端」入口 |
| `src/lib/api.ts` | 追加 SSH API 调用函数 |
| `src/types/index.ts` | 追加 SSH 相关 TypeScript 类型 |
| `src/styles.css` | 追加 xterm.js 样式覆盖 |
| `package.json` | 追加 @xterm/xterm、@xterm/addon-fit、@xterm/addon-web-links 依赖 |

---

## Task 1: 添加 Rust 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 追加 SSH 相关依赖到 Cargo.toml**

在 `[dependencies]` 段末尾追加：

```toml
# === SSH 协议 ===
russh = "0.49"

# === WebSocket 服务器（PTY 数据流）===
tokio-tungstenite = "0.29"
futures = "0.3"

# === SSH Handler trait 需要 ===
async-trait = "0.1"
```

> **注意：** russh 0.49 使用 edition 2018，与项目 edition 2021 兼容。russh 内部会自动拉取匹配的 russh-keys 版本（0.49.2），无需显式声明。

- [ ] **Step 2: 验证依赖可解析**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: 编译成功，无依赖解析错误

- [ ] **Step 3: Commit**

```bash
cd /Users/baiyuyao/code_tools/Kimi_Agent_mac运维面板方案/macops
git add src-tauri/Cargo.toml
git commit -m "deps: add russh, tokio-tungstenite, futures, async-trait for SSH terminal"
```

---

## Task 2: 创建 SSH 数据类型

**Files:**
- Create: `src-tauri/src/ssh/types.rs`
- Modify: `src-tauri/src/ssh/mod.rs`

- [ ] **Step 1: 创建 ssh/types.rs**

```rust
use serde::{Deserialize, Serialize};

/// SSH 连接配置（存储在 SQLite）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SshAuthType,
    pub group_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SshAuthType {
    Password { password: String },
    PublicKey { key_path: String, passphrase: Option<String> },
}

/// 活动会话（内存中，不持久化）
#[derive(Debug, Clone, Serialize)]
pub struct SshSessionInfo {
    pub session_id: String,
    pub connection_id: i64,
    pub host: String,
    pub username: String,
    pub connected: bool,
    pub connected_at: String,
    pub websocket_port: u16,
}
```

- [ ] **Step 2: 创建 ssh/mod.rs**

```rust
pub mod client;
pub mod session;
pub mod types;
pub mod websocket;
```

- [ ] **Step 3: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/
git commit -m "feat(ssh): add SSH data types module"
```

---

## Task 3: 创建 SSH 客户端核心

**Files:**
- Create: `src-tauri/src/ssh/client.rs`

- [ ] **Step 1: 创建 ssh/client.rs**

```rust
use async_trait::async_trait;
use russh::keys::*;
use russh::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::ToSocketAddrs;

use super::types::SshAuthType;

pub struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SshConnectionManager {
    session: client::Handle<SshClientHandler>,
}

impl SshConnectionManager {
    pub async fn connect<A: ToSocketAddrs>(
        addrs: A,
    ) -> anyhow::Result<Self> {
        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            ..<_>::default()
        };
        let config = Arc::new(config);
        let handler = SshClientHandler {};
        let session = client::connect(config, addrs, handler).await?;
        Ok(Self { session })
    }

    pub async fn auth_password(
        &mut self,
        username: &str,
        password: &str,
    ) -> anyhow::Result<bool> {
        let auth_res = self
            .session
            .authenticate_password(username, password)
            .await?;
        Ok(auth_res)
    }

    pub async fn auth_publickey(
        &mut self,
        username: &str,
        key_path: &str,
        passphrase: Option<&str>,
    ) -> anyhow::Result<bool> {
        let key_pair = load_secret_key(key_path, passphrase)?;
        let auth_res = self
            .session
            .authenticate_publickey(
                username,
                PrivateKeyWithHashAlg::new(Arc::new(key_pair), None)?,
            )
            .await?;
        Ok(auth_res)
    }

    pub async fn authenticate(
        &mut self,
        username: &str,
        auth: &SshAuthType,
    ) -> anyhow::Result<bool> {
        match auth {
            SshAuthType::Password { password } => {
                self.auth_password(username, password).await
            }
            SshAuthType::PublicKey { key_path, passphrase } => {
                self.auth_publickey(username, key_path, passphrase.as_deref()).await
            }
        }
    }

    pub async fn open_pty(&mut self) -> anyhow::Result<Channel<client::Msg>> {
        let mut channel = self.session.channel_open_session().await?;
        channel
            .request_pty(
                true,
                "xterm-256color",
                80,
                24,
                0,
                0,
                &[],
            )
            .await?;
        channel.request_shell(true).await?;
        Ok(channel)
    }

    pub async fn disconnect(&mut self) -> anyhow::Result<()> {
        self.session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await?;
        Ok(())
    }

    pub fn session(&self) -> &client::Handle<SshClientHandler> {
        &self.session
    }
}
```

> **关键说明：**
> - russh 0.49 的 `client::Handler` 需要使用 `#[async_trait]`
> - `authenticate_password` 返回 `bool`（不需要 `.success()`，这是 0.60 的 API）
> - `PrivateKeyWithHashAlg::new` 返回 `Result`（需要 `?`），第二个参数是 `Option<HashAlg>`
> - `channel_open_session` 返回 `Channel<client::Msg>`，不是 `ChannelId`

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/client.rs
git commit -m "feat(ssh): add SSH client core with connection, auth, and PTY"
```

---

## Task 4: 创建 WebSocket PTY 服务器

**Files:**
- Create: `src-tauri/src/ssh/websocket.rs`

- [ ] **Step 1: 创建 ssh/websocket.rs**

```rust
use futures::{SinkExt, StreamExt};
use russh::ChannelMsg;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

/// 启动 WebSocket 服务器，桥接 SSH Channel 和 WebSocket
pub async fn start_pty_server(
    port: u16,
    channel: Arc<Mutex<russh::Channel<russh::client::Msg>>>,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    let (stream, _) = listener.accept().await?;
    let ws_stream = tokio_tungstenite::accept_async(stream).await?;
    let (mut ws_write, mut ws_read) = ws_stream.split();

    // SSH → WebSocket
    let channel_ssh_to_ws = channel.clone();
    let ssh_to_ws = tokio::spawn(async move {
        loop {
            let msg = {
                let mut ch = channel_ssh_to_ws.lock().await;
                ch.wait().await
            };
            match msg {
                Some(ChannelMsg::Data { ref data }) => {
                    if ws_write
                        .send(Message::Binary(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    if ws_write
                        .send(Message::Binary(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some(ChannelMsg::ExitStatus { .. }) | None => break,
                _ => {}
            }
        }
    });

    // WebSocket → SSH
    let ws_to_ssh = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            match msg {
                Message::Binary(data) => {
                    let mut ch = channel.lock().await;
                    if ch.data(&data[..]).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::try_join!(ssh_to_ws, ws_to_ssh)?;
    Ok(())
}
```

> **关键说明：**
> - `Channel` 通过 `Arc<Mutex<Channel>>` 在多个 tokio task 间共享
> - `channel.wait()` 接收 SSH 数据（`ChannelMsg::Data`）
> - `channel.data(&[u8])` 发送数据到 SSH 服务器（`&[u8]` 实现了 `AsyncRead`）
> - WebSocket 只接受一个连接（前端 xterm.js），收到连接后立即开始桥接

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/websocket.rs
git commit -m "feat(ssh): add WebSocket PTY server bridging SSH and WebSocket"
```

---

## Task 5: 创建 SSH 会话管理器

**Files:**
- Create: `src-tauri/src/ssh/session.rs`

- [ ] **Step 1: 创建 ssh/session.rs**

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::client::SshConnectionManager;
use super::types::{SshAuthType, SshConnection, SshSessionInfo};

pub struct SshSessionManager {
    sessions: Mutex<HashMap<String, SshSession>>,
}

pub struct SshSession {
    pub info: SshSessionInfo,
    pub connection_manager: SshConnectionManager,
    pub channel: Option<Arc<Mutex<russh::Channel<russh::client::Msg>>>>,
}

impl SshSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn create_session(
        &self,
        connection: &SshConnection,
    ) -> anyhow::Result<String> {
        let session_id = Uuid::new_v4().to_string();
        let mut manager = SshConnectionManager::connect((
            connection.host.as_str(),
            connection.port,
        ))
        .await?;

        let auth_result = manager
            .authenticate(&connection.username, &connection.auth_type)
            .await?;

        if !auth_result {
            anyhow::bail!("Authentication failed");
        }

        let info = SshSessionInfo {
            session_id: session_id.clone(),
            connection_id: connection.id,
            host: connection.host.clone(),
            username: connection.username.clone(),
            connected: true,
            connected_at: chrono::Local::now().to_rfc3339(),
            websocket_port: 0,
        };

        let session = SshSession {
            info,
            connection_manager: manager,
            channel: None,
        };

        self.sessions.lock().await.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn open_pty(
        &self,
        session_id: &str,
    ) -> anyhow::Result<u16> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let channel = session.connection_manager.open_pty().await?;
        let websocket_port = find_available_port().await?;

        let channel_arc = Arc::new(Mutex::new(channel));
        session.channel = Some(channel_arc.clone());
        session.info.websocket_port = websocket_port;

        // 启动 WebSocket 服务器
        tokio::spawn(async move {
            let _ = super::websocket::start_pty_server(websocket_port, channel_arc).await;
        });

        Ok(websocket_port)
    }

    pub async fn disconnect(&self, session_id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(mut session) = sessions.remove(session_id) {
            let _ = session.connection_manager.disconnect().await;
        }
        Ok(())
    }

    pub async fn get_session_info(
        &self,
        session_id: &str,
    ) -> Option<SshSessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|s| s.info.clone())
    }
}

async fn find_available_port() -> anyhow::Result<u16> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
```

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/session.rs
git commit -m "feat(ssh): add SSH session manager with PTY and WebSocket lifecycle"
```

---

## Task 6: 扩展数据库

**Files:**
- Modify: `src-tauri/src/database.rs`

- [ ] **Step 1: 追加 SSH 连接表到 init 方法**

在 `database.rs` 的 `init()` 方法中，在 `CREATE INDEX IF NOT EXISTS idx_resource_snapshots_timestamp` 之后追加：

```rust
            CREATE TABLE IF NOT EXISTS ssh_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                auth_data TEXT NOT NULL,
                group_name TEXT DEFAULT '默认',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
```

- [ ] **Step 2: 追加 SshConnection 结构体**

在 `database.rs` 中 `Group` 结构体之后追加：

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub auth_data: String,
    pub group_name: String,
    pub created_at: String,
    pub updated_at: String,
}
```

> **注意：** 这里使用扁平结构（auth_type 和 auth_data 分开存储），前端序列化/反序列化在 commands.rs 中处理。

- [ ] **Step 3: 追加 SSH 连接 CRUD 方法**

在 `Database` impl 末尾追加：

```rust
    // === SSH Connection CRUD ===

    pub fn create_ssh_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        auth_type: &str,
        auth_data: &str,
        group_name: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ssh_connections (name, host, port, username, auth_type, auth_data, group_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![name, host, port, username, auth_type, auth_data, group_name],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_ssh_connections(&self) -> Result<Vec<SshConnection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, auth_type, auth_data, group_name, created_at, updated_at
             FROM ssh_connections ORDER BY created_at DESC"
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(SshConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    auth_type: row.get(5)?,
                    auth_data: row.get(6)?,
                    group_name: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(connections)
    }

    pub fn get_ssh_connection(&self, id: i64) -> Result<SshConnection> {
        let conn = self.conn.lock().unwrap();
        let connection = conn.query_row(
            "SELECT id, name, host, port, username, auth_type, auth_data, group_name, created_at, updated_at
             FROM ssh_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(SshConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    auth_type: row.get(5)?,
                    auth_data: row.get(6)?,
                    group_name: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;
        Ok(connection)
    }

    pub fn delete_ssh_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM ssh_connections WHERE id = ?1", params![id])?;
        Ok(())
    }
```

- [ ] **Step 4: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database.rs
git commit -m "feat(db): add ssh_connections table and CRUD operations"
```

---

## Task 7: 追加 IPC 命令

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 追加导入**

在 `commands.rs` 顶部追加：

```rust
use crate::ssh::types::SshAuthType;
```

- [ ] **Step 2: 追加请求结构体和命令**

在文件末尾追加：

```rust
// === SSH Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateSshConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SshAuthType,
    pub group_name: String,
}

#[tauri::command]
pub fn create_ssh_connection(
    state: State<AppState>,
    req: CreateSshConnectionRequest,
) -> Result<i64, String> {
    let auth_type_str = match &req.auth_type {
        SshAuthType::Password { .. } => "password",
        SshAuthType::PublicKey { .. } => "publickey",
    };
    let auth_data = serde_json::to_string(&req.auth_type).map_err(|e| e.to_string())?;

    state
        .db
        .create_ssh_connection(
            &req.name,
            &req.host,
            req.port,
            &req.username,
            auth_type_str,
            &auth_data,
            &req.group_name,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_ssh_connections(
    state: State<AppState>,
) -> Result<Vec<database::SshConnection>, String> {
    state.db.list_ssh_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_ssh_connection(
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    state.db.delete_ssh_connection(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<String, String> {
    let db_connection = state
        .db
        .get_ssh_connection(connection_id)
        .map_err(|e| e.to_string())?;

    // 反序列化 auth_data
    let auth_type: SshAuthType =
        serde_json::from_str(&db_connection.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_connection.id,
        name: db_connection.name,
        host: db_connection.host,
        port: db_connection.port,
        username: db_connection.username,
        auth_type,
        group_name: db_connection.group_name,
        created_at: db_connection.created_at,
        updated_at: db_connection.updated_at,
    };

    let session_id = state
        .ssh_session_manager
        .create_session(&connection)
        .await
        .map_err(|e| e.to_string())?;

    let websocket_port = state
        .ssh_session_manager
        .open_pty(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("ws://127.0.0.1:{}", websocket_port))
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .ssh_session_manager
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): add SSH IPC commands for connection CRUD and session management"
```

---

## Task 8: 扩展 AppState 和 main.rs

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 追加模块声明和导入**

在 `main.rs` 中，在 `mod system;` 之后追加：

```rust
mod ssh;
```

在 `use process::ProcessManager;` 之后追加：

```rust
use ssh::session::SshSessionManager;
```

- [ ] **Step 2: 扩展 AppState**

修改 `AppState` 结构体：

```rust
pub struct AppState {
    db: Database,
    process_manager: Mutex<ProcessManager>,
    ssh_session_manager: SshSessionManager,
}
```

- [ ] **Step 3: 修改 setup 中的 state 初始化**

在 `setup` closure 中修改 state 创建：

```rust
            let state = AppState {
                db,
                process_manager: Mutex::new(ProcessManager::new()),
                ssh_session_manager: SshSessionManager::new(),
            };
```

- [ ] **Step 4: 注册新 IPC 命令**

在 `invoke_handler` 中追加 SSH 命令：

```rust
            // SSH commands
            commands::create_ssh_connection,
            commands::list_ssh_connections,
            commands::delete_ssh_connection,
            commands::ssh_connect,
            commands::ssh_disconnect,
```

- [ ] **Step 5: 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(main): register SSH module, extend AppState with session manager"
```

---

## Task 9: 安装前端依赖

**Files:**
- Modify: `package.json`
- Modify: `src/styles.css`

- [ ] **Step 1: 安装 xterm.js 依赖**

Run: `npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links`

- [ ] **Step 2: 追加 xterm 样式**

在 `src/styles.css` 末尾追加：

```css
/* xterm.js styles */
.xterm {
  height: 100% !important;
  padding: 8px;
}

.xterm-viewport {
  background-color: transparent !important;
}

.xterm-screen {
  width: 100% !important;
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/styles.css
git commit -m "deps: add xterm.js and terminal styling"
```

---

## Task 10: 创建前端类型定义

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 追加 SSH 类型**

在 `src/types/index.ts` 末尾追加：

```typescript
export interface SshConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type:
    | { type: "Password"; password: string }
    | { type: "PublicKey"; key_path: string; passphrase?: string };
  group_name: string;
  created_at: string;
  updated_at: string;
}

export interface SshSessionInfo {
  session_id: string;
  connection_id: number;
  host: string;
  username: string;
  connected: boolean;
  connected_at: string;
  websocket_port: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add SSH connection and session types"
```

---

## Task 11: 创建前端 API 封装

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: 追加导入**

在 `src/lib/api.ts` 中，修改第一行的 import：

```typescript
import type { Service, DockerContainer, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, SshConnection } from "@/types";
```

- [ ] **Step 2: 追加 SSH API 函数**

在文件末尾追加：

```typescript
// ===== SSH 管理 =====

export async function createSshConnection(
  data: Omit<SshConnection, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_ssh_connection", { req: data });
}

export async function listSshConnections(): Promise<SshConnection[]> {
  return invoke("list_ssh_connections");
}

export async function deleteSshConnection(id: number): Promise<void> {
  return invoke("delete_ssh_connection", { id });
}

export async function sshConnect(connectionId: number): Promise<string> {
  return invoke("ssh_connect", { connectionId });
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  return invoke("ssh_disconnect", { sessionId });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): add SSH connection and session API wrappers"
```

---

## Task 12: 创建 xterm.js 组件

**Files:**
- Create: `src/components/terminal/XTerm.tsx`

- [ ] **Step 1: 创建 XTerm.tsx**

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface XTermProps {
  websocketUrl: string;
}

export default function XTerm({ websocketUrl }: XTermProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: 'Menlo, "DejaVu Sans Mono", "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#10b981",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current!);
    fitAddon.fit();

    const ws = new WebSocket(websocketUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected to SSH session\x1b[0m\r\n");
    };

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      term.write(data);
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[31m[Connection closed]\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[Connection error]\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current!);

    termRef.current = term;

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [websocketUrl]);

  return <div ref={terminalRef} className="h-full w-full" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/XTerm.tsx
git commit -m "feat(terminal): add xterm.js wrapper component with WebSocket integration"
```

---

## Task 13: 创建终端页面

**Files:**
- Create: `src/pages/Terminal.tsx`

- [ ] **Step 1: 创建 Terminal.tsx**

```tsx
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Terminal as TerminalIcon, Plus, Unplug } from "lucide-react";
import XTerm from "@/components/terminal/XTerm";
import {
  createSshConnection,
  listSshConnections,
  deleteSshConnection,
  sshConnect,
  sshDisconnect,
} from "@/lib/api";
import type { SshConnection } from "@/types";

export default function Terminal() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [websocketUrl, setWebsocketUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formHost, setFormHost] = useState("");
  const [formPort, setFormPort] = useState("22");
  const [formUsername, setFormUsername] = useState("");
  const [formAuthType, setFormAuthType] = useState<"password" | "publickey">("password");
  const [formPassword, setFormPassword] = useState("");
  const [formKeyPath, setFormKeyPath] = useState("");
  const [formKeyPassphrase, setFormKeyPassphrase] = useState("");

  const loadConnections = useCallback(async () => {
    try {
      const list = await listSshConnections();
      setConnections(list);
    } catch (err) {
      console.error("Failed to load connections:", err);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleCreateConnection = async () => {
    try {
      const authType =
        formAuthType === "password"
          ? { type: "Password" as const, password: formPassword }
          : {
              type: "PublicKey" as const,
              key_path: formKeyPath,
              passphrase: formKeyPassphrase || undefined,
            };

      await createSshConnection({
        name: formName,
        host: formHost,
        port: parseInt(formPort, 10) || 22,
        username: formUsername,
        auth_type: authType,
        group_name: "默认",
      });

      setShowNewDialog(false);
      resetForm();
      loadConnections();
    } catch (err) {
      console.error("Failed to create connection:", err);
      alert("保存连接失败: " + String(err));
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormHost("");
    setFormPort("22");
    setFormUsername("");
    setFormAuthType("password");
    setFormPassword("");
    setFormKeyPath("");
    setFormKeyPassphrase("");
  };

  const handleConnect = async (connectionId: number) => {
    if (connecting) return;
    setConnecting(true);
    try {
      const wsUrl = await sshConnect(connectionId);
      setWebsocketUrl(wsUrl);
    } catch (err) {
      console.error("Failed to connect:", err);
      alert("连接失败: " + String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (sessionId) {
      try {
        await sshDisconnect(sessionId);
      } catch (err) {
        console.error("Failed to disconnect:", err);
      }
    }
    setWebsocketUrl("");
    setSessionId("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 border-b p-3">
        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-3 w-3" />
              新建连接
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>新建 SSH 连接</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  placeholder="例如：生产服务器"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="host">主机</Label>
                  <Input
                    id="host"
                    placeholder="192.168.1.1"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">端口</Label>
                  <Input
                    id="port"
                    placeholder="22"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  placeholder="root"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>认证方式</Label>
                <Select
                  value={formAuthType}
                  onValueChange={(v: "password" | "publickey") =>
                    setFormAuthType(v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">密码</SelectItem>
                    <SelectItem value="publickey">公钥</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formAuthType === "password" ? (
                <div className="space-y-2">
                  <Label htmlFor="password">密码</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="keyPath">密钥路径</Label>
                    <Input
                      id="keyPath"
                      placeholder="~/.ssh/id_rsa"
                      value={formKeyPath}
                      onChange={(e) => setFormKeyPath(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keyPassphrase">密钥密码（可选）</Label>
                    <Input
                      id="keyPassphrase"
                      type="password"
                      value={formKeyPassphrase}
                      onChange={(e) => setFormKeyPassphrase(e.target.value)}
                    />
                  </div>
                </>
              )}
              <Button
                className="w-full"
                onClick={handleCreateConnection}
                disabled={!formName || !formHost || !formUsername}
              >
                保存连接
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Select
          value={selectedConnectionId}
          onValueChange={(value) => {
            setSelectedConnectionId(value);
            if (value) {
              handleConnect(parseInt(value, 10));
            }
          }}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="选择连接" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} ({c.host})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {websocketUrl && (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDisconnect}
            >
              <Unplug className="mr-1 h-3 w-3" />
              断开
            </Button>
            <span className="ml-auto text-xs text-emerald-500 flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              已连接
            </span>
          </>
        )}

        {connecting && (
          <span className="ml-auto text-xs text-muted-foreground">
            连接中...
          </span>
        )}
      </div>

      {/* 终端区域 */}
      <div className="flex-1 overflow-hidden bg-[#1a1a2e]">
        {websocketUrl ? (
          <XTerm websocketUrl={websocketUrl} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <TerminalIcon className="mx-auto mb-3 h-12 w-12 opacity-50" />
              <p className="text-sm">选择一个连接或新建连接</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Terminal.tsx
git commit -m "feat(terminal): add Terminal page with connection manager and xterm"
```

---

## Task 14: 注册路由和导航

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: App.tsx 追加路由**

在 `src/App.tsx` 中：

1. 导入 Terminal：

```tsx
import Terminal from "./pages/Terminal";
```

2. 在 Routes 中添加：

```tsx
<Route path="terminal" element={<Terminal />} />
```

- [ ] **Step 2: Layout.tsx 追加导航**

在 `src/components/Layout.tsx` 中：

1. 导入 TerminalIcon：

```tsx
import { Terminal as TerminalIcon } from "lucide-react";
```

2. 在 `navItems` 数组中添加（放在 "导航" 之前）：

```tsx
const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/services", icon: Server, label: "服务" },
  { to: "/docker", icon: Container, label: "Docker" },
  { to: "/bookmarks", icon: Bookmark, label: "导航" },
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
  { to: "/system", icon: Activity, label: "系统" },
];
```

- [ ] **Step 3: 验证前端编译**

Run: `npm run build`
Expected: TypeScript 编译成功，无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "feat(routing): add Terminal route and sidebar navigation"
```

---

## Task 15: 端到端验证

**Files:** 不涉及文件修改

- [ ] **Step 1: 编译完整项目**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: Rust 编译成功

Run: `npm run build`
Expected: 前端编译成功

- [ ] **Step 2: 启动开发模式**

Run: `npm run tauri dev`

- [ ] **Step 3: 功能验证（需要 SSH 服务器）**

1. 打开 MacOps 应用，点击侧边栏「终端」
2. 点击「新建连接」，填写：
   - 名称：测试服务器
   - 主机：localhost（或你的测试服务器 IP）
   - 端口：22
   - 用户名：你的用户名
   - 认证方式：密码
   - 密码：你的密码
3. 点击「保存连接」
4. 从下拉列表选择刚保存的连接
5. 观察终端区域：应显示绿色 "Connected to SSH session"
6. 输入 `ls` 或 `pwd`，应看到命令输出
7. 点击「断开」，应显示红色 "[Connection closed]"

- [ ] **Step 4: 异常验证**

1. 连接不存在的主机，应看到错误提示
2. 输入错误的密码，应看到 "Authentication failed" 提示
3. 断开网络后，终端应显示 "[Connection closed]"

---

## 自审检查

### Spec 覆盖检查

| 设计文档要求 | 对应任务 |
|-------------|---------|
| SSH 连接配置 CRUD | Task 6 (DB), Task 7 (Commands) |
| 密码认证 | Task 3 (client.rs auth_password) |
| 公钥认证 | Task 3 (client.rs auth_publickey) |
| PTY 打开 | Task 3 (client.rs open_pty) |
| WebSocket 桥接 | Task 4 (websocket.rs) |
| 会话生命周期管理 | Task 5 (session.rs) |
| xterm.js 组件 | Task 12 (XTerm.tsx) |
| 终端页面 UI | Task 13 (Terminal.tsx) |
| 路由和导航 | Task 14 |
| 前端 API 封装 | Task 11 |

### Placeholder 扫描

- [x] 无 "TBD"、"TODO"、"implement later"
- [x] 无 "Add appropriate error handling" 等模糊描述
- [x] 每个步骤包含完整代码
- [x] 无 "Similar to Task N"

### 类型一致性检查

- [x] `SshAuthType` 在 Rust (types.rs) 和 TypeScript (types/index.ts) 中一致
- [x] `SshConnection` 字段名前后一致
- [x] IPC 命令名与前端 `invoke` 调用一致
- [x] WebSocket URL 格式 `ws://127.0.0.1:PORT` 前后一致

---

*实施计划版本 1.0 | 基于设计文档 2026-05-16-ssh-terminal-design.md*
