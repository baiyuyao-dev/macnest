# MacOps SSH 终端功能设计文档

> 版本: 1.0 | 日期: 2026-05-16 | 状态: 待审查

---

## 一、背景与目标

MacOps 当前是一个本地运维面板，包含服务管理、Docker 管理、书签导航、系统监控四大模块。本设计文档为 MacOps 增加 **SSH 终端** 功能，使用户能够通过 MacOps 直接连接远程服务器并执行命令。

**本期目标（最小可用）：**
- 保存 SSH 连接配置（主机、端口、用户名、认证方式）
- 通过 xterm.js 前端终端连接远程 SSH 服务器
- 支持密码认证和公钥认证
- 终端支持基础交互（输入、输出、光标）

**非本期目标：**
- SFTP 文件传输
- 多标签终端
- 端口转发 / 跳板机
- X11 转发
- 同步输入

---

## 二、架构概览

### 2.1 核心链路（方案 C）

采用"先打通核心链路，再完善外围"的策略：

```
前端 React                WebSocket 层              Rust 后端

xterm.js  ──输入──>  ws://127.0.0.1:PORT  ──>  tokio-tungstenite
  ↑                                                  │
  │                                              russh Channel
  │                                                  │
  │                                              SSH Server
  └────输出──────────────────────────────────────────┘
```

**数据流向：**
1. 用户在 xterm.js 终端输入字符
2. 前端通过 WebSocket 发送二进制数据到本地端口
3. Rust WebSocket 服务器接收数据，写入 russh Channel
4. SSH 服务器返回的数据通过 russh Channel 读取
5. WebSocket 将数据发回前端
6. xterm.js 渲染输出

### 2.2 模块关系

```
src-tauri/src/
  main.rs           ← 注册 SSH 命令，管理 SSH 会话状态
  commands.rs       ← 追加 SSH IPC 命令
  database.rs       ← 追加 ssh_connections 表
  ssh/
    mod.rs          ← SSH 客户端核心（连接、认证、PTY）
    session.rs      ← 会话管理器（内存中的活动会话）
    websocket.rs    ← WebSocket PTY 服务器
    types.rs        ← SSH 相关数据结构

src/
  App.tsx           ← 追加 /terminal 路由
  components/Layout.tsx  ← 追加「终端」侧边栏入口
  pages/Terminal.tsx     ← 终端页面
  components/terminal/
    XTerm.tsx       ← xterm.js 封装组件
  lib/api.ts        ← 追加 SSH API 调用
  types/index.ts    ← 追加 SSH 类型
```

---

## 三、Rust 后端设计

### 3.1 数据类型（ssh/types.rs）

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
    pub session_id: String,     // UUID
    pub connection_id: i64,
    pub host: String,
    pub username: String,
    pub connected: bool,
    pub connected_at: String,
    pub websocket_port: u16,
}
```

### 3.2 SSH 连接核心（ssh/mod.rs）

```rust
use russh::*;
use russh_keys::*;
use tokio::sync::mpsc;
use anyhow::Result;
use std::sync::Arc;

pub struct SshClientHandler;

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // 暂时自动接受所有主机密钥（后续可添加 known_hosts 验证）
        Ok(true)
    }
}

pub struct SshConnectionManager {
    handle: client::Handle<SshClientHandler>,
}

