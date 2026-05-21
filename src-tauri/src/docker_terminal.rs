use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, ChildStderr, Command};
use tokio::sync::Mutex;
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

// ── Resize message (ignored in pipe mode) ──

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
    child: Child,
}

impl Drop for DockerExecSession {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

pub struct DockerTerminalManager {
    sessions: Mutex<HashMap<String, DockerExecSession>>,
}

impl DockerTerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
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

        // Spawn docker exec -i with an interactive shell.
        // Without a TTY, bash outputs prompts/echo to stderr and commands
        // output to stdout. We capture BOTH and relay them to the WebSocket.
        let mut child = Command::new(docker_path())
            .args([
                "exec",
                "-i",
                "-e",
                "TERM=xterm-256color",
                container_id,
                shell,
                "-i",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn docker exec: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture docker exec stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture docker exec stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture docker exec stderr")?;

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
        tokio::spawn(async move {
            start_docker_exec_server(listener, stdin, stdout, stderr, &sid_for_log).await;
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
            },
        );

        Ok(info)
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(mut session) = sessions.remove(session_id) {
            eprintln!("[docker-terminal] Session {} closed", session_id);
            let _ = session.child.start_kill();
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }
}

// ── Helpers ──

/// Convert bare `\n` (LF) to `\r\n` (CRLF) so xterm.js renders line breaks correctly.
/// Programs running without a TTY output bare LF; the terminal emulator expects CRLF.
fn fix_newlines(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut prev = 0u8;
    for &b in data {
        if b == b'\n' && prev != b'\r' {
            out.push(b'\r');
        }
        out.push(b);
        prev = b;
    }
    out
}

// ── WebSocket relay ──

async fn start_docker_exec_server(
    listener: tokio::net::TcpListener,
    stdin_pipe: ChildStdin,
    stdout_pipe: ChildStdout,
    stderr_pipe: ChildStderr,
    session_id: &str,
) {
    let stdin_writer = Arc::new(Mutex::new(stdin_pipe));
    let stdout_reader = Arc::new(Mutex::new(stdout_pipe));
    let stderr_reader = Arc::new(Mutex::new(stderr_pipe));

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

        let stdout_r = stdout_reader.clone();
        let stderr_r = stderr_reader.clone();
        let stdin_w = stdin_writer.clone();
        let sid = session_id.to_string();

        // Task 1: stdout + stderr → WebSocket + keepalive
        let reader = tokio::spawn(async move {
            let mut stdout_buf = [0u8; 4096];
            let mut stderr_buf = [0u8; 4096];
            let mut ping_interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                let result = tokio::select! {
                    biased;
                    _ = ping_interval.tick() => {
                        if ws_write.send(Message::Ping(vec![].into())).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    n = async {
                        let mut stdout = stdout_r.lock().await;
                        stdout.read(&mut stdout_buf).await
                    } => ("stdout", n),
                    n = async {
                        let mut stderr = stderr_r.lock().await;
                        stderr.read(&mut stderr_buf).await
                    } => ("stderr", n),
                };

                match result {
                    ("stdout", Ok(0)) => {
                        eprintln!("[docker-terminal:{}] stdout EOF — process exited", sid);
                        let _ = ws_write.send(Message::Close(None)).await;
                        break;
                    }
                    ("stderr", Ok(0)) => {
                        // stderr EOF is normal when the process closes it;
                        // keep reading stdout until that EOFs too.
                        continue;
                    }
                    ("stdout", Ok(n)) => {
                        let fixed = fix_newlines(&stdout_buf[..n]);
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&fixed);
                        if ws_write.send(Message::Text(b64.into())).await.is_err() {
                            eprintln!("[docker-terminal:{}] WebSocket send error", sid);
                            break;
                        }
                    }
                    ("stderr", Ok(n)) => {
                        let fixed = fix_newlines(&stderr_buf[..n]);
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&fixed);
                        if ws_write.send(Message::Text(b64.into())).await.is_err() {
                            eprintln!("[docker-terminal:{}] WebSocket send error", sid);
                            break;
                        }
                    }
                    (_, Err(e)) => {
                        eprintln!("[docker-terminal:{}] pipe read error: {}", sid, e);
                        break;
                    }
                    _ => break,
                }
            }
        });

        // Task 2: WebSocket → stdin
        let sid = session_id.to_string();
        let writer = tokio::spawn(async move {
            while let Some(ws_msg) = ws_read.next().await {
                match ws_msg {
                    Ok(Message::Text(text)) => {
                        if text == "\0" {
                            continue;
                        }
                        // Silently consume resize messages (no TTY in pipe mode)
                        if serde_json::from_str::<ResizeMessage>(&text).is_ok() {
                            continue;
                        }
                        if let Ok(bytes) =
                            base64::engine::general_purpose::STANDARD.decode(&text)
                        {
                            let mut stdin = stdin_w.lock().await;
                            if stdin.write_all(&bytes).await.is_err() {
                                break;
                            }
                        }
                    }
                    Ok(Message::Binary(data)) => {
                        let mut stdin = stdin_w.lock().await;
                        if stdin.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            eprintln!("[docker-terminal:{}] WebSocket reader closed", sid);
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
