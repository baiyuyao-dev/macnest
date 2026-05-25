use serde::{Deserialize, Serialize};

/// tmux 会话信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxSession {
    pub name: String,
    pub display_name: String,
    pub windows: usize,
    pub attached: bool,
    pub created_at: String,
    pub pid: u32,
}

/// 创建会话请求
#[derive(Debug, Deserialize)]
pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
}

/// 重命名会话请求
#[derive(Debug, Deserialize)]
pub struct RenameTmuxSessionRequest {
    pub old_name: String,
    pub new_name: String,
}
