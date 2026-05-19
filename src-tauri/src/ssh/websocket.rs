use base64::Engine;
use futures::{SinkExt, StreamExt};
use russh::ChannelMsg;
use serde::Deserialize;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Deserialize)]
struct ResizeMessage {
    #[serde(rename = "type")]
    msg_type: String,
    cols: u32,
    rows: u32,
}

/// 桥接 SSH Channel 和 WebSocket 的 PTY 数据流。
///
/// 核心设计：
/// 1. Writer 独立任务：通过 mpsc channel 接收前端输入，持有 make_writer_ext() 创建的 writer。
///    writer 的生命周期与 WebSocket 解耦，WebSocket 断开时不会 drop writer，避免发送 EOF。
/// 2. SSH reader：每次 WebSocket 重连时创建新任务，把 SSH 数据转发给当前 WebSocket。
/// 3. Resize：通过独立任务异步执行 window_change，不阻塞键盘输入。
pub async fn start_pty_server(
    listener: tokio::net::TcpListener,
    channel: Arc<Mutex<russh::Channel<russh::client::Msg>>>,
) -> anyhow::Result<()> {
    // 创建 writer 独立任务：通过 mpsc 接收前端输入，写入 SSH channel
    let (write_tx, mut write_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    let channel_writer = channel.clone();
    tokio::spawn(async move {
        let mut writer = {
            let ch = channel_writer.lock().await;
            ch.make_writer_ext(None)
        };
        eprintln!("[ssh] writer task started");

        while let Some(data) = write_rx.recv().await {
            if let Err(e) = writer.write_all(&data).await {
                eprintln!("[ssh] writer error: {}", e);
                break;
            }
        }

        // 通道关闭（所有 sender drop）， flush 残留数据
        let _ = writer.flush().await;
        eprintln!("[ssh] writer task ended");
    });

    // 外层 loop：持续 accept 新 WebSocket 连接，支持前端重连
    loop {
        let (stream, _) = listener.accept().await?;
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        let (mut ws_write, mut ws_read) = ws_stream.split();

        eprintln!("[ssh] WebSocket client connected");

        // === 任务1: SSH -> WebSocket + ping keepalive ===
        let channel_reader = channel.clone();
        let ssh_reader = tokio::spawn(async move {
            eprintln!("[ssh] ssh_reader started");
            let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                let msg = tokio::select! {
                    biased;
                    _ = ping_interval.tick() => {
                        if let Err(e) = ws_write.send(Message::Ping(vec![].into())).await {
                            eprintln!("[ssh] WebSocket ping error: {}", e);
                            break;
                        }
                        continue;
                    }
                    msg = async {
                        let mut ch = channel_reader.lock().await;
                        ch.wait().await
                    } => msg,
                };
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(data);
                        if let Err(e) = ws_write.send(Message::Text(b64.into())).await {
                            eprintln!("[ssh] WebSocket send error: {}", e);
                            break;
                        }
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(data);
                        if let Err(e) = ws_write.send(Message::Text(b64.into())).await {
                            eprintln!("[ssh] WebSocket send error: {}", e);
                            break;
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        eprintln!("[ssh] SSH channel exit status: {}", exit_status);
                        break;
                    }
                    None => {
                        eprintln!("[ssh] SSH channel closed");
                        break;
                    }
                    _ => {}
                }
            }
            eprintln!("[ssh] ssh_reader exited");
        });

        // === 任务2: WebSocket -> writer 任务 ===
        let channel_ws = channel.clone();
        let write_tx_clone = write_tx.clone();
        let ws_to_ssh = tokio::spawn(async move {
            while let Some(ws_msg) = ws_read.next().await {
                match ws_msg {
                    Ok(Message::Text(text)) => {
                        // 忽略前端 keepalive（空字节）
                        if text == "\0" {
                            continue;
                        }
                        // 优先判断 JSON resize
                        if let Ok(resize) = serde_json::from_str::<ResizeMessage>(&text) {
                            if resize.msg_type == "resize" {
                                let c = channel_ws.clone();
                                tokio::spawn(async move {
                                    let ch = c.lock().await;
                                    if let Err(e) = ch
                                        .window_change(resize.cols, resize.rows, 0, 0)
                                        .await
                                    {
                                        eprintln!("[ssh] window_change error: {}", e);
                                    }
                                });
                            }
                            continue;
                        }
                        // 否则视为 base64 编码的键盘输入
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&text) {
                            if write_tx_clone.send(bytes).is_err() {
                                eprintln!("[ssh] writer channel closed");
                                break;
                            }
                        }
                    }
                    Ok(Message::Binary(data)) => {
                        // 兼容旧客户端
                        if write_tx_clone.send(data.to_vec()).is_err() {
                            eprintln!("[ssh] writer channel closed");
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    Ok(other) => {
                        eprintln!("[ssh] WebSocket other: {:?}", other);
                    }
                }
            }
        });

        let (r1, r2) = tokio::join!(ssh_reader, ws_to_ssh);
        if let Err(e) = r1 {
            eprintln!("[ssh] ssh_reader panic: {}", e);
        }
        if let Err(e) = r2 {
            eprintln!("[ssh] ws_to_ssh panic: {}", e);
        }
        eprintln!("[ssh] WebSocket client disconnected, waiting for reconnection...");
    }
}
