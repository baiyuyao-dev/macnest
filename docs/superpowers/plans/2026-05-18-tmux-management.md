# Tmux 管理功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MacOps 中增加本地 tmux 会话管理能力（列表/创建/重命名/Kill/内嵌终端 attach/Ghostty 外唤/配置生成）。

**Architecture:** 后端新增 `tmux/` 模块封装 tmux 命令和 PTY 管理（`portable-pty`），前端抽象 `BaseTerminal` 共享 xterm.js 渲染层，`TmuxTerminal` 通过 Tauri Channel 传输 PTY 数据流。

**Tech Stack:** Tauri v2, React 19, TypeScript, Rust, xterm.js, portable-pty

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/Cargo.toml` | 修改 | 添加 `portable-pty` 依赖 |
| `src-tauri/src/tmux/mod.rs` | 新建 | tmux 命令封装（list/create/kill/rename/检查安装/配置生成） |
| `src-tauri/src/tmux/pty.rs` | 新建 | PTY 会话管理（attach/write/close） |
| `src-tauri/src/tmux/types.rs` | 新建 | tmux 数据类型（TmuxSession 等） |
| `src-tauri/src/tmux.rs` | 新建 | tmux 模块入口（mod tmux） |
| `src-tauri/src/commands.rs` | 修改 | 追加 10 个 IPC 命令 |
| `src-tauri/src/main.rs` | 修改 | 注册命令 + AppState 新增 `tmux_pty_sessions` |
| `src/types/index.ts` | 修改 | 追加 Tmux 类型 |
| `src/lib/api.ts` | 修改 | 追加 Tmux API 函数 |
| `src/components/terminal/BaseTerminal.tsx` | 新建 | 共享 xterm.js 基础组件 |
| `src/components/terminal/TmuxTerminal.tsx` | 新建 | tmux 终端（Tauri Channel 数据源） |
| `src/components/terminal/XTerm.tsx` | 修改 | 重构为基于 BaseTerminal 的 SshTerminal |
| `src/pages/Tmux.tsx` | 新建 | tmux 管理主页面 |
| `src/App.tsx` | 修改 | 添加 `/tmux` 路由 |
| `src/components/Layout.tsx` | 修改 | 侧边栏添加 Tmux 入口 |
| `src/styles.css` | 修改 | 追加 xterm 终端区域滚动条样式 |

---

## Task 1: 添加 Rust 依赖

**Files:**
- 修改: `src-tauri/Cargo.toml`

- [ ] **Step 1: 添加 portable-pty 依赖**

在 `[dependencies]` 节末尾追加：

```toml
# === PTY 支持（tmux 内嵌终端）===
portable-pty = "1.0"
```

- [ ] **Step 2: 验证依赖可解析**

Run: `cd src-tauri && cargo check --message-format=short 2>&1 | head -20`

Expected: 无 `portable-pty` 相关错误，可能有一些编译警告

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add portable-pty for tmux PTY support"
```

---

## Task 2: 创建 tmux 数据类型

**Files:**
- 新建: `src-tauri/src/tmux/types.rs`

- [ ] **Step 1: 创建类型文件**

```rust
use serde::{Deserialize, Serialize};

/// tmux 会话信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxSession {
    pub name: String,
    pub windows: usize,
    pub attached: bool,
    pub created_at: String,
    pub pid: u32,
}

/// 创建会话请求
#[derive(Debug, Deserialize)]
pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
}

/// 重命名会话请求
#[derive(Debug, Deserialize)]
pub struct RenameTmuxSessionRequest {
    pub old_name: String,
    pub new_name: String,
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/tmux/types.rs
git commit -m "feat(tmux): add TmuxSession data types"
```

---

## Task 3: 创建 tmux 命令模块

**Files:**
- 新建: `src-tauri/src/tmux/mod.rs`

- [ ] **Step 1: 创建命令封装模块**

