# MacOps SFTP 文件管理器设计文档

> 版本: 1.0 | 日期: 2026-05-18 | 状态: 已确认

---

## 一、背景与目标

SSH 终端功能已实现（russh + xterm.js + WebSocket）。本设计在现有 SSH 会话基础上增加 **SFTP 文件管理器**，实现终端与文件操作同屏显示，风格参考 FinalShell。

**本期目标：**
- SSH 终端在上、SFTP 文件管理器在下的上下分栏布局
- SFTP 三栏布局：左侧树形目录 + 中间文件列表 + 右侧详情/传输
- 文件操作：浏览、上传、下载、删除、新建文件夹、重命名
- 文件属性查看：大小、权限、所有者、修改时间
- 面包屑导航 + 状态栏

**非本期目标：**
- 本地-远程双栏拖拽传输（FileZilla 风格）
- 文件内容编辑/预览
- 批量操作（多选）
- 断点续传
- 文件搜索

---

## 二、架构概览

### 2.1 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  SSH Terminal (xterm.js) - 上部约 45%                   │
│  user@server:~$ ls                                       │
│  Documents  Downloads  public_html                       │
│  user@server:~$ _                                        │
├─────────────────────────────────────────────────────────┤
│  SFTP 文件管理器 - 下部约 55%                            │
│  ┌────────┬─────────────────────────┬──────────────┐    │
│  │ 树形   │  文件列表                │  文件详情    │    │
│  │ 目录   │  ┌─────────────────────┐│  传输队列    │    │
│  │        │  │ 面包屑 /var/www     ││              │    │
│  │ 📁 /   │  ├─────────────────────┤│  名称: logs  │    │
│  │ 📁 home│  │ ⬆⬇🗑📁✏🔄 工具栏   ││  大小: 4KB   │    │
│  │ 📁 user│  ├─────────────────────┤│  权限: drwxr │    │
│  │ 📁 .ssh│  │ 📁 html  4KB  05-16 ││  所有者: www │    │
│  │ 📂 www │  │ 📂 logs  4KB  05-17 ││              │    │
│  │ 📁 log │  │ 📄 nginx 220B 05-15 ││  传输进度    │    │
│  │        │  │ 📄 index 1.2K 05-16 ││  ████████░░  │    │
│  │        │  └─────────────────────┘│              │    │
│  │        │  状态栏: 5个项目 | 已选1 │              │    │
│  └────────┴─────────────────────────┴──────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 技术架构

```
前端 React                              Rust 后端
┌─────────────────┐                    ┌─────────────────────────┐
│ Terminal.tsx    │                    │ SshSessionManager       │
│  ├─ XTerm.tsx   │◄──WebSocket──►    │  ├─ russh session (PTY) │
│  └─ SftpPanel   │                    │  └─ ssh2 session (SFTP) │
│     ├─ SftpTree │◄──Tauri IPC──►    │                         │
│     ├─ FileList │                    │ SFTP Commands           │
│     ├─ FileDet. │                    │  ├─ sftp_list_dir       │
│     └─ Toolbar  │                    │  ├─ sftp_upload         │
│                 │                    │  ├─ sftp_download       │
│ lib/api.ts      │                    │  ├─ sftp_delete         │
│  ├─ sshConnect  │                    │  ├─ sftp_mkdir          │
│  ├─ sftpListDir │                    │  ├─ sftp_rename         │
│  └─ sftpUpload  │                    │  └─ sftp_get_file_info  │
└─────────────────┘                    └─────────────────────────┘
```

**SFTP 后端方案：**
- russh 没有内置 SFTP 协议实现
- 采用 `ssh2` crate（libssh2 绑定，带 `vendored` feature）专门处理 SFTP 操作
- 每个 SSH 会话同时持有：russh session（终端用）+ ssh2 session（SFTP 用）
- 建立两次连接是务实的选择：代码简单、SFTP API 成熟、风险低
- 后续如需优化为单连接，可替换为 `russh-sftp` 或自行实现 SFTP 协议

---

## 三、Rust 后端设计

