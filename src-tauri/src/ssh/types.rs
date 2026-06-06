use serde::{Deserialize, Serialize};

/// SSH 连接配置（存储在 SQLite）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SshAuthType,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SshAuthType {
    Password { password: String },
    PublicKey { key_path: String, passphrase: Option<String> },
}

/// 活动会话（内存中，不持久化）
#[derive(Debug, Clone, Serialize)]
pub struct SshSessionInfo {
    pub session_id: String,
    pub connection_id: i64,
    pub host: String,
    pub username: String,
    pub connected: bool,
    pub connected_at: String,
    pub websocket_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFile {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_time: String,
    pub permissions: String,
    pub owner: String,
    pub group: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferProgress {
    pub id: String,
    pub file_name: String,
    pub direction: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteSystemInfo {
    pub hostname: String,
    pub os_version: String,
    pub cpu_model: String,
    pub cpu_cores: i32,
    pub memory_total_mb: i32,
    pub memory_used_mb: i32,
    pub memory_free_mb: i32,
    pub memory_percent: i32,
    pub disk_total: String,
    pub disk_used: String,
    pub disk_available: String,
    pub disk_usage_percent: String,
    pub disk_usage_percent_num: i32,
    pub load_1m: String,
    pub load_5m: String,
    pub load_15m: String,
    pub latency_ms: i32,
}
