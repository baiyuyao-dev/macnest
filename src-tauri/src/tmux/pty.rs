use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

pub struct TmuxPtySession {
    pub session_name: String,
    pub master: Arc<Mutex<Box<dyn Write + Send>>>,
    pub _reader_thread: Option<std::thread::JoinHandle<()>>,
}

/// 创建 PTY 并 attach 到 tmux 会话
pub fn attach_session_pty(
    session_name: &str,
    channel: Channel<Vec<u8>>,
) -> Result<TmuxPtySession, String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("tmux");
    cmd.arg("attach");
    cmd.arg("-t");
    cmd.arg(session_name);
    cmd.env("TERM", "xterm-256color");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut master_reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let master_writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));

    // 后台线程：PTY 输出 → Tauri Channel → 前端 xterm.js
    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match master_reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let _ = channel.send(buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
    });

    Ok(TmuxPtySession {
        session_name: session_name.to_string(),
        master: master_writer,
        _reader_thread: Some(reader_thread),
    })
}

/// 向 PTY 写入数据（用户键盘输入）
pub fn write_to_pty(session: &TmuxPtySession, data: &[u8]) -> Result<(), String> {
    let mut writer = session.master.lock().map_err(|e| e.to_string())?;
    writer.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}
