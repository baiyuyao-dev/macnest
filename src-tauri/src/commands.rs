use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::database;
use crate::docker;
use crate::mysql;
use crate::ssh::types::SshAuthType;
use crate::system;
use crate::AppState;

/* ── Constants ── */

const PORT_DETECT_MAX_ATTEMPTS: u32 = 8;
const PORT_DETECT_RETRY_MS: u64 = 800;
const SFTP_CHUNK_SIZE: usize = 64 * 1024; // 64KB

/// 解密 auth_data，兼容旧的明文格式
/// 先尝试解密（新格式），失败则回退到明文 JSON（旧格式）
fn decrypt_auth_data(auth_data: &str) -> Result<SshAuthType, String> {
    // 先尝试解密（加密后的数据）
    if let Ok(json) = crate::security::decrypt(auth_data) {
        if let Ok(auth) = serde_json::from_str::<SshAuthType>(&json) {
            return Ok(auth);
        }
    }
    // 回退：直接作为明文 JSON 解析（旧数据兼容）
    serde_json::from_str::<SshAuthType>(auth_data).map_err(|e| e.to_string())
}
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
            // If the process died while MacNest was closed, clean up the stale DB state.
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

    let _ = state.db.increment_service_start_count(id);

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
        // Fallback: service was started before MacNest restarted.
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
pub async fn stop_service(state: State<'_, AppState>, id: i64) -> Result<(), String> {
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

    let _ = state.db.increment_service_start_count(id);

    Ok(pid)
}

#[tauri::command]
pub fn get_service_logs(
    state: State<AppState>,
    service_id: i64,
) -> Result<Vec<crate::process::LogEntry>, String> {
    let pm = state
        .process_manager
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(pm.get_logs(service_id))
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
    eprintln!("[MacNest] detect_ports: root_pid={}, all_pids={:?}", pid, all_pids);

    let mut all_ports = Vec::new();
    for &p in &all_pids {
        match detect_ports_for_pid(p) {
            Ok(ports) => {
                if !ports.is_empty() {
                    eprintln!("[MacNest]   PID {} ports: {:?}", p, ports);
                    all_ports.extend(ports);
                }
            }
            Err(e) => {
                eprintln!("[MacNest]   PID {} error: {}", p, e);
            }
        }
    }

    all_ports.sort();
    all_ports.dedup();
    eprintln!("[MacNest] detect_ports result: {:?}", all_ports);
    Ok(all_ports)
}

// === Docker Commands ===

#[tauri::command]
pub async fn list_containers() -> Result<Vec<docker::DockerContainer>, String> {
    docker::list_containers().await
}

#[tauri::command]
pub async fn start_container(container_id: String) -> Result<(), String> {
    docker::start_container(&container_id).await
}

#[tauri::command]
pub async fn stop_container(container_id: String) -> Result<(), String> {
    docker::stop_container(&container_id).await
}

#[tauri::command]
pub async fn restart_container(container_id: String) -> Result<(), String> {
    docker::restart_container(&container_id).await
}

#[tauri::command]
pub async fn remove_container(container_id: String) -> Result<(), String> {
    docker::remove_container(&container_id).await
}

#[tauri::command]
pub async fn get_container_logs(container_id: String, tail: i64) -> Result<String, String> {
    docker::get_container_logs(&container_id, tail).await
}

#[tauri::command]
pub async fn get_container_stats(container_id: String) -> Result<docker::ContainerStats, String> {
    docker::get_container_stats(&container_id).await
}

#[tauri::command]
pub async fn recreate_container(container_id: String) -> Result<String, String> {
    docker::recreate_container(&container_id).await
}

#[tauri::command]
pub async fn update_container_ports(
    container_id: String,
    ports: Vec<String>,
) -> Result<String, String> {
    docker::update_container_ports(&container_id, ports).await
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<docker::DockerImage>, String> {
    docker::list_images().await
}

#[tauri::command]
pub async fn remove_image(image_id: String) -> Result<(), String> {
    docker::remove_image(&image_id).await
}

#[tauri::command]
pub async fn prune_images() -> Result<String, String> {
    docker::prune_images().await
}

#[tauri::command]
pub async fn inspect_container(container_id: String) -> Result<docker::ContainerInspect, String> {
    docker::inspect_container(&container_id).await
}

#[tauri::command]
pub async fn pull_image(image: String) -> Result<String, String> {
    docker::pull_image(&image).await
}

#[tauri::command]
pub async fn create_container(req: docker::CreateContainerRequest) -> Result<String, String> {
    docker::create_container(&req).await
}

#[tauri::command]
pub async fn docker_system_df() -> Result<docker::DockerSystemDf, String> {
    docker::system_df().await
}

#[tauri::command]
pub async fn list_volumes() -> Result<Vec<docker::DockerVolume>, String> {
    docker::list_volumes().await
}

#[tauri::command]
pub async fn remove_volume(name: String) -> Result<(), String> {
    docker::remove_volume(&name).await
}

#[tauri::command]
pub async fn prune_volumes() -> Result<String, String> {
    docker::prune_volumes().await
}

#[tauri::command]
pub async fn list_networks() -> Result<Vec<docker::DockerNetwork>, String> {
    docker::list_networks().await
}

#[tauri::command]
pub async fn remove_network(id: String) -> Result<(), String> {
    docker::remove_network(&id).await
}

// === Docker Terminal Commands ===

#[tauri::command]
pub async fn docker_detect_shells(container_id: String) -> Result<Vec<String>, String> {
    crate::docker_terminal::detect_shells(&container_id).await
}

#[derive(Debug, Serialize)]
pub struct DockerTerminalConnectResponse {
    pub session_id: String,
    pub websocket_url: String,
}

#[tauri::command]
pub async fn docker_terminal_connect(
    state: State<'_, AppState>,
    container_id: String,
    container_name: String,
    shell: String,
) -> Result<DockerTerminalConnectResponse, String> {
    let info = state
        .docker_terminal_manager
        .create_session(&container_id, &container_name, &shell)
        .await?;
    Ok(DockerTerminalConnectResponse {
        session_id: info.session_id,
        websocket_url: info.websocket_url,
    })
}

#[tauri::command]
pub async fn docker_terminal_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.docker_terminal_manager.close_session(&session_id).await
}

// === Group Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub group_type: String,
    pub start_directory: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub group_type: String,
    pub start_directory: String,
}

