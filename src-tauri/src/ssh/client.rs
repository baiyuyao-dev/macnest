use async_trait::async_trait;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::keys::{load_secret_key, ssh_key};
use russh::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tokio::net::ToSocketAddrs;

use super::types::SshAuthType;

/// 已知主机指纹缓存（内存），key 为 "host:port"
lazy_static::lazy_static! {
    static ref KNOWN_HOSTS: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

pub struct SshClientHandler {
    pub host_key: String, // "host:port"
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256);
        let fingerprint_str = fingerprint.to_string();

        let known = KNOWN_HOSTS.lock().unwrap();
        if let Some(stored) = known.get(&self.host_key) {
            // 已知主机：指纹必须匹配
            return Ok(stored == &fingerprint_str);
        }
        drop(known);

        // 首次连接：记录指纹并接受
        // TODO: 生产环境应 emit 事件让前端展示指纹确认对话框
        eprintln!(
            "[ssh] 首次连接 {}，指纹: {}",
            self.host_key, fingerprint_str
        );
        KNOWN_HOSTS
            .lock()
            .unwrap()
            .insert(self.host_key.clone(), fingerprint_str);
        Ok(true)
    }
}

pub struct SshConnectionManager {
    session: client::Handle<SshClientHandler>,
}

impl SshConnectionManager {
    pub async fn connect<A: ToSocketAddrs + Clone + std::fmt::Debug>(
        addrs: A,
        host_key: String,
    ) -> anyhow::Result<Self> {
        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..<_>::default()
        };
        let config = Arc::new(config);
        let handler = SshClientHandler { host_key };
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

    pub async fn open_pty(
        &mut self,
    ) -> anyhow::Result<Channel<client::Msg>> {
        eprintln!("[ssh] Opening SSH channel...");
        let channel = self.session.channel_open_session().await?;
        eprintln!("[ssh] SSH channel opened, requesting PTY...");
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
        eprintln!("[ssh] PTY requested, requesting shell...");
        channel.request_shell(true).await?;
        eprintln!("[ssh] Shell request accepted");

        // 注入 shell 路径同步配置（OSC 7）
        // 避免在单引号内使用 \r（会被 icrnl 转成 \n 导致字符串跨行）
        // 用 \x0d 表示回车，bash printf 会正确解释
        let init: &[u8] = b"\rPROMPT_COMMAND='printf \"\x1B]7;file://%s\x07\" \"$PWD\"';[ -n \"$ZSH_VERSION\" ]&&precmd(){printf \"\x1B]7;file://%s\x07\" \"$PWD\"}\n";
        let _ = channel.data(init).await;

        Ok(channel)
    }

    pub async fn window_change(
        &mut self,
        _cols: u32,
        _rows: u32,
    ) -> anyhow::Result<()> {
        // This requires access to the channel, which is owned by the session manager.
        // The caller should use the channel directly.
        Ok(())
    }

    pub async fn disconnect(
        &mut self,
    ) -> anyhow::Result<()> {
        self.session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await?;
        Ok(())
    }

    pub fn session(&self) -> &client::Handle<SshClientHandler> {
        &self.session
    }
}
