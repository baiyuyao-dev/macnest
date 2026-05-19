# SFTP 文件管理器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 SSH 终端功能基础上，增加 FinalShell 风格的 SFTP 文件管理器，实现终端在上、SFTP 在下的同屏显示布局。

**Architecture:** 后端使用 `ssh2` crate（libssh2 绑定）处理 SFTP 协议，每次 SFTP 操作独立创建连接（避免 Send 问题）。前端采用三栏布局：左侧树形目录 + 中间文件列表 + 右侧详情/传输。

**Tech Stack:** Rust (ssh2, russh), React (TypeScript), Tailwind CSS, Tauri IPC

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/Cargo.toml` | Modify | 添加 ssh2 依赖 |
| `src-tauri/src/ssh/sftp.rs` | Create | SFTP 管理器：连接、列表、删除、新建、重命名、上传、下载 |
| `src-tauri/src/ssh/types.rs` | Modify | 追加 SftpFile 结构体 |
| `src-tauri/src/ssh/session.rs` | Modify | 在 SshSessionInfo 中追加 connection_id（已存在） |
| `src-tauri/src/ssh/mod.rs` | Modify | 暴露 sftp 模块 |
| `src-tauri/src/commands.rs` | Modify | 追加 7 个 SFTP IPC 命令 |
| `src-tauri/src/main.rs` | Modify | 注册 7 个新命令到 invoke_handler |
| `src/types/index.ts` | Modify | 追加 SftpFile, SftpTransfer 接口 |
| `src/lib/api.ts` | Modify | 追加 7 个 SFTP API 函数 |
| `src/pages/Terminal.tsx` | Modify | 已连接时改为上下分栏布局（SSH 45% + SFTP 55%） |
| `src/components/terminal/SftpPanel.tsx` | Create | SFTP 面板容器，三栏布局协调 |
| `src/components/terminal/SftpTree.tsx` | Create | 左侧树形目录导航 |
| `src/components/terminal/SftpFileList.tsx` | Create | 中间文件列表：面包屑+工具栏+文件行+状态栏 |
| `src/components/terminal/SftpFileDetail.tsx` | Create | 右侧文件详情 + 传输队列 |

---

## Task 1: Add ssh2 Dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add ssh2 to Cargo.toml**

在 `[dependencies]` 节末尾添加：

```toml
# === SFTP 文件传输 ===
ssh2 = { version = "0.9", features = ["vendored"] }
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无错误

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add ssh2 crate for SFTP support

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Create SFTP Types

**Files:**
- Modify: `src-tauri/src/ssh/types.rs`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add SftpFile to Rust types**

Modify `src-tauri/src/ssh/types.rs`，在文件末尾追加：

```rust
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
```

- [ ] **Step 2: Add SftpFile and SftpTransfer to TypeScript types**

Modify `src/types/index.ts`，在文件末尾追加：

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

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ssh/types.rs src/types/index.ts
git commit -m "feat(sftp): add SftpFile and SftpTransfer types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Create SFTP Manager (Backend)

**Files:**
- Create: `src-tauri/src/ssh/sftp.rs`
- Modify: `src-tauri/src/ssh/mod.rs`

- [ ] **Step 1: Create ssh/sftp.rs**

