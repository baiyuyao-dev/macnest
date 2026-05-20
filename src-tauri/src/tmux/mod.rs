pub mod commands;
pub mod pty;
pub mod types;

// 重导出常用类型
pub use types::*;

use std::process::Command;

/// 获取 tmux 可执行文件的完整路径。
/// 打包后的 macOS App PATH 不包含 Homebrew 路径，需要显式查找。
pub(crate) fn get_tmux_path() -> String {
    // 如果 PATH 中可直接找到，优先使用
    if Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return "tmux".to_string();
    }

    // 尝试常见安装路径
    let candidates = [
        "/opt/homebrew/bin/tmux",
        "/usr/local/bin/tmux",
        "/usr/bin/tmux",
        "/bin/tmux",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            if Command::new(path)
                .arg("-V")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return path.to_string();
            }
        }
    }

    // 回退：尝试通过 zsh -lc 解析 PATH
    if let Ok(output) = Command::new("zsh").args(["-lc", "which tmux"]).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return path;
            }
        }
    }

    // 最后的回退，让后续命令报错时给出清晰的错误信息
    "tmux".to_string()
}
