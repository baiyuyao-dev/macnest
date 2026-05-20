use serde::Serialize;

/// 统一的应用错误类型
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details: None,
        }
    }

    pub fn with_details(code: &str, message: &str, details: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details: Some(details.to_string()),
        }
    }

    // 常用错误工厂方法
    pub fn not_found(msg: &str) -> Self {
        Self::new("NOT_FOUND", msg)
    }

    pub fn unauthorized(msg: &str) -> Self {
        Self::new("UNAUTHORIZED", msg)
    }

    pub fn validation(msg: &str) -> Self {
        Self::new("VALIDATION_ERROR", msg)
    }

    pub fn internal(msg: &str) -> Self {
        Self::new("INTERNAL_ERROR", msg)
    }

    pub fn connection(msg: &str) -> Self {
        Self::new("CONNECTION_ERROR", msg)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::internal(&e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::internal(&e.to_string())
    }
}

/// 将 AppError 转换为 Tauri command 可返回的 String
/// Tauri commands 返回 Result<T, String>，所以需要序列化为 JSON
impl From<AppError> for String {
    fn from(e: AppError) -> String {
        serde_json::to_string(&e).unwrap_or_else(|_| {
            format!("{{\"code\":\"INTERNAL_ERROR\",\"message\":\"{}\"}}", e.message)
        })
    }
}
