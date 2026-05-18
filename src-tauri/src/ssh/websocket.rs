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
/// 核心修复：使用 Channel::make_writer_ext() 创建独立 writer，
/// 写数据不需要 Mutex，彻底消除 wait() 与 data() 的竞争。
///
/// 支持 WebSocket 重连：外层 loop 持续 accept 新连接，前端路由切换后
/// 重新挂载 XTerm 时可以恢复与同一 SSH session 的通信。
pub async fn start_pty_server(
    listener: tokio::net::TcpListener,
    channel: Arc<Mutex<russh::Channel<russh::client::Msg>>>,
) -> anyhow::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        let (mut ws_write, mut ws_read) = ws_stream.split();

        // 创建独立 writer，它克隆了 channel 的 sender，写数据不需要 Mutex
        let mut writer = {
            let ch = channel.lock().await;
            ch.make_writer_ext(None)
        };

        // === 任务1: SSH -> WebSocket ===
        let channel_reader = channel.clone();
        let ssh_reader = tokio::spawn(async move {
            loop {
                let msg = {
                    let mut ch = channel_reader.lock().await;
                    ch.wait().await
                };
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        if let Err(e) = ws_write.send(Message::Binary(data.to_vec().into())).await {
                            eprintln!("[ssh] WebSocket send error: {}", e);
                            break;
                        }
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        if let Err(e) = ws_write.send(Message::Binary(data.to_vec().into())).await {
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
        });

        // === 任务2: WebSocket -> SSH (使用独立 writer，无 Mutex 竞争) ===
        let channel_ws = channel.clone();
        let ws_to_ssh = tokio::spawn(async move {
            while let Some(ws_msg) = ws_read.next().await {
                match ws_msg {
                    Ok(Message::Binary(data)) => {
                        if let Err(e) = writer.write_all(&data).await {
                            eprintln!("[ssh] SSH write error: {}", e);
                            break;
                        }
                        // 不要每次按键都 flush，让内核批量发送以减少延迟
                    }
                    Ok(Message::Text(text)) => {
                        if let Ok(resize) = serde_json::from_str::<ResizeMessage>(&text) {
                            if resize.msg_type == "resize" {
                                // resize 需要 channel 锁，但 wait() 可能长时间持有锁。
                                // 放到独立任务中执行，避免阻塞键盘输入的消息循环。
                                let c = channel_ws.clone();
                                tokio::spawn(async move {
                                    let ch = c.lock().await;
                                    if let Err(e) = ch.window_change(resize.cols, resize.rows, 0, 0).await {
                                        eprintln!("[ssh] window_change error: {}", e);
                                    }
                                });
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        let _ = channel_ws.lock().await.eof().await;
                        break;
                    }
                    Ok(other) => {
                        eprintln!("[ssh] WebSocket other: {:?}", other);
                    }
                    Err(e) => {
                        eprintln!("[ssh] WebSocket read error: {}", e);
                        break;
                    }
                }
            }
            // 循环结束后再 flush 一次，确保残留数据发出
            let _ = writer.flush().await;
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