### 3.1 新增依赖

```toml
# Cargo.toml
[dependencies]
ssh2 = { version = "0.9", features = ["vendored"] }
```

### 3.2 SFTP 类型（ssh/sftp.rs）

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_time: String,
    pub permissions: String,
    pub owner: String,
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpTransfer {
    pub id: String,
    pub file_name: String,
    pub direction: String, // "upload" | "download"
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: String, // "pending" | "in_progress" | "completed" | "failed"
}
```

### 3.3 SFTP 管理器（ssh/sftp.rs）

```rust
use ssh2::Session;
use std::net::TcpStream;

pub struct SftpManager {
    session: Session,
    sftp: ssh2::Sftp,
}

impl SftpManager {
    pub fn connect(
        host: &str,
        port: u16,
        username: &str,
        auth: &SshAuthType,
    ) -> anyhow::Result<Self> {
        let tcp = TcpStream::connect(format!("{}:{}", host, port))?;
        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);
        session.handshake()?;

        match auth {
            SshAuthType::Password { password } => {
                session.userauth_password(username, password)?;
            }
            SshAuthType::PublicKey { key_path, passphrase } => {
                session.userauth_pubkey_file(
                    username,
                    None,
                    std::path::Path::new(key_path),
                    passphrase.as_deref(),
                )?;
            }
        }

        if !session.authenticated() {
            anyhow::bail!("SFTP authentication failed");
        }

