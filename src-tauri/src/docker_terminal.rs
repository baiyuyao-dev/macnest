use base64::Engine;
use futures::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;
use tokio_tungstenite::tungstenite::Message;

// ── Docker binary path (same logic as docker.rs) ──

fn docker_path() -> PathBuf {
    if let Ok(path) = std::env::var("DOCKER_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return p;
        }
    }
    let candidates = [
        "/opt/homebrew/bin/docker",
        "/usr/local/bin/docker",
        "/usr/bin/docker",
        "/bin/docker",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return PathBuf::from(c);
        }
    }
    PathBuf::from("docker")
}

// ── Resize message ──

#[derive(Debug, Deserialize)]
struct ResizeMessage {
    #[serde(rename = "type")]
    msg_type: String,
    cols: u16,
    rows: u16,
}

// ── Session types ──

#[derive(Debug, Serialize, Clone)]
pub struct DockerTerminalSessionInfo {
    pub session_id: String,
    pub container_id: String,
    pub container_name: String,
    pub shell: String,
    pub websocket_url: String,
}

struct DockerExecSession {
    #[allow(dead_code)]
    container_id: String,
    #[allow(dead_code)]
    container_name: String,
    #[allow(dead_code)]
    shell: String,
    #[allow(dead_code)]
    websocket_port: u16,
    child: Box<dyn portable_pty::Child + Send>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
}

impl Drop for DockerExecSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

pub struct DockerTerminalManager {
    sessions: TokioMutex<HashMap<String, DockerExecSession>>,
}

impl DockerTerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: TokioMutex::new(HashMap::new()),
        }
    }

    pub async fn create_session(
        &self,
        container_id: &str,
        container_name: &str,
        shell: &str,
    ) -> Result<DockerTerminalSessionInfo, String> {
        // Verify container is running
        let inspect = Command::new(docker_path())
            .args(["inspect", "--format", "{{.State.Running}}", container_id])
            .output()
            .await
            .map_err(|e| format!("Failed to inspect container: {}", e))?;

        let running = String::from_utf8_lossy(&inspect.stdout).trim().to_string();
        if running != "true" {
            return Err("容器未在运行中".to_string());
        }

        // Create a PTY so docker exec -it works and Ctrl+C is handled by the
        // kernel TTY driver (translates 0x03 into SIGINT).
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&*docker_path().to_string_lossy());
        cmd.arg("exec");
        cmd.arg("-it");
        cmd.arg("-e");
        cmd.arg("TERM=xterm-256color");
        cmd.arg(container_id);
        cmd.arg(shell);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn docker exec: {}", e))?;

        let pty_reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
        let pty_writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;
        let master = Arc::new(Mutex::new(pair.master));

        // Bind ephemeral WebSocket port
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind WebSocket port: {}", e))?;
        let websocket_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        let session_id = uuid::Uuid::new_v4().to_string();

        eprintln!(
            "[docker-terminal] Session {} created: container={}, shell={}, ws_port={}",
            session_id, container_id, shell, websocket_port
        );

        // Start WebSocket relay
        let sid_for_log = session_id.clone();
        let master_for_server = master.clone();
        tokio::spawn(async move {
            start_docker_exec_server(
                listener,
                pty_reader,
                pty_writer,
                master_for_server,
                &sid_for_log,
            )
            .await;
        });

        let info = DockerTerminalSessionInfo {
            session_id: session_id.clone(),
            container_id: container_id.to_string(),
            container_name: container_name.to_string(),
            shell: shell.to_string(),
            websocket_url: format!("ws://127.0.0.1:{}", websocket_port),
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(
            session_id,
            DockerExecSession {
                container_id: container_id.to_string(),
                container_name: container_name.to_string(),
                shell: shell.to_string(),
                websocket_port,
                child,
                master,
            },
        );

        Ok(info)
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(mut session) = sessions.remove(session_id) {
            eprintln!("[docker-terminal] Session {} closing", session_id);
            let _ = session.child.kill();
            eprintln!("[docker-terminal] Session {} closed", session_id);
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }
}

// ── WebSocket relay ──

