use crate::database::Database;
use crate::security;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Deserialize)]
pub struct CreateBackupTaskRequest {
    pub connection_id: i64,
    pub database_name: String,
    pub cron_expression: String,
    pub backup_path: String,
}

#[derive(Debug, Serialize)]
pub struct BackupTaskResponse {
    pub id: i64,
    pub connection_id: i64,
    pub database_name: String,
    pub cron_expression: String,
    pub backup_path: String,
    pub is_enabled: bool,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::MysqlBackupTask> for BackupTaskResponse {
    fn from(task: crate::database::MysqlBackupTask) -> Self {
        Self {
            id: task.id,
            connection_id: task.connection_id,
            database_name: task.database_name,
            cron_expression: task.cron_expression,
            backup_path: task.backup_path,
            is_enabled: task.is_enabled,
            last_run_at: task.last_run_at,
            last_status: task.last_status,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

/// 创建备份任务
pub fn mysql_create_backup_task(
    db: &Database,
    req: CreateBackupTaskRequest,
) -> Result<i64, String> {
    db.create_mysql_backup_task(
        req.connection_id,
        &req.database_name,
        &req.cron_expression,
        &req.backup_path,
    )
    .map_err(|e| e.to_string())
}

/// 列出备份任务
pub fn mysql_list_backup_tasks(db: &Database) -> Result<Vec<BackupTaskResponse>, String> {
    let tasks = db.list_mysql_backup_tasks().map_err(|e| e.to_string())?;
    Ok(tasks.into_iter().map(|t| t.into()).collect())
}

/// 删除备份任务
pub fn mysql_delete_backup_task(db: &Database, id: i64) -> Result<(), String> {
    db.delete_mysql_backup_task(id).map_err(|e| e.to_string())
}

/// 切换备份任务启用状态
pub fn mysql_toggle_backup_task(db: &Database, id: i64, is_enabled: bool) -> Result<(), String> {
    db.update_mysql_backup_task_enabled(id, is_enabled)
        .map_err(|e| e.to_string())
}

/// 立即执行备份
pub async fn mysql_run_backup_now(
    db: &Database,
    task_id: i64,
) -> Result<String, String> {
    let tasks = db.list_mysql_backup_tasks().map_err(|e| e.to_string())?;
    let task = tasks
        .into_iter()
        .find(|t| t.id == task_id)
        .ok_or("备份任务不存在")?;

    let conn = db
        .get_mysql_connection(task.connection_id)
        .map_err(|e| e.to_string())?;
    let password = security::decrypt(&conn.password).map_err(|e| e.to_string())?;

    // 确保备份目录存在
    std::fs::create_dir_all(&task.backup_path)
        .map_err(|e| format!("创建备份目录失败: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}_{}.sql", task.database_name, timestamp);
    let filepath = std::path::Path::new(&task.backup_path).join(&filename);

    // 使用 mysqldump 备份
    let output = Command::new("mysqldump")
        .args([
            "-h",
            &conn.host,
            "-P",
            &conn.port.to_string(),
            "-u",
            &conn.username,
            &format!("-p{}", password),
            &task.database_name,
        ])
        .output()
        .map_err(|e| format!("执行 mysqldump 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        db.update_mysql_backup_task_status(task_id, "failed")
            .map_err(|e| e.to_string())?;
        return Err(format!("mysqldump 失败: {}", stderr));
    }

    std::fs::write(&filepath, &output.stdout)
        .map_err(|e| format!("写入备份文件失败: {}", e))?;

    db.update_mysql_backup_task_status(task_id, "success")
        .map_err(|e| e.to_string())?;

    Ok(filepath.to_string_lossy().to_string())
}