        let sftp = session.sftp()?;
        Ok(Self { session, sftp })
    }

    pub fn list_dir(&self, path: &str) -> anyhow::Result<Vec<SftpFile>> {
        let entries = self.sftp.readdir(std::path::Path::new(path))?;
        let mut files = Vec::new();
        for (path, stat) in entries {
            let name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name == "." || name == ".." {
                continue;
            }
            let is_dir = stat.is_dir();
            let permissions = format!("{:o}", stat.perm.unwrap_or(0));
            let modified_time = stat.mtime
                .map(|t| chrono::DateTime::from_timestamp(t as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default())
                .unwrap_or_default();

            files.push(SftpFile {
                path: path.to_string_lossy().to_string(),
                name,
                is_dir,
                size: stat.size.unwrap_or(0),
                modified_time,
                permissions,
                owner: stat.uid.map(|u| u.to_string()).unwrap_or_default(),
                group: stat.gid.map(|g| g.to_string()).unwrap_or_default(),
            });
        }
        Ok(files)
    }

    pub fn delete(&self, path: &str, is_dir: bool) -> anyhow::Result<()> {
        if is_dir {
            self.sftp.rmdir(std::path::Path::new(path))?;
        } else {
            self.sftp.unlink(std::path::Path::new(path))?;
        }
        Ok(())
    }

    pub fn mkdir(&self, path: &str) -> anyhow::Result<()> {
        self.sftp.mkdir(std::path::Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn rename(&self, old_path: &str, new_path: &str) -> anyhow::Result<()> {
        self.sftp.rename(
            std::path::Path::new(old_path),
            std::path::Path::new(new_path),
            None,
        )?;
        Ok(())
    }

    pub fn get_file_info(&self, path: &str) -> anyhow::Result<SftpFile> {
        let stat = self.sftp.stat(std::path::Path::new(path))?;
        let path_obj = std::path::Path::new(path);
        let name = path_obj.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        Ok(SftpFile {
            path: path.to_string(),
            name,
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified_time: stat.mtime
                .map(|t| chrono::DateTime::from_timestamp(t as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default())
                .unwrap_or_default(),
            permissions: format!("{:o}", stat.perm.unwrap_or(0)),
            owner: stat.uid.map(|u| u.to_string()).unwrap_or_default(),
            group: stat.gid.map(|g| g.to_string()).unwrap_or_default(),
        })
    }

    // 上传/下载通过流式读写实现
    pub fn upload_file(
        &self,
        local_path: &str,
        remote_path: &str,
    ) -> anyhow::Result<()> {
        let data = std::fs::read(local_path)?;
        let mut remote_file = self.sftp.create(std::path::Path::new(remote_path))?;
        remote_file.write_all(&data)?;
        Ok(())
    }

    pub fn download_file(
        &self,
        remote_path: &str,
        local_path: &str,
    ) -> anyhow::Result<()> {
        let mut remote_file = self.sftp.open(std::path::Path::new(remote_path))?;
        let mut data = Vec::new();
        remote_file.read_to_end(&mut data)?;
        std::fs::write(local_path, &data)?;
        Ok(())
    }
}
```

### 3.4 会话管理器扩展（ssh/session.rs）

```rust
pub struct SshSession {
    pub info: SshSessionInfo,
    pub connection_manager: SshConnectionManager,
    pub channel: Option<Arc<Mutex<russh::Channel<russh::client::Msg>>>>,
    pub sftp_manager: Option<SftpManager>, // 新增
}

impl SshSessionManager {
    pub async fn create_session(&self, connection: &SshConnection) -> anyhow::Result<String> {
        // ... 现有 russh 连接和认证逻辑 ...

        // 同时建立 SFTP 连接
        let sftp_manager = SftpManager::connect(
            &connection.host,
            connection.port,
            &connection.username,
            &connection.auth_type,
        )?;

        let session = SshSession {
            info: SshSessionInfo { ... },
            connection_manager: manager,
            channel: None,
            sftp_manager: Some(sftp_manager), // 新增
        };
        // ...
    }

    // SFTP 操作方法
    pub async fn sftp_list_dir(&self, session_id: &str, path: &str) -> anyhow::Result<Vec<SftpFile>> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;
        let sftp = session.sftp_manager.as_ref()
            .ok_or_else(|| anyhow::anyhow!("SFTP not initialized"))?;
        sftp.list_dir(path)
    }

    pub async fn sftp_delete(&self, session_id: &str, path: &str, is_dir: bool) -> anyhow::Result<()> {
        // ... 类似实现
    }

    pub async fn sftp_mkdir(&self, session_id: &str, path: &str) -> anyhow::Result<()> {
        // ...
    }

    pub async fn sftp_rename(&self, session_id: &str, old_path: &str, new_path: &str) -> anyhow::Result<()> {
        // ...
    }

    pub async fn sftp_get_file_info(&self, session_id: &str, path: &str) -> anyhow::Result<SftpFile> {
        // ...
    }
}
```

### 3.5 IPC 命令（commands.rs 追加）

```rust
// === SFTP Commands ===

#[tauri::command]
pub fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpFile>, String> {
    // 由于 ssh2 的 Sftp 不是 Send，需要在主线程执行
    // 使用 tokio::task::spawn_blocking 或 std::thread
    // 暂时用阻塞调用
    let rt = tokio::runtime::Handle::current();
    rt.block_on(async {
        state.ssh_session_manager
            .sftp_list_dir(&session_id, &path)
            .await
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    // ...
}

#[tauri::command]
pub fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    // ...
}

#[tauri::command]
pub fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    // ...
}

#[tauri::command]
pub fn sftp_get_file_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<SftpFile, String> {
    // ...
}

// 上传/下载使用 Tauri 的 dialog 插件选择文件
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    // ...
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    // ...
}
```

### 3.6 AppState 扩展

```rust
// main.rs
#[tauri::command]
pub fn sftp_list_dir(...) // 注册新命令

// 注册所有命令时追加
.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    sftp_list_dir,
    sftp_delete,
    sftp_mkdir,
    sftp_rename,
    sftp_get_file_info,
    sftp_upload,
    sftp_download,
])
```

---

## 四、前端设计

### 4.1 新增类型（types/index.ts）

```typescript
export interface SftpFile {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  permissions: string;
  owner: string;
  group: string;
}

export interface SftpTransfer {
  id: string;
  file_name: string;
  direction: "upload" | "download";
  total_bytes: number;
  transferred_bytes: number;
  status: "pending" | "in_progress" | "completed" | "failed";
}
```

### 4.2 API 封装（lib/api.ts 追加）

```typescript
export async function sftpListDir(
  sessionId: string,
  path: string
): Promise<SftpFile[]> {
  return invoke("sftp_list_dir", { sessionId, path });
}

