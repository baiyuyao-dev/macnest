pub mod commands;
pub mod pty;
pub mod types;

// 重导出常用类型
pub use types::*;

use std::process::Command;

/// 从标记符包裹的 shell 输出中提取实际内容。
/// 避免被 shell 配置文件（主题、欢迎信息、提示符等）污染 stdout。
fn extract_between_markers(raw: &str, start: &str, end: &str) -> Option<String> {
    // 去除 ANSI 转义序列
    let re = regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap_or_else(|_| regex::Regex::new(r"").unwrap());
    let cleaned = re.replace_all(raw, "");
    let start_idx = cleaned.find(start)?;
    let after_start = &cleaned[start_idx + start.len()..];
    let end_idx = after_start.find(end)?;
    let content = &after_start[..end_idx];
    content
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(|s| s.to_string())
}

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
        "~/.local/bin/tmux",
    ];
    for path in &candidates {
        let expanded = if path.starts_with("~") {
            std::env::var("HOME")
                .map(|h| path.replacen("~", &h, 1))
                .unwrap_or_else(|_| path.to_string())
        } else {
            path.to_string()
        };
        if std::path::Path::new(&expanded).exists() {
            if Command::new(&expanded)
                .arg("-V")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return expanded;
            }
        }
    }

    // 回退：尝试通过 shell 解析 PATH（-l 加载 profile，-il 额外加载 rc）。
    // 很多用户把 Homebrew 的 PATH 放在 .zshrc/.bashrc 中，-l 可能无法获取，
    // 因此先尝试 -lc 减少输出污染，失败后回退到 -ilc 加载 rc 文件。
    let start_marker = "___MACNEST_TMUX_START___";
    let end_marker = "___MACNEST_TMUX_END___";
    for shell in ["zsh", "bash"] {
        // type -P / whence -p 只返回可执行文件路径，不会受 alias/函数干扰
        let cmd = if shell == "zsh" {
            "whence -p tmux 2>/dev/null"
        } else {
            "type -P tmux 2>/dev/null"
        };
        let script = format!(
            "printf '{}\\n'; {}; printf '{}\\n'",
            start_marker, cmd, end_marker
        );
        for args in [["-lc"], ["-ilc"]] {
            let Ok(output) = Command::new(shell).args([args[0], &script]).output() else {
                continue;
            };
            if !output.status.success() {
                continue;
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            match extract_between_markers(&raw, start_marker, end_marker) {
                Some(path) if !path.is_empty() => {
                    eprintln!(
                        "[MacNest] {} detected tmux path: '{}' (raw preview: {:?})",
                        shell,
                        path,
                        raw.trim().lines().take(3).collect::<Vec<_>>()
                    );
                    if std::path::Path::new(&path).exists() {
                        if Command::new(&path)
                            .arg("-V")
                            .output()
                            .map(|o| o.status.success())
                            .unwrap_or(false)
                        {
                            return path;
                        }
                    }
                }
                _ => {
                    eprintln!(
                        "[MacNest] {} failed to parse path from output: {:?}",
                        shell,
                        raw.trim()
                    );
                }
            }
        }
    }

    // 所有方法都找不到，返回空字符串让调用者明确处理
    String::new()
}
