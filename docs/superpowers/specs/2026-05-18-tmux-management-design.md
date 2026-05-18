# MacOps Tmux 管理功能设计文档

> 状态：已审核 | 日期：2026-05-18

---

## 1. 概述

在 MacOps 中增加本地 tmux 会话管理能力，包含会话 CRUD、内嵌终端 attach、Ghostty 外唤、配置生成等功能。

### 1.1 目标

- 在 MacOps 内直接管理本地 tmux 会话
- 支持创建、重命名、Kill 会话
- 内嵌 xterm.js 终端直接 attach 到 tmux 会话
- 支持唤起 Ghostty 作为备选方案
- 一键生成 `~/.tmux.conf` 优化配置

### 1.2 排除范围

- 远程服务器 tmux 管理（等 SSH 功能完成后联动）
- 窗口/pane 级别的 UI 管理（终端内用 tmux 快捷键更自然）
- 会话使用统计/历史
- 实时推送状态变化（手动刷新够用）
- tmux 插件管理

---

## 2. 架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│              React Frontend                          │
│  ┌────────────────┐  ┌──────────────────────────┐   │
│  │ 会话卡片列表    │  │   内嵌终端 (xterm.js)    │   │
│  │ (左侧分栏)      │  │   (右侧 attach 后显示)   │   │
│  └────────────────┘  └──────────────────────────┘   │
├──────────────────────┬──────────────────────────────┤
│  Tauri IPC (invoke)  │  Tauri IPC (Channel)         │
│  (命令调用)           │  (PTY 双向数据流)            │
├──────────────────────┴──────────────────────────────┤
│              Rust Backend                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ tmux/    │  │ tmux/    │  │ commands.rs      │  │
│  │ mod.rs   │  │ pty.rs   │  │ (IPC 命令注册)   │  │
│  │ (命令)   │  │ (伪终端) │  │                  │  │
│  └────┬─────┘  └────┬─────┘  └──────────────────┘  │
│       │              │                               │
│  ┌────▼─────┐  ┌────▼─────┐                        │
│  │ tmux     │  │ portable │                        │
│  │ binary   │  │ -pty     │                        │
│  │ (本地)   │  │ (库)     │                        │
│  └──────────┘  └──────────┘                        │
└─────────────────────────────────────────────────────┘
```

### 2.2 终端组件分层

现有 `XTerm.tsx` 重构为三层：

```
BaseTerminal.tsx          ← 纯 xterm.js 渲染（主题、字体、resize、清理）
├── SshTerminal.tsx       ← WebSocket 数据源（现有改造）
└── TmuxTerminal.tsx      ← Tauri Channel 数据源（新增）
```

**BaseTerminal 职责：**
- xterm.js Terminal 实例创建与配置
- FitAddon 加载与自适应
- ResizeObserver 绑定
- 主题与字体配置
- 清理与 dispose

**数据源层职责：**
- 建立/断开连接
- 接收数据写入 terminal
- 发送用户输入

---

## 3. 组件设计

### 3.1 页面：pages/Tmux.tsx

**布局：左右分栏（方案 A）**

```
┌────────────────────────────────────────────────────────┐
│ [Monitor] Tmux 会话  [3]        [刷新] [+ 新建会话]     │  ← 工具栏
├──────────────────────┬─────────────────────────────────┤
│ ┌──────────────────┐ │                                 │
│ │ ● frpc-dev       │ │  ┌─────────────────────────┐    │
│ │ 2 窗口 · 5分钟前  │ │  │ ● frpc-dev   [断开]    │    │
│ │ [Attach]         │ │  ├─────────────────────────┤    │
│ │ [Ghostty]        │ │  │                         │    │
│ │ [Rename] [Kill]  │ │  │  $ tmux ls              │    │
│ └──────────────────┘ │  │  frpc-dev: 2 windows    │    │
│ ┌──────────────────┐ │  │  $                      │    │
│ │ ○ blog           │ │  │                         │    │
│ │ 1 窗口 · 2小时前  │ │  │                         │    │
│ │ [Attach]         │ │  │                         │    │
│ │ [Ghostty]        │ │  └─────────────────────────┘    │
│ │ [Rename] [Kill]  │ │                                 │
│ └──────────────────┘ │                                 │
└──────────────────────┴─────────────────────────────────┘
         左侧 (320px)              右侧 (flex-1)