export async function sftpDelete(
  sessionId: string,
  path: string,
  isDir: boolean
): Promise<void> {
  return invoke("sftp_delete", { sessionId, path, isDir });
}

export async function sftpMkdir(
  sessionId: string,
  path: string
): Promise<void> {
  return invoke("sftp_mkdir", { sessionId, path });
}

export async function sftpRename(
  sessionId: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  return invoke("sftp_rename", { sessionId, oldPath, newPath });
}

export async function sftpGetFileInfo(
  sessionId: string,
  path: string
): Promise<SftpFile> {
  return invoke("sftp_get_file_info", { sessionId, path });
}

export async function sftpUpload(
  sessionId: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  return invoke("sftp_upload", { sessionId, localPath, remotePath });
}

export async function sftpDownload(
  sessionId: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  return invoke("sftp_download", { sessionId, remotePath, localPath });
}
```

### 4.3 Terminal.tsx 修改

已连接时改为上下分栏布局：

```tsx
// 已连接状态
<div className="flex-1 flex flex-col overflow-hidden">
  {/* SSH 终端 - 上部 45% */}
  <div className="h-[45%] border-b overflow-hidden bg-[#1a1a2e]">
    <XTerm websocketUrl={websocketUrl} />
  </div>
  {/* SFTP 文件管理器 - 下部 55% */}
  <div className="h-[55%] overflow-hidden">
    <SftpPanel sessionId={sessionId} />
  </div>
</div>
```

### 4.4 SftpPanel 组件（新增 components/terminal/SftpPanel.tsx）

三栏布局容器：

```tsx
interface SftpPanelProps {
  sessionId: string;
}

