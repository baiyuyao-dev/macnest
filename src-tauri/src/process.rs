use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct ProcessManager {
    running_processes: Mutex<HashMap<i64, u32>>, // service_id -> child_pid
}

impl ProcessManager {
    pub fn new() -> Self {
        ProcessManager {
            running_processes: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_service(
        &self,
        app: &AppHandle,
        service_id: i64,
        command: &str,
        cwd: &str,
        _env_vars: &str,
    ) -> Result<u32, String> {
        // Use tauri-plugin-shell to spawn the process
        let shell_command = app.shell().command("sh");
        let mut shell_command = shell_command.args(["-c", command]);

        if !cwd.is_empty() {
            shell_command = shell_command.current_dir(cwd);
        }

        let (mut rx, child) = shell_command.spawn().map_err(|e| e.to_string())?;

        let pid = child.pid();
        {
            let mut processes = self.running_processes.lock().map_err(|e| e.to_string())?;
            processes.insert(service_id, pid);
        }

        // Spawn a background task to listen for process output
        let app_clone: AppHandle = app.clone();
        let service_id_clone = service_id;
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let log = String::from_utf8_lossy(&line).to_string();
                        let event_name = format!("service:log:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, log);
                    }
                    CommandEvent::Stderr(line) => {
                        let log = String::from_utf8_lossy(&line).to_string();
                        let event_name = format!("service:err:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, log);
                    }
                    CommandEvent::Terminated(payload) => {
                        let event_name = format!("service:exit:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, payload.code.unwrap_or(-1));
                    }
                    CommandEvent::Error(err) => {
                        let event_name = format!("service:err:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, err.to_string());
                    }
                    _ => {}
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_service(&self, service_id: i64) -> Result<(), String> {
        let pid = {
            let processes = self
                .running_processes
                .lock()
                .map_err(|e| e.to_string())?;
            processes.get(&service_id).copied()
        };

        if let Some(pid) = pid {
            // Try graceful kill first (SIGTERM), then force kill (SIGKILL)
            let _ = std::process::Command::new("kill")
                .args([&pid.to_string()])
                .output();

            // Give it a moment to terminate gracefully
            std::thread::sleep(std::time::Duration::from_millis(500));

            // Force kill if still running
            let check = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output();

            if check.is_ok() && check.unwrap().status.success() {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }

            let mut processes = self
                .running_processes
                .lock()
                .map_err(|e| e.to_string())?;
            processes.remove(&service_id);
        }

        Ok(())
    }

    pub fn get_pid(&self, service_id: i64) -> Option<u32> {
        let processes = self.running_processes.lock().ok()?;
        processes.get(&service_id).copied()
    }

    pub fn is_running(&self, service_id: i64) -> bool {
        let processes = self.running_processes.lock();
        match processes {
            Ok(p) => p.contains_key(&service_id),
            Err(_) => false,
        }
    }
}