```

**状态：**
- `sessions: TmuxSession[]` — 会话列表
- `loading: boolean` — 加载中
- `hasTmux: boolean` — tmux 是否安装
- `activeSession: string | null` — 当前 attach 的会话名
- `ptyId: string | null` — PTY 会话 ID
- `createOpen: boolean` — 创建对话框
- `renameOpen: boolean` — 重命名对话框
- `newName: string` — 输入框值
- `renameTarget: string` — 重命名目标会话

**交互：**
- 点击卡片 → attach 到右侧终端
- 右侧终端显示时，左侧卡片边框高亮
- [断开] → 关闭 PTY，清理终端，返回列表视图
- Kill 正在 attach 的会话 → 先 detach 再 kill

### 3.2 终端组件

#### BaseTerminal.tsx

**Props：**
```typescript
interface BaseTerminalProps {
  onData: (data: string) => void;           // 用户输入回调
  onReady: (term: Terminal) => void;        // 终端就绪回调
  className?: string;
}
```

**职责：**
- 创建 xterm.js Terminal 实例
- 加载 FitAddon
- 绑定 onData → 调用 props.onData
- ResizeObserver → fitAddon.fit()
- 返回时 dispose

#### TmuxTerminal.tsx

**Props：**
```typescript
interface TmuxTerminalProps {
  sessionName: string;           // 要 attach 的会话名
  onDetach: () => void;          // 断开回调
}
```

**数据流：**
1. mount 时调用 `tmuxAttachPty(sessionName, channel)` 获取 ptyId
2. channel 回调 → `term.write(data)`
3. `term.onData` → `tmuxPtyWrite(ptyId, data)`
4. unmount 时 → `tmuxPtyClose(ptyId)` → 清理

### 3.3 对话框

**新建会话对话框：**
- 输入：会话名称
- 可选：起始目录、启动命令
- Enter 快捷提交

**重命名对话框：**
- 输入：新名称
- Enter 快捷提交

---

## 4. 后端设计

### 4.1 新增依赖

```toml
# Cargo.toml
[dependencies]
portable-pty = "1.0"
```

### 4.2 数据类型

```rust
// tmux/types.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxSession {
    pub name: String,
    pub windows: usize,
    pub attached: bool,
    pub created_at: String,
    pub pid: u32,
}

#[derive(Debug, Deserialize)]
pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RenameTmuxSessionRequest {
    pub old_name: String,
    pub new_name: String,
}
```

### 4.3 tmux 命令模块

**`tmux/mod.rs` — 命令封装：**

| 函数 | 命令 | 说明 |
|------|------|------|
| `list_sessions()` | `tmux list-sessions -F "..."` | 解析输出为 `Vec<TmuxSession>` |
| `create_session()` | `tmux new-session -d -s <name>` | detached 模式创建 |
| `kill_session()` | `tmux kill-session -t <name>` | kill 指定会话 |
| `rename_session()` | `tmux rename-session -t <old> <new>` | 重命名 |
| `is_tmux_available()` | `tmux -V` | 检查是否安装 |

**`tmux/pty.rs` — PTY 管理：**

```rust
pub struct TmuxPtySession {
    pub session_name: String,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub reader_thread: Option<JoinHandle<()>>,
}

pub fn attach_session_pty(
    session_name: &str,
    channel: Channel<Vec<u8>>,
) -> Result<TmuxPtySession, String>

pub fn write_to_pty(
    session: &TmuxPtySession,
    data: &[u8],
) -> Result<(), String>
```

**PTY 实现细节：**
- 使用 `portable_pty::NativePtySystem` 创建 PTY pair
- 执行 `tmux attach -t <session>`
- 设置 `TERM=xterm-256color`
- 后台线程循环读取 PTY 输出 → Channel.send()
- 写入通过 Mutex 保护的 writer

### 4.4 IPC 命令

```rust
#[tauri::command]
pub fn tmux_list_sessions() -> Result<Vec<TmuxSession>, String>

#[tauri::command]
pub fn tmux_create_session(req: CreateTmuxSessionRequest) -> Result<(), String>

#[tauri::command]
pub fn tmux_kill_session(name: String) -> Result<(), String>

#[tauri::command]
pub fn tmux_rename_session(req: RenameTmuxSessionRequest) -> Result<(), String>

#[tauri::command]
pub fn tmux_is_available() -> bool

#[tauri::command]
pub fn tmux_attach_pty(
    session_name: String,
    channel: Channel<Vec<u8>>,
    state: State<'_, AppState>,
) -> Result<String, String>

