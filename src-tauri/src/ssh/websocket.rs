use futures::{SinkExt, StreamExt};
use russh::ChannelMsg;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

/// 启动 WebSocket 服务器，桥接 SSH Channel 和 WebSocket
pub async fn start_pty_server(
    port: u16,
    channel: Arc<Mutex<russh::Channel<russh::client::Msg>>>,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    let (stream, _) = listener.accept().await?;
    let ws_stream = tokio_tungstenite::accept_async(stream).await?;
    let (mut ws_write, mut ws_read) = ws_stream.split();

    // SSH → WebSocket
    let channel_ssh_to_ws = channel.clone();
    let ssh_to_ws = tokio::spawn(async move {
        loop {
            let msg = {
                let mut ch = channel_ssh_to_ws.lock().await;
                ch.wait().await
            };
            match msg {
                Some(ChannelMsg::Data { ref data }) => {
                    if ws_write
                        .send(Message::Binary(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    if ws_write
                        .send(Message::Binary(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Some(ChannelMsg::ExitStatus { .. }) | None => break,
                _ => {}
            }
        }
    });

    // WebSocket → SSH
    let ws_to_ssh = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_read.next().await {
            match msg {
                Message::Binary(data) => {
                    let mut ch = channel.lock().await;
                    if ch.data(&data[..]).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::try_join!(ssh_to_ws, ws_to_ssh)?;
    Ok(())
}