impl SshConnectionManager {
    pub async fn connect(host: &str, port: u16) -> Result<Self> {
        let client_config = client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(300)),
            preferred: CipherPreference::DEFAULT,
            ..Default::default()
        };
        let config = Arc::new(client_config);
        let handler = SshClientHandler;
        let addrs = (host, port);
        let handle = client::connect(config, addrs, handler).await?;
        Ok(Self { handle })
    }

    pub async fn auth_password(&self, username: &str, password: &str) -> Result<bool> {
        let auth_res = self.handle
            .authenticate_password(username, password)
            .await?;
        Ok(auth_res)
    }

    pub async fn auth_publickey(
        &self,
        username: &str,
        key_path: &str,
        passphrase: Option<&str>,
    ) -> Result<bool> {
        let key_pair = load_secret_key(key_path, passphrase)?;
        let auth_res = self.handle
            .authenticate_publickey(username, Arc::new(key_pair))
            .await?;
        Ok(auth_res)
    }

    pub async fn open_pty(&self) -> Result<ChannelId> {
        let mut channel = self.handle.channel_open_session().await?;
        channel.request_pty(
            true,
            "xterm-256color",
            80,
            24,
            0,
            0,
            &[],
        ).await?;
        channel.request_shell(true).await?;
        Ok(channel.id())
    }

    pub fn get_handle(&self) -> &client::Handle<SshClientHandler> {
        &self.handle
    }
}
```

### 3.3 会话管理器（ssh/session.rs）

内存中管理所有活动 SSH 会话：

```rust
use std::collections::HashMap;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct SshSessionManager {
    sessions: Mutex<HashMap<String, SshSession>>,
}

pub struct SshSession {
    pub info: SshSessionInfo,
    pub connection_manager: SshConnectionManager,
    pub channel_id: Option<russh::ChannelId>,
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
    ) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();
        let manager = SshConnectionManager::connect(
            &connection.host,
            connection.port,
        ).await?;

        let session = SshSession {
            info: SshSessionInfo {
                session_id: session_id.clone(),
                connection_id: connection.id,
                host: connection.host.clone(),
                username: connection.username.clone(),
                connected: true,
                connected_at: chrono::Local::now().to_rfc3339(),
                websocket_port: 0, // 将在 open_pty 时分配
            },
            connection_manager: manager,
            channel_id: None,
        };

        self.sessions.lock().await.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn authenticate(
        &self,
        session_id: &str,
        username: &str,
        auth: &SshAuthType,
    ) -> Result<bool> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions.get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let result = match auth {
            SshAuthType::Password { password } => {
                session.connection_manager.auth_password(username, password).await
            }
            SshAuthType::PublicKey { key_path, passphrase } => {
                session.connection_manager.auth_publickey(
                    username,
                    key_path,
                    passphrase.as_deref(),
                ).await
            }
        };

        result
    }

    pub async fn open_pty(&self, session_id: &str) -> Result<(ChannelId, u16)> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions.get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let channel_id = session.connection_manager.open_pty().await?;
        let websocket_port = find_available_port().await?;

        session.channel_id = Some(channel_id);
        session.info.websocket_port = websocket_port;

        // 启动 WebSocket 服务器
        let handle = session.connection_manager.get_handle().clone();
        tokio::spawn(async move {
            let _ = websocket::start_pty_server(websocket_port, handle, channel_id).await;
        });

        Ok((channel_id, websocket_port))
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(session_id) {
            if let Some(channel_id) = session.channel_id {
                let _ = session.connection_manager.get_handle()
                    .close(channel_id).await;
            }
        }
        Ok(())
    }
}

