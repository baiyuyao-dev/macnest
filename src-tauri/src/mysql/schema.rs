use crate::mysql::get_pool;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<i64>,
    pub size_mb: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ViewInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub table: String,
    pub timing: String,
}

#[derive(Debug, Serialize)]
pub struct FunctionInfo {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct EventInfo {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: String,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub comment: String,
}

#[derive(Debug, Serialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
}

#[derive(Debug, Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: String,
    pub non_unique: bool,
}

/// 列出所有数据库
pub async fn mysql_list_databases(connection_id: i64) -> Result<Vec<DatabaseInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(name,)| DatabaseInfo { name }).collect())
}

/// 列出数据库中的表
pub async fn mysql_list_tables(
    connection_id: i64,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let query = format!(
        "SELECT table_name, engine, table_rows,
                ROUND(((data_length + index_length) / 1024 / 1024), 2) as size_mb
         FROM information_schema.tables
         WHERE table_schema = ? AND table_type = 'BASE TABLE'
         ORDER BY table_name",
    );
    let rows = sqlx::query_as::<_, (String, Option<String>, Option<i64>, Option<f64>)>(
        &query,
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, engine, rows, size_mb)| TableInfo {
            name,
            engine,
            rows,
            size_mb,
        })
        .collect())
}

/// 列出数据库中的视图
pub async fn mysql_list_views(
    connection_id: i64,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'VIEW' ORDER BY table_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(name,)| ViewInfo { name }).collect())
}

/// 列出数据库中的触发器
pub async fn mysql_list_triggers(
    connection_id: i64,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT trigger_name, event_manipulation, event_object_table, action_timing
         FROM information_schema.triggers
         WHERE trigger_schema = ? ORDER BY trigger_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, event, table, timing)| TriggerInfo {
            name,
            event,
            table,
            timing,
        })
        .collect())
}

/// 列出数据库中的函数和存储过程
pub async fn mysql_list_functions(
    connection_id: i64,
    database: String,
) -> Result<Vec<FunctionInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION' ORDER BY routine_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(name,)| FunctionInfo { name }).collect())
}

/// 列出数据库中的事件
pub async fn mysql_list_events(
    connection_id: i64,
    database: String,
) -> Result<Vec<EventInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT event_name, status FROM information_schema.events WHERE event_schema = ? ORDER BY event_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(name, status)| EventInfo { name, status })
        .collect())
}

/// 获取表结构
pub async fn mysql_get_table_structure(
    connection_id: i64,
    database: String,
    table: String,
) -> Result<TableStructure, String> {
    let pool = get_pool(connection_id).await?;

    // 列信息
    let columns = sqlx::query_as::<_, (String, String, String, String, Option<String>, String, String)>(
        "SELECT column_name, data_type, is_nullable, column_key, column_default, extra, column_comment
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position"
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let columns = columns
        .into_iter()
        .map(|(name, data_type, is_nullable, key, default_value, extra, comment)| ColumnInfo {
            name,
            data_type,
            is_nullable,
            key,
            default_value,
            extra,
            comment,
        })
        .collect();

    // 索引信息
    let indexes = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) as columns, MAX(non_unique) as non_unique
         FROM information_schema.statistics
         WHERE table_schema = ? AND table_name = ?
         GROUP BY index_name"
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let indexes = indexes
        .into_iter()
        .map(|(name, columns, non_unique)| IndexInfo {
            name,
            columns,
            non_unique: non_unique != 0,
        })
        .collect();

    Ok(TableStructure { columns, indexes })
}
