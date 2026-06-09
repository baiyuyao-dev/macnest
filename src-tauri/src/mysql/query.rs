use crate::mysql::get_pool;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Arguments, Column, Row};
use sqlx::mysql::MySqlArguments;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteQueryRequest {
    pub connection_id: i64,
    pub database: String,
    pub sql: String,
}

#[derive(Debug, Deserialize)]
pub struct LoadTableDataRequest {
    pub connection_id: i64,
    pub database: String,
    pub table: String,
    pub page: u32,
    pub page_size: u32,
    pub filters: HashMap<String, String>,
    pub sort_col: Option<String>,
    pub sort_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoadTableDataResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub total_rows: u64,
    pub execution_time_ms: u64,
}

/// 执行 SQL 查询
pub async fn mysql_execute_query(req: ExecuteQueryRequest) -> Result<QueryResult, String> {
    let pool = get_pool(req.connection_id).await?;
    let start = Instant::now();

    let trimmed = req.sql.trim().to_lowercase();
    let is_select = trimmed.starts_with("select")
        || trimmed.starts_with("show")
        || trimmed.starts_with("describe")
        || trimmed.starts_with("desc")
        || trimmed.starts_with("explain");

    if is_select {
        // 查询类 SQL
        let result = sqlx::query(&req.sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("查询失败: {}", e))?;

        let mut columns = Vec::new();
        let mut rows = Vec::new();

        if let Some(first_row) = result.first() {
            columns = first_row
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect();
        }

        for row in result {
            let mut row_values = Vec::new();
            for (i, _) in row.columns().iter().enumerate() {
                let value = row_to_json_value(&row, i)?;
                row_values.push(value);
            }
            rows.push(row_values);
        }

        Ok(QueryResult {
            columns,
            rows,
            affected_rows: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    } else {
        // 执行类 SQL
        let result = sqlx::query(&req.sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("执行失败: {}", e))?;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: Some(result.rows_affected()),
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}

/// 分页加载表数据（支持筛选、排序）
pub async fn mysql_load_table_data_paged(
    req: LoadTableDataRequest,
) -> Result<LoadTableDataResponse, String> {
    let pool = get_pool(req.connection_id).await?;
    let start = Instant::now();

    let table_ref = format!("`{}`.`{}`", req.database, req.table);

    // 收集筛选条件，按列名排序以保证参数绑定顺序一致
    let mut filter_entries: Vec<(&String, &String)> = req.filters.iter().collect();
    filter_entries.sort_by(|a, b| a.0.cmp(b.0));

    // 构建 WHERE 子句
    let where_sql = if filter_entries.is_empty() {
        String::new()
    } else {
        let clauses: Vec<String> = filter_entries
            .iter()
            .map(|(col, _)| format!("`{}` LIKE CONCAT('%', ?, '%')", col))
            .collect();
        format!(" WHERE {}", clauses.join(" AND "))
    };

    // 构建 ORDER BY 子句
    let order_sql = if let (Some(col), Some(dir)) = (&req.sort_col, &req.sort_dir) {
        let dir_upper = dir.to_uppercase();
        if dir_upper == "ASC" || dir_upper == "DESC" {
            format!(" ORDER BY `{}` {}", col, dir_upper)
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // COUNT 查询
    let count_sql = format!("SELECT COUNT(*) as cnt FROM {}{}", table_ref, where_sql);
    let mut count_args = MySqlArguments::default();
    for (_, val) in &filter_entries {
        count_args.add(val.as_str()).map_err(|e| format!("绑定参数失败: {}", e))?;
    }
    let count_result = sqlx::query_with(&count_sql, count_args)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("计数失败: {}", e))?;
    let total_rows: i64 = count_result
        .try_get::<i64, _>("cnt")
        .map_err(|e| format!("读取计数失败: {}", e))?;

    // SELECT 查询
    let offset = req.page * req.page_size;
    let select_sql = format!(
        "SELECT * FROM {}{}{} LIMIT ? OFFSET ?",
        table_ref, where_sql, order_sql
    );
    let mut select_args = MySqlArguments::default();
    for (_, val) in &filter_entries {
        select_args.add(val.as_str()).map_err(|e| format!("绑定参数失败: {}", e))?;
    }
    select_args.add(req.page_size as i64).map_err(|e| format!("绑定参数失败: {}", e))?;
    select_args.add(offset as i64).map_err(|e| format!("绑定参数失败: {}", e))?;

    let result = sqlx::query_with(&select_sql, select_args)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("查询失败: {}", e))?;

    let mut columns = Vec::new();
    let mut rows = Vec::new();

    if let Some(first_row) = result.first() {
        columns = first_row
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
    }

    for row in result {
        let mut row_values = Vec::new();
        for (i, _) in row.columns().iter().enumerate() {
            let value = row_to_json_value(&row, i)?;
            row_values.push(value);
        }
        rows.push(row_values);
    }

    Ok(LoadTableDataResponse {
        columns,
        rows,
        total_rows: total_rows as u64,
        execution_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// 将 SQL 行中的列值转换为 JSON Value
fn row_to_json_value(row: &sqlx::mysql::MySqlRow, index: usize) -> Result<Value, String> {
    use sqlx::TypeInfo;

    let column = row.column(index);
    let type_info = column.type_info();
    let type_name = type_info.name();

    // 尝试不同的类型
    if let Ok(v) = row.try_get::<Option<String>, _>(index) {
        return Ok(v.map_or(Value::Null, Value::String));
    }
    if let Ok(v) = row.try_get::<Option<i64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<u32>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| Value::Number(serde_json::Number::from(n))));
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(index) {
        return Ok(v.map_or(Value::Null, |n| {
            Value::Number(serde_json::Number::from_f64(n).unwrap_or(serde_json::Number::from(0)))
        }));
    }
    if let Ok(v) = row.try_get::<Option<bool>, _>(index) {
        return Ok(v.map_or(Value::Null, Value::Bool));
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(v.map_or(Value::Null, |dt| Value::String(dt.to_string())));
    }
    if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(v.map_or(Value::Null, |d| Value::String(d.to_string())));
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(v.map_or(Value::Null, |b| {
            // 二进制数据转为 base64
            Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }));
    }

    // 兜底：转字符串
    let s: Option<String> = row.try_get(index).unwrap_or(None);
    Ok(s.map_or(Value::Null, Value::String))
}