```rust
use std::process::Command;

use crate::tmux::types::{CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession};

/// 列出所有 tmux 会话
pub fn list_sessions() -> Result<Vec<TmuxSession>, String> {
    let output = Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_pid}",
        ])
        .output()
        .map_err(|e| format!("Failed to run tmux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            return Ok(Vec::new());
        }
        return Err(format!("tmux error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let now = chrono::Utc::now().timestamp();

    let sessions = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            TmuxSession {
                name: parts.get(0).unwrap_or(&"").to_string(),
                windows: parts.get(1).unwrap_or(&"0").parse().unwrap_or(0),
                attached: parts.get(2).unwrap_or(&"0") == "1",
                created_at: format_timestamp(parts.get(3).unwrap_or(&"0"), now),
                pid: parts.get(4).unwrap_or(&"0").parse().unwrap_or(0),
            }
        })
        .collect();

    Ok(sessions)
}

/// 创建新会话（detached 模式）
pub fn create_session(req: &CreateTmuxSessionRequest) -> Result<(), String> {
    let mut cmd = Command::new("tmux");
    cmd.args(["new-session", "-d", "-s", &req.name]);

    if let Some(ref dir) = req.start_directory {
        cmd.args(["-c", dir]);
    }

    if let Some(ref command) = req.command {
        cmd.arg(command);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// Kill 会话
pub fn kill_session(name: &str) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["kill-session", "-t", name])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// 重命名会话
pub fn rename_session(req: &RenameTmuxSessionRequest) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["rename-session", "-t", &req.old_name, &req.new_name])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// 检查 tmux 是否安装
pub fn is_tmux_available() -> bool {
    Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 生成 ~/.tmux.conf
pub fn generate_config() -> Result<String, String> {
    let config = r#"# MacOps 生成的 tmux 配置

# 鼠标支持
set -g mouse on

# 状态栏样式
set -g status-style bg=#1a1a2e,fg=#e0e0e0
set -g status-left " #[fg=#10b981]● #[fg=white]#S "
set -g status-right " %H:%M %Y-%m-%d "
set -g status-left-length 50
set -g status-right-length 50

# 窗口样式
set -g window-status-current-style bg=#10b981,fg=#000000,bold
set -g window-status-style bg=#1a1a2e,fg=#6272a4
set -g window-status-format " #I:#W "
set -g window-status-current-format " #I:#W "

# 边框样式
set -g pane-border-style fg=#6272a4
set -g pane-active-border-style fg=#10b981

# 消息样式
set -g message-style bg=#10b981,fg=#000000

# 复制模式 vi 风格
setw -g mode-keys vi

# 窗口编号从 1 开始
set -g base-index 1
setw -g pane-base-index 1

# 自动重命名窗口
setw -g automatic-rename on

# 历史行数
set -g history-limit 50000

# 聚焦事件
set -g focus-events on

# 256 色支持
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",*256col*:Tc"
"#;

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let config_path = home.join(".tmux.conf");

    std::fs::write(&config_path, config).map_err(|e| e.to_string())?;

    Ok(config_path.to_string_lossy().to_string())
}

/// 格式化时间戳为友好字符串
fn format_timestamp(seconds: &str, now: i64) -> String {
    let ts: i64 = seconds.parse().unwrap_or(0);
    let diff = now - ts;

    if diff < 60 {
        "刚刚".to_string()
    } else if diff < 3600 {
        format!("{} 分钟前", diff / 60)
    } else if diff < 86400 {
        format!("{} 小时前", diff / 3600)
    } else {
        format!("{} 天前", diff / 86400)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/tmux/mod.rs
git commit -m "feat(tmux): add tmux command wrappers (list/create/kill/rename/config)"
```

---

## Task 4: 创建 PTY 管理模块

**Files:**
- 新建: `src-tauri/src/tmux/pty.rs`

- [ ] **Step 1: 创建 PTY 模块**

```rust
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

pub struct TmuxPtySession {
    pub session_name: String,
    pub master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    pub _reader_thread: Option<std::thread::JoinHandle<()>>,
}

/// 创建 PTY 并 attach 到 tmux 会话
pub fn attach_session_pty(
    session_name: &str,
    channel: Channel<Vec<u8>>,
) -> Result<TmuxPtySession, String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("tmux");
    cmd.arg("attach");
    cmd.arg("-t");
    cmd.arg(session_name);
    cmd.env("TERM", "xterm-256color");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut master_reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let master_writer = Arc::new(Mutex::new(
        pair.master.try_clone_writer().map_err(|e| e.to_string())?,
    ));

    // 后台线程：PTY 输出 → Tauri Channel → 前端 xterm.js
    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match master_reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let _ = channel.send(buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
    });

    Ok(TmuxPtySession {
        session_name: session_name.to_string(),
        master: master_writer,
        _reader_thread: Some(reader_thread),
    })
}

/// 向 PTY 写入数据（用户键盘输入）
pub fn write_to_pty(session: &TmuxPtySession, data: &[u8]) -> Result<(), String> {
    let mut writer = session.master.lock().map_err(|e| e.to_string())?;
    writer.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/tmux/pty.rs
git commit -m "feat(tmux): add PTY session management via portable-pty"
```