async fn start_docker_exec_server(
    listener: tokio::net::TcpListener,
    mut pty_reader: Box<dyn Read + Send>,
    mut pty_writer: Box<dyn Write + Send>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    session_id: &str,
) {
    // Broadcast channel: PTY output → all active WebSocket connections
    let (broadcast_tx, _) = tokio::sync::broadcast::channel::<Vec<u8>>(1024);

    // Spawn blocking task to read from PTY master
    let broadcast_tx_clone = broadcast_tx.clone();
    let sid = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut total = 0usize;
        loop {
            match pty_reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!("[docker-terminal:{}] PTY EOF (total {} bytes)", sid, total);
                    break;
                }
                Ok(n) => {
                    total += n;
                    eprintln!("[docker-terminal:{}] PTY read {} bytes (total {}), first bytes: {:?}",
                        sid, n, total, &buf[..n.min(20)]);
                    if broadcast_tx_clone.send(buf[..n].to_vec()).is_err() {
                        eprintln!("[docker-terminal:{}] broadcast send failed", sid);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[docker-terminal:{}] PTY read error: {}", sid, e);
                    break;
                }
            }
        }
    });

    // Write channel: WebSocket → PTY master (std::thread + std::sync::mpsc 更稳定)
    let (write_tx, write_rx) = std::sync::mpsc::channel::<Vec<u8>>();

    // Spawn blocking thread to write to PTY master
    std::thread::spawn(move || {
        while let Ok(data) = write_rx.recv() {
            if pty_writer.write_all(&data).is_err() {
                break;
            }
            if pty_writer.flush().is_err() {
                break;
            }
        }
    });

    // Accept loop: support reconnection (xterm.js auto-reconnects)
    loop {
        eprintln!(
            "[docker-terminal:{}] Waiting for WebSocket connection...",
            session_id
        );
        let (stream, _) = match listener.accept().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[docker-terminal:{}] Accept error: {}", session_id, e);
                break;
            }
        };

        let ws_stream = match tokio_tungstenite::accept_async(stream).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!(
                    "[docker-terminal:{}] WebSocket handshake error: {}",
                    session_id, e
                );
                continue;
            }
        };

        eprintln!(
            "[docker-terminal:{}] WebSocket client connected",
            session_id
        );
        let (mut ws_write, mut ws_read) = ws_stream.split();

        let mut broadcast_rx = broadcast_tx.subscribe();
        let write_tx = write_tx.clone();
        let master = master.clone();
        let sid = session_id.to_string();
        let sid_writer = sid.clone();

        // Task 1: PTY → WebSocket + ping keepalive
        let reader = tokio::spawn(async move {
            let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
            let mut ws_total = 0usize;
            loop {
                let result = tokio::select! {
                    biased;
                    _ = ping_interval.tick() => {
                        if ws_write.send(Message::Ping(vec![].into())).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    result = broadcast_rx.recv() => result,
                };
                match result {
                    Ok(data) => {
                        ws_total += data.len();
                        let b64 =
                            base64::engine::general_purpose::STANDARD.encode(&data);
                        eprintln!("[docker-terminal:{}] WS send {} bytes (total {})", sid, data.len(), ws_total);
                        if ws_write.send(Message::Text(b64.into())).await.is_err() {
                            eprintln!("[docker-terminal:{}] WS send failed", sid);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
            eprintln!("[docker-terminal:{}] WS reader task ended", sid);
        });

        // Task 2: WebSocket → PTY
        let writer = tokio::spawn(async move {
            while let Some(ws_msg) = ws_read.next().await {
                match ws_msg {
                    Ok(Message::Text(text)) => {
                        if text == "\0" {
                            continue;
                        }
                        // Handle resize
                        if let Ok(resize) = serde_json::from_str::<ResizeMessage>(&text)
                        {
                            if resize.msg_type == "resize" {
                                let master = master.clone();
                                let sid2 = sid_writer.clone();
                                tokio::task::spawn_blocking(move || {
                                    let master = master.lock().unwrap();
                                    match master.resize(PtySize {
                                        rows: resize.rows,
                                        cols: resize.cols,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    }) {
                                        Ok(_) => eprintln!(
                                            "[docker-terminal:{}] PTY resized to {}x{}",
                                            sid2, resize.cols, resize.rows
                                        ),
                                        Err(e) => eprintln!(
                                            "[docker-terminal:{}] PTY resize failed: {}",
                                            sid2, e
                                        ),
                                    }
                                });
                                continue;
                            }
                        }
                        if let Ok(bytes) =
                            base64::engine::general_purpose::STANDARD.decode(&text)
                        {
                            if write_tx.send(bytes).is_err() {
                                break;
                            }
                        }
                    }
                    Ok(Message::Binary(data)) => {
                        if write_tx.send(data.to_vec()).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            eprintln!("[docker-terminal:{}] WebSocket reader closed", sid_writer);
        });

        let (r1, r2) = tokio::join!(reader, writer);
        if let Err(e) = r1 {
            eprintln!("[docker-terminal:{}] reader panic: {}", session_id, e);
        }
        if let Err(e) = r2 {
            eprintln!("[docker-terminal:{}] writer panic: {}", session_id, e);
        }
        eprintln!(
            "[docker-terminal:{}] WebSocket disconnected, waiting for reconnection...",
            session_id
        );
    }
}

// ── Shell detection ──

pub async fn detect_shells(container_id: &str) -> Result<Vec<String>, String> {
    let known_shells = ["/bin/bash", "/bin/zsh", "/bin/sh"];
    let mut available = Vec::new();

    let output = Command::new(docker_path())
        .args([
            "exec",
            container_id,
            "ls",
            "/bin/bash",
            "/bin/zsh",
            "/bin/sh",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to detect shells: {}", e))?;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if known_shells.contains(&trimmed) {
            available.push(trimmed.to_string());
        }
    }

    // Fallback: always include /bin/sh
    if available.is_empty() {
        available.push("/bin/sh".to_string());
    }

    // Sort by preference: bash > zsh > sh
    available.sort_by(|a, b| {
        let priority = |s: &str| match s {
            "/bin/bash" => 0,
            "/bin/zsh" => 1,
            "/bin/sh" => 2,
            _ => 3,
        };
        priority(a).cmp(&priority(b))
    });

    eprintln!("[docker-terminal] Available shells: {:?}", available);
    Ok(available)
}