#[tauri::command]
pub fn tmux_pty_write(
    pty_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String>

#[tauri::command]
pub fn tmux_pty_close(pty_id: String, state: State<'_, AppState>) -> Result<(), String>

#[tauri::command]
pub fn tmux_open_in_ghostty(session_name: String) -> Result<(), String>
```

### 4.5 全局状态更新

```rust
pub struct AppState {
    db: Database,
    process_manager: Mutex<ProcessManager>,
    ssh_session_manager: SshSessionManager,
    tmux_pty_sessions: Mutex<HashMap<String, TmuxPtySession>>, // 新增
}
```

### 4.6 Ghostty 唤起

通过 AppleScript 唤起 Ghostty 并发送 tmux attach 命令：

```rust
let script = format!(
    r#"tell application "Ghostty" to activate
    tell application "Ghostty" to tell front window to create tab with default profile
    tell application "System Events" to keystroke "tmux attach -t {}" & return"#,
    session_name
);
```

### 4.7 配置生成

**`tmux_generate_config()`：**
生成 `~/.tmux.conf`，包含：
- 鼠标支持
- 状态栏样式
- 窗口样式
- 边框样式
- vi 复制模式
- 窗口编号从 1 开始
- 历史行数 50000
- 256 色支持

---

## 5. 前端 API

### 5.1 类型定义

```typescript
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

### 5.2 API 函数

```typescript
export async function tmuxListSessions(): Promise<TmuxSession[]>
export async function tmuxCreateSession(req: CreateTmuxSessionRequest): Promise<void>
export async function tmuxKillSession(name: string): Promise<void>
export async function tmuxRenameSession(req: RenameTmuxSessionRequest): Promise<void>
export async function tmuxIsAvailable(): Promise<boolean>
export async function tmuxAttachPty(sessionName: string, channel: any): Promise<string>
export async function tmuxPtyWrite(ptyId: string, data: Uint8Array): Promise<void>
export async function tmuxPtyClose(ptyId: string): Promise<void>
export async function tmuxOpenInGhostty(sessionName: string): Promise<void>
export async function tmuxGenerateConfig(): Promise<string>
```

---

## 6. 路由与导航

### 6.1 新增路由

```tsx
// App.tsx
import Tmux from "./pages/Tmux";

<Route path="tmux" element={<Tmux />} />
```

### 6.2 侧边栏导航

```tsx
// Layout.tsx
import { Monitor } from "lucide-react";

const navItems = [
  // ... 已有项目 ...
  { to: "/tmux", icon: Monitor, label: "Tmux" },
];
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| tmux 未安装 | 页面显示安装提示，提供 `brew install tmux` |
| tmux 无会话 | 显示空状态，引导创建第一个会话 |
| `list-sessions` 返回 "no server running" | 视为正常，返回空数组 |
| attach 失败（会话不存在）| toast 错误提示，保持列表状态 |
| PTY 断开（EOF/Error）| 终端显示 "[已断开]"，自动清理 |
| Kill 正在 attach 的会话 | 先 detach 终端 → kill → 刷新列表 |
| 重命名冲突 | 返回 tmux 错误信息，前端 toast 提示 |

---

## 8. 样式

### 8.1 xterm.js 适配

```css
.xterm {
  height: 100% !important;
  padding: 4px;
}

.xterm-viewport {
  background-color: transparent !important;
  overflow-y: auto !important;
}

.xterm-screen {
  width: 100% !important;
}

/* 终端区域滚动条 */
.xterm-viewport::-webkit-scrollbar {
  width: 6px;
}

.xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
```

### 8.2 终端主题

使用与现有 SSH 终端一致的深色主题（Dracula 风格），背景 `#1a1a2e`，前景 `#e0e0e0`。

---

## 9. 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src-tauri/Cargo.toml` | 加 `portable-pty` |
| 新建 | `src-tauri/src/tmux/mod.rs` | tmux 命令封装 |
| 新建 | `src-tauri/src/tmux/pty.rs` | PTY 管理 |
| 新建 | `src-tauri/src/tmux/types.rs` | 数据类型 |
| 修改 | `src-tauri/src/commands.rs` | 追加 9 个 IPC 命令 |
| 修改 | `src-tauri/src/main.rs` | 注册命令 + 全局状态 |
| 新建 | `src/pages/Tmux.tsx` | 主页面 |
| 新建 | `src/components/terminal/BaseTerminal.tsx` | 共享终端基础 |
| 新建 | `src/components/terminal/TmuxTerminal.tsx` | tmux 终端 |
| 修改 | `src/components/terminal/XTerm.tsx` | 重构为 SshTerminal |
| 修改 | `src/App.tsx` | 加 /tmux 路由 |
| 修改 | `src/components/Layout.tsx` | 侧边栏加入口 |
| 修改 | `src/lib/api.ts` | 加 Tmux API |
| 修改 | `src/types/index.ts` | 加 Tmux 类型 |
| 修改 | `src/styles.css` | xterm 样式 |

---

## 10. 依赖安装

```bash
# Rust
cargo add portable-pty

# 前端（已有，无需安装）
# npm install @xterm/xterm @xterm/addon-fit
```

---

*设计文档版本: 1.0*