---

## Task 5: 创建 tmux 模块入口

**Files:**
- 新建: `src-tauri/src/tmux.rs`

- [ ] **Step 1: 创建模块入口文件**

```rust
pub mod mod;
pub mod pty;
pub mod types;

// 重导出常用类型
pub use types::*;
```

- [ ] **Step 2: 在 main.rs 中注册 tmux 模块**

修改 `src-tauri/src/main.rs`，在 `mod` 声明区域追加：

```rust
mod commands;
mod database;
mod docker;
mod process;
mod system;
mod ssh;
mod tmux; // ← 新增
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/tmux.rs src-tauri/src/main.rs
git commit -m "feat(tmux): register tmux module in main.rs"
```

---

## Task 6: 更新全局状态 AppState

**Files:**
- 修改: `src-tauri/src/main.rs`

- [ ] **Step 1: 添加 HashMap import 和 PTY sessions 字段**

在 `main.rs` 顶部添加：

```rust
use std::collections::HashMap;
```

修改 `AppState` 结构体：

```rust
pub struct AppState {
    db: Database,
    process_manager: Mutex<ProcessManager>,
    ssh_session_manager: SshSessionManager,
    tmux_pty_sessions: Mutex<HashMap<String, crate::tmux::pty::TmuxPtySession>>,
}
```

修改 `setup` 中的 state 初始化：

```rust
let state = AppState {
    db,
    process_manager,
    ssh_session_manager: SshSessionManager::new(),
    tmux_pty_sessions: Mutex::new(HashMap::new()),
};
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tmux): add tmux_pty_sessions to AppState"
```

---

## Task 7: 添加 IPC 命令

**Files:**
- 修改: `src-tauri/src/commands.rs`（文件末尾追加）

- [ ] **Step 1: 追加 tmux IPC 命令**

在 `commands.rs` 文件末尾追加：

```rust
// === Tmux 管理 ===

use crate::tmux::types::{
    CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession,
};

#[tauri::command]
pub fn tmux_list_sessions() -> Result<Vec<TmuxSession>, String> {
    crate::tmux::mod::list_sessions()
}

#[tauri::command]
pub fn tmux_create_session(req: CreateTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::mod::create_session(&req)
}

#[tauri::command]
pub fn tmux_kill_session(name: String) -> Result<(), String> {
    crate::tmux::mod::kill_session(&name)
}

#[tauri::command]
pub fn tmux_rename_session(req: RenameTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::mod::rename_session(&req)
}

#[tauri::command]
pub fn tmux_is_available() -> bool {
    crate::tmux::mod::is_tmux_available()
}

#[tauri::command]
pub fn tmux_attach_pty(
    session_name: String,
    channel: Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pty_session = crate::tmux::pty::attach_session_pty(&session_name, channel)?;
    let pty_id = uuid::Uuid::new_v4().to_string();

    state
        .tmux_pty_sessions
        .lock()
        .unwrap()
        .insert(pty_id.clone(), pty_session);

    Ok(pty_id)
}

#[tauri::command]
pub fn tmux_pty_write(
    pty_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.tmux_pty_sessions.lock().unwrap();
    let session = sessions
        .get(&pty_id)
        .ok_or("PTY session not found")?;
    crate::tmux::pty::write_to_pty(session, &data)
}

#[tauri::command]
pub fn tmux_pty_close(pty_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.tmux_pty_sessions.lock().unwrap().remove(&pty_id);
    Ok(())
}

#[tauri::command]
pub fn tmux_open_in_ghostty(session_name: String) -> Result<(), String> {
    let script = format!(
        r#"tell application "Ghostty" to activate
tell application "Ghostty" to tell front window to create tab with default profile
tell application "System Events" to keystroke "tmux attach -t {}" & return"#,
        session_name
    );

    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn tmux_generate_config() -> Result<String, String> {
    crate::tmux::mod::generate_config()
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(tmux): add 10 IPC commands for tmux management"
```

---

