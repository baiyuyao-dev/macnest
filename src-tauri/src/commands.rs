use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::{AppHandle, State};

use crate::database;
use crate::docker;
use crate::ssh::types::SshAuthType;
use crate::system;
use crate::AppState;

/* ── Constants ── */

const PORT_DETECT_MAX_ATTEMPTS: u32 = 8;
const PORT_DETECT_RETRY_MS: u64 = 800;
const SFTP_CHUNK_SIZE: usize = 64 * 1024; // 64KB
const SFTP_YIELD_INTERVAL: usize = 16;    // ~1MB per yield (64KB * 16)

// === Service Commands ===

#[derive(Debug, Serialize)]
pub struct ServiceResponse {
    pub services: Vec<database::Service>,
}

fn get_process_metrics(pid: i64) -> Option<(f64, f64)> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "pcpu,pmem,rss"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().nth(1)?;
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 3 {
        let cpu = parts[0].parse::<f64>().ok()?;
        let _mem_percent = parts[1].parse::<f64>().ok()?;
        let rss_kb = parts[2].parse::<u64>().ok()?;
        let mem_mb = rss_kb as f64 / 1024.0;
        Some((cpu, mem_mb))
    } else {
        None
    }
}

#[tauri::command]
pub fn list_services(state: State<AppState>) -> Result<Vec<database::Service>, String> {
    let mut services = state.db.list_services().map_err(|e| e.to_string())?;

    for svc in &mut services {
        if svc.status == "running" {
            // Validate that the recorded PID is still alive.
            // If the process died while MacOps was closed, clean up the stale DB state.
            let pid_alive = svc.pid.map_or(false, |p| {
                std::process::Command::new("kill")
                    .args(["-0", &p.to_string()])
                    .output()
                    .map(|out| out.status.success())
                    .unwrap_or(false)
            });
            if !pid_alive {
                let _ = state.db.update_service_status(svc.id, "stopped", None, "");
                svc.status = "stopped".to_string();
                svc.pid = None;
                svc.ports = "".to_string();
                continue;
            }

            if let Some(pid) = svc.pid {
                if let Some((cpu, mem_mb)) = get_process_metrics(pid) {
                    svc.cpu_percent = cpu;
                    svc.memory_mb = mem_mb;
                    // Also persist to DB so Dashboard shows current values
                    let _ = state.db.update_service_metrics(svc.id, cpu, mem_mb);
                }
            }
        }
    }

    Ok(services)
}

#[derive(Debug, Deserialize)]
pub struct CreateServiceRequest {
    pub name: String,
    pub description: String,
    pub command: String,
    pub cwd: String,
    pub env_vars: String,
    pub auto_start: bool,
    pub restart_policy: String,
    pub max_restarts: i64,
    pub port_auto_detect: bool,
}

