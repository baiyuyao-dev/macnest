use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

pub struct TmuxPtySession {
    pub session_name: String,
    pub master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Option<Box<dyn portable_pty::Child + Send>>,
    pub _reader_thread: Option<std::thread::JoinHandle<()>>,
}

/// 创建 PTY 并 attach 到 tmux 会话
pub fn attach_session_pty(
    session_name: &str,
    channel: Channel<Vec<u8>>,
    cols: u16,
    rows: u16,
) -> Result<TmuxPtySession, String> {
    // 先重新加载配置，确保右键菜单等设置已禁用
    crate::tmux::commands::source_tmux_config();

    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let tmux_path = crate::tmux::get_tmux_path();
    let mut cmd = CommandBuilder::new(&tmux_path);
    cmd.arg("attach");
    cmd.arg("-t");
    cmd.arg(session_name);
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let mut master_reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let master_writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    let master = Arc::new(Mutex::new(pair.master));

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
        master,
        writer: master_writer,
        child: Some(child),
        _reader_thread: Some(reader_thread),
    })
}

/// 向 PTY 写入数据（用户键盘输入）
pub fn write_to_pty(session: &TmuxPtySession, data: &[u8]) -> Result<(), String> {
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}

/// 调整 PTY 尺寸
pub fn resize_pty(session: &TmuxPtySession, cols: u16, rows: u16) -> Result<(), String> {
    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
