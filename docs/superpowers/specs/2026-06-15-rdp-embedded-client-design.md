# MacNest 内嵌 RDP 客户端设计

## 目标

在 Terminal 页面内新增 **RDP 远程桌面** 连接类型，使用户可以在同一个分组/Tab 体系下同时管理 SSH 和 RDP 连接。

- 使用场景：内网 / 低延迟环境
- 功能范围（一期）：连接管理、画面显示、鼠标、键盘
- 功能范围（二期）：剪贴板同步、快捷键（如 Ctrl+Alt+Del）
- 明确排除：音频、文件传输、多显示器、自适应分辨率

## 技术选型

**方案 A：新版 IronRDP + GFX/AVC444 + Canvas**

- 使用 [IronRDP](https://github.com/Devolutions/IronRDP) v0.15 作为底层 RDP 协议栈
- 利用 GFX/AVC444 降低带宽并提升画面流畅度
- 后端 Rust 解码帧数据，通过 Tauri 事件推送到前端 Canvas 渲染
- 相比旧版 IronRDP PNG 整帧方案，CPU 和延迟预期大幅改善

未选方案：
- FreeRDP3 FFI：协议更成熟，但 C 依赖重、unsafe 多、构建复杂
- xfreerdp 子进程：macOS 窗口嵌入困难、集成度差

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Terminal 页面                         │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │  分组/连接树  │  │  Tab 内容区                           │ │
│  │  SSH / RDP   │  │  [SSH: xterm + SFTP] [RDP: Canvas]   │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   SSH Backend           RDP Backend          Database
   (已有)                (新增)                (已有)
```

## 数据库

新增 `rdp_connections` 表：

```sql
CREATE TABLE IF NOT EXISTS rdp_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 3389,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    domain TEXT DEFAULT '',
    screen_width INTEGER DEFAULT 1920,
    screen_height INTEGER DEFAULT 1080,
    color_depth INTEGER DEFAULT 16,
    group_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- `password` 使用 `src-tauri/src/security.rs` 的 `encrypt/decrypt` 加密存储
- `group_id` 复用 `groups` 表，`group_type = 'terminal'`，与 SSH 共享分组树

## 后端模块

新增 `src-tauri/src/rdp/` 目录：

| 文件 | 职责 |
|------|------|
| `mod.rs` | 模块导出 |
| `types.rs` | `RdpConnection`、`SessionConfig`、`InputEvent` 等类型 |
| `session.rs` | IronRDP v0.15 连接、GFX/AVC444 解码、帧发送、输入处理 |
| `encoder.rs` | 帧编码器抽象：原始 RGBA 输出；后续可扩展 H.264 解码后输出 |
| `manager.rs` | `RdpSessionManager`，管理多 session 生命周期 |
| `network_client.rs` | IronRDP 网络客户端适配 |

新增 Tauri commands（`src-tauri/src/commands.rs`）：

- `create_rdp_connection`
- `list_rdp_connections`
- `update_rdp_connection`
- `delete_rdp_connection`
- `rdp_connect` → 返回 `{ session_id }`
- `rdp_disconnect`
- `rdp_send_input`
- `rdp_send_clipboard`（二期实现，接口预留）

事件（前端通过 `listen` 订阅）：

- `rdp-frame-{session_id}`：帧数据 `{ regions, data }`
- `rdp-error-{session_id}`：连接/运行错误
- `rdp-disconnected-{session_id}`：session 断开
- `rdp-clipboard-{session_id}`（二期）：远端剪贴板内容推送

## 前端模块

| 文件 | 改动 |
|------|------|
`src/pages/Terminal.tsx` 具体调整：

- 连接树节点增加 `connection_type` 字段（由后端 `list_rdp_connections` / `list_ssh_connections` 返回，前端拼接）
- 新增 RDP 连接按钮和对话框（复用现有对话框模式）
- tab 的 `TerminalTab` 增加 `connectionType`，根据类型渲染不同内容
- 关闭 tab 时根据类型调用 `sshDisconnect` 或 `rdp_disconnect`
| `src/components/rdp/RdpCanvas.tsx` | 新增 Canvas 渲染 + 输入捕获 + 状态显示 |
| `src/lib/api.ts` | 新增 RDP API 函数 |
| `src/types/index.ts` | 新增 `RdpConnection`、`RdpSession`、`RdpFramePayload` |
| `src/stores/terminal.ts` | `TerminalTab` 增加 `connectionType: 'ssh' \| 'rdp'` |

`RdpCanvas` 职责：

1. 订阅 `rdp-frame-{id}`，base64 解码为 `Uint8ClampedArray`
2. 使用 Canvas 2D `putImageData` 或 WebGL 纹理渲染脏矩形
3. 监听鼠标事件，转换为 `InputEvent` 通过 `rdp_send_input` 发送
4. 监听键盘事件，转换为 scancode 发送
5. 显示连接中/已断开/错误状态

## 数据流

1. 用户在 Terminal 页面新建 RDP 连接，保存到 `rdp_connections`
2. 双击/点击连接 → 调用 `rdp_connect(connection_id)`
3. 后端 `RdpSessionManager` 启动 session：
   - IronRDP connector 建立 TCP/TLS/CredSSP
   - 进入 ActiveStage，解码 GFX/AVC444 帧
   - 合并脏矩形，编码为 RGBA payload
   - emit `rdp-frame-{id}`
4. 前端 `RdpCanvas` 接收帧并渲染
5. 用户鼠标/键盘 → `rdp_send_input` → 后端转成 FastPath input → 发送到 Windows

## 错误处理

- 连接失败：emit `rdp-error-{id}`，前端 toast 并关闭 tab
- 编码失败：记录日志，丢帧，不中断 session
- 网络断开：emit `rdp-disconnected-{id}`，前端更新 tab 状态
- session 未找到：`rdp_send_input` 返回错误

## 依赖

`src-tauri/Cargo.toml` 新增：

```toml
ironrdp = { version = "0.15", features = [...] }
ironrdp-connector = "0.15"
ironrdp-session = "0.15"
ironrdp-pdu = "0.15"
ironrdp-graphics = "0.15"
# 二期：ironrdp-cliprdr = "0.15"
```

具体 feature 和子 crate 列表以 IronRDP v0.15 实际发布结构为准。

## 测试计划

- 功能：连接 Windows 10/11/Server，验证画面、鼠标、键盘
- 性能：Activity Monitor 观察 Rust 进程 CPU；DevTools Performance 观察前端渲染
- 稳定：长时间空闲 30 分钟，观察是否断连/内存增长
- 异常：关闭远端、网络断开、错误密码，观察前端提示

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| IronRDP v0.15 API 与旧版差异大 | 中 | 重新对接 connector/session；参考官方 example 和 `macrdp` |
| GFX/AVC444 解码在 macOS 上性能 | 中 | 先验证软件解码；必要时回退到 bitmap codec |
| 剪贴板通道复杂度高 | 中 | 放到二期，接口预留 |
| 旧 RDP 表/代码已删除 | 低 | 重新创建表；UI 从零写，不依赖旧代码 |

## 范围

**一期必须完成：**
- `rdp_connections` 表 + CRUD
- 后端 RDP session（连接、解码、帧发送、输入）
- 前端 RDP 连接管理 + Canvas 渲染
- 鼠标、键盘输入转发

**二期：**
- 剪贴板同步
- 快捷键菜单（Ctrl+Alt+Del 等）

**明确不做：**
- 音频重定向
- 文件/驱动器重定向
- 多显示器
- 自适应分辨率

## 关键文件

- `src-tauri/src/rdp/session.rs`
- `src-tauri/src/rdp/manager.rs`
- `src-tauri/src/rdp/encoder.rs`
- `src-tauri/src/rdp/types.rs`
- `src-tauri/src/rdp/network_client.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/database.rs`
- `src-tauri/Cargo.toml`
- `src/pages/Terminal.tsx`
- `src/components/rdp/RdpCanvas.tsx`
- `src/lib/api.ts`
- `src/types/index.ts`
- `src/stores/terminal.ts`