#[tauri::command]
pub fn create_service(state: State<AppState>, req: CreateServiceRequest) -> Result<i64, String> {
    state
        .db
        .create_service(
            &req.name,
            &req.description,
            &req.command,
            &req.cwd,
            &req.env_vars,
            req.auto_start,
            &req.restart_policy,
            req.max_restarts,
            req.port_auto_detect,
        )
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateServiceRequest {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub command: String,
    pub cwd: String,
    pub env_vars: String,
    pub auto_start: bool,
    pub restart_policy: String,
    pub max_restarts: i64,
    pub port_auto_detect: bool,
}

#[tauri::command]
pub fn update_service(state: State<AppState>, req: UpdateServiceRequest) -> Result<(), String> {
    state
        .db
        .update_service(
            req.id,
            &req.name,
            &req.description,
            &req.command,
            &req.cwd,
            &req.env_vars,
            req.auto_start,
            &req.restart_policy,
            req.max_restarts,
            req.port_auto_detect,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service(state: State<AppState>, id: i64) -> Result<(), String> {
    // Stop the process first
    let _ = state
        .process_manager
        .lock()
        .map_err(|e| e.to_string())?
        .stop_service(id);
    state.db.delete_service(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_service(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<u32, String> {
    let service = state.db.get_service(id).map_err(|e| e.to_string())?;

    // Check if already running
    {
        let pm = state
            .process_manager
            .lock()
            .map_err(|e| e.to_string())?;
        if pm.is_running(id) {
            return Err("Service is already running".to_string());
        }
    }

    let pid = {
        let pm = state
            .process_manager
            .lock()
            .map_err(|e| e.to_string())?;
        pm.start_service(&app, id, &service.command, &service.cwd, &service.env_vars)?
    };

    // Detect ports with retry — child process needs time to bind.
    let mut ports = Vec::new();
    for attempt in 0..PORT_DETECT_MAX_ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(PORT_DETECT_RETRY_MS));
        }
        ports = detect_ports(pid).unwrap_or_default();
        if !ports.is_empty() {
            break;
        }
    }
    let ports_str = ports.join(", ");

    state
        .db
        .update_service_status(id, "running", Some(pid as i64), &ports_str)
        .map_err(|e| e.to_string())?;

    Ok(pid)
}

/// Internal helper to stop a service, with fallback to DB pid when not in memory.
fn stop_service_internal(state: &State<'_, AppState>, id: i64) -> Result<(), String> {
    let pm = state
        .process_manager
        .lock()
        .map_err(|e| e.to_string())?;

    let in_memory_pid = pm.get_pid(id);
    drop(pm);

    if let Some(pid) = in_memory_pid {
        // Normal case: service was started in this session
        let pm = state
            .process_manager
            .lock()
            .map_err(|e| e.to_string())?;
        let _ = pm.stop_service_by_pid(id, pid);
    } else {
        // Fallback: service was started before MacOps restarted.
        // PID is only in the DB, not in memory.
        if let Ok(service) = state.db.get_service(id) {
            if let Some(pid) = service.pid {
                let pm = state
                    .process_manager
                    .lock()
                    .map_err(|e| e.to_string())?;
                let _ = pm.stop_service_by_pid(id, pid as u32);
            }
        }
    }

    state
        .db
        .update_service_status(id, "stopped", None, "")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stop_service(state: State<AppState>, id: i64) -> Result<(), String> {
    stop_service_internal(&state, id)
}

#[tauri::command]
pub async fn restart_service(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<u32, String> {
    let service = state.db.get_service(id).map_err(|e| e.to_string())?;

    // Stop the service if running (with DB fallback for recovered PIDs)
    let _ = stop_service_internal(&state, id);

    // Update status to restarting
    state
        .db
        .update_service_status(id, "restarting", None, "")
        .map_err(|e| e.to_string())?;

    // Wait a bit
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    // Start again
    let pid = {
        let pm = state
            .process_manager
            .lock()
            .map_err(|e| e.to_string())?;
        pm.start_service(&app, id, &service.command, &service.cwd, &service.env_vars)?
    };

    // Detect ports with retry
    let mut ports = Vec::new();
    for attempt in 0..PORT_DETECT_MAX_ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(PORT_DETECT_RETRY_MS));
        }
        ports = detect_ports(pid).unwrap_or_default();
        if !ports.is_empty() {
            break;
        }
    }
    let ports_str = ports.join(", ");

    state
        .db
        .update_service_status(id, "running", Some(pid as i64), &ports_str)
        .map_err(|e| e.to_string())?;

    Ok(pid)
}

#[tauri::command]
pub fn get_service_logs(
    state: State<AppState>,
    service_id: i64,
) -> Result<Vec<database::ServiceLog>, String> {
    state
        .db
        .get_service_logs(service_id, 500)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_service_ports(pid: i64) -> Result<Vec<String>, String> {
    detect_ports(pid as u32)
}

/// Detect listening TCP ports for a single PID using lsof.
fn detect_ports_for_pid(pid: u32) -> Result<Vec<String>, String> {
    let output = std::process::Command::new("lsof")
        .args(["-p", &pid.to_string(), "-Pn"])
        .output()
        .map_err(|e| format!("lsof failed for PID {}: {}", pid, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = Vec::new();

    for line in stdout.lines().skip(1) {
        // Look for lines containing (LISTEN) – these are TCP listening sockets
        if !line.contains("(LISTEN)") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        // NAME column is typically index 8 (after COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE)
        if let Some(name_col) = parts.get(8) {
            if let Some(port_part) = name_col.rsplit(':').next() {
                if port_part.parse::<u16>().is_ok() {
                    ports.push(port_part.to_string());
                }
            }
        }
    }

    Ok(ports)
}

/// Scan all listening TCP ports and return those belonging to the process tree rooted at `pid`.
fn detect_ports(pid: u32) -> Result<Vec<String>, String> {
    let all_pids = crate::process::collect_pids(pid);
    eprintln!("[macops] detect_ports: root_pid={}, all_pids={:?}", pid, all_pids);

    let mut all_ports = Vec::new();
    for &p in &all_pids {
        match detect_ports_for_pid(p) {
            Ok(ports) => {
                if !ports.is_empty() {
                    eprintln!("[macops]   PID {} ports: {:?}", p, ports);
                    all_ports.extend(ports);
                }
            }
            Err(e) => {
                eprintln!("[macops]   PID {} error: {}", p, e);
            }
        }
    }

    all_ports.sort();
    all_ports.dedup();
    eprintln!("[macops] detect_ports result: {:?}", all_ports);
    Ok(all_ports)
}

// === Docker Commands ===

#[tauri::command]
pub fn list_containers() -> Result<Vec<docker::DockerContainer>, String> {
    docker::list_containers()
}

#[tauri::command]
pub fn start_container(container_id: String) -> Result<(), String> {
    docker::start_container(&container_id)
}

#[tauri::command]
pub fn stop_container(container_id: String) -> Result<(), String> {
    docker::stop_container(&container_id)
}

#[tauri::command]
pub fn restart_container(container_id: String) -> Result<(), String> {
    docker::restart_container(&container_id)
}

#[tauri::command]
pub fn remove_container(container_id: String) -> Result<(), String> {
    docker::remove_container(&container_id)
}

#[tauri::command]
pub fn get_container_logs(container_id: String, tail: i64) -> Result<String, String> {
    docker::get_container_logs(&container_id, tail)
}

#[tauri::command]
pub fn get_container_stats(container_id: String) -> Result<docker::ContainerStats, String> {
    docker::get_container_stats(&container_id)
}

// === Group Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
}

#[tauri::command]
pub fn list_groups(state: State<AppState>) -> Result<Vec<database::Group>, String> {
    state.db.list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(
    state: State<AppState>,
    req: CreateGroupRequest,
) -> Result<i64, String> {
    state
        .db
        .create_group(&req.name, req.parent_id, req.sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    state: State<AppState>,
    req: UpdateGroupRequest,
) -> Result<(), String> {
    state
        .db
        .update_group(req.id, &req.name, req.parent_id, req.sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_group(id).map_err(|e| e.to_string())
}

// === Bookmark Commands ===

#[tauri::command]
pub fn list_bookmarks(
    state: State<AppState>,
    group_id: Option<i64>,
) -> Result<Vec<database::Bookmark>, String> {
    state.db.list_bookmarks(group_id).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct CreateBookmarkRequest {
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub service_id: Option<i64>,
    pub health_check_url: String,
}

#[tauri::command]
pub fn create_bookmark(
    state: State<AppState>,
    req: CreateBookmarkRequest,
) -> Result<i64, String> {
    state
        .db
        .create_bookmark(
            &req.name,
            &req.url,
            &req.description,
            req.group_id,
            &req.icon,
            req.service_id,
            &req.health_check_url,
        )
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateBookmarkRequest {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub health_check_url: String,
}

#[tauri::command]
pub fn update_bookmark(
    state: State<AppState>,
    req: UpdateBookmarkRequest,
) -> Result<(), String> {
    state
        .db
        .update_bookmark(
            req.id,
            &req.name,
            &req.url,
            &req.description,
            req.group_id,
            &req.icon,
            &req.health_check_url,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_bookmark(id).map_err(|e| e.to_string())
}

// === System Commands ===

#[tauri::command]
pub async fn get_system_info() -> Result<system::SystemInfo, String> {
    system::get_system_info()
}

#[tauri::command]
pub async fn get_resource_usage() -> Result<system::ResourceUsage, String> {
    system::get_resource_usage()
}

#[tauri::command]
pub async fn get_processes() -> Result<Vec<system::ProcessInfo>, String> {
    system::get_processes()
}

// === Settings Commands ===

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<database::AppSettings, String> {
    state.db.get_settings().map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub theme: String,
    pub auto_refresh_interval: i64,
    pub show_menu_bar: bool,
}

#[tauri::command]
pub fn update_settings(
    state: State<AppState>,
    req: UpdateSettingsRequest,
) -> Result<(), String> {
    state
        .db
        .update_settings(&req.theme, req.auto_refresh_interval, req.show_menu_bar)
        .map_err(|e| e.to_string())
}

// === SSH Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateSshConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SshAuthType,
    pub group_id: Option<i64>,
}

#[tauri::command]
pub fn create_ssh_connection(
    state: State<AppState>,
    req: CreateSshConnectionRequest,
) -> Result<i64, String> {
    let auth_type_str = match &req.auth_type {
        SshAuthType::Password { .. } => "password",
        SshAuthType::PublicKey { .. } => "publickey",
    };
    let auth_data = serde_json::to_string(&req.auth_type).map_err(|e| e.to_string())?;

    state
        .db
        .create_ssh_connection(
            &req.name,
            &req.host,
            req.port,
            &req.username,
            auth_type_str,
            &auth_data,
            req.group_id,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_ssh_connections(
    state: State<AppState>,
) -> Result<Vec<crate::ssh::types::SshConnection>, String> {
    let db_connections = state.db.list_ssh_connections().map_err(|e| e.to_string())?;

    let mut connections = Vec::new();
    for db_conn in db_connections {
        let auth_type: SshAuthType =
            serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

        connections.push(crate::ssh::types::SshConnection {
            id: db_conn.id,
            name: db_conn.name,
            host: db_conn.host,
            port: db_conn.port,
            username: db_conn.username,
            auth_type,
            group_id: db_conn.group_id,
            created_at: db_conn.created_at,
            updated_at: db_conn.updated_at,
        });
    }

    Ok(connections)
}

#[tauri::command]
pub fn delete_ssh_connection(
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    state.db.delete_ssh_connection(id).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateSshConnectionRequest {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: SshAuthType,
    pub group_id: Option<i64>,
}

#[tauri::command]
pub fn update_ssh_connection(
    state: State<AppState>,
    req: UpdateSshConnectionRequest,
) -> Result<(), String> {
    let auth_type_str = match &req.auth_type {
        SshAuthType::Password { .. } => "password",
        SshAuthType::PublicKey { .. } => "publickey",
    };
    let auth_data = serde_json::to_string(&req.auth_type).map_err(|e| e.to_string())?;

    state
        .db
        .update_ssh_connection(
            req.id,
            &req.name,
            &req.host,
            req.port,
            &req.username,
            auth_type_str,
            &auth_data,
            req.group_id,
        )
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct SshConnectResponse {
    pub session_id: String,
    pub websocket_url: String,
}

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<SshConnectResponse, String> {
    let db_connection = state
        .db
        .get_ssh_connection(connection_id)
        .map_err(|e| e.to_string())?;

    // Deserialize auth_data
    let auth_type: SshAuthType =
        serde_json::from_str(&db_connection.auth_data).map_err(|e| e.to_string())?;

    let connection = crate::ssh::types::SshConnection {
        id: db_connection.id,
        name: db_connection.name,
        host: db_connection.host,
        port: db_connection.port,
        username: db_connection.username,
        auth_type,
        group_id: db_connection.group_id,
        created_at: db_connection.created_at,
        updated_at: db_connection.updated_at,
    };

    let session_id = state
        .ssh_session_manager
        .create_session(&connection)
        .await
        .map_err(|e| e.to_string())?;

    let websocket_port = state
        .ssh_session_manager
        .open_pty(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SshConnectResponse {
        session_id,
        websocket_url: format!("ws://127.0.0.1:{}", websocket_port),
    })
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .ssh_session_manager
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_active_sessions_count(state: State<'_, AppState>) -> Result<usize, String> {
    let count = state.ssh_session_manager.get_active_sessions_count().await;
    Ok(count)
}

// === SFTP Commands ===

async fn get_sftp_manager(
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<crate::ssh::sftp::SftpManager, String> {
    let info = state
        .ssh_session_manager
        .get_session_info(session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type: SshAuthType =
        serde_json::from_str(&db_conn.auth_data).map_err(|e| e.to_string())?;

    crate::ssh::sftp::SftpManager::connect(
        &db_conn.host,
        db_conn.port,
        &db_conn.username,
        &auth_type,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<crate::ssh::types::SftpFile>, String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    sftp.list_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    sftp.delete(&path, is_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    sftp.mkdir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    sftp.rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_get_file_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<crate::ssh::types::SftpFile, String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    sftp.get_file_info(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;

    let total = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
    let file_name = std::path::Path::new(&local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    // 初始化进度
    {
        let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
        map.insert(
            transfer_id.clone(),
            crate::ssh::types::TransferProgress {
                id: transfer_id.clone(),
                file_name,
                direction: "upload".to_string(),
                total_bytes: total,
                transferred_bytes: 0,
                status: "in_progress".to_string(),
            },
        );
    }

    // 分块传输
    let mut local_file = std::fs::File::open(&local_path).map_err(|e| e.to_string())?;
    let mut remote_file = sftp
        .create_file(std::path::Path::new(&remote_path))
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; SFTP_CHUNK_SIZE];
    let mut transferred = 0u64;
    let mut chunk_count = 0usize;

    let result = loop {
        // 检查取消
        {
            let map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
            if let Some(p) = map.get(&transfer_id) {
                if p.status == "cancelled" {
                    let _ = sftp.delete(&remote_path, false);
                    break Err("传输已取消".to_string());
                }
            }
        }

        let n = match local_file.read(&mut buffer) {
            Ok(n) => n,
            Err(e) => break Err(format!("读取本地文件失败: {}", e)),
        };

        if n == 0 {
            break Ok(());
        }

        if let Err(e) = remote_file.write_all(&buffer[..n]) {
            break Err(format!("写入远程文件失败: {}", e));
        }

        transferred += n as u64;
        chunk_count += 1;

        // 更新进度
        {
            let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
            if let Some(p) = map.get_mut(&transfer_id) {
                p.transferred_bytes = transferred;
            }
        }

        // 每 16 个 chunk（约 1MB）yield 一次，让 tokio 调度其他任务
        if chunk_count % SFTP_YIELD_INTERVAL == 0 {
            tokio::task::yield_now().await;
        }
    };

    // 更新最终状态
    {
        let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
        if let Some(p) = map.get_mut(&transfer_id) {
            if result.is_ok() {
                p.transferred_bytes = total;
                p.status = "completed".to_string();
            } else {
                p.status = "failed".to_string();
            }
        }
    }

    result
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;

    // 获取远程文件大小
    let total = sftp
        .get_file_info(&remote_path)
        .map(|f| f.size)
        .unwrap_or(0);
    let file_name = std::path::Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    // 初始化进度
    {
        let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
        map.insert(
            transfer_id.clone(),
            crate::ssh::types::TransferProgress {
                id: transfer_id.clone(),
                file_name,
                direction: "download".to_string(),
                total_bytes: total,
                transferred_bytes: 0,
                status: "in_progress".to_string(),
            },
        );
    }

    // 分块传输
    let mut remote_file = sftp
        .open_file(std::path::Path::new(&remote_path))
        .map_err(|e| e.to_string())?;
    let mut local_file = std::fs::File::create(&local_path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; SFTP_CHUNK_SIZE];
    let mut transferred = 0u64;
    let mut chunk_count = 0usize;

    let result = loop {
        // 检查取消
        {
            let map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
            if let Some(p) = map.get(&transfer_id) {
                if p.status == "cancelled" {
                    let _ = std::fs::remove_file(&local_path);
                    break Err("传输已取消".to_string());
                }
            }
        }

        let n = match remote_file.read(&mut buffer) {
            Ok(n) => n,
            Err(e) => break Err(format!("读取远程文件失败: {}", e)),
        };

        if n == 0 {
            break Ok(());
        }

        if let Err(e) = local_file.write_all(&buffer[..n]) {
            break Err(format!("写入本地文件失败: {}", e));
        }

        transferred += n as u64;
        chunk_count += 1;

        // 更新进度
        {
            let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
            if let Some(p) = map.get_mut(&transfer_id) {
                p.transferred_bytes = transferred;
            }
        }

        // 每 16 个 chunk yield 一次
        if chunk_count % SFTP_YIELD_INTERVAL == 0 {
            tokio::task::yield_now().await;
        }
    };

    // 更新最终状态
    {
        let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
        if let Some(p) = map.get_mut(&transfer_id) {
            if result.is_ok() {
                p.transferred_bytes = total;
                p.status = "completed".to_string();
            } else {
                p.status = "failed".to_string();
            }
        }
    }

    result
}

#[tauri::command]
pub fn sftp_get_progress(
    state: State<AppState>,
    transfer_id: String,
) -> Result<Option<crate::ssh::types::TransferProgress>, String> {
    let map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
    Ok(map.get(&transfer_id).cloned())
}

#[tauri::command]
pub fn sftp_cancel_transfer(
    state: State<AppState>,
    transfer_id: String,
) -> Result<(), String> {
    let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
    if let Some(p) = map.get_mut(&transfer_id) {
        p.status = "cancelled".to_string();
    }
    Ok(())
}

#[tauri::command]
pub fn sftp_clear_completed(state: State<AppState>) -> Result<(), String> {
    let mut map = state.transfer_progress.lock().map_err(|e| e.to_string())?;
    map.retain(|_, p| p.status == "in_progress");
    Ok(())
}

// === Tmux 管理 ===

use crate::tmux::types::{
    CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession,
};
use tauri::ipc::Channel;

#[tauri::command]
pub fn tmux_list_sessions() -> Result<Vec<TmuxSession>, String> {
    crate::tmux::commands::list_sessions()
}

#[tauri::command]
pub fn tmux_create_session(req: CreateTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::commands::create_session(&req)
}

#[tauri::command]
pub fn tmux_kill_session(name: String) -> Result<(), String> {
    crate::tmux::commands::kill_session(&name)
}

#[tauri::command]
pub fn tmux_rename_session(req: RenameTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::commands::rename_session(&req)
}

#[tauri::command]
pub fn tmux_is_available() -> bool {
    crate::tmux::commands::is_tmux_available()
}

#[tauri::command]
pub fn tmux_attach_pty(
    session_name: String,
    channel: Channel<Vec<u8>>,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pty_session = crate::tmux::pty::attach_session_pty(&session_name, channel, cols, rows)?;
    let pty_id = uuid::Uuid::new_v4().to_string();

    state
        .tmux_pty_sessions
        .lock()
        .unwrap()
        .insert(pty_id.clone(), pty_session);

    Ok(pty_id)
}

#[tauri::command]
pub fn tmux_pty_write(
    pty_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.tmux_pty_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&pty_id)
        .ok_or("PTY session not found")?;
    crate::tmux::pty::write_to_pty(session, &data)
}

#[tauri::command]
pub fn tmux_pty_resize(
    pty_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.tmux_pty_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&pty_id)
        .ok_or("PTY session not found")?;
    crate::tmux::pty::resize_pty(session, cols, rows)
}

#[tauri::command]
pub fn tmux_pty_close(pty_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = {
        let mut sessions = state.tmux_pty_sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(&pty_id)
    };

    if let Some(session) = session {
        std::thread::spawn(move || {
            // 先发送 tmux prefix (Ctrl+B) + d，让客户端优雅 detach
            let _ = crate::tmux::pty::write_to_pty(&session, b"\x02d");
            // 给 tmux 一点时间处理 detach 命令
            std::thread::sleep(std::time::Duration::from_millis(300));
            // session 在这里被 drop，关闭 PTY 和子进程
        });
    }
    Ok(())
}

#[tauri::command]
pub fn tmux_open_in_ghostty(session_name: String) -> Result<(), String> {
    // 方案1: 直接通过 ghostty CLI 启动（最可靠）
    let ghostty_in_path = std::process::Command::new("which")
        .arg("ghostty")
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false);

    if ghostty_in_path {
        let result = std::process::Command::new("ghostty")
            .args(["-e", &format!("tmux attach -t {}", session_name)])
            .spawn();
        if result.is_ok() {
            return Ok(());
        }
    }

    // 方案2: 通过 open 启动 Ghostty app 并传参
    let open_result = std::process::Command::new("open")
        .args([
            "-na",
            "Ghostty",
            "--args",
            "-e",
            &format!("tmux attach -t {}", session_name),
        ])
        .output();

    if open_result.is_ok() {
        return Ok(());
    }

    // 方案3: AppleScript 回退（兼容模式）
    let script = format!(
        r#"tell application "Ghostty"
    activate
    delay 0.5
end tell
tell application "System Events" to tell process "Ghostty"
    keystroke "n" using command down
    delay 0.3
    keystroke "tmux attach -t {}"
    keystroke return
end tell"#,
        session_name
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("无法启动 Ghostty: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript 执行失败: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub fn tmux_generate_config() -> Result<String, String> {
    crate::tmux::commands::generate_config()
}