## Task 8: 注册 IPC 命令到 Tauri

**Files:**
- 修改: `src-tauri/src/main.rs`

- [ ] **Step 1: 在 invoke_handler 中注册 tmux 命令**

在 `tauri::generate_handler![...]` 调用中追加 tmux 命令：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 已有命令 ...
    // Tmux 命令
    commands::tmux_list_sessions,
    commands::tmux_create_session,
    commands::tmux_kill_session,
    commands::tmux_rename_session,
    commands::tmux_is_available,
    commands::tmux_attach_pty,
    commands::tmux_pty_write,
    commands::tmux_pty_close,
    commands::tmux_open_in_ghostty,
    commands::tmux_generate_config,
])
```

- [ ] **Step 2: 验证编译通过**

Run: `cd src-tauri && cargo check --message-format=short 2>&1 | tail -20`

Expected: `error` 计数为 0（warnings 可以忽略）

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(tmux): register tmux commands in Tauri invoke handler"
```

---

## Task 9: 添加前端类型

**Files:**
- 修改: `src/types/index.ts`

- [ ] **Step 1: 追加 Tmux 类型到类型文件**

在 `src/types/index.ts` 末尾追加：

```typescript
// ===== Tmux 管理 =====

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  created_at: string;
  pid: number;
}

export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
}

export interface RenameTmuxSessionRequest {
  old_name: string;
  new_name: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(tmux): add TmuxSession frontend types"
```

---

## Task 10: 添加前端 API 封装

**Files:**
- 修改: `src/lib/api.ts`

- [ ] **Step 1: 追加 tmux API 函数**

在 `src/lib/api.ts` 末尾追加：

```typescript
// ===== Tmux 管理 =====

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  created_at: string;
  pid: number;
}

export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
}

export interface RenameTmuxSessionRequest {
  old_name: string;
  new_name: string;
}

export async function tmuxListSessions(): Promise<TmuxSession[]> {
  return invoke("tmux_list_sessions");
}

export async function tmuxCreateSession(req: CreateTmuxSessionRequest): Promise<void> {
  return invoke("tmux_create_session", { req });
}

export async function tmuxKillSession(name: string): Promise<void> {
  return invoke("tmux_kill_session", { name });
}

export async function tmuxRenameSession(req: RenameTmuxSessionRequest): Promise<void> {
  return invoke("tmux_rename_session", { req });
}

export async function tmuxIsAvailable(): Promise<boolean> {
  return invoke("tmux_is_available");
}

export async function tmuxAttachPty(sessionName: string, channel: unknown): Promise<string> {
  return invoke("tmux_attach_pty", { sessionName, channel });
}

export async function tmuxPtyWrite(ptyId: string, data: Uint8Array): Promise<void> {
  return invoke("tmux_pty_write", { ptyId, data: Array.from(data) });
}

export async function tmuxPtyClose(ptyId: string): Promise<void> {
  return invoke("tmux_pty_close", { ptyId });
}

export async function tmuxOpenInGhostty(sessionName: string): Promise<void> {
  return invoke("tmux_open_in_ghostty", { sessionName });
}

export async function tmuxGenerateConfig(): Promise<string> {
  return invoke("tmux_generate_config");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(tmux): add frontend API wrappers for tmux IPC"
```

---

## Task 11: 创建 BaseTerminal 共享组件

**Files:**
- 新建: `src/components/terminal/BaseTerminal.tsx`

- [ ] **Step 1: 创建基础终端组件**

```typescript
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface BaseTerminalProps {
  onData: (data: string) => void;
  onReady: (term: Terminal) => void;
  className?: string;
}

export default function BaseTerminal({ onData, onReady, className }: BaseTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

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

    term.open(terminalRef.current);
    fitAddon.fit();
    term.focus();

    term.onData((data) => {
      onData(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    onReady(term);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [onData, onReady]);

  return <div ref={terminalRef} className={className ?? "h-full w-full"} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/BaseTerminal.tsx
git commit -m "feat(terminal): add BaseTerminal shared xterm.js component"
```

---

## Task 12: 创建 TmuxTerminal 组件

**Files:**
- 新建: `src/components/terminal/TmuxTerminal.tsx`

- [ ] **Step 1: 创建 tmux 终端组件**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import BaseTerminal from "./BaseTerminal";
import { tmuxAttachPty, tmuxPtyClose, tmuxPtyWrite } from "@/lib/api";

