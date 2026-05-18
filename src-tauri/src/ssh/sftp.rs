use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::types::{SshAuthType, SftpFile};

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

    pub fn create_file(&self, path: &Path) -> anyhow::Result<ssh2::File> {
        self.sftp.create(path).map_err(|e| e.into())
    }

    pub fn open_file(&self, path: &Path) -> anyhow::Result<ssh2::File> {
        self.sftp.open(path).map_err(|e| e.into())
    }
}