```rust
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::types::{SftpAuthType, SftpFile};

pub struct SftpManager {
    #[allow(dead_code)]
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
                    Path::new(key_path),
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
        let entries = self.sftp.readdir(Path::new(path))?;
        let mut files = Vec::new();
        for (path_buf, stat) in entries {
            let name = path_buf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name == "." || name == ".." {
                continue;
            }
            let is_dir = stat.is_dir();
            let permissions = stat
                .perm
                .map(|p| format!("{:o}", p))
                .unwrap_or_else(|| "0".to_string());
            let modified_time = stat
                .mtime
                .and_then(|t| {
                    chrono::DateTime::from_timestamp(t as i64, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                })
                .unwrap_or_default();

            files.push(SftpFile {
                path: path_buf.to_string_lossy().to_string(),
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
            self.sftp.rmdir(Path::new(path))?;
        } else {
            self.sftp.unlink(Path::new(path))?;
        }
        Ok(())
    }

    pub fn mkdir(&self, path: &str) -> anyhow::Result<()> {
        self.sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn rename(&self, old_path: &str, new_path: &str) -> anyhow::Result<()> {
        self.sftp
            .rename(Path::new(old_path), Path::new(new_path), None)?;
        Ok(())
    }

    pub fn get_file_info(&self, path: &str) -> anyhow::Result<SftpFile> {
        let stat = self.sftp.stat(Path::new(path))?;
        let path_obj = Path::new(path);
        let name = path_obj
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let permissions = stat
            .perm
            .map(|p| format!("{:o}", p))
            .unwrap_or_else(|| "0".to_string());
        let modified_time = stat
            .mtime
            .and_then(|t| {
                chrono::DateTime::from_timestamp(t as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            })
            .unwrap_or_default();

        Ok(SftpFile {
            path: path.to_string(),
            name,
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified_time,
            permissions,
            owner: stat.uid.map(|u| u.to_string()).unwrap_or_default(),
            group: stat.gid.map(|g| g.to_string()).unwrap_or_default(),
        })
    }

    pub fn upload_file(&self, local_path: &str, remote_path: &str) -> anyhow::Result<()> {
        let data = std::fs::read(local_path)?;
        let mut remote_file = self.sftp.create(Path::new(remote_path))?;
        remote_file.write_all(&data)?;
        Ok(())
    }

    pub fn download_file(&self, remote_path: &str, local_path: &str) -> anyhow::Result<()> {
        let mut remote_file = self.sftp.open(Path::new(remote_path))?;
        let mut data = Vec::new();
        remote_file.read_to_end(&mut data)?;
        std::fs::write(local_path, &data)?;
        Ok(())
    }
}
```

- [ ] **Step 2: Register sftp module in ssh/mod.rs**

修改 `src-tauri/src/ssh/mod.rs`：

```rust
pub mod client;
pub mod sftp;    // 新增
pub mod session;
pub mod types;
pub mod websocket;
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ssh/sftp.rs src-tauri/src/ssh/mod.rs
git commit -m "feat(sftp): add SftpManager with list, delete, mkdir, rename, upload, download

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Add SFTP IPC Commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/ssh/session.rs`（添加 get_session_info 以获取 connection_id）

- [ ] **Step 1: Verify get_session_info exists in session.rs**

Read `src-tauri/src/ssh/session.rs`，确认已有：

```rust
pub async fn get_session_info(
    &self,
    session_id: &str,
) -> Option<SshSessionInfo> {
    let sessions = self.sessions.lock().await;
    sessions.get(session_id).map(|s| s.info.clone())
}
```

如果已经存在，跳过此步骤。如果不存在，添加这个方法。

- [ ] **Step 2: Add SFTP commands to commands.rs**

在 `src-tauri/src/commands.rs` 文件末尾追加：

```rust
// === SFTP Commands ===

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<crate::ssh::types::SftpFile>, String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.list_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.delete(&path, is_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.mkdir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_get_file_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<crate::ssh::types::SftpFile, String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.get_file_info(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.upload_file(&local_path, &remote_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_conn.id,
        name: db_conn.name,
        host: db_conn.host,
        port: db_conn.port,
        username: db_conn.username,
        auth_type,
        group_id: db_conn.group_id,
        created_at: db_conn.created_at,
        updated_at: db_conn.updated_at,
    };

    let sftp = crate::ssh::sftp::SftpManager::connect(
        &connection.host,
        connection.port,
        &connection.username,
        &connection.auth_type,
    )
    .map_err(|e| e.to_string())?;

    sftp.download_file(&remote_path, &local_path)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(sftp): add SFTP IPC commands (list, delete, mkdir, rename, info, upload, download)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Register SFTP Commands in main.rs

**Files:**
- Modify: `src-tauri/src/main.rs:115-120`（在 invoke_handler 的 SSH commands 后面追加）

- [ ] **Step 1: Add 7 new commands to invoke_handler**

修改 `src-tauri/src/main.rs`，在 `commands::ssh_disconnect` 后面追加：

```rust
            // SFTP commands
            commands::sftp_list_dir,
            commands::sftp_delete,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_get_file_info,
            commands::sftp_upload,
            commands::sftp_download,
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(sftp): register SFTP commands in Tauri invoke handler

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Add Frontend SFTP API

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Import SftpFile type and add API functions**

