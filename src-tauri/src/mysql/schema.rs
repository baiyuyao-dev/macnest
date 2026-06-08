use crate::mysql::get_pool;
use serde::Serialize;
use sqlx::Row;

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

/// 安全地从行中获取字符串：先尝试 String，失败则尝试 Vec<u8> 转 UTF-8，再失败则返回错误
fn get_string(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<String, String> {
    if let Ok(v) = row.try_get::<Option<String>, _>(idx) {
        return Ok(v.unwrap_or_default());
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return Ok(v.map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default());
    }
    Err(format!("无法解码第 {} 列为字符串", idx))
}

fn get_opt_string(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<Option<String>, String> {
    if let Ok(v) = row.try_get::<Option<String>, _>(idx) {
        return Ok(v);
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return Ok(v.map(|b| String::from_utf8_lossy(&b).into_owned()));
    }
    Ok(None)
}

fn get_i64(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<i64, String> {
    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return Ok(v.unwrap_or(0));
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(idx) {
        return Ok(v.unwrap_or(0) as i64);
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(idx) {
        return Ok(v.unwrap_or(0) as i64);
    }
    if let Ok(v) = row.try_get::<Option<u32>, _>(idx) {
        return Ok(v.unwrap_or(0) as i64);
    }
    Err(format!("无法解码第 {} 列为整数", idx))
}

fn get_opt_i64(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<Option<i64>, String> {
    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return Ok(v);
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(idx) {
        return Ok(v.map(|n| n as i64));
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(idx) {
        return Ok(v.map(|n| n as i64));
    }
    if let Ok(v) = row.try_get::<Option<u32>, _>(idx) {
        return Ok(v.map(|n| n as i64));
    }
    Ok(None)
}

fn get_f64(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<f64, String> {
    if let Ok(v) = row.try_get::<Option<f64>, _>(idx) {
        return Ok(v.unwrap_or(0.0));
    }
    if let Ok(v) = row.try_get::<Option<f32>, _>(idx) {
        return Ok(v.unwrap_or(0.0) as f64);
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return Ok(v.unwrap_or(0) as f64);
    }
    Err(format!("无法解码第 {} 列为浮点数", idx))
}

fn get_opt_f64(row: &sqlx::mysql::MySqlRow, idx: usize) -> Result<Option<f64>, String> {
    if let Ok(v) = row.try_get::<Option<f64>, _>(idx) {
        return Ok(v);
    }
    if let Ok(v) = row.try_get::<Option<f32>, _>(idx) {
        return Ok(v.map(|n| n as f64));
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return Ok(v.map(|n| n as f64));
    }
    Ok(None)
}

/// 列出所有数据库
pub async fn mysql_list_databases(connection_id: i64) -> Result<Vec<DatabaseInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        result.push(DatabaseInfo { name });
    }
    Ok(result)
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
    let rows = sqlx::query(&query)
        .bind(&database)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        let engine = get_opt_string(&row, 1)?;
        let rows_count = get_opt_i64(&row, 2)?;
        let size_mb = get_opt_f64(&row, 3)?;
        result.push(TableInfo {
            name,
            engine,
            rows: rows_count,
            size_mb,
        });
    }
    Ok(result)
}

/// 列出数据库中的视图
pub async fn mysql_list_views(
    connection_id: i64,
    database: String,
) -> Result<Vec<ViewInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'VIEW' ORDER BY table_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        result.push(ViewInfo { name });
    }
    Ok(result)
}

/// 列出数据库中的触发器
pub async fn mysql_list_triggers(
    connection_id: i64,
    database: String,
) -> Result<Vec<TriggerInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query(
        "SELECT trigger_name, event_manipulation, event_object_table, action_timing
         FROM information_schema.triggers
         WHERE trigger_schema = ? ORDER BY trigger_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        let event = get_string(&row, 1)?;
        let table = get_string(&row, 2)?;
        let timing = get_string(&row, 3)?;
        result.push(TriggerInfo {
            name,
            event,
            table,
            timing,
        });
    }
    Ok(result)
}

/// 列出数据库中的函数和存储过程
pub async fn mysql_list_functions(
    connection_id: i64,
    database: String,
) -> Result<Vec<FunctionInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION' ORDER BY routine_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        result.push(FunctionInfo { name });
    }
    Ok(result)
}

/// 列出数据库中的事件
pub async fn mysql_list_events(
    connection_id: i64,
    database: String,
) -> Result<Vec<EventInfo>, String> {
    let pool = get_pool(connection_id).await?;
    let rows = sqlx::query(
        "SELECT event_name, status FROM information_schema.events WHERE event_schema = ? ORDER BY event_name"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        let status = get_string(&row, 1)?;
        result.push(EventInfo { name, status });
    }
    Ok(result)
}

/// 获取表结构
pub async fn mysql_get_table_structure(
    connection_id: i64,
    database: String,
    table: String,
) -> Result<TableStructure, String> {
    let pool = get_pool(connection_id).await?;

    // 列信息
    let rows = sqlx::query(
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

    let mut columns = Vec::new();
    for row in rows {
        let name = get_string(&row, 0)?;
        let data_type = get_string(&row, 1)?;
        let is_nullable = get_string(&row, 2)?;
        let key = get_string(&row, 3)?;
        let default_value = get_opt_string(&row, 4)?;
        let extra = get_string(&row, 5)?;
        let comment = get_string(&row, 6)?;
        columns.push(ColumnInfo {
            name,
            data_type,
            is_nullable,
            key,
            default_value,
            extra,
            comment,
        });
    }

    // 索引信息
    let idx_rows = sqlx::query(
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

    let mut indexes = Vec::new();
    for row in idx_rows {
        let name = get_string(&row, 0)?;
        let columns_str = get_string(&row, 1)?;
        let non_unique = get_i64(&row, 2)? != 0;
        indexes.push(IndexInfo {
            name,
            columns: columns_str,
            non_unique,
        });
    }

    Ok(TableStructure { columns, indexes })
}
