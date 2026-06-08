use crate::database::Database;
use crate::security;
use crate::mysql::{get_or_create_pool, register_pool, unregister_pool};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateMysqlConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMysqlConnectionRequest {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Deserialize)]
pub struct TestMysqlConnectionRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Serialize)]
pub struct MysqlConnectionResponse {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::MysqlConnection> for MysqlConnectionResponse {
    fn from(conn: crate::database::MysqlConnection) -> Self {
        Self {
            id: conn.id,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            database: conn.database,
            created_at: conn.created_at,
            updated_at: conn.updated_at,
        }
    }
}

/// 创建 MySQL 连接配置
pub async fn mysql_create_connection(
    db: &Database,
    req: CreateMysqlConnectionRequest,
) -> Result<i64, String> {
    let encrypted_password = security::encrypt(&req.password)
        .map_err(|e| format!("加密失败: {}", e))?;

    db.create_mysql_connection(
        &req.name,
        &req.host,
        req.port,
        &req.username,
        &encrypted_password,
        &req.database,
    )
    .map_err(|e| e.to_string())
}

/// 列出所有 MySQL 连接（返回时密码不暴露）
pub fn mysql_list_connections(db: &Database) -> Result<Vec<MysqlConnectionResponse>, String> {
    let connections = db.list_mysql_connections().map_err(|e| e.to_string())?;
    Ok(connections.into_iter().map(|c| c.into()).collect())
}

/// 更新 MySQL 连接
pub async fn mysql_update_connection(
    db: &Database,
    req: UpdateMysqlConnectionRequest,
) -> Result<(), String> {
    let encrypted_password = security::encrypt(&req.password)
        .map_err(|e| format!("加密失败: {}", e))?;

    db.update_mysql_connection(
        req.id,
        &req.name,
        &req.host,
        req.port,
        &req.username,
        &encrypted_password,
        &req.database,
    )
    .map_err(|e| e.to_string())?;

    // 如果连接池存在，断开旧连接
    unregister_pool(req.id).await;
    Ok(())
}

/// 删除 MySQL 连接
pub async fn mysql_delete_connection(db: &Database, id: i64) -> Result<(), String> {
    unregister_pool(id).await;
    db.delete_mysql_connection(id).map_err(|e| e.to_string())
}

/// 测试 MySQL 连接
pub async fn mysql_test_connection(req: TestMysqlConnectionRequest) -> Result<bool, String> {
    let pool = get_or_create_pool(
        &req.host,
        req.port,
        &req.username,
        &req.password,
        &req.database,
    )
    .await?;

    // 测试查询
    let row: (i64,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("查询测试失败: {}", e))?;

    pool.close().await;

    Ok(row.0 == 1)
}

/// 建立连接池（用于实际查询）
pub async fn mysql_connect(
    db: &Database,
    connection_id: i64,
) -> Result<bool, String> {
    let conn = db.get_mysql_connection(connection_id).map_err(|e| e.to_string())?;
    let decrypted_password = security::decrypt(&conn.password)
        .map_err(|e| format!("解密失败: {}", e))?;

    let pool = get_or_create_pool(
        &conn.host,
        conn.port,
        &conn.username,
        &decrypted_password,
        &conn.database,
    )
    .await?;

    // 测试连接
    let _: (i64,) = sqlx::query_as("SELECT 1")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("连接测试失败: {}", e))?;

    register_pool(connection_id, pool).await;
    Ok(true)
}

/// 断开连接
pub async fn mysql_disconnect(connection_id: i64) -> Result<(), String> {
    unregister_pool(connection_id).await;
    Ok(())
}