interface TmuxTerminalProps {
  sessionName: string;
  onDetach: () => void;
}

export default function TmuxTerminal({ sessionName, onDetach }: TmuxTerminalProps) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  // 保持 ptyIdRef 与 state 同步
  useEffect(() => {
    ptyIdRef.current = ptyId;
  }, [ptyId]);

  // 终端就绪后建立 PTY 连接
  const handleReady = useCallback(
    async (term: Terminal) => {
      termRef.current = term;

      // 创建 Channel 接收 PTY 输出
      const { Channel } = await import("@tauri-apps/api/core");
      const channel = new Channel<Uint8Array>((message: unknown) => {
        if (message instanceof Uint8Array) {
          term.write(message);
        } else if (Array.isArray(message)) {
          // Tauri Channel 可能以 number[] 形式发送
          term.write(new Uint8Array(message));
        }
      });

      try {
        const id = await tmuxAttachPty(sessionName, channel);
        setPtyId(id);
      } catch (e) {
        term.writeln(`\r\n\x1b[31m[Failed to attach: ${e}]\x1b[0m`);
      }
    },
    [sessionName]
  );

  // 用户输入 → Rust PTY
  const handleData = useCallback((data: string) => {
    const id = ptyIdRef.current;
    if (id) {
      tmuxPtyWrite(id, new TextEncoder().encode(data)).catch(() => {
        // 忽略写入错误（PTY 可能已关闭）
      });
    }
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      const id = ptyIdRef.current;
      if (id) {
        tmuxPtyClose(id).catch(() => {});
      }
    };
  }, []);

  return <BaseTerminal onData={handleData} onReady={handleReady} className="h-full w-full" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/TmuxTerminal.tsx
git commit -m "feat(tmux): add TmuxTerminal component with Tauri Channel PTY"
```

---

## Task 13: 重构 XTerm.tsx 为基于 BaseTerminal

**Files:**
- 修改: `src/components/terminal/XTerm.tsx`

- [ ] **Step 1: 重构为 SshTerminal（基于 BaseTerminal）**

完整替换 `XTerm.tsx` 内容：

```typescript
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import BaseTerminal from "./BaseTerminal";

interface XTermProps {
  websocketUrl: string;
}

export default function XTerm({ websocketUrl }: XTermProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);

  const handleReady = useCallback((term: Terminal) => {
    termRef.current = term;
    term.loadAddon(new WebLinksAddon());

    const ws = new WebSocket(websocketUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected to SSH session\x1b[0m\r\n");
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      let data: Uint8Array;
      if (typeof event.data === "string") {
        data = new TextEncoder().encode(event.data);
      } else {
        data = new Uint8Array(event.data);
      }
      term.write(data);
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[31m[Connection closed]\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[Connection error]\x1b[0m");
    };
  }, [websocketUrl]);

  const handleData = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(data));
    }
  }, []);

  useEffect(() => {
    const term = termRef.current;
    const ws = wsRef.current;

    return () => {
      ws?.close();
      wsRef.current = null;
      // BaseTerminal 会负责 dispose term
    };
  }, []);

  return <BaseTerminal onData={handleData} onReady={handleReady} className="h-full w-full" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/XTerm.tsx
git commit -m "refactor(terminal): rewrite XTerm as SshTerminal based on BaseTerminal"
```

---

## Task 14: 创建 Tmux 管理页面

**Files:**
- 新建: `src/pages/Tmux.tsx`

- [ ] **Step 1: 创建主页面**

```tsx
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Monitor,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Square,
  ExternalLink,
  Terminal as TerminalIcon,
} from "lucide-react";
import TmuxTerminal from "@/components/terminal/TmuxTerminal";
import {
  tmuxListSessions,
  tmuxCreateSession,
  tmuxKillSession,
  tmuxRenameSession,
  tmuxOpenInGhostty,
} from "@/lib/api";
import type { TmuxSession } from "@/types";

