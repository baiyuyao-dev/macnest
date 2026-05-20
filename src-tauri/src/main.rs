#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod docker;
mod error;
mod process;
mod security;
mod system;
mod ssh;
mod tmux;

use database::Database;
use process::ProcessManager;
use ssh::session::SshSessionManager;
use ssh::types::TransferProgress;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Listener, Manager};

pub struct AppState {
    db: Database,
    process_manager: Mutex<ProcessManager>,
    ssh_session_manager: SshSessionManager,
    pub transfer_progress: Arc<Mutex<HashMap<String, TransferProgress>>>,
    pub tmux_pty_sessions: Mutex<HashMap<String, crate::tmux::pty::TmuxPtySession>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle();
            let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
            let db_path = app_dir.join("macops.db");

            let db_path_str = db_path.to_str().ok_or("Invalid database path")?;
            let db = Database::new(db_path_str).map_err(|e| e.to_string())?;
            db.init().map_err(|e| e.to_string())?;

            let process_manager = Mutex::new(ProcessManager::new());

            // Recover running services after app restart
            if let Ok(services) = db.list_services() {
                for svc in services {
                    if svc.status == "running" {
                        if let Some(pid) = svc.pid {
                            if let Ok(pm) = process_manager.lock() {
                                if pm.recover_service(svc.id, pid as u32) {
                                    eprintln!("[macnest] Recovered service '{}' (id={}, pid={})", svc.name, svc.id, pid);
                                } else {
                                    eprintln!("[macnest] Stale service '{}' (id={}, pid={}) — process no longer alive, marking stopped", svc.name, svc.id, pid);
                                    let _ = db.update_service_status(svc.id, "stopped", None, "");
                                }
                            }
                        }
                    }
                }
            }

            let state = AppState {
                db,
                process_manager,
                ssh_session_manager: SshSessionManager::new(),
                transfer_progress: Arc::new(Mutex::new(HashMap::new())),
                tmux_pty_sessions: Mutex::new(HashMap::new()),
            };
            app.manage(state);

            // Listen for tray navigation events
            let app_handle = app.handle().clone();
            app.listen("tray-navigate", move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    if let Some(path) = payload.get("path").and_then(|v| v.as_str()) {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("navigate-to", path);
                        }
                    }
                }
            });

            // Create tray popup window (hidden by default)
            let _popup = tauri::WebviewWindowBuilder::new(
                app,
                "tray-popup",
                tauri::WebviewUrl::App("tray-popup.html".into()),
            )
            .title("MacNest")
            .inner_size(260.0, 340.0)
            .visible(false)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()?;

            // Setup tray icon
            setup_tray(app)?;

            // Show main window after setup
            let window = app.get_webview_window("main").unwrap();
            let _ = window.show();
            let _ = window.set_focus();
            #[cfg(debug_assertions)]
            let _ = window.open_devtools();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Service management commands
            commands::create_service,
            commands::update_service,
            commands::delete_service,
            commands::list_services,
            commands::start_service,
            commands::stop_service,
            commands::restart_service,
            commands::get_service_logs,
            commands::get_service_ports,
            // Docker commands
            commands::list_containers,
            commands::start_container,
            commands::stop_container,
            commands::restart_container,
            commands::remove_container,
            commands::get_container_logs,
            commands::get_container_stats,
            // Bookmark commands
            commands::create_bookmark,
            commands::update_bookmark,
            commands::delete_bookmark,
            commands::list_bookmarks,
            // Group commands
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            // System monitoring commands
            commands::get_system_info,
            commands::get_resource_usage,
            commands::get_processes,
            // Settings commands
            commands::get_settings,
            commands::update_settings,
            // SSH commands
            commands::create_ssh_connection,
            commands::list_ssh_connections,
            commands::update_ssh_connection,
            commands::delete_ssh_connection,
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_active_sessions_count,
            // SFTP commands
            commands::sftp_list_dir,
            commands::sftp_delete,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_get_file_info,
            commands::sftp_upload,
            commands::sftp_download,
            commands::sftp_get_progress,
            commands::sftp_cancel_transfer,
            commands::sftp_clear_completed,
            // Tmux commands
            commands::tmux_list_sessions,
            commands::tmux_create_session,
            commands::tmux_kill_session,
            commands::tmux_rename_session,
            commands::tmux_is_available,
            commands::tmux_attach_pty,
            commands::tmux_pty_write,
            commands::tmux_pty_resize,
            commands::tmux_pty_close,
            commands::tmux_open_in_ghostty,
            commands::tmux_generate_config,
            // App commands
            commands::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static LAST_CLICK_MS: AtomicU64 = AtomicU64::new(0);

    let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    let _tray = TrayIconBuilder::new()
        .tooltip("MacNest")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { id: _, position, rect: _, .. } = event {
                // 防抖：忽略 300ms 内的重复点击（macOS mouseDown + mouseUp 各触发一次）
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                let last = LAST_CLICK_MS.load(Ordering::Relaxed);
                if now.saturating_sub(last) < 300 {
                    return;
                }
                LAST_CLICK_MS.store(now, Ordering::Relaxed);

                let app = tray.app_handle();
                match app.get_webview_window("tray-popup") {
                    Some(popup) => {
                        let is_visible = popup.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = popup.hide();
                        } else {
                            // 让 popup 显示在 tray icon 正下方
                            let x = position.x;
                            let y = position.y + 10.0;
                            let _ = popup.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                            let _ = popup.show();
                            let _ = popup.set_focus();
                        }
                    }
                    None => {
                        eprintln!("[macnest] ERROR: tray-popup window not found!");
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