#[tauri::command]
pub fn list_groups(
    state: State<AppState>,
    group_type: String,
) -> Result<Vec<database::Group>, String> {
    let groups = state
        .db
        .list_groups(&group_type)
        .map_err(|e| e.to_string())?;
    // 过滤掉 "其他" 和 "默认" 分组
    let filtered = groups
        .into_iter()
        .filter(|g| g.name != "其他" && g.name != "默认")
        .collect();
    Ok(filtered)
}

#[tauri::command]
pub fn create_group(
    state: State<AppState>,
    req: CreateGroupRequest,
) -> Result<i64, String> {
    state
        .db
        .create_group(&req.name, req.parent_id, req.sort_order, &req.group_type, &req.start_directory)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    state: State<AppState>,
    req: UpdateGroupRequest,
) -> Result<(), String> {
    state
        .db
        .update_group(req.id, &req.name, req.parent_id, req.sort_order, &req.group_type, &req.start_directory)
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
    pub group_id: Option<i64>,
    pub icon: String,
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
            req.group_id,
            &req.icon,
        )
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateBookmarkRequest {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub group_id: Option<i64>,
    pub icon: String,
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
            req.group_id,
            &req.icon,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_bookmark(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_safari_bookmarks(
    state: State<AppState>,
) -> Result<crate::safari_bookmarks::ImportResult, String> {
    crate::safari_bookmarks::import_safari_bookmarks(&state.db)
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

#[tauri::command]
pub async fn get_cpu_detailed_usage() -> Result<system::CpuDetailedUsage, String> {
    system::get_cpu_detailed_usage()
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
    pub auto_sync_bookmarks_interval: i64,
}

#[tauri::command]
pub fn update_settings(
    state: State<AppState>,
    req: UpdateSettingsRequest,
) -> Result<(), String> {
    state
        .db
        .update_settings(
            &req.theme,
            req.auto_refresh_interval,
            req.show_menu_bar,
            req.auto_sync_bookmarks_interval,
        )
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
    let auth_json = serde_json::to_string(&req.auth_type).map_err(|e| e.to_string())?;
    let auth_data = crate::security::encrypt(&auth_json).map_err(|e| e.to_string())?;

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
        let auth_type = decrypt_auth_data(&db_conn.auth_data)?;

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
    let auth_json = serde_json::to_string(&req.auth_type).map_err(|e| e.to_string())?;
    let auth_data = crate::security::encrypt(&auth_json).map_err(|e| e.to_string())?;

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

    // Decrypt and deserialize auth_data（兼容旧格式）
    let auth_type = decrypt_auth_data(&db_connection.auth_data)?;

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

#[tauri::command]
pub async fn get_ssh_system_info(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<crate::ssh::types::RemoteSystemInfo, String> {
    // 先测一个极简命令的 RTT，作为网络延迟指标
    let latency_ms = {
        let start = std::time::Instant::now();
        let _ = state
            .ssh_session_manager
            .exec_command(&session_id, "echo pong")
            .await;
        start.elapsed().as_millis() as i32
    };

    // 复用已有的 russh session 执行命令，避免新建 ssh2 连接导致服务器拒绝

    // hostname
    let (hostname, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "hostname")
        .await
        .map_err(|e| format!("获取主机名失败: {}", e))?;
    let hostname = hostname.trim().to_string();

    // OS version
    let (os_version, _, exit_code) = state
        .ssh_session_manager
        .exec_command(&session_id, "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2")
        .await
        .unwrap_or_default();
    let os_version = if exit_code == 0 && !os_version.trim().is_empty() {
        os_version.trim().to_string()
    } else {
        let (uname, _, _) = state
            .ssh_session_manager
            .exec_command(&session_id, "uname -sr")
            .await
            .unwrap_or_default();
        uname.trim().to_string()
    };

    // CPU model
    let (cpu_model, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "cat /proc/cpuinfo 2>/dev/null | grep 'model name' | head -1 | cut -d':' -f2 | sed 's/^ *//' || echo 'Unknown'")
        .await
        .unwrap_or_default();
    let cpu_model = cpu_model.trim().to_string();

    // CPU cores
    let (cpu_cores_str, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '1'")
        .await
        .unwrap_or_default();
    let cpu_cores = cpu_cores_str.trim().parse::<i32>().unwrap_or(1);

    // Memory: try /proc/meminfo first (Linux, locale-independent), then free -m, then vm_stat (macOS)
    let mut memory_total_mb = 0_i32;
    let mut memory_used_mb = 0_i32;
    let mut memory_free_mb = 0_i32;

    // 1. Linux: /proc/meminfo — always in English, no locale issues
    let (mem_str, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "cat /proc/meminfo 2>/dev/null | awk '/MemTotal:/ {t=int($2/1024)} /MemAvailable:/ {a=int($2/1024)} /MemFree:/ {f=int($2/1024)} END {print t,a,f}'")
        .await
        .unwrap_or_default();
    let mem_parts: Vec<&str> = mem_str.trim().split_whitespace().collect();
    if mem_parts.len() >= 3 {
        memory_total_mb = mem_parts[0].parse().unwrap_or(0);
        let available_mb = mem_parts[1].parse::<i32>().unwrap_or(0);
        let free_mb = mem_parts[2].parse::<i32>().unwrap_or(0);
        // Use MemAvailable (Linux 3.14+) if present, otherwise fall back to MemFree
        memory_free_mb = if available_mb > 0 { available_mb } else { free_mb };
        memory_used_mb = memory_total_mb.saturating_sub(memory_free_mb);
    } else {
        // 2. Fallback: LC_ALL=C free -m (forces English headers)
        let (free_str, _, _) = state
            .ssh_session_manager
            .exec_command(&session_id, "LC_ALL=C free -m 2>/dev/null | awk 'NR==2 {print $2,$3,$4}'")
            .await
            .unwrap_or_default();
        let free_parts: Vec<&str> = free_str.trim().split_whitespace().collect();
        if free_parts.len() >= 3 {
            memory_total_mb = free_parts[0].parse().unwrap_or(0);
            memory_used_mb = free_parts[1].parse().unwrap_or(0);
            memory_free_mb = free_parts[2].parse().unwrap_or(0);
        } else {
            // 3. macOS fallback: vm_stat + sysctl hw.memsize
            let (vm_str, _, _) = state
                .ssh_session_manager
                .exec_command(&session_id, "vm_stat 2>/dev/null | tr -d '.' | awk '/Pages free/ {f=$3} /Pages active/ {a=$3} /Pages inactive/ {i=$3} /Pages speculative/ {s=$3} /Pages wired down/ {w=$3} /Pages occupied by compressor/ {c=$3} END {print f,a,i,s,w,c}'")
                .await
                .unwrap_or_default();
            let vm_parts: Vec<&str> = vm_str.trim().split_whitespace().collect();
            if vm_parts.len() >= 5 {
                let page_size = 4096_i64;
                let free_pages = vm_parts[0].parse::<i64>().unwrap_or(0);
                let active_pages = vm_parts[1].parse::<i64>().unwrap_or(0);
                let inactive_pages = vm_parts[2].parse::<i64>().unwrap_or(0);
                let speculative_pages = vm_parts[3].parse::<i64>().unwrap_or(0);
                let wired_pages = vm_parts[4].parse::<i64>().unwrap_or(0);
                let compressed_pages = if vm_parts.len() >= 6 {
                    vm_parts[5].parse::<i64>().unwrap_or(0)
                } else {
                    0
                };

                let (total_str, _, _) = state
                    .ssh_session_manager
                    .exec_command(&session_id, "sysctl -n hw.memsize 2>/dev/null || echo '0'")
                    .await
                    .unwrap_or_default();
                let total_bytes = total_str.trim().parse::<i64>().unwrap_or(0);
                memory_total_mb = (total_bytes / 1024 / 1024) as i32;
                memory_used_mb = ((active_pages + inactive_pages + speculative_pages + wired_pages + compressed_pages) * page_size / 1024 / 1024) as i32;
                memory_free_mb = (free_pages * page_size / 1024 / 1024) as i32;
            }
        }
    }

    let memory_percent = if memory_total_mb > 0 {
        (memory_used_mb as f32 / memory_total_mb as f32 * 100.0) as i32
    } else {
        0
    };

    // Disk: total used available usage_percent
    let (disk_str, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "LC_ALL=C df -h / 2>/dev/null | tail -1 | awk '{print $2,$3,$4,$5}'")
        .await
        .unwrap_or_default();
    let disk_parts: Vec<&str> = disk_str.trim().split_whitespace().collect();
    let disk_total = disk_parts.get(0).unwrap_or(&"-").to_string();
    let disk_used = disk_parts.get(1).unwrap_or(&"-").to_string();
    let disk_available = disk_parts.get(2).unwrap_or(&"-").to_string();
    let disk_usage_percent = disk_parts.get(3).unwrap_or(&"-").to_string();
    let disk_usage_percent_num = disk_usage_percent.trim_end_matches('%').parse::<i32>().unwrap_or(0);

    // Load average: split into 1m, 5m, 15m
    let (load_str, _, _) = state
        .ssh_session_manager
        .exec_command(&session_id, "uptime 2>/dev/null | awk -F'load average[s]*:' '{print $2}' | sed 's/^ *//;s/,//g'")
        .await
        .unwrap_or_default();
    let load_parts: Vec<&str> = load_str.trim().split_whitespace().collect();
    let load_1m = load_parts.get(0).unwrap_or(&"-").to_string();
    let load_5m = load_parts.get(1).unwrap_or(&"-").to_string();
    let load_15m = load_parts.get(2).unwrap_or(&"-").to_string();

    Ok(crate::ssh::types::RemoteSystemInfo {
        hostname,
        os_version,
        cpu_model,
        cpu_cores,
        memory_total_mb,
        memory_used_mb,
        memory_free_mb,
        memory_percent,
        disk_total,
        disk_used,
        disk_available,
        disk_usage_percent,
        disk_usage_percent_num,
        load_1m,
        load_5m,
        load_15m,
        latency_ms,
    })
}

#[derive(Debug, Serialize)]
pub struct ShellIntegrationResult {
    pub bashrc_modified: bool,
    pub zshrc_modified: bool,
    pub script_uploaded: bool,
}

#[tauri::command]
pub async fn install_ssh_shell_integration(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<ShellIntegrationResult, String> {
    // 获取会话信息以确定用户名和 home 目录
    let info = state
        .ssh_session_manager
        .get_session_info(&session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let sftp_arc = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp_arc.lock().await;

    // 通过 SSH exec 获取真实的 home 目录，而不是猜
    let (home_dir, _, exit_code) = sftp
        .exec_command("echo $HOME")
        .map_err(|e| format!("获取 home 目录失败: {}", e))?;
    if exit_code != 0 || home_dir.trim().is_empty() {
        return Err("无法检测远程服务器的 home 目录".to_string());
    }
    let home_dir = home_dir.trim();

    // Shell Integration 脚本内容（同时支持 bash 和 zsh）
    const SCRIPT_CONTENT: &str = r#"#!/bin/bash
# MacNest Shell Integration - OSC 7 路径同步
# 由 macnest 自动安装，请勿手动修改

__macnest_osc7() {
    printf '\e]7;file://%s%s\a' "${HOSTNAME:-$(hostname)}" "$PWD"
}

__macnest_setup() {
    if [ -n "$BASH_VERSION" ]; then
        if [[ "$PROMPT_COMMAND" != *"__macnest_osc7"* ]]; then
            # 去掉 PROMPT_COMMAND 末尾的分号和空格，避免追加后出现双分号
            local trimmed="${PROMPT_COMMAND%"${PROMPT_COMMAND##*[![:space:];]}"}"
            PROMPT_COMMAND="${trimmed:+$trimmed; }__macnest_osc7"
        fi
    elif [ -n "$ZSH_VERSION" ]; then
        if [[ "${precmd_functions[(r)__macnest_osc7]}" != "__macnest_osc7" ]]; then
            precmd_functions+=(__macnest_osc7)
        fi
    fi
}

__macnest_setup
unset -f __macnest_setup
"#;

    const SOURCE_LINE: &str =
        "[ -f ~/.macnest_shell_integration.sh ] && source ~/.macnest_shell_integration.sh";

    let script_path = format!("{}/.macnest_shell_integration.sh", home_dir);
    sftp.write_file(&script_path, SCRIPT_CONTENT.as_bytes())
        .map_err(|e| format!("上传脚本失败: {}", e))?;

    let bashrc_path = format!("{}/.bashrc", home_dir);
    let bashrc_modified = modify_rc_file(&sftp, &bashrc_path, SOURCE_LINE)
        .map_err(|e| format!("修改 .bashrc 失败: {}", e))?;

    let zshrc_path = format!("{}/.zshrc", home_dir);
    let zshrc_modified = modify_rc_file(&sftp, &zshrc_path, SOURCE_LINE)
        .unwrap_or(false);

    Ok(ShellIntegrationResult {
        bashrc_modified,
        zshrc_modified,
        script_uploaded: true,
    })
}

/// 检查 rc 文件是否已包含指定行，没有则追加
fn modify_rc_file(
    sftp: &crate::ssh::sftp::SftpManager,
    path: &str,
    line: &str,
) -> anyhow::Result<bool> {
    let content = match sftp.read_file(path) {
        Ok(data) => String::from_utf8_lossy(&data).to_string(),
        Err(_) => String::new(),
    };

    if content.contains(line) {
        return Ok(false); // 已存在，无需修改
    }

    let new_content = if content.is_empty() {
        format!("# MacNest Shell Integration\n{}\n", line)
    } else {
        format!("{}\n# MacNest Shell Integration\n{}\n", content.trim_end(), line)
    };

    sftp.write_file(path, new_content.as_bytes())?;
    Ok(true)
}

// === SFTP Commands ===

async fn get_sftp_manager(
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<tokio::sync::Mutex<crate::ssh::sftp::SftpManager>>, String> {
    // Fast path: 检查缓存
    {
        let managers = state.sftp_managers.lock().await;
        if let Some(manager) = managers.get(session_id) {
            return Ok(manager.clone());
        }
    }

    // Slow path: 新建连接
    let info = state
        .ssh_session_manager
        .get_session_info(session_id)
        .await
        .ok_or("Session not found")?;

    let db_conn = state
        .db
        .get_ssh_connection(info.connection_id)
        .map_err(|e| e.to_string())?;

    let auth_type = decrypt_auth_data(&db_conn.auth_data)?;

    let manager = crate::ssh::sftp::SftpManager::connect(
        &db_conn.host,
        db_conn.port,
        &db_conn.username,
        &auth_type,
    )
    .map_err(|e| e.to_string())?;

    let manager_arc = Arc::new(tokio::sync::Mutex::new(manager));

    let mut managers = state.sftp_managers.lock().await;
    managers.insert(session_id.to_string(), manager_arc.clone());

    Ok(manager_arc)
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<crate::ssh::types::SftpFile>, String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp.lock().await;
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
    let sftp = sftp.lock().await;
    sftp.delete(&path, is_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp.lock().await;
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
    let sftp = sftp.lock().await;
    sftp.rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_get_file_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<crate::ssh::types::SftpFile, String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp.lock().await;
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
    let sftp_arc = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp_arc.lock().await;

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
    let sftp_arc = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp_arc.lock().await;

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

#[tauri::command]
pub async fn sftp_read_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp.lock().await;
    let bytes = sftp.read_file(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| format!("文件不是有效的 UTF-8 文本: {}", e))
}

#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let sftp = get_sftp_manager(&state, &session_id).await?;
    let sftp = sftp.lock().await;
    sftp.write_file(&path, content.as_bytes()).map_err(|e| e.to_string())
}

// === Tmux 管理 ===

use crate::tmux::types::{
    CreateTmuxSessionRequest, RenameTmuxSessionRequest, TmuxSession,
};
use tauri::ipc::Channel;

#[tauri::command]
pub fn tmux_list_sessions(state: State<AppState>) -> Result<Vec<TmuxSession>, String> {
    crate::tmux::commands::list_sessions(&state.db)
}

#[tauri::command]
pub fn tmux_create_session(state: State<AppState>, req: CreateTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::commands::create_session(&state.db, &req)
}

#[tauri::command]
pub fn tmux_kill_session(state: State<AppState>, name: String) -> Result<(), String> {
    crate::tmux::commands::kill_session(&state.db, &name)
}

#[tauri::command]
pub fn tmux_rename_session(state: State<AppState>, req: RenameTmuxSessionRequest) -> Result<(), String> {
    crate::tmux::commands::rename_session(&state.db, &req)
}

#[tauri::command]
pub fn tmux_update_session_start_directory(
    state: State<AppState>,
    display_name: String,
    start_directory: String,
) -> Result<(), String> {
    crate::tmux::commands::update_session_start_directory(&state.db, &display_name, &start_directory)
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
    let tmux_name = crate::tmux::commands::resolve_tmux_name(&state.db, &session_name)?;
    let pty_session = crate::tmux::pty::attach_session_pty(&tmux_name, channel, cols, rows)?;
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
pub fn tmux_open_in_ghostty(state: State<AppState>, session_name: String) -> Result<(), String> {
    let tmux_name = crate::tmux::commands::resolve_tmux_name(&state.db, &session_name)?;

    // 使用 tmux 绝对路径，避免 Ghostty 启动的 shell 没有加载 profile 导致 PATH 缺失
    let tmux_path = crate::tmux::get_tmux_path();

    // 创建临时脚本文件
    let script_content = format!(
        "#!/bin/sh\n# MacNest auto-generated tmux attach script\nexec {} attach -t '{}'\n",
        tmux_path,
        tmux_name.replace('\'', "'\"'\"'")
    );
    let script_path = format!(
        "/tmp/macnest-tmux-{}.sh",
        tmux_name.replace(|c: char| !c.is_alphanumeric(), "_")
    );

    std::fs::write(&script_path, &script_content)
        .map_err(|e| format!("写入临时脚本失败: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("设置脚本权限失败: {}", e))?;
    }

    // 创建 Ghostty 临时配置文件
    let config_content = format!("command = {}\n", script_path);
    let config_path = format!(
        "/tmp/macnest-ghostty-{}.conf",
        tmux_name.replace(|c: char| !c.is_alphanumeric(), "_")
    );

    std::fs::write(&config_path, &config_content)
        .map_err(|e| format!("写入临时配置文件失败: {}", e))?;

    // 方案: 通过 open + --config-file 启动 Ghostty
    // Ghostty 支持 --config-file 参数，且在 macOS 上通过 open 启动时会解析 --args 传递的参数
    let result = std::process::Command::new("open")
        .args(["-na", "Ghostty", "--args", &format!("--config-file={}", config_path)])
        .output();

    // 延迟清理临时文件（给 Ghostty 启动时间）
    let script_path_clone = script_path.clone();
    let config_path_clone = config_path.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        std::fs::remove_file(&script_path_clone).ok();
        std::fs::remove_file(&config_path_clone).ok();
    });

    match result {
        Ok(output) if output.status.success() => return Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("Ghostty config-file launch stderr: {}", stderr);
        }
        Err(e) => {
            eprintln!("Ghostty spawn failed: {}", e);
        }
    }

    // 如果 Ghostty 已经在运行，open -na 可能启动新实例失败。
    // 尝试直接用 ghostty CLI 的 +action 方式（虽然 help 说 macOS 不支持启动终端，但试试）
    let ghostty_cli = std::path::Path::new("/Applications/Ghostty.app/Contents/MacOS/ghostty");
    if ghostty_cli.exists() {
        let result = std::process::Command::new(ghostty_cli)
            .args(["--config-file", &config_path])
            .spawn();
        if result.is_ok() {
            return Ok(());
        }
    }

    // 最终回退: AppleScript
    let script = format!(
        r#"tell application "System Events"
    set isRunning to (name of processes) contains "Ghostty"
end tell

tell application "Ghostty"
    activate
    delay 0.3
end tell

tell application "System Events"
    if isRunning then
        keystroke "n" using command down
        delay 0.3
    end if
    keystroke "tmux attach -t {}"
    keystroke return
end tell"#,
        tmux_name.replace('"', "\\\"").replace('\\', "\\\\")
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("AppleScript 执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not allowed") || stderr.contains("(-25211)") || stderr.contains("(1002)") {
            return Err(
                "Ghostty 自动化失败。请尝试以下任一方法：\n\
                1. 终端执行: tccutil reset Accessibility\n\
                2. 重新给 MacNest 辅助功能权限\n\
                3. 或手动在 Ghostty 中执行: tmux attach -t ".to_string() + &tmux_name
            );
        }
        return Err(format!("Ghostty 命令发送失败: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub fn tmux_generate_config() -> Result<String, String> {
    crate::tmux::commands::generate_config()
}

#[tauri::command]
pub fn tmux_update_session_group_id(
    state: State<AppState>,
    display_name: String,
    group_id: Option<i64>,
) -> Result<(), String> {
    let tmux_name = crate::tmux::commands::resolve_tmux_name(&state.db, &display_name)?;
    state
        .db
        .update_tmux_session_group_id(&tmux_name, group_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tmux_has_claude_process(session_name: String) -> Result<bool, String> {
    // 检查 tmux session 中是否有 claude 相关进程
    let output = std::process::Command::new("tmux")
        .args(["list-panes", "-t", &session_name, "-F", "#{pane_pid}"])
        .output()
        .map_err(|e| format!("tmux 命令失败: {}", e))?;
    if !output.status.success() {
        return Ok(false);
    }
    let pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    for pid in pids {
        let ps_out = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output();
        if let Ok(ps) = ps_out {
            let comm = String::from_utf8_lossy(&ps.stdout).trim().to_lowercase();
            if comm.contains("claude") {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[derive(Debug, Serialize)]
pub struct LocalFileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_time: String,
    pub permissions: String,
    pub children: Option<Vec<LocalFileNode>>,
}

#[tauri::command]
pub fn local_list_dir(path: String) -> Result<Vec<LocalFileNode>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();
        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            format!("{:o}", metadata.permissions().mode())
        };
        #[cfg(not(unix))]
        let permissions = String::new();
        nodes.push(LocalFileNode {
            name,
            path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified_time: modified,
            permissions,
            children: None,
        });
    }
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(nodes)
}

#[tauri::command]
pub fn local_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_open_file(path: String, app: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if let Some(app_name) = app {
            cmd.args(["-a", &app_name, &path]);
        } else {
            cmd.arg(&path);
        }
        cmd.spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        let _ = app;
        return Err("当前平台不支持打开文件".to_string());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct InstalledApp {
    pub name: String,
    pub bundle_id: String,
    pub path: String,
}

/// 扫描 /Applications 和 ~/Applications 获取安装的应用列表
#[tauri::command]
pub fn local_get_installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "macos")]
    {
        let mut apps = Vec::new();
        let mut seen = std::collections::HashSet::new();

        let search_paths = [
            "/Applications",
            &format!("{}/Applications", std::env::var("HOME").unwrap_or_default()),
        ];

        for base_path in &search_paths {
            let entries = match std::fs::read_dir(base_path) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let path = entry.path();
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n,
                    None => continue,
                };

                if !name.ends_with(".app") {
                    continue;
                }

                let app_name = name.trim_end_matches(".app").to_string();
                if seen.contains(&app_name) {
                    continue;
                }
                seen.insert(app_name.clone());

                // 尝试读取 bundle identifier from Info.plist
                let plist_path = path.join("Contents/Info.plist");
                let bundle_id = if plist_path.exists() {
                    let output = std::process::Command::new("defaults")
                        .args(["read", plist_path.to_str().unwrap_or(""), "CFBundleIdentifier"])
                        .output();
                    match output {
                        Ok(o) if o.status.success() => {
                            String::from_utf8_lossy(&o.stdout).trim().to_string()
                        }
                        _ => String::new(),
                    }
                } else {
                    String::new()
                };

                apps.push(InstalledApp {
                    name: app_name,
                    bundle_id,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }

        apps.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(apps)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("当前平台不支持获取应用列表".to_string())
    }
}

/// 根据文件扩展名推荐应用（结合系统扫描结果和常见映射）
#[tauri::command]
pub fn local_get_recommended_apps(extension: String) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let all_apps = local_get_installed_apps()?;
        let all_names: Vec<String> = all_apps.iter().map(|a| a.name.clone()).collect();

        let ext = extension.to_lowercase();
        let mut recommended: Vec<String> = Vec::new();

        // 常见扩展名到推荐应用的映射
        let candidates: &[&str] = match ext.as_str() {
            "js" | "ts" | "jsx" | "tsx" | "json" | "html" | "css" | "scss" | "less" | "vue" | "svelte" => {
                &["Visual Studio Code", "Cursor", "WebStorm", "Sublime Text", "Zed"]
            }
            "py" | "pyw" | "ipynb" => {
                &["PyCharm", "Visual Studio Code", "Cursor", "Sublime Text", "Zed"]
            }
            "rs" => {
                &["RustRover", "Visual Studio Code", "Cursor", "Zed"]
            }
            "go" => {
                &["GoLand", "Visual Studio Code", "Cursor", "Zed"]
            }
            "java" | "kt" | "gradle" => {
                &["IntelliJ IDEA", "Android Studio", "Visual Studio Code", "Cursor"]
            }
            "swift" => {
                &["Xcode", "Visual Studio Code", "Cursor"]
            }
            "c" | "cpp" | "h" | "hpp" | "m" | "mm" => {
                &["Xcode", "CLion", "Visual Studio Code", "Cursor"]
            }
            "rb" => {
                &["RubyMine", "Visual Studio Code", "Cursor"]
            }
            "php" => {
                &["PhpStorm", "Visual Studio Code", "Cursor"]
            }
            "md" | "markdown" | "mdx" => {
                &["Typora", "Visual Studio Code", "Cursor", "Obsidian", "Bear"]
            }
            "txt" | "log" | "conf" | "cfg" | "ini" | "env" => {
                &["TextEdit", "Visual Studio Code", "Cursor", "Sublime Text", "Zed", "BBEdit"]
            }
            "sh" | "bash" | "zsh" | "fish" => {
                &["Visual Studio Code", "Cursor", "Sublime Text", "Zed", "BBEdit"]
            }
            "sql" => {
                &["DataGrip", "TablePlus", "Sequel Ace", "Visual Studio Code", "Cursor"]
            }
            "xml" | "yaml" | "yml" | "toml" => {
                &["Visual Studio Code", "Cursor", "Sublime Text", "Zed"]
            }
            "dockerfile" => {
                &["Visual Studio Code", "Cursor", "Docker Desktop"]
            }
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "heic" => {
                &["Preview", "Pixelmator Pro", "Photoshop", "Acorn"]
            }
            "svg" => {
                &["Pixelmator Pro", "Affinity Designer", "Sketch", "Visual Studio Code"]
            }
            "pdf" => {
                &["Preview", "PDF Expert", "Skim"]
            }
            "doc" | "docx" => {
                &["Microsoft Word", "Pages"]
            }
            "xls" | "xlsx" | "csv" => {
                &["Microsoft Excel", "Numbers"]
            }
            "ppt" | "pptx" => {
                &["Microsoft PowerPoint", "Keynote"]
            }
            "mp3" | "wav" | "aac" | "flac" | "m4a" => {
                &["Music", "VOX", "Swinsian"]
            }
            "mp4" | "mov" | "avi" | "mkv" | "wmv" => {
                &["QuickTime Player", "IINA", "VLC"]
            }
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" => {
                &["The Unarchiver", "Keka", "BetterZip"]
            }
            "dmg" | "pkg" | "app" => {
                &["Installer"]
            }
            _ => &[],
        };

        // 优先返回已安装的应用
        for &candidate in candidates {
            if all_names.iter().any(|n| n == candidate) {
                recommended.push(candidate.to_string());
            }
        }

        // 如果没有找到推荐应用，返回一些通用的已安装编辑器
        if recommended.is_empty() {
            for generic in &["Visual Studio Code", "Cursor", "Sublime Text", "Zed", "TextEdit"] {
                if all_names.iter().any(|n| n == *generic) {
                    recommended.push(generic.to_string());
                }
            }
        }

        Ok(recommended)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("当前平台不支持获取推荐应用".to_string())
    }
}

#[tauri::command]
pub fn local_reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("在 Finder 中显示失败: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err("当前平台不支持在 Finder 中显示".to_string());
    }
    Ok(())
}

pub fn show_or_create_main_window(app: &AppHandle) -> Result<(), String> {
    match app.get_webview_window("main") {
        Some(window) => {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(())
        }
        None => {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("MacNest")
            .inner_size(1200.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .decorations(true)
            .resizable(true)
            .build()
            .map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

// === RDP Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateRdpConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: String,
    pub screen_width: i32,
    pub screen_height: i32,
    pub color_depth: i32,
    pub group_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRdpConnectionRequest {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: String,
    pub screen_width: i32,
    pub screen_height: i32,
    pub color_depth: i32,
    pub group_id: Option<i64>,
}

#[tauri::command]
pub fn create_rdp_connection(
    state: State<AppState>,
    req: CreateRdpConnectionRequest,
) -> Result<i64, String> {
    state
        .db
        .create_rdp_connection(
            &req.name,
            &req.host,
            req.port,
            &req.username,
            &req.password,
            &req.domain,
            req.screen_width,
            req.screen_height,
            req.color_depth,
            req.group_id,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_rdp_connections(
    state: State<AppState>,
) -> Result<Vec<crate::database::RdpConnection>, String> {
    state.db.list_rdp_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_rdp_connection(
    state: State<AppState>,
    req: UpdateRdpConnectionRequest,
) -> Result<(), String> {
    state
        .db
        .update_rdp_connection(
            req.id,
            &req.name,
            &req.host,
            req.port,
            &req.username,
            &req.password,
            &req.domain,
            req.screen_width,
            req.screen_height,
            req.color_depth,
            req.group_id,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_rdp_connection(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_rdp_connection(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rdp_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<(), String> {
    let conn = state
        .db
        .get_rdp_connection(connection_id)
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let address = format!("{}:{}", conn.host, conn.port);

        // 构建 .rdp 文件内容（最可靠的方式）
        let rdp_file_content = format!(
            "full address:s:{}\nusername:s:{}\ndomain:s:{}\ndesktopwidth:i:{}\ndesktopheight:i:{}\nsession bpp:i:{}\nscreen mode id:i:1\n",
            address,
            conn.username,
            conn.domain,
            conn.screen_width,
            conn.screen_height,
            conn.color_depth
        );

        let temp_dir = std::env::temp_dir();
        let rdp_file_path = temp_dir.join(format!("macnest_rdp_{}.rdp", conn.id));
        std::fs::write(&rdp_file_path, rdp_file_content)
            .map_err(|e| format!("写入 RDP 文件失败: {}", e))?;

        // 尝试的应用列表（按优先级）
        let app_candidates = [
            "Microsoft Remote Desktop",
            "Microsoft Remote Desktop.app",
            "Windows App",
            "Windows App.app",
        ];

        // 1. 尝试用已知应用名打开 .rdp 文件
        for app in &app_candidates {
            let result = std::process::Command::new("open")
                .args(["-a", app, rdp_file_path.to_str().unwrap_or("")])
                .output();

            match result {
                Ok(output) if output.status.success() => {
                    // 再确认一下是否真的启动了目标应用（open -a 即使应用不存在也可能返回成功）
                    // 通过检查 stderr 来判断
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if !stderr.contains("Unable") && !stderr.contains("No such file") {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        // 2. 尝试用 bundle ID 打开（App Store 版 Microsoft Remote Desktop）
        let bundle_candidates = [
            "com.microsoft.rdc.macos",
            "com.microsoft.rdc.osx",
            "com.microsoft.windowsapp",
        ];

        for bundle in &bundle_candidates {
            let result = std::process::Command::new("open")
                .args(["-b", bundle, rdp_file_path.to_str().unwrap_or("")])
                .output();

            match result {
                Ok(output) if output.status.success() => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if !stderr.contains("Unable") && !stderr.contains("No such file") {
                        return Ok(());
                    }
                }
                _ => {}
            }
        }

        // 3. 最后回退：用默认应用打开 .rdp 文件
        // 如果用户默认是 RoyalTSX，那就会打开 RoyalTSX
        std::process::Command::new("open")
            .arg(&rdp_file_path)
            .spawn()
            .map_err(|e| format!("打开 RDP 客户端失败: {}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("RDP 连接仅在 macOS 上支持".to_string())
    }
}

#[derive(Debug, Serialize)]
pub struct RdpStartSessionResponse {
    pub session_id: String,
}

#[tauri::command]
pub async fn rdp_start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<RdpStartSessionResponse, String> {
    let conn = state
        .db
        .get_rdp_connection(connection_id)
        .map_err(|e| e.to_string())?;

    let config = crate::rdp::SessionConfig {
        host: conn.host,
        port: conn.port as u16,
        username: conn.username,
        password: conn.password,
        domain: if conn.domain.is_empty() { None } else { Some(conn.domain) },
        screen_width: conn.screen_width as u16,
        screen_height: conn.screen_height as u16,
    };

    let session_id = state
        .rdp_session_manager
        .create_session(app, config, conn.name)
        .await
        .map_err(|e| format!("启动 RDP 会话失败: {}", e))?;

    Ok(RdpStartSessionResponse { session_id })
}

#[tauri::command]
pub async fn rdp_stop_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .rdp_session_manager
        .close_session(&session_id)
        .await
        .map_err(|e| format!("停止 RDP 会话失败: {}", e))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct RdpSendInputRequest {
    pub session_id: String,
    pub event_type: String,
    pub x: Option<u16>,
    pub y: Option<u16>,
    pub button: Option<u8>,
    pub scancode: Option<u16>,
}

#[tauri::command]
pub async fn rdp_send_input(
    state: State<'_, AppState>,
    req: RdpSendInputRequest,
) -> Result<(), String> {
    let event = match req.event_type.as_str() {
        "mousemove" => crate::rdp::InputEvent::MouseMove {
            x: req.x.unwrap_or(0),
            y: req.y.unwrap_or(0),
        },
        "mousedown" => crate::rdp::InputEvent::MouseDown {
            x: req.x.unwrap_or(0),
            y: req.y.unwrap_or(0),
            button: req.button.unwrap_or(0),
        },
        "mouseup" => crate::rdp::InputEvent::MouseUp {
            x: req.x.unwrap_or(0),
            y: req.y.unwrap_or(0),
            button: req.button.unwrap_or(0),
        },
        "keydown" => crate::rdp::InputEvent::KeyDown {
            scancode: req.scancode.unwrap_or(0),
        },
        "keyup" => crate::rdp::InputEvent::KeyUp {
            scancode: req.scancode.unwrap_or(0),
        },
        _ => return Err(format!("未知的输入事件类型: {}", req.event_type)),
    };

    state
        .rdp_session_manager
        .send_input(&req.session_id, event)
        .await
        .map_err(|e| format!("发送输入失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_or_create_main_window(&app)
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

// === Notification Commands ===

/// 通过 osascript 发送 macOS 系统通知（绕过 Tauri 插件，用于诊断和备选）
#[tauri::command]
pub async fn send_osascript_notification(title: String, body: String) -> Result<(), String> {
    let script = format!(r#"display notification "{}" with title "{}""#, body.replace('"', "\\\""), title.replace('"', "\\\""));
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("执行 osascript 失败: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript 错误: {}", stderr));
    }
    
    Ok(())
}

/// 获取当前应用的 Bundle Identifier（用于诊断通知权限问题）
#[tauri::command]
pub fn get_bundle_id() -> String {
    std::env::var("CFBundleIdentifier").unwrap_or_else(|_| "not-set".to_string())
}

/// 检查 macOS 通知权限状态（通过查询系统数据库）
#[tauri::command]
pub async fn check_macos_notification_permission() -> Result<bool, String> {
    // 通过 osascript 检查通知权限
    let script = r#"tell application "System Events" to return name of every application process"#;
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("执行失败: {}", e))?;
    
    if !output.status.success() {
        return Ok(false);
    }
    
    // 如果能执行 AppleScript，说明有基本的自动化权限
    // 但无法直接查询通知权限状态
    Ok(true)
}

/// 获取当前应用的可执行路径
#[tauri::command]
pub fn get_app_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

/// 检查当前应用是否在 /Applications 目录下
#[tauri::command]
pub fn is_in_applications() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(path) = exe.to_str() {
            return path.starts_with("/Applications/");
        }
    }
    false
}

/// 将当前应用重新安装到 /Applications 并重启（需要管理员权限）
#[tauri::command]
pub async fn reinstall_to_applications() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法获取当前路径: {}", e))?;
    let exe_str = exe.to_string_lossy();

    // 找到 .app 包根目录
    // 路径通常是 /xxx/MacNest.app/Contents/MacOS/MacNest
    let app_bundle = exe
        .ancestors()
        .find(|p| {
            p.extension()
                .map(|ext| ext == "app")
                .unwrap_or(false)
        })
        .ok_or("无法定位 .app 包目录")?;

    let app_bundle_str = app_bundle.to_string_lossy();
    let app_name = app_bundle
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "MacNest".to_string());

    // 用 osascript 请求管理员权限复制并重启
    let script = format!(
        r##"do shell script "rm -rf '/Applications/{}.app' && cp -R '{}' '/Applications/'" with administrator privileges
        tell application "{0}"
            if it is running then quit
            delay 1
            activate
        end tell"##,
        app_name.replace("'", "'\\''"),
        app_bundle_str.replace("'", "'\\''")
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("执行安装脚本失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("安装失败: {}", stderr));
    }

    Ok(format!("{} 已重新安装到 /Applications", app_name))
}

// === Notification Commands ===

#[derive(Debug, Deserialize)]
pub struct CreateNotificationRequest {
    pub name: String,
    pub notify_type: String,
    pub content: String,
    pub trigger_condition: String,
}

#[tauri::command]
pub fn create_notification(
    state: State<AppState>,
    req: CreateNotificationRequest,
) -> Result<i64, String> {
    state
        .db
        .create_notification(&req.name, &req.notify_type, &req.content, &req.trigger_condition)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notifications(state: State<AppState>) -> Result<Vec<database::Notification>, String> {
    state.db.list_notifications().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_notification(
    state: State<AppState>,
    req: database::Notification,
) -> Result<(), String> {
    state
        .db
        .update_notification(
            req.id,
            &req.name,
            &req.notify_type,
            &req.content,
            &req.trigger_condition,
            req.enabled,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_notification(state: State<AppState>, id: i64) -> Result<(), String> {
    state.db.delete_notification(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_notification(
    state: State<AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    state.db.toggle_notification(id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notification_logs(
    state: State<AppState>,
    notification_id: i64,
) -> Result<Vec<database::NotificationLog>, String> {
    state
        .db
        .list_notification_logs(notification_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_notification_today(
    state: State<AppState>,
    notification_id: i64,
) -> Result<(), String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    state
        .db
        .dismiss_notification_for_today(notification_id, &today)
        .map_err(|e| e.to_string())
}

// === MySQL Commands ===

#[tauri::command]
pub async fn mysql_create_connection(
    state: State<'_, AppState>,
    req: mysql::connection::CreateMysqlConnectionRequest,
) -> Result<i64, String> {
    mysql::connection::mysql_create_connection(&state.db, req).await
}

#[tauri::command]
pub fn mysql_list_connections(state: State<'_, AppState>) -> Result<Vec<mysql::connection::MysqlConnectionResponse>, String> {
    mysql::connection::mysql_list_connections(&state.db)
}

#[tauri::command]
pub async fn mysql_update_connection(
    state: State<'_, AppState>,
    req: mysql::connection::UpdateMysqlConnectionRequest,
) -> Result<(), String> {
    mysql::connection::mysql_update_connection(&state.db, req).await
}

#[tauri::command]
pub async fn mysql_delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    mysql::connection::mysql_delete_connection(&state.db, id).await
}

#[tauri::command]
pub async fn mysql_test_connection(
    req: mysql::connection::TestMysqlConnectionRequest,
) -> Result<bool, String> {
    mysql::connection::mysql_test_connection(req).await
}

#[tauri::command]
pub async fn mysql_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<bool, String> {
    mysql::connection::mysql_connect(&state.db, connection_id).await
}

#[tauri::command]
pub async fn mysql_disconnect(connection_id: i64) -> Result<(), String> {
    mysql::connection::mysql_disconnect(connection_id).await
}

#[tauri::command]
pub async fn mysql_switch_database(
    state: State<'_, AppState>,
    connection_id: i64,
    database: String,
) -> Result<(), String> {
    let conn = state
        .db
        .get_mysql_connection(connection_id)
        .map_err(|e| e.to_string())?;
    let decrypted_password = crate::security::decrypt(&conn.password)
        .map_err(|e| format!("解密失败: {}", e))?;

    mysql::switch_database(
        connection_id,
        &conn.host,
        conn.port,
        &conn.username,
        &decrypted_password,
        &database,
    )
    .await
}

#[tauri::command]
pub async fn mysql_list_databases(connection_id: i64) -> Result<Vec<mysql::schema::DatabaseInfo>, String> {
    mysql::schema::mysql_list_databases(connection_id).await
}

#[tauri::command]
pub async fn mysql_list_tables(connection_id: i64, database: String) -> Result<Vec<mysql::schema::TableInfo>, String> {
    mysql::schema::mysql_list_tables(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_views(connection_id: i64, database: String) -> Result<Vec<mysql::schema::ViewInfo>, String> {
    mysql::schema::mysql_list_views(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_triggers(connection_id: i64, database: String) -> Result<Vec<mysql::schema::TriggerInfo>, String> {
    mysql::schema::mysql_list_triggers(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_functions(connection_id: i64, database: String) -> Result<Vec<mysql::schema::FunctionInfo>, String> {
    mysql::schema::mysql_list_functions(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_list_events(connection_id: i64, database: String) -> Result<Vec<mysql::schema::EventInfo>, String> {
    mysql::schema::mysql_list_events(connection_id, database).await
}

#[tauri::command]
pub async fn mysql_get_table_structure(
    connection_id: i64,
    database: String,
    table: String,
) -> Result<mysql::schema::TableStructure, String> {
    mysql::schema::mysql_get_table_structure(connection_id, database, table).await
}

#[tauri::command]
pub async fn mysql_execute_query(
    req: mysql::query::ExecuteQueryRequest,
) -> Result<mysql::query::QueryResult, String> {
    mysql::query::mysql_execute_query(req).await
}

#[tauri::command]
pub async fn mysql_load_table_data_paged(
    req: mysql::query::LoadTableDataRequest,
) -> Result<mysql::query::LoadTableDataResponse, String> {
    mysql::query::mysql_load_table_data_paged(req).await
}

#[tauri::command]
pub fn mysql_create_backup_task(
    state: State<'_, AppState>,
    req: mysql::backup::CreateBackupTaskRequest,
) -> Result<i64, String> {
    mysql::backup::mysql_create_backup_task(&state.db, req)
}

#[tauri::command]
pub fn mysql_list_backup_tasks(state: State<'_, AppState>) -> Result<Vec<mysql::backup::BackupTaskResponse>, String> {
    mysql::backup::mysql_list_backup_tasks(&state.db)
}

#[tauri::command]
pub fn mysql_delete_backup_task(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    mysql::backup::mysql_delete_backup_task(&state.db, id)
}

#[tauri::command]
pub fn mysql_toggle_backup_task(state: State<'_, AppState>, id: i64, is_enabled: bool) -> Result<(), String> {
    mysql::backup::mysql_toggle_backup_task(&state.db, id, is_enabled)
}

#[tauri::command]
pub async fn mysql_run_backup_now(state: State<'_, AppState>, task_id: i64) -> Result<String, String> {
    mysql::backup::mysql_run_backup_now(&state.db, task_id).await
}

#[tauri::command]
pub async fn mysql_dump_table(
    state: State<'_, AppState>,
    connection_id: i64,
    database_name: String,
    table_name: String,
    dump_type: String, // "structure_and_data" | "structure_only"
) -> Result<String, String> {
    let conn = state
        .db
        .get_mysql_connection(connection_id)
        .map_err(|e| e.to_string())?;
    let decrypted_password = crate::security::decrypt(&conn.password)
        .map_err(|e| format!("解密失败: {}", e))?;

    // Build output path
    let app_dir = std::env::temp_dir();
    let dump_dir = app_dir.join("macnest_mysql_dumps");
    std::fs::create_dir_all(&dump_dir).map_err(|e| e.to_string())?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}_{}_{}.sql", database_name, table_name, timestamp);
    let output_path = dump_dir.join(&filename);
    let output_path_str = output_path.to_str().ok_or("Invalid output path")?;

    // Build mysqldump args
    let mut args = vec![
        "-h".to_string(),
        conn.host.clone(),
        "-P".to_string(),
        conn.port.to_string(),
        "-u".to_string(),
        conn.username.clone(),
        format!("-p{}", decrypted_password),
        database_name,
        table_name,
    ];

    if dump_type == "structure_only" {
        args.push("--no-data".to_string());
    }

    let output = std::process::Command::new("mysqldump")
        .args(&args)
        .output()
        .map_err(|e| format!("运行 mysqldump 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("mysqldump 失败: {}", stderr));
    }

    std::fs::write(&output_path, &output.stdout).map_err(|e| e.to_string())?;

    Ok(output_path_str.to_string())
}
