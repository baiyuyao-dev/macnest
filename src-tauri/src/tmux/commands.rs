use std::process::Command;

use crate::tmux::types::{CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession};

/// 列出所有 tmux 会话
pub fn list_sessions() -> Result<Vec<TmuxSession>, String> {
    let output = Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_pid}",
        ])
        .output()
        .map_err(|e| format!("Failed to run tmux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            return Ok(Vec::new());
        }
        return Err(format!("tmux error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let now = chrono::Utc::now().timestamp();

    let sessions = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            TmuxSession {
                name: parts.get(0).unwrap_or(&"").to_string(),
                windows: parts.get(1).unwrap_or(&"0").parse().unwrap_or(0),
                attached: parts.get(2).unwrap_or(&"0") == &"1",
                created_at: format_timestamp(parts.get(3).unwrap_or(&"0"), now),
                pid: parts.get(4).unwrap_or(&"0").parse().unwrap_or(0),
            }
        })
        .collect();

    Ok(sessions)
}

/// 创建新会话（detached 模式）
pub fn create_session(req: &CreateTmuxSessionRequest) -> Result<(), String> {
    let mut cmd = Command::new("tmux");
    cmd.args(["new-session", "-d", "-s", &req.name]);

    if let Some(ref dir) = req.start_directory {
        cmd.args(["-c", dir]);
    }

    if let Some(ref command) = req.command {
        cmd.arg(command);
    } else {
        // 默认启动登录 shell，确保会话持久运行
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        cmd.arg(&shell);
        cmd.arg("-l");
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// Kill 会话
pub fn kill_session(name: &str) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["kill-session", "-t", name])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 如果 tmux server 已退出，会话自然也不存在了，当作成功处理
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            return Ok(());
        }
        return Err(stderr.to_string());
    }
    Ok(())
}

/// 重命名会话
pub fn rename_session(req: &RenameTmuxSessionRequest) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["rename-session", "-t", &req.old_name, &req.new_name])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// 检查 tmux 是否安装
pub fn is_tmux_available() -> bool {
    Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 生成 ~/.tmux.conf
pub fn generate_config() -> Result<String, String> {
    let config = r#"# MacOps 生成的 tmux 配置

# 鼠标支持
set -g mouse on

# 状态栏样式
set -g status-style bg=#1a1a2e,fg=#e0e0e0
set -g status-left " #[fg=#10b981]● #[fg=white]#S "
set -g status-right " %H:%M %Y-%m-%d "
set -g status-left-length 50
set -g status-right-length 50

# 窗口样式
set -g window-status-current-style bg=#10b981,fg=#000000,bold
set -g window-status-style bg=#1a1a2e,fg=#6272a4
set -g window-status-format " #I:#W "
set -g window-status-current-format " #I:#W "

# 边框样式
set -g pane-border-style fg=#6272a4
set -g pane-active-border-style fg=#10b981

# 消息样式
set -g message-style bg=#10b981,fg=#000000

# 复制模式 vi 风格
setw -g mode-keys vi

# 窗口编号从 1 开始
set -g base-index 1
setw -g pane-base-index 1

# 自动重命名窗口
setw -g automatic-rename on

# 历史行数
set -g history-limit 50000

# 聚焦事件
set -g focus-events on

# 256 色支持
set -g default-terminal "xterm-256color"
set -ga terminal-overrides ",*256col*:Tc"
"#;

    let home = std::env::var("HOME").map_err(|_| "Cannot find HOME directory")?;
    let config_path = std::path::PathBuf::from(home).join(".tmux.conf");

    std::fs::write(&config_path, config).map_err(|e| e.to_string())?;

    Ok(config_path.to_string_lossy().to_string())
}

/// 格式化时间戳为友好字符串
fn format_timestamp(seconds: &str, now: i64) -> String {
    let ts: i64 = seconds.parse().unwrap_or(0);
    let diff = now - ts;

    if diff < 60 {
        "刚刚".to_string()
    } else if diff < 3600 {
        format!("{} 分钟前", diff / 60)
    } else if diff < 86400 {
        format!("{} 小时前", diff / 3600)
    } else {
        format!("{} 天前", diff / 86400)
    }
}
