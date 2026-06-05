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
    pub start_directory: Option<String>,
    pub group_id: Option<i64>,
    pub group_name: Option<String>,
    pub is_external: bool,
}

/// 创建会话请求
#[derive(Debug, Deserialize)]
pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
    pub group_id: Option<i64>,
    #[serde(default = "default_pane_count")]
    pub pane_count: u8,
    pub layout: Option<String>,
}

fn default_pane_count() -> u8 {
    1
}

/// 重命名会话请求
#[derive(Debug, Deserialize)]
pub struct RenameTmuxSessionRequest {
    pub old_name: String,
    pub new_name: String,
}