async fn find_available_port() -> Result<u16> {
    use tokio::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
```

### 3.4 WebSocket PTY 服务器（ssh/websocket.rs）

```rust
use tokio_tungstenite::accept_async;
use futures::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

pub async fn start_pty_server(
    port: u16,
    ssh_handle: russh::client::Handle<SshClientHandler>,
    channel_id: russh::ChannelId,
) -> Result<()> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    let (stream, _) = listener.accept().await?;
    let ws_stream = accept_async(stream).await?;
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // SSH 数据 → WebSocket
    let ssh_to_ws = tokio::spawn(async move {
        let mut data = vec![0u8; 8192];
        loop {
            match ssh_handle.read(channel_id, &mut data).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_write
                        .send(tokio_tungstenite::tungstenite::Message::Binary(
                            data[..n].to_vec(),
                        ))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // WebSocket → SSH
    let ws_to_ssh = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            if let tokio_tungstenite::tungstenite::Message::Binary(data) = msg {
                // 通过 tx 发送数据（实际实现需要调整）
            }
        }
    });

    tokio::try_join!(ssh_to_ws, ws_to_ssh)?;
    Ok(())
}
```

> **注：** 实际实现中，russh 的 `client::Handle::data()` 方法需要通过 channel 的 sender 发送数据。具体实现需要根据 russh 的实际 API 调整数据流桥接逻辑。

### 3.5 IPC 命令（commands.rs 追加）

```rust
// === SSH 命令 ===

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
    state.db.create_ssh_connection(
        &req.name,
        &req.host,
        req.port,
        &req.username,
        &req.auth_type,
        &req.group_name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_ssh_connections(
    state: State<AppState>,
) -> Result<Vec<SshConnection>, String> {
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
    let connection = state.db.get_ssh_connection(connection_id)
        .map_err(|e| e.to_string())?;

    let session_id = state.ssh_session_manager
        .create_session(&connection)
        .await
        .map_err(|e| e.to_string())?;

    let auth_result = state.ssh_session_manager
        .authenticate(&session_id, &connection.username, &connection.auth_type)
        .await
        .map_err(|e| e.to_string())?;

    if !auth_result {
        return Err("Authentication failed".to_string());
    }

    let (_, websocket_port) = state.ssh_session_manager
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
    state.ssh_session_manager
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}
```

### 3.6 AppState 扩展（main.rs）

```rust
use ssh::session::SshSessionManager;

pub struct AppState {
    db: Database,
    process_manager: Mutex<ProcessManager>,
    ssh_session_manager: SshSessionManager,
}

// 初始化时：
let state = AppState {
    db,
    process_manager: Mutex::new(ProcessManager::new()),
    ssh_session_manager: SshSessionManager::new(),
};
```

---

## 四、数据库设计

### 4.1 ssh_connections 表

```sql
CREATE TABLE IF NOT EXISTS ssh_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,      -- 'password' | 'publickey'
    auth_data TEXT NOT NULL,      -- JSON: {password} 或 {key_path, passphrase}
    group_name TEXT DEFAULT '默认',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Database 方法追加

```rust
impl Database {
    pub fn create_ssh_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        auth_type: &SshAuthType,
        group_name: &str,
    ) -> Result<i64> {
        let auth_data = serde_json::to_string(auth_type)?;
        let auth_type_str = match auth_type {
            SshAuthType::Password { .. } => "password",
            SshAuthType::PublicKey { .. } => "publickey",
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ssh_connections (name, host, port, username, auth_type, auth_data, group_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![name, host, port, username, auth_type_str, auth_data, group_name],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_ssh_connections(&self) -> Result<Vec<SshConnection>> {
        // ... SELECT 并反序列化 auth_data
    }

    pub fn get_ssh_connection(&self, id: i64) -> Result<SshConnection> {
        // ... SELECT WHERE id = ?
    }

    pub fn delete_ssh_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM ssh_connections WHERE id = ?1", params![id])?;
        Ok(())
    }
}
```

---

## 五、前端设计

### 5.1 新增依赖

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

### 5.2 xterm.js 组件（components/terminal/XTerm.tsx）

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

### 5.3 终端页面（pages/Terminal.tsx）

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Terminal as TerminalIcon, Plus } from "lucide-react";
import XTerm from "@/components/terminal/XTerm";
import { sshConnect, listSshConnections } from "@/lib/api";