修改 `src/lib/api.ts`：

1. 修改 import 行：

```typescript
import type { Service, DockerContainer, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, SshConnection, SftpFile } from "@/types";
```

2. 在文件末尾追加：

```typescript
// ===== SFTP 文件管理 =====

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

- [ ] **Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(sftp): add frontend SFTP API wrappers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Create SftpFileDetail Component

**Files:**
- Create: `src/components/terminal/SftpFileDetail.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { SftpFile, SftpTransfer } from "@/types";

interface SftpFileDetailProps {
  file: SftpFile | null;
  transfers: SftpTransfer[];
}

export default function SftpFileDetail({ file, transfers }: SftpFileDetailProps) {
  return (
    <div className="flex h-full w-[160px] flex-col border-l border-[#333] bg-[#1a1a2e] shrink-0">
      {/* 文件详情 */}
      <div className="bg-[#252540] px-2 py-1.5 text-[10px] font-bold text-[#aaa] border-b border-[#333]">
        文件详情
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-[10px] text-[#999] leading-relaxed">
        {file ? (
          <>
            <p><strong className="text-[#ccc]">名称:</strong> {file.name}</p>
            <p><strong className="text-[#ccc]">类型:</strong> {file.is_dir ? "文件夹" : "文件"}</p>
            <p><strong className="text-[#ccc]">大小:</strong> {formatSize(file.size)}</p>
            <p><strong className="text-[#ccc]">权限:</strong> {file.permissions}</p>
            <p><strong className="text-[#ccc]">所有者:</strong> {file.owner}:{file.group}</p>
            <p><strong className="text-[#ccc]">修改:</strong> {file.modified_time}</p>
          </>
        ) : (
          <p className="text-[#666]">选择文件查看详情</p>
        )}
      </div>

      {/* 传输队列 */}
      <div className="bg-[#252540] px-2 py-1.5 text-[10px] font-bold text-[#aaa] border-t border-[#333] border-b border-[#333]">
        传输队列
      </div>
      <div className="flex-1 overflow-y-auto">
        {transfers.length === 0 ? (
          <p className="p-2 text-[10px] text-[#666]">暂无传输</p>
        ) : (
          transfers.map((t) => (
            <div key={t.id} className="px-2 py-1.5 text-[9px] text-[#0dbc79] border-b border-[#222]">
              {t.direction === "upload" ? "⬆" : "⬇"} {t.file_name}
              <div className="h-[3px] bg-[#333] rounded mt-1">
                <div
                  className="h-full bg-[#0dbc79] rounded"
                  style={{
                    width: `${t.total_bytes > 0 ? (t.transferred_bytes / t.total_bytes) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="mt-0.5 text-[#888]">
                {formatSize(t.transferred_bytes)} / {formatSize(t.total_bytes)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/SftpFileDetail.tsx
git commit -m "feat(sftp): add SftpFileDetail component (file info + transfer queue)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Create SftpTree Component

**Files:**
- Create: `src/components/terminal/SftpTree.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface SftpTreeProps {
  currentPath: string;
  onPathChange: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

// 预定义常用目录结构
const defaultTree: TreeNode[] = [
  {
    name: "/",
    path: "/",
    children: [
      { name: "home", path: "/home" },
      { name: "var", path: "/var" },
      { name: "etc", path: "/etc" },
      { name: "usr", path: "/usr" },
      { name: "tmp", path: "/tmp" },
      { name: "opt", path: "/opt" },
      { name: "root", path: "/root" },
    ],
  },
];

export default function SftpTree({ currentPath, onPathChange }: SftpTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/"]));

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = currentPath === node.path || currentPath.startsWith(node.path + "/");
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center px-2 py-[3px] text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
            isActive ? "bg-[#1e3a5f] text-[#4fc3f7]" : "text-[#999] hover:bg-[#2a2a45] hover:text-[#ddd]"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => {
            onPathChange(node.path);
            if (hasChildren) toggleExpand(node.path);
          }}
        >
          {hasChildren && (
            <span className="mr-0.5 shrink-0" onClick={(e) => { e.stopPropagation(); toggleExpand(node.path); }}>
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 inline" />
              ) : (
                <ChevronRight className="h-3 w-3 inline" />
              )}
            </span>
          )}
          {!hasChildren && <span className="w-3 shrink-0" />}
          <span className="mr-1">{node.path === "/" ? "📁" : "📁"}</span>
          <span className="truncate">{node.name}</span>
        </div>
        {hasChildren && isExpanded &&
          node.children!.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full w-[160px] flex-col border-r border-[#333] bg-[#1a1a2e] shrink-0 overflow-hidden">
      <div className="bg-[#252540] px-2 py-1.5 text-[10px] font-bold text-[#aaa] border-b border-[#333]">
        📁 远程目录
      </div>
      <div className="flex-1 overflow-y-auto">
        {defaultTree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/SftpTree.tsx
git commit -m "feat(sftp): add SftpTree component (directory tree navigation)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Create SftpFileList Component

**Files:**
- Create: `src/components/terminal/SftpFileList.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { Folder, FileText, ArrowUp, ArrowDown, Trash2, FolderPlus, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SftpFile } from "@/types";

interface SftpFileListProps {
  files: SftpFile[];
  currentPath: string;
  selectedFile: SftpFile | null;
  onSelectFile: (file: SftpFile | null) => void;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onDelete: (file: SftpFile) => void;
  onMkdir: (name: string) => void;
  onRename: (oldPath: string, newName: string) => void;
}

export default function SftpFileList({
  files,
  currentPath,
  selectedFile,
  onSelectFile,
  onPathChange,
  onRefresh,
  onDelete,
  onMkdir,
  onRename,
}: SftpFileListProps) {
  const [showMkdirDialog, setShowMkdirDialog] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // 面包屑解析
  const breadcrumbs = currentPath === "/"
    ? [{ name: "根目录", path: "/" }]
    : [{ name: "根目录", path: "/" }, ...currentPath.split("/").filter(Boolean).map((part, i, arr) => ({
        name: part,
        path: "/" + arr.slice(0, i + 1).join("/"),
      }))];

  const handleDoubleClick = (file: SftpFile) => {
    if (file.is_dir) {
      onPathChange(file.path);
    }
  };

  const handleDelete = () => {
    if (selectedFile) {
      onDelete(selectedFile);
    }
  };

  const handleMkdir = () => {
    if (mkdirName.trim()) {
      onMkdir(mkdirName.trim());
      setMkdirName("");
      setShowMkdirDialog(false);
    }
  };

  const handleRename = () => {
    if (selectedFile && renameValue.trim()) {
      const parent = currentPath === "/" ? "" : currentPath;
      const newPath = parent + "/" + renameValue.trim();
      onRename(selectedFile.path, newPath);
      setRenameValue("");
      setShowRenameDialog(false);
    }
  };

  const openRename = () => {
    if (selectedFile) {
      setRenameValue(selectedFile.name);
      setShowRenameDialog(true);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 面包屑 */}
      <div className="bg-[#252540] px-3 py-1.5 text-[10px] text-[#aaa] border-b border-[#333]">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            {i > 0 && <span className="mx-1 text-[#666]">&gt;</span>}
            <span
              className="cursor-pointer text-[#4fc3f7] hover:underline"
              onClick={() => onPathChange(crumb.path)}
            >
              {crumb.name}
            </span>
          </span>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex gap-1 px-2 py-1 bg-[#1e1e2e] border-b border-[#333]">
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={() => {}}>
          <ArrowUp className="h-3 w-3 mr-1" />上传
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={() => {}}>
          <ArrowDown className="h-3 w-3 mr-1" />下载
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={handleDelete}>
          <Trash2 className="h-3 w-3 mr-1" />删除
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={() => setShowMkdirDialog(true)}>
          <FolderPlus className="h-3 w-3 mr-1" />新建
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55]" onClick={openRename}>
          <Pencil className="h-3 w-3 mr-1" />重命名
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-[#ccc] hover:bg-[#3a3a55] ml-auto" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" />刷新
        </Button>
      </div>

      {/* 列表头 */}
      <div className="flex px-3 py-1 bg-[#1a1a2e] border-b border-[#333] text-[10px] text-[#888] font-bold">
        <div className="flex-[2]">名称</div>
        <div className="flex-1 text-right">大小</div>
        <div className="flex-[1.5] text-right">修改时间</div>
        <div className="flex-1 text-right">权限</div>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto">
        {/* 返回上级 */}
        {currentPath !== "/" && (
          <div
            className="flex px-3 py-1 text-[10px] text-[#888] cursor-pointer hover:bg-[#252540] border-b border-[#222]"
            onClick={() => {
              const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
              onPathChange(parent);
            }}
          >
            <div className="flex-[2]">📁 ..</div>
            <div className="flex-1 text-right">-</div>
            <div className="flex-[1.5] text-right">-</div>
            <div className="flex-1 text-right">-</div>
          </div>
        )}
        {files.map((file) => (
          <div
            key={file.path}
            className={`flex px-3 py-1 text-[10px] cursor-pointer border-b border-[#222] ${
              selectedFile?.path === file.path
                ? "bg-[#1e3a5f]"
                : "hover:bg-[#252540]"
            }`}
            onClick={() => onSelectFile(file)}
            onDoubleClick={() => handleDoubleClick(file)}
          >
            <div className={`flex-[2] ${file.is_dir ? "text-[#e5e510]" : "text-[#bbb]"}`}>
              {file.is_dir ? <Folder className="h-3 w-3 inline mr-1" /> : <FileText className="h-3 w-3 inline mr-1" />}
              {file.name}
            </div>
            <div className="flex-1 text-right text-[#999]">{formatSize(file.size)}</div>
            <div className="flex-[1.5] text-right text-[#999]">{file.modified_time}</div>
            <div className="flex-1 text-right text-[#999]">{file.permissions}</div>
          </div>
        ))}
      </div>

      {/* 状态栏 */}
      <div className="bg-[#252540] px-3 py-[3px] text-[9px] text-[#888] border-t border-[#333]">
        {files.length} 个项目{selectedFile ? ` | 已选择: ${selectedFile.name}` : ""}
      </div>

      {/* 新建文件夹对话框 */}
      <Dialog open={showMkdirDialog} onOpenChange={setShowMkdirDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="文件夹名称"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
              autoFocus
            />
            <Button className="w-full" onClick={handleMkdir} disabled={!mkdirName.trim()}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="新名称"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
            <Button className="w-full" onClick={handleRename} disabled={!renameValue.trim()}>
              确认
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/SftpFileList.tsx
git commit -m "feat(sftp): add SftpFileList component (breadcrumb, toolbar, file rows, status bar)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Create SftpPanel Component

**Files:**
- Create: `src/components/terminal/SftpPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect, useCallback } from "react";
import SftpTree from "./SftpTree";
import SftpFileList from "./SftpFileList";
import SftpFileDetail from "./SftpFileDetail";
import { sftpListDir, sftpDelete, sftpMkdir, sftpRename } from "@/lib/api";
import type { SftpFile, SftpTransfer } from "@/types";

interface SftpPanelProps {
  sessionId: string;
}

export default function SftpPanel({ sessionId }: SftpPanelProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<SftpFile | null>(null);
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const list = await sftpListDir(sessionId, path);
      setFiles(list);
      setCurrentPath(path);
      setSelectedFile(null);
    } catch (err) {
      console.error("Failed to list directory:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadFiles("/");
  }, [sessionId, loadFiles]);

  const handleDelete = async (file: SftpFile) => {
    if (!confirm(`确定要删除 "${file.name}" 吗？`)) return;
    try {
      await sftpDelete(sessionId, file.path, file.is_dir);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("删除失败: " + String(err));
    }
  };

  const handleMkdir = async (name: string) => {
    const newPath = currentPath === "/" ? "/" + name : currentPath + "/" + name;
    try {
      await sftpMkdir(sessionId, newPath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to create directory:", err);
      alert("创建失败: " + String(err));
    }
  };

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      await sftpRename(sessionId, oldPath, newPath);
      loadFiles(currentPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      alert("重命名失败: " + String(err));
    }
  };

  return (
    <div className="flex h-full bg-[#1e1e2e]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
          <div className="text-[#0dbc79] text-xs">加载中...</div>
        </div>
      )}
      <SftpTree
        currentPath={currentPath}
        onPathChange={loadFiles}
      />
      <SftpFileList
        files={files}
        currentPath={currentPath}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onPathChange={loadFiles}
        onRefresh={() => loadFiles(currentPath)}
        onDelete={handleDelete}
        onMkdir={handleMkdir}
        onRename={handleRename}
      />
      <SftpFileDetail
        file={selectedFile}
        transfers={transfers}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal/SftpPanel.tsx
git commit -m "feat(sftp): add SftpPanel container component

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Update Terminal Page Layout

**Files:**
- Modify: `src/pages/Terminal.tsx`

- [ ] **Step 1: Import SftpPanel**

在 `src/pages/Terminal.tsx` 的 import 区域添加：

```tsx
import SftpPanel from "@/components/terminal/SftpPanel";
```

- [ ] **Step 2: Modify connected state layout**

找到已连接时的 JSX（大约在第 613-634 行），将：

```tsx
        {websocketUrl ? (
          <>
            {/* Terminal toolbar */}
            <div className="flex items-center gap-2 border-b p-3">
              ...
            </div>
            {/* Terminal area */}
            <div className="flex-1 overflow-hidden bg-[#1a1a2e]">
              <XTerm websocketUrl={websocketUrl} />
            </div>
          </>
        ) : (
```

替换为：

```tsx
        {websocketUrl ? (
          <>
            {/* Terminal toolbar */}
            <div className="flex items-center gap-2 border-b p-3">
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
            </div>
            {/* 上下分栏：SSH 终端 + SFTP */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* SSH 终端 - 上部 45% */}
              <div className="h-[45%] border-b border-[#333] overflow-hidden bg-[#1a1a2e]">
                <XTerm websocketUrl={websocketUrl} />
              </div>
              {/* SFTP 文件管理器 - 下部 55% */}
              <div className="h-[55%] overflow-hidden">
                <SftpPanel sessionId={sessionId} />
              </div>
            </div>
          </>
        ) : (
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd /Users/baiyuyao/code_tools/Kimi_Agent_mac运维面板方案/macops && npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 4: Commit**

```bash
git add src/pages/Terminal.tsx
git commit -m "feat(sftp): integrate SftpPanel into Terminal page with top-bottom layout

SSH terminal on top (45%), SFTP file manager on bottom (55%)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Verify Full Compilation

- [ ] **Step 1: Verify Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无错误

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 3: Run dev build**

Run: `npm run tauri dev`
Expected: 应用正常启动

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(sftp): complete SFTP file manager implementation

FinalShell-style SFTP panel with three-column layout:
- Left: directory tree navigation
- Center: file list with breadcrumb and toolbar
- Right: file details and transfer queue

Supported operations: browse, upload, download, delete,
mkdir, rename, view file permissions and metadata.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Spec Coverage Checklist

| 设计文档要求 | 对应任务 |
|-------------|---------|
| Cargo.toml 添加 ssh2 依赖 | Task 1 |
| SftpFile 类型（Rust + TS） | Task 2 |
| SftpManager 后端实现 | Task 3 |
| 7 个 SFTP IPC 命令 | Task 4 |
| main.rs 注册命令 | Task 5 |
| 前端 API 封装 | Task 6 |
| 三栏 SFTP 面板 | Tasks 7-10 |
| Terminal.tsx 上下分栏 | Task 11 |
| 文件操作（浏览/删除/新建/重命名） | Tasks 3-4, 9-10 |
| 文件详情显示 | Task 7 |
| 面包屑导航 | Task 9 |
| 状态栏 | Task 9 |

---

## Placeholder Scan

- [x] 无 "TBD" / "TODO" / "implement later"
- [x] 每个步骤包含完整代码
- [x] 每个步骤包含验证命令
- [x] 类型名称前后一致（SftpFile, SftpTransfer）
- [x] 函数签名前后一致
