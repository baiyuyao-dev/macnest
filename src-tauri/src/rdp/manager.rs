use std::collections::HashMap;

use base64::Engine;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::rdp::session::{InputEvent, SessionConfig, SessionHandle, start_session};

pub struct RdpSessionManager {
    sessions: Mutex<HashMap<String, RdpSessionEntry>>,
}

struct RdpSessionEntry {
    handle: SessionHandle,
    connection_name: String,
}

impl RdpSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn create_session(
        &self,
        app_handle: AppHandle,
        config: SessionConfig,
        connection_name: String,
    ) -> anyhow::Result<String> {
        let session_id = Uuid::new_v4().to_string();
        let mut handle = start_session(config, app_handle.clone(), session_id.clone())?;

        // Spawn frame forwarding task
        let session_id_clone = session_id.clone();
        let app_handle_clone = app_handle.clone();
        let mut frame_rx = handle.frame_rx.take().ok_or_else(|| anyhow::anyhow!("frame_rx already taken"))?;
        tokio::spawn(async move {
            loop {
                match frame_rx.recv().await {
                    Some(frame_data) => {
                        let event_name = format!("rdp-frame-{}", session_id_clone);
                        let base64_frame = base64::engine::general_purpose::STANDARD.encode(&frame_data);
                        if let Err(e) = app_handle_clone.emit(
                            &event_name, base64_frame) {
                            eprintln!("[rdp] failed to emit frame: {}", e);
                            break;
                        }
                    }
                    None => {
                        eprintln!("[rdp] frame channel closed for session {}", session_id_clone);
                        break;
                    }
                }
            }
            // Notify frontend that session ended
            let _ = app_handle_clone.emit(
                &format!("rdp-disconnected-{}", session_id_clone),
                (),
            );
        });

        self.sessions.lock().await.insert(
            session_id.clone(),
            RdpSessionEntry {
                handle,
                connection_name,
            },
        );

        eprintln!("[rdp] session {} started", session_id);
        Ok(session_id)
    }

    pub async fn send_input(
        &self,
        session_id: &str,
        event: InputEvent,
    ) -> anyhow::Result<()> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        entry
            .handle
            .input_tx
            .send(event)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send input: {}", e))?;

        Ok(())
    }

    pub async fn close_session(&self, session_id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(entry) = sessions.remove(session_id) {
            entry.handle.shutdown();
            eprintln!("[rdp] session {} shutdown requested", session_id);
        }
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<(String, String)> {
        self.sessions
            .lock()
            .await
            .iter()
            .map(|(id, entry)| (id.clone(), entry.connection_name.clone()))
            .collect()
    }
}