export default function SftpPanel({ sessionId }: SftpPanelProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SftpFile | null>(null);
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = async (path: string) => {
    setLoading(true);
    try {
      const list = await sftpListDir(sessionId, path);
      setFiles(list);
      setCurrentPath(path);
    } catch (err) {
      console.error("Failed to list directory:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles("/");
  }, [sessionId]);

  return (
    <div className="flex h-full bg-[#1e1e2e]">
      {/* 左侧：树形目录 */}
      <SftpTree
        sessionId={sessionId}
        currentPath={currentPath}
        onPathChange={loadFiles}
      />
      {/* 中间：文件列表 */}
      <SftpFileList
        files={files}
        currentPath={currentPath}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onPathChange={loadFiles}
        onRefresh={() => loadFiles(currentPath)}
        sessionId={sessionId}
      />
      {/* 右侧：详情 + 传输 */}
      <SftpFileDetail
        file={selectedFile}
        transfers={transfers}
      />
    </div>
  );
}
```

### 4.5 SftpTree 组件（新增 components/terminal/SftpTree.tsx）

左侧树形目录导航：

```tsx
interface SftpTreeProps {
  sessionId: string;
  currentPath: string;
  onPathChange: (path: string) => void;
}

// 显示关键目录的树形结构
// /, /home, /var, /etc, /usr, /tmp 等
// 支持点击跳转到对应目录
// 当前目录高亮显示
```

### 4.6 SftpFileList 组件（新增 components/terminal/SftpFileList.tsx）

中间文件列表：

```tsx
interface SftpFileListProps {
  files: SftpFile[];
  currentPath: string;
  selectedFile: SftpFile | null;
  onSelectFile: (file: SftpFile | null) => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  sessionId: string;
}

// 包含：
// - 面包屑导航（可点击跳转上级目录）
// - 工具栏（上传/下载/删除/新建/重命名/刷新）
// - 列表头（名称/大小/修改时间/权限）
// - 文件行（文件夹黄色、文件白色）
// - 状态栏（项目数/已选择）
// - 双击文件夹进入
// - 右键菜单（删除/重命名/下载）
```

### 4.7 SftpFileDetail 组件（新增 components/terminal/SftpFileDetail.tsx）

右侧详情面板：

```tsx
interface SftpFileDetailProps {
  file: SftpFile | null;
  transfers: SftpTransfer[];
}

// 上方：文件详情（名称/类型/大小/权限/所有者/修改时间）
// 下方：传输队列（文件名/方向/进度条/状态）
```

### 4.8 文件上传/下载交互

**上传：**
1. 用户点击「上传」按钮
2. 弹出系统文件选择对话框（Tauri dialog API）
3. 用户选择本地文件
4. 调用 `sftp_upload(sessionId, localPath, remoteCurrentPath + filename)`
5. 传输进度显示在右侧传输队列
6. 完成后刷新文件列表

**下载：**
1. 用户选中文件，点击「下载」按钮
2. 弹出系统保存对话框
3. 用户选择保存位置
4. 调用 `sftp_download(sessionId, remotePath, localPath)`
5. 传输进度显示在右侧传输队列

---

## 五、组件文件清单

### 后端
- `src-tauri/src/ssh/sftp.rs` — 新增 SFTP 管理器
- `src-tauri/src/ssh/session.rs` — 扩展会话结构
- `src-tauri/src/ssh/types.rs` — 追加 SftpFile/SftpTransfer 类型
- `src-tauri/src/commands.rs` — 追加 SFTP IPC 命令
- `src-tauri/src/main.rs` — 注册新命令
- `src-tauri/Cargo.toml` — 添加 ssh2 依赖

### 前端
- `src/pages/Terminal.tsx` — 修改已连接时布局为上下分栏
- `src/components/terminal/SftpPanel.tsx` — 新增 SFTP 面板容器
- `src/components/terminal/SftpTree.tsx` — 新增树形目录
- `src/components/terminal/SftpFileList.tsx` — 新增文件列表
- `src/components/terminal/SftpFileDetail.tsx` — 新增详情面板
- `src/lib/api.ts` — 追加 SFTP API
- `src/types/index.ts` — 追加 SFTP 类型

---

## 六、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| ssh2 (libssh2) 在 macOS 编译失败 | 中 | 高 | 使用 `vendored` feature 静态链接；如遇问题尝试 `openssl-vendored` |
| ssh2 与 russh 同时连接同一服务器被限制 | 低 | 中 | 大多数 SSH 服务器允许多个连接；如有限制可在文档中说明 |
| 大文件上传/下载阻塞 UI | 中 | 中 | 使用 Tauri 的 async command + 前端显示进度；考虑分块传输 |
| 中文文件名编码问题 | 低 | 低 | SFTP 协议使用 UTF-8，ssh2 已处理 |
| 文件权限显示格式不一致 | 低 | 低 | 统一使用 Unix 权限字符串格式 (e.g. `drwxr-xr-x`) |

---

## 七、验证标准

### 7.1 编译验证
- [ ] `cargo check` 编译通过（含 ssh2 依赖）
- [ ] `npm run tauri dev` 启动成功

### 7.2 功能验证
- [ ] 连接 SSH 后，页面显示上下分栏（终端在上，SFTP 在下）
- [ ] SFTP 左侧显示树形目录，点击可跳转
- [ ] 中间显示文件列表，包含名称/大小/时间/权限
- [ ] 双击文件夹进入子目录
- [ ] 面包屑导航可点击返回上级
- [ ] 选中文件后右侧显示文件详情
- [ ] 点击「新建文件夹」可创建目录
- [ ] 点击「删除」可删除文件/文件夹（带确认对话框）
- [ ] 点击「重命名」可修改文件名
- [ ] 点击「上传」可选择本地文件上传到当前目录
- [ ] 点击「下载」可将选中文件下载到本地
- [ ] 刷新按钮可重新加载当前目录

### 7.3 异常验证
- [ ] 无权限的目录显示友好的错误提示
- [ ] 删除不存在的文件显示错误提示
- [ ] 网络中断时 SFTP 操作显示连接错误

---

*设计文档版本 1.0 | 基于 MacOps SSH 终端功能 + FinalShell 风格 SFTP 同屏显示*