export default function Terminal() {
  const [connections, setConnections] = useState<SshConnection[]>([]);
  const [websocketUrl, setWebsocketUrl] = useState<string>("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // ... 加载连接列表、处理连接逻辑

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 border-b p-3">
        <Button size="sm" onClick={() => setShowNewDialog(true)}>
          <Plus className="mr-1 h-3 w-3" />新建连接
        </Button>
        <Select onValueChange={handleConnect}>
          <SelectTrigger className="w-[200px]">
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
          <span className="ml-auto text-xs text-emerald-500">
            <span className="mr-1">●</span>已连接
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
              <p>选择一个连接或新建连接</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 5.4 API 封装（lib/api.ts 追加）

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

### 5.5 路由和导航

**App.tsx 追加：**
```tsx
import Terminal from "./pages/Terminal";

// 在 Routes 中添加：
<Route path="terminal" element={<Terminal />} />
```

**Layout.tsx 追加：**
```tsx
import { Terminal as TerminalIcon } from "lucide-react";

const navItems = [
  // ... 现有项
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
];
```

---

## 六、依赖变更

### 6.1 Cargo.toml 新增

```toml
[dependencies]
russh = { version = "0.43", features = ["openssl", "vendored-openssl"] }
russh-keys = { version = "0.43", features = ["vendored-openssl"] }
tokio-tungstenite = "0.21"
futures = "0.3"
async-trait = "0.1"
```

### 6.2 package.json 新增

```json
{
  "dependencies": {
    "@xterm/xterm": "^5.3.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0"
  }
}
```

### 6.3 styles.css 追加

```css
.xterm {
  height: 100% !important;
  padding: 8px;
}

.xterm-viewport {
  background-color: transparent !important;
}
```

---

## 七、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| russh + OpenSSL 在 macOS 上编译失败 | 中 | 高 | 先用 `cargo check` 验证编译；如遇问题尝试 `openssl-vendored` feature 或降级版本 |
| russh API 版本差异（0.43） | 中 | 中 | 以实际 crates.io 最新版本为准，设计中的代码为参考，实际实现根据 API 调整 |
| WebSocket 数据流桥接（russh Channel → WebSocket） | 高 | 高 | 这是核心风险点。russh 的 channel 数据读写需要通过特定 API，可能需要多轮调试。预留 1-2 天缓冲 |
| xterm.js 与 WebSocket 编码问题 | 低 | 中 | 使用 binaryType = "arraybuffer"，确保 UTF-8 编码正确 |
| 密钥文件路径跨平台 | 低 | 低 | macOS 上 `~/.ssh/id_rsa` 等路径直接使用 |

---

## 八、验证标准

### 8.1 单元验证

- [ ] `cargo check` 编译通过
- [ ] `npm install @xterm/xterm` 成功
- [ ] `npm run tauri dev` 启动成功

### 8.2 功能验证

- [ ] 在终端页面点击「新建连接」，填写主机/端口/用户名/密码，保存成功
- [ ] 保存的连接显示在下拉列表中
- [ ] 选择连接后，终端区域显示绿色 "Connected to SSH session"
- [ ] 能在终端中输入命令（如 `ls`、`pwd`）并看到输出
- [ ] 终端支持清屏（`clear` 或 Ctrl+L）
- [ ] 点击断开连接后，终端显示红色 "[Connection closed]"
- [ ] 断开连接后可以重新连接

### 8.3 异常验证

- [ ] 连接不存在的主机，显示友好的错误提示
- [ ] 密码错误时，显示认证失败提示
- [ ] 网络中断时，终端显示连接关闭

---

## 九、后续扩展（非本期）

| 功能 | Phase | 说明 |
|------|-------|------|
| 多标签终端 | Phase 2 | 类似浏览器标签，支持同时连接多台服务器 |
| SFTP 文件管理 | Phase 3 | 双面板文件浏览器，支持上传/下载/删除 |
| 传输队列 | Phase 3 | 显示文件传输进度 |
| 端口转发 | Phase 4 | 本地/远程端口映射 |
| known_hosts | Phase 4 | 主机密钥验证 |
| 会话日志 | Phase 4 | 自动记录终端操作 |
| 仪表盘 SSH 统计卡片 | Phase 2 | Dashboard 显示已连接会话数 |

---

*设计文档版本 1.0 | 基于 MacOps v0.1.0 + SSH-SFTP-INTEGRATION.md 技术方案*
