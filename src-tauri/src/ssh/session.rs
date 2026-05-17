use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::client::SshConnectionManager;
use super::types::{SshAuthType, SshConnection, SshSessionInfo};

pub struct SshSessionManager {
    sessions: Mutex<HashMap<String, SshSession>>,
}

pub struct SshSession {
    pub info: SshSessionInfo,
    pub connection_manager: SshConnectionManager,
    pub channel: Option<Arc<Mutex<russh::Channel<russh::client::Msg>>>>,
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
    ) -> anyhow::Result<String> {
        let session_id = Uuid::new_v4().to_string();
        let mut manager = SshConnectionManager::connect((
            connection.host.as_str(),
            connection.port,
        ))
        .await?;

        let auth_result = manager
            .authenticate(&connection.username, &connection.auth_type)
            .await?;

        if !auth_result {
            anyhow::bail!("Authentication failed");
        }

        let info = SshSessionInfo {
            session_id: session_id.clone(),
            connection_id: connection.id,
            host: connection.host.clone(),
            username: connection.username.clone(),
            connected: true,
            connected_at: chrono::Local::now().to_rfc3339(),
            websocket_port: 0,
        };

        let session = SshSession {
            info,
            connection_manager: manager,
            channel: None,
        };

        self.sessions.lock().await.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn open_pty(
        &self,
        session_id: &str,
    ) -> anyhow::Result<u16> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let channel = session.connection_manager.open_pty().await?;
        let websocket_port = find_available_port().await?;

        let channel_arc = Arc::new(Mutex::new(channel));
        session.channel = Some(channel_arc.clone());
        session.info.websocket_port = websocket_port;

        // 启动 WebSocket 服务器
        tokio::spawn(async move {
            let _ = super::websocket::start_pty_server(websocket_port, channel_arc).await;
        });

        Ok(websocket_port)
    }

    pub async fn disconnect(
        &self,
        session_id: &str,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(mut session) = sessions.remove(session_id) {
            let _ = session.connection_manager.disconnect().await;
        }
        Ok(())
    }

    pub async fn get_session_info(
        &self,
        session_id: &str,
    ) -> Option<SshSessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|s| s.info.clone())
    }
}

async fn find_available_port() -> anyhow::Result<u16> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
