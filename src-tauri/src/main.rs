#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod docker;
mod process;
mod system;
mod ssh;
mod tmux;

use database::Database;
use process::ProcessManager;
use ssh::session::SshSessionManager;
use ssh::types::TransferProgress;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

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
                                    eprintln!("[macops] Recovered service '{}' (id={}, pid={})", svc.name, svc.id, pid);
                                } else {
                                    eprintln!("[macops] Stale service '{}' (id={}, pid={}) — process no longer alive, marking stopped", svc.name, svc.id, pid);
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
            // Tmux 命令
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let _tray = TrayIconBuilder::new()
        .tooltip("MacOps")
        .menu(&menu)
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
        .build(app)?;

    Ok(())
}
