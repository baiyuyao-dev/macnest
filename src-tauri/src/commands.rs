use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::database;
use crate::docker;
use crate::ssh::types::SshAuthType;
use crate::system;
use crate::AppState;

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
        let mem_percent = parts[1].parse::<f64>().ok()?;
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
    for attempt in 0..8 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(800));
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
pub fn stop_service(state: State<AppState>, id: i64) -> Result<(), String> {
    state
        .process_manager
        .lock()
        .map_err(|e| e.to_string())?
        .stop_service(id)?;
    state
        .db
        .update_service_status(id, "stopped", None, "")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn restart_service(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<u32, String> {
    let service = state.db.get_service(id).map_err(|e| e.to_string())?;

    // Stop the service if running
    {
        let pm = state
            .process_manager
            .lock()
            .map_err(|e| e.to_string())?;
        let _ = pm.stop_service(id);
    }

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
    for attempt in 0..8 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(800));
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

/// Collect all PIDs in a process tree starting from `pid` (parent → children recursively)
/// Uses `ps` instead of `pgrep` because `pgrep -P` is not reliably available on macOS.
fn collect_pids(pid: u32) -> Vec<u32> {
    let mut pids = vec![pid];
    let mut changed = true;

    while changed {
        changed = false;
        let output = std::process::Command::new("ps")
            .args(["-ax", "-o", "pid=", "-o", "ppid="])
            .output();

        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let snapshot = pids.clone();
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() == 2 {
                    if let (Ok(child_pid), Ok(ppid)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                        if snapshot.contains(&ppid) && !pids.contains(&child_pid) {
                            pids.push(child_pid);
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    pids
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
    let all_pids = collect_pids(pid);
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
    pub group_name: String,
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
            &req.group_name,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_ssh_connections(
    state: State<AppState>,
) -> Result<Vec<database::SshConnection>, String> {
    state.db.list_ssh_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_ssh_connection(
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    state.db.delete_ssh_connection(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    connection_id: i64,
) -> Result<String, String> {
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
        group_name: db_connection.group_name,
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

    Ok(format!("ws://127.0.0.1:{}", websocket_port))
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
