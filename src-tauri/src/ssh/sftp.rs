use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};

use super::types::{SshAuthType, SftpFile};

pub struct SftpManager {
    #[allow(dead_code)]
    session: Session,
    sftp: ssh2::Sftp,
}

// ssh2::Session 和 ssh2::Sftp 都是 Send，SftpManager 仅持有它们，因此也是 Send
unsafe impl Send for SftpManager {}

/// 将权限位转换为人类可读的 rwx 格式，例如 "rwxr-xr-x"
fn format_permissions(perm: u32, is_dir: bool) -> String {
    let mode = perm & 0o777; // 只取低9位权限位
    let mut result = String::with_capacity(10);
    result.push(if is_dir { 'd' } else { '-' });
    // owner
    result.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o100 != 0 { 'x' } else { '-' });
    // group
    result.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o010 != 0 { 'x' } else { '-' });
    // others
    result.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o001 != 0 { 'x' } else { '-' });
    result
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

    /// 验证路径安全性，防止路径遍历攻击
    fn validate_sftp_path(&self, path: &str) -> anyhow::Result<()> {
        // 拒绝包含 .. 的路径组件
        for component in Path::new(path).components() {
            if let std::path::Component::ParentDir = component {
                anyhow::bail!("路径遍历不被允许：路径中包含 '..'");
            }
        }
        Ok(())
    }

    pub fn list_dir(&self, path: &str) -> anyhow::Result<Vec<SftpFile>> {
        self.validate_sftp_path(path)?;
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
                .map(|p| format_permissions(p, is_dir))
                .unwrap_or_else(|| "-".to_string());
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
        self.validate_sftp_path(path)?;
        if is_dir {
            // 先尝试 rmdir（仅空目录）
            if self.sftp.rmdir(Path::new(path)).is_err() {
                // 非空目录回退到 rm -rf
                let (_, stderr, exit_code) =
                    self.exec_command(&format!("rm -rf {}", shell_escape(path)))?;
                if exit_code != 0 {
                    anyhow::bail!("删除目录失败: {}", stderr);
                }
            }
        } else {
            self.sftp.unlink(Path::new(path))?;
        }
        Ok(())
    }

    pub fn mkdir(&self, path: &str) -> anyhow::Result<()> {
        self.validate_sftp_path(path)?;
        self.sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn rename(&self, old_path: &str, new_path: &str) -> anyhow::Result<()> {
        self.validate_sftp_path(old_path)?;
        self.validate_sftp_path(new_path)?;
        self.sftp
            .rename(Path::new(old_path), Path::new(new_path), None)?;
        Ok(())
    }

    pub fn get_file_info(&self, path: &str) -> anyhow::Result<SftpFile> {
        self.validate_sftp_path(path)?;
        let stat = self.sftp.stat(Path::new(path))?;
        let path_obj = Path::new(path);
        let name = path_obj
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let is_dir = stat.is_dir();
        let permissions = stat
            .perm
            .map(|p| format_permissions(p, is_dir))
            .unwrap_or_else(|| "-".to_string());
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

    pub fn create_file(&self, path: &Path) -> anyhow::Result<ssh2::File> {
        self.sftp.create(path).map_err(|e| e.into())
    }

    pub fn open_file(&self, path: &Path) -> anyhow::Result<ssh2::File> {
        self.sftp.open(path).map_err(|e| e.into())
    }

    /// 将字节内容写入远程文件（覆盖模式）
    pub fn write_file(&self, path: &str, content: &[u8]) -> anyhow::Result<()> {
        self.validate_sftp_path(path)?;
        let mut file = self.sftp.create(Path::new(path))?;
        file.write_all(content)?;
        Ok(())
    }

    /// 读取远程文件全部内容
    pub fn read_file(&self, path: &str) -> anyhow::Result<Vec<u8>> {
        self.validate_sftp_path(path)?;
        let mut file = self.sftp.open(Path::new(path))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        Ok(buf)
    }

    /// 通过 SSH exec 执行命令并返回 stdout/stderr/exit_code
    pub fn exec_command(&self, command: &str) -> anyhow::Result<(String, String, i32)> {
        let mut channel = self.session.channel_session()?;
        channel.exec(command)?;

        let mut stdout = String::new();
        channel.read_to_string(&mut stdout)?;

        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr)?;

        channel.wait_close()?;
        let exit_code = channel.exit_status()?;

        Ok((stdout, stderr, exit_code as i32))
    }
}

/// 简单 shell 转义：用单引号包裹，内部单引号转义
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
