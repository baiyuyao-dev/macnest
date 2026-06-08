#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod docker;
mod docker_terminal;
mod error;
mod notification_scheduler;
mod process;
mod rdp;
mod safari_bookmarks;
mod security;
mod system;
mod mysql;
mod ssh;
mod tmux;

use database::Database;
use docker_terminal::DockerTerminalManager;
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
    docker_terminal_manager: DockerTerminalManager,
    pub rdp_session_manager: rdp::RdpSessionManager,
    pub transfer_progress: Arc<Mutex<HashMap<String, TransferProgress>>>,
    pub tmux_pty_sessions: Mutex<HashMap<String, crate::tmux::pty::TmuxPtySession>>,
    pub sftp_managers: Arc<tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<crate::ssh::sftp::SftpManager>>>>>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle();
            let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
            let db_path = app_dir.join("MacNest.db");

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
                docker_terminal_manager: DockerTerminalManager::new(),
                rdp_session_manager: rdp::RdpSessionManager::new(),
                transfer_progress: Arc::new(Mutex::new(HashMap::new())),
                tmux_pty_sessions: Mutex::new(HashMap::new()),
                sftp_managers: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            };
            app.manage(state);

            // Start background Safari bookmark auto-sync thread
            let db_path_for_sync = db_path_str.to_string();
            let app_handle_for_sync = app_handle.clone();
            std::thread::spawn(move || {
                let db = match Database::new(&db_path_for_sync) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[macnest] Auto-sync thread: failed to open DB: {}", e);
                        return;
                    }
                };
                let mut last_sync: Option<std::time::Instant> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    if let Ok(settings) = db.get_settings() {
                        let interval = settings.auto_sync_bookmarks_interval;
                        if interval <= 0 {
                            continue;
                        }
                        let should_sync = match last_sync {
                            None => true,
                            Some(t) => t.elapsed().as_secs() >= (interval as u64 * 60),
                        };
                        if should_sync {
                            match crate::safari_bookmarks::import_safari_bookmarks(&db) {
                                Ok(result) => {
                                    eprintln!(
                                        "[macnest] Auto-synced Safari bookmarks: {} bookmarks, {} groups",
                                        result.bookmarks_imported, result.groups_imported
                                    );
                                    last_sync = Some(std::time::Instant::now());
                                    // Notify frontend to refresh bookmarks
                                    let _ = app_handle_for_sync.emit("safari-bookmarks-synced", result);
                                }
                                Err(e) => {
                                    eprintln!("[macnest] Auto-sync Safari bookmarks failed: {}", e);
                                    let _ = app_handle_for_sync.emit("safari-bookmarks-sync-failed", e);
                                }
                            }
                        }
                    }
                }
            });

            // Start notification scheduler
            let db_path_for_scheduler = db_path_str.to_string();
            let app_handle_for_scheduler = app_handle.clone();
            notification_scheduler::start_scheduler(db_path_for_scheduler, app_handle_for_scheduler);

            // Create tray popup window (hidden by default)
            let _popup = tauri::WebviewWindowBuilder::new(
                app,
                "tray-popup",
                tauri::WebviewUrl::App("tray-popup.html".into()),
            )
            .title("MacNest")
            .inner_size(260.0, 430.0)
            .visible(false)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()?;

            // Setup tray icon
            setup_tray(app)?;

            // Show main window after setup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                #[cfg(debug_assertions)]
                let _ = window.open_devtools();
            } else {
                eprintln!("[macnest] Warning: main window not found during setup");
            }

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
            commands::recreate_container,
            commands::update_container_ports,
            // Docker image commands
            commands::list_images,
            commands::remove_image,
            commands::prune_images,
            // Docker inspect command
            commands::inspect_container,
            // Docker system overview
            commands::docker_system_df,
            // Docker volume commands
            commands::list_volumes,
            commands::remove_volume,
            commands::prune_volumes,
            // Docker network commands
            commands::list_networks,
            commands::remove_network,
            // Docker pull / create
            commands::pull_image,
            commands::create_container,
            // Docker terminal commands
            commands::docker_detect_shells,
            commands::docker_terminal_connect,
            commands::docker_terminal_disconnect,
            // Bookmark commands
            commands::create_bookmark,
            commands::update_bookmark,
            commands::delete_bookmark,
            commands::list_bookmarks,
            commands::import_safari_bookmarks,
            // Group commands
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            // System monitoring commands
            commands::get_system_info,
            commands::get_resource_usage,
            commands::get_processes,
            commands::get_cpu_detailed_usage,
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
            commands::get_ssh_system_info,
            commands::install_ssh_shell_integration,
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
            commands::sftp_read_file,
            commands::sftp_write_file,
            // Tmux commands
            commands::tmux_list_sessions,
            commands::tmux_create_session,
            commands::tmux_kill_session,
            commands::tmux_rename_session,
            commands::tmux_update_session_start_directory,
            commands::tmux_update_session_group_id,
            commands::tmux_is_available,
            commands::tmux_attach_pty,
            commands::tmux_pty_write,
            commands::tmux_pty_resize,
            commands::tmux_pty_close,
            commands::tmux_open_in_ghostty,
            commands::tmux_generate_config,
            commands::tmux_has_claude_process,
            // App commands
            commands::show_main_window,
            commands::exit_app,
            // Local file commands
            commands::local_list_dir,
            commands::local_read_file,
            commands::local_write_file,
            commands::local_open_file,
            commands::local_reveal_in_finder,
            commands::local_get_installed_apps,
            commands::local_get_recommended_apps,
            // RDP commands
            commands::create_rdp_connection,
            commands::list_rdp_connections,
            commands::update_rdp_connection,
            commands::delete_rdp_connection,
            commands::rdp_connect,
            commands::rdp_start_session,
            commands::rdp_stop_session,
            commands::rdp_send_input,
            // Notification commands (osascript fallback)
            commands::send_osascript_notification,
            commands::check_macos_notification_permission,
            commands::get_bundle_id,
            commands::get_app_path,
            commands::is_in_applications,
            commands::reinstall_to_applications,
            // Notification management commands
            commands::create_notification,
            commands::list_notifications,
            commands::update_notification,
            commands::delete_notification,
            commands::toggle_notification,
            commands::list_notification_logs,
            // MySQL commands
            commands::mysql_create_connection,
            commands::mysql_list_connections,
            commands::mysql_update_connection,
            commands::mysql_delete_connection,
            commands::mysql_test_connection,
            commands::mysql_connect,
            commands::mysql_disconnect,
            commands::mysql_switch_database,
            commands::mysql_list_databases,
            commands::mysql_list_tables,
            commands::mysql_list_views,
            commands::mysql_list_triggers,
            commands::mysql_list_functions,
            commands::mysql_list_events,
            commands::mysql_get_table_structure,
            commands::mysql_execute_query,
            commands::mysql_create_backup_task,
            commands::mysql_list_backup_tasks,
            commands::mysql_delete_backup_task,
            commands::mysql_toggle_backup_task,
            commands::mysql_run_backup_now,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "tray-popup" {
                    if let tauri::WindowEvent::Focused(false) = event {
                        if let Some(popup) = app_handle.get_webview_window("tray-popup") {
                            let _ = popup.hide();
                        }
                    }
                }
            }
            tauri::RunEvent::Reopen { .. } => {
                if let Err(e) = commands::show_or_create_main_window(&app_handle) {
                    eprintln!("[macnest] Failed to show main window on reopen: {}", e);
                }
            }
            _ => {}
        }
    });
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
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Err(e) = commands::show_or_create_main_window(app) {
                    eprintln!("[macnest] Failed to show main window from tray menu: {}", e);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let is_valid_click = matches!(
                event,
                TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClick { .. }
            );
            if !is_valid_click {
                return;
            }

            // 获取点击位置
            let position = match &event {
                TrayIconEvent::Click { position, .. } => *position,
                TrayIconEvent::DoubleClick { position, .. } => *position,
                _ => return,
            };

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
        })
        .build(app)?;

    Ok(())
}