export default function Tmux() {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTmux, setHasTmux] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tmuxListSessions();
      setSessions(data);
      setHasTmux(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("no server")) {
        setSessions([]);
        setHasTmux(true);
      } else {
        setHasTmux(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await tmuxCreateSession({ name: newName.trim() });
    setNewName("");
    setCreateOpen(false);
    loadSessions();
  };

  const handleKill = async (name: string) => {
    if (!confirm(`确定要删除 tmux 会话 "${name}" 吗？`)) return;
    await tmuxKillSession(name);
    if (activeSession === name) {
      setActiveSession(null);
    }
    loadSessions();
  };

  const handleRename = async () => {
    if (!newName.trim() || !renameTarget) return;
    await tmuxRenameSession({
      old_name: renameTarget,
      new_name: newName.trim(),
    });
    setNewName("");
    setRenameOpen(false);
    if (activeSession === renameTarget) {
      setActiveSession(newName.trim());
    }
    loadSessions();
  };

  const handleAttach = (name: string) => {
    setActiveSession(name);
  };

  const handleDetach = () => {
    setActiveSession(null);
  };

  const handleGhostty = async (name: string) => {
    await tmuxOpenInGhostty(name);
  };

  if (!hasTmux) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <TerminalIcon className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">未检测到 tmux</h2>
          <p className="mb-4 text-muted-foreground">
            请先安装 tmux：brew install tmux
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Tmux 会话</h1>
          <Badge variant="secondary">{sessions.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadSessions}>
            <RefreshCw className="mr-1 h-4 w-4" />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setNewName("");
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            新建会话
          </Button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：会话列表 */}
        <div
          className={`${activeSession ? "w-[320px]" : "flex-1"} overflow-auto border-r p-4`}
        >
          {sessions.length === 0 && !loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <TerminalIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-muted-foreground">没有 tmux 会话</p>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  创建第一个会话
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <Card
                  key={s.name}
                  className={`cursor-pointer transition-colors ${
                    activeSession === s.name
                      ? "border-primary bg-primary/5"
                      : "hover:bg-accent"
                  }`}
                  onClick={() => handleAttach(s.name)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-3 w-3 rounded-full ${
                            s.attached ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        <div>
                          <p className="font-semibold">{s.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.windows} 个窗口 · {s.created_at}
                            {s.attached && " · 已连接"}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {activeSession === s.name ? (
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDetach();
                            }}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGhostty(s.name);
                              }}
                              title="Ghostty 中打开"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameTarget(s.name);
                                setNewName(s.name);
                                setRenameOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleKill(s.name);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：终端区域 */}
        {activeSession && (
          <div className="flex flex-1 flex-col bg-[#0f0f1a]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-white">
                  {activeSession}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={() => handleGhostty(activeSession)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Ghostty
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-red-400 hover:bg-white/10 hover:text-red-300"
                  onClick={handleDetach}
                >
                  <Square className="mr-1 h-3 w-3" />
                  断开
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TmuxTerminal
                key={activeSession}
                sessionName={activeSession}
                onDetach={handleDetach}
              />
            </div>
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 tmux 会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>会话名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如 frpc-dev"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!newName.trim()}>
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>新名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                取消
              </Button>
              <Button onClick={handleRename} disabled={!newName.trim()}>
                重命名
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Tmux.tsx
git commit -m "feat(tmux): add Tmux management page with session list and terminal"
```

---

## Task 15: 添加路由和导航

**Files:**
- 修改: `src/App.tsx`
- 修改: `src/components/Layout.tsx`

- [ ] **Step 1: 添加路由**

修改 `src/App.tsx`：

```tsx
import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Services from "./pages/Services";
import Docker from "./pages/Docker";
import Bookmarks from "./pages/Bookmarks";
import System from "./pages/System";
import Terminal from "./pages/Terminal";
import Tmux from "./pages/Tmux"; // ← 新增
import Settings from "./pages/Settings";
import { useThemeStore } from "./stores/theme";
import { useEffect } from "react";

function App() {
  const { isDark } = useThemeStore();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="services" element={<Services />} />
          <Route path="docker" element={<Docker />} />
          <Route path="bookmarks" element={<Bookmarks />} />
          <Route path="terminal" element={<Terminal />} />
          <Route path="tmux" element={<Tmux />} /> {/* ← 新增 */}
          <Route path="system" element={<System />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
```

- [ ] **Step 2: 添加侧边栏导航**

修改 `src/components/Layout.tsx`：

```tsx
import { Outlet, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Container,
  Bookmark,
  Activity,
  Terminal as TerminalIcon,
  Monitor, // ← 新增
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { useThemeStore } from "@/stores/theme";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/services", icon: Server, label: "服务" },
  { to: "/docker", icon: Container, label: "Docker" },
  { to: "/bookmarks", icon: Bookmark, label: "导航" },
  { to: "/terminal", icon: TerminalIcon, label: "终端" },
  { to: "/tmux", icon: Monitor, label: "Tmux" }, // ← 新增
  { to: "/system", icon: Activity, label: "系统" },
];
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/components/Layout.tsx
git commit -m "feat(tmux): add /tmux route and sidebar navigation"
```

---

## Task 16: 添加 xterm 终端样式

**Files:**
- 修改: `src/styles.css`

- [ ] **Step 1: 追加终端区域滚动条样式**

在 `src/styles.css` 现有 `.xterm-screen` 规则之后追加：

```css
/* 终端区域滚动条 */
.xterm-viewport::-webkit-scrollbar {
  width: 6px;
}

.xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}

.xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(tmux): add xterm terminal scrollbar styles"
```

---

## Task 17: 集成验证

**Files:** 无新建/修改

- [ ] **Step 1: 前端 TypeScript 编译检查**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: 无 tmux 相关编译错误

- [ ] **Step 2: Rust 编译检查**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`

Expected: `error` 计数为 0

- [ ] **Step 3: 验证 tmux 已安装**

Run: `tmux -V`

Expected: 显示 tmux 版本（如 `tmux 3.5`）

- [ ] **Step 4: 运行开发服务器快速验证**

Run: `npm run tauri dev`（启动后手动验证）

检查项：
- 侧边栏有 "Tmux" 入口
- 点击后进入 Tmux 页面
- 显示会话列表（如果没有会话则显示空状态）
- [新建会话] 按钮可弹出对话框
- 创建会话后列表刷新
- 点击会话卡片右侧展开终端
- 终端内可操作 tmux（Ctrl+b 前缀等）
- [断开] 按钮可关闭终端
- Kill 按钮可删除会话（二次确认）
- Rename 按钮可重命名

- [ ] **Step 5: Commit（如需要修复）**

```bash
git add -A
git commit -m "fix(tmux): integration fixes after verification"
```

---

## Spec 覆盖检查

| Spec 需求 | 实现任务 |
|-----------|----------|
| 会话列表（卡片网格） | Task 14 |
| 创建会话 | Task 3 + Task 7 + Task 14 |
| Kill 会话 | Task 3 + Task 7 + Task 14 |
| 重命名会话 | Task 3 + Task 7 + Task 14 |
| 内嵌终端 attach | Task 4 + Task 12 + Task 14 |
| 断开终端 | Task 4 + Task 12 + Task 14 |
| Ghostty 外唤 | Task 7 + Task 14 |
| tmux.conf 生成 | Task 3 + Task 7 + Task 10 |
| 检查 tmux 安装 | Task 3 + Task 7 + Task 14 |
| 左右分栏布局 | Task 14 |
| 手动刷新 | Task 14 |
| BaseTerminal 抽象 | Task 11 + Task 12 + Task 13 |

---

## Placeholder 扫描

- ✅ 无 "TBD", "TODO", "implement later"
- ✅ 无 "Add appropriate error handling" 等模糊描述
- ✅ 所有步骤包含具体代码或命令
- ✅ 无 "Similar to Task N" 引用

---

## 类型一致性检查

| 类型/函数 | 定义位置 | 使用位置 | 状态 |
|-----------|----------|----------|------|
| `TmuxSession` | Task 2 (Rust), Task 9 (TS) | Task 3, 7, 10, 14 | ✅ 一致 |
| `CreateTmuxSessionRequest` | Task 2 (Rust), Task 9 (TS) | Task 3, 7, 10, 14 | ✅ 一致 |
| `RenameTmuxSessionRequest` | Task 2 (Rust), Task 9 (TS) | Task 3, 7, 10, 14 | ✅ 一致 |
| `tmux_list_sessions` | Task 7 | Task 8, 10 | ✅ 一致 |
| `tmux_attach_pty` | Task 7 | Task 8, 10, 12 | ✅ 一致 |
| `TmuxPtySession` | Task 4 | Task 6, 7 | ✅ 一致 |
| `tmuxPtyWrite` | Task 10 | Task 12 | ✅ 一致 |

---

*计划版本: 1.0 | 基于设计文档: docs/superpowers/specs/2026-05-18-tmux-management-design.md*
