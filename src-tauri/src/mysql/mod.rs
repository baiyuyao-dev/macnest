pub mod connection;
pub mod schema;
pub mod query;
pub mod backup;

use lazy_static::lazy_static;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

lazy_static! {
    static ref MYSQL_POOLS: Arc<Mutex<HashMap<i64, MySqlPool>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// 获取或创建 MySQL 连接池
pub async fn get_or_create_pool(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: &str,
) -> Result<MySqlPool, String> {
    let dsn = if database.is_empty() {
        format!("mysql://{}:{}@{}:{}", username, password, host, port)
    } else {
        format!("mysql://{}:{}@{}:{}/{}", username, password, host, port, database)
    };

    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&dsn)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    Ok(pool)
}

/// 获取连接池（如果不存在会报错，用于已连接的会话）
pub async fn get_pool(connection_id: i64) -> Result<MySqlPool, String> {
    let pools = MYSQL_POOLS.lock().await;
    pools
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| "连接未建立或已断开".to_string())
}

/// 注册连接池
pub async fn register_pool(connection_id: i64, pool: MySqlPool) {
    let mut pools = MYSQL_POOLS.lock().await;
    pools.insert(connection_id, pool);
}

/// 注销连接池
pub async fn unregister_pool(connection_id: i64) {
    let mut pools = MYSQL_POOLS.lock().await;
    if let Some(pool) = pools.remove(&connection_id) {
        let _ = pool.close().await;
    }
}
