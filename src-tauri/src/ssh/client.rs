use async_trait::async_trait;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::keys::{load_secret_key, ssh_key};
use russh::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::ToSocketAddrs;

use super::types::SshAuthType;

pub struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    /// TODO: Implement proper host key verification (known_hosts file)
    /// Currently accepts all host keys for ease of use in MVP.
    /// This is a security risk and should be addressed before production use.
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
            keepalive_interval: Some(Duration::from_secs(30)),
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
