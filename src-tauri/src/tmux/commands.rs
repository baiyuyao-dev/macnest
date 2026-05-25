use std::process::Command;

use crate::database::Database;
use crate::tmux::types::{CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession};

/// 列出所有 tmux 会话，并与数据库映射合并返回 display_name
pub fn list_sessions(db: &Database) -> Result<Vec<TmuxSession>, String> {
    // 1. 从 tmux 获取原始会话列表
    let tmux = crate::tmux::get_tmux_path();
    let output = Command::new(&tmux)
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

    // 2. 从数据库获取映射关系（包含 display_name 和 start_directory）
    let db_sessions = db.list_tmux_sessions().unwrap_or_default();
    let name_map: std::collections::HashMap<String, String> = db_sessions
        .iter()
        .map(|r| (r.tmux_name.clone(), r.display_name.clone()))
        .collect();
    let dir_map: std::collections::HashMap<String, String> = db_sessions
        .into_iter()
        .map(|r| (r.tmux_name, r.start_directory))
        .collect();

    let sessions = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            let tmux_name = parts.get(0).unwrap_or(&"").to_string();
            let display_name = name_map
                .get(&tmux_name)
                .cloned()
                .unwrap_or_else(|| tmux_name.clone());
            let start_directory = dir_map
                .get(&tmux_name)
                .cloned()
                .filter(|s| !s.is_empty());
            TmuxSession {
                name: tmux_name,
                display_name,
                windows: parts.get(1).unwrap_or(&"0").parse().unwrap_or(0),
                attached: parts.get(2).unwrap_or(&"0") == &"1",
                created_at: format_timestamp(parts.get(3).unwrap_or(&"0"), now),
                pid: parts.get(4).unwrap_or(&"0").parse().unwrap_or(0),
                start_directory,
            }
        })
        .collect();

    Ok(sessions)
}

/// 从 display_name 生成唯一的 tmux 会话名
fn generate_tmux_name(display_name: &str) -> String {
    let prefix: String = display_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
        .trim()
        .to_string();

    let prefix = if prefix.is_empty() {
        "session".to_string()
    } else {
        prefix
    };
    let timestamp = chrono::Local::now().timestamp_millis();
    format!("{}-{}", prefix, timestamp)
}

/// 验证 tmux 底层会话名称合法性（仅用于自动生成的 tmux_name）
fn validate_tmux_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("tmux 会话名长度必须在1-64字符之间".to_string());
    }
    if !name.is_ascii() {
        return Err("tmux 会话名必须是 ASCII".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err("tmux 会话名只能包含字母、数字、下划线、连字符和点".to_string());
    }
    if name.starts_with('.') || name.starts_with('-') {
        return Err("tmux 会话名不能以 . 或 - 开头".to_string());
    }
    Ok(())
}

/// 创建新会话（detached 模式）
pub fn create_session(db: &Database, req: &CreateTmuxSessionRequest) -> Result<(), String> {
    let display_name = req.name.trim();
    if display_name.is_empty() {
        return Err("会话名称不能为空".to_string());
    }

    let tmux_name = generate_tmux_name(display_name);
    validate_tmux_name(&tmux_name)?;

    let tmux = crate::tmux::get_tmux_path();
    let mut cmd = Command::new(&tmux);
    cmd.args(["new-session", "-d", "-s", &tmux_name]);

    let start_dir = req
        .start_directory
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
    cmd.args(["-c", &start_dir]);

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

    // 存入数据库映射
    let command_str = req.command.as_deref().unwrap_or("");
    db.create_tmux_session(&tmux_name, display_name, &start_dir, command_str)
        .map_err(|e| format!("保存会话映射失败: {}", e))?;

    Ok(())
}

/// Kill 会话（通过 display_name 查找 tmux_name）
pub fn kill_session(db: &Database, display_name: &str) -> Result<(), String> {
    // 先从数据库查找 tmux_name
    let tmux_name = match db
        .get_tmux_session_by_display_name(display_name)
        .map_err(|e| e.to_string())?
    {
        Some(record) => record.tmux_name,
        None => {
            // 数据库中没有记录，直接尝试用 display_name 作为 tmux_name（兼容外部创建的会话）
            display_name.to_string()
        }
    };

    let tmux = crate::tmux::get_tmux_path();
    let output = Command::new(&tmux)
        .args(["kill-session", "-t", &tmux_name])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 如果 tmux server 已退出，会话自然也不存在了，当作成功处理
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            // 仍然尝试删除数据库记录
            let _ = db.delete_tmux_session_by_tmux_name(&tmux_name);
            return Ok(());
        }
        return Err(stderr.to_string());
    }

    // 删除数据库记录
    let _ = db.delete_tmux_session_by_tmux_name(&tmux_name);
    Ok(())
}

/// 重命名会话（只更新数据库中的 display_name，tmux_name 不变）
pub fn rename_session(
    db: &Database,
    req: &RenameTmuxSessionRequest,
) -> Result<(), String> {
    let old_display_name = req.old_name.trim();
    let new_display_name = req.new_name.trim();

    if new_display_name.is_empty() {
        return Err("新名称不能为空".to_string());
    }

    // 查找旧的映射记录
    let record = db
        .get_tmux_session_by_display_name(old_display_name)
        .map_err(|e| e.to_string());

    match record {
        Ok(Some(r)) => {
            // 更新数据库中的 display_name
            db.update_tmux_session_display_name(&r.tmux_name, new_display_name)
                .map_err(|e| format!("更新显示名失败: {}", e))?;
        }
        _ => {
            // 数据库中没有记录，尝试重命名 tmux 会话本身（兼容外部创建的会话）
            let tmux = crate::tmux::get_tmux_path();
            let output = Command::new(&tmux)
                .args([
                    "rename-session",
                    "-t",
                    old_display_name,
                    new_display_name,
                ])
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        }
    }

    Ok(())
}

/// 检查 tmux 是否安装
pub fn is_tmux_available() -> bool {
    let path = crate::tmux::get_tmux_path();
    Command::new(&path)
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 通过 display_name 获取 tmux_name
pub fn resolve_tmux_name(db: &Database, display_name: &str) -> Result<String, String> {
    match db
        .get_tmux_session_by_display_name(display_name)
        .map_err(|e| e.to_string())?
    {
        Some(record) => Ok(record.tmux_name),
        None => {
            // 未找到映射，直接返回原名称（兼容外部会话）
            Ok(display_name.to_string())
        }
    }
}

/// 生成 ~/.tmux.conf
pub fn generate_config() -> Result<String, String> {
    let config = r#"# MacNest 生成的 tmux 配置

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

# 终端类型与功能键支持（解决 Delete/Backspace 异常）
set -g default-terminal "xterm-256color"
set -g xterm-keys on
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
