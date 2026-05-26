use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// 单条日志
#[derive(Clone, Debug, serde::Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub content: String,
}

/// 内存日志缓冲区：程序关闭即消失
pub struct ProcessManager {
    running_processes: Mutex<HashMap<i64, u32>>, // service_id -> child_pid
    logs: Arc<Mutex<HashMap<i64, VecDeque<LogEntry>>>>,
}

const MAX_LOG_ENTRIES: usize = 5000;

/// 根据内容推断日志级别（很多程序把 INFO 也输出到 stderr）
fn infer_level(content: &str) -> &'static str {
    let lower = content.to_lowercase();
    if lower.contains("error") || lower.contains("fatal") || lower.contains("panic") || lower.contains("exception") {
        "error"
    } else if lower.contains("warn") {
        "warn"
    } else {
        "info"
    }
}

/// Check if a process with the given PID is currently alive (kill -0)
fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Collect all PIDs in a process tree starting from `pid` (parent → children recursively)
/// Uses `ps` instead of `pgrep` because `pgrep -P` is not reliably available on macOS.
pub fn collect_pids(pid: u32) -> Vec<u32> {
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

impl ProcessManager {
    pub fn new() -> Self {
        ProcessManager {
            running_processes: Mutex::new(HashMap::new()),
            logs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Try to recover a running service after app restart.
    /// Returns true if the PID is alive and has been re-registered.
    pub fn recover_service(&self, service_id: i64, pid: u32) -> bool {
        if !is_process_alive(pid) {
            return false;
        }
        let mut processes = self.running_processes.lock().unwrap();
        processes.insert(service_id, pid);
        true
    }

    fn append_log(&self, service_id: i64, level: &str, content: &str) {
        if let Ok(mut logs_map) = self.logs.lock() {
            let entry = logs_map
                .entry(service_id)
                .or_insert_with(VecDeque::new);
            entry.push_back(LogEntry {
                timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                level: level.to_string(),
                content: content.to_string(),
            });
            while entry.len() > MAX_LOG_ENTRIES {
                entry.pop_front();
            }
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
        let logs = self.logs.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let log = String::from_utf8_lossy(&line).to_string();
                        let event_name = format!("service:log:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, log.clone());
                        if let Ok(mut logs_map) = logs.lock() {
                            let entry = logs_map.entry(service_id_clone).or_insert_with(VecDeque::new);
                            entry.push_back(LogEntry {
                                timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                                level: "info".to_string(),
                                content: log,
                            });
                            while entry.len() > MAX_LOG_ENTRIES {
                                entry.pop_front();
                            }
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let log = String::from_utf8_lossy(&line).to_string();
                        let level = infer_level(&log);
                        let event_name = format!("service:err:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, log.clone());
                        if let Ok(mut logs_map) = logs.lock() {
                            let entry = logs_map.entry(service_id_clone).or_insert_with(VecDeque::new);
                            entry.push_back(LogEntry {
                                timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                                level: level.to_string(),
                                content: log,
                            });
                            while entry.len() > MAX_LOG_ENTRIES {
                                entry.pop_front();
                            }
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        let event_name = format!("service:exit:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, payload.code.unwrap_or(-1));
                        let exit_msg = format!("Process exited with code {}", payload.code.unwrap_or(-1));
                        if let Ok(mut logs_map) = logs.lock() {
                            let entry = logs_map.entry(service_id_clone).or_insert_with(VecDeque::new);
                            entry.push_back(LogEntry {
                                timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                                level: "warn".to_string(),
                                content: exit_msg,
                            });
                            while entry.len() > MAX_LOG_ENTRIES {
                                entry.pop_front();
                            }
                        }
                    }
                    CommandEvent::Error(err) => {
                        let event_name = format!("service:err:{}", service_id_clone);
                        let _ = app_clone.emit(&event_name, err.to_string());
                        if let Ok(mut logs_map) = logs.lock() {
                            let entry = logs_map.entry(service_id_clone).or_insert_with(VecDeque::new);
                            entry.push_back(LogEntry {
                                timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                                level: "error".to_string(),
                                content: err.to_string(),
                            });
                            while entry.len() > MAX_LOG_ENTRIES {
                                entry.pop_front();
                            }
                        }
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
            self.stop_service_by_pid(service_id, pid)?;
        }

        Ok(())
    }

    /// Stop a service by a specific PID and clean up the in-memory tracker.
    /// Kills the entire process tree (parent + all descendants).
    pub fn stop_service_by_pid(&self, service_id: i64, pid: u32) -> Result<(), String> {
        // Collect the entire process tree rooted at this PID
        let pids = collect_pids(pid);
        eprintln!("[macnest] Stopping service {} — killing PID tree: {:?}", service_id, pids);

        // Phase 1: graceful termination (SIGTERM) for all processes
        for &p in &pids {
            let _ = std::process::Command::new("kill")
                .args([&p.to_string()])
                .output();
        }

        // Give them a moment to terminate gracefully
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Phase 2: force kill (SIGKILL) any survivors
        for &p in &pids {
            if is_process_alive(p) {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &p.to_string()])
                    .output();
            }
        }

        let mut processes = self
            .running_processes
            .lock()
            .map_err(|e| e.to_string())?;
        processes.remove(&service_id);

        // 清除该服务的内存日志
        if let Ok(mut logs_map) = self.logs.lock() {
            logs_map.remove(&service_id);
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

    /// 从内存缓冲区获取日志（最多 5000 条）
    pub fn get_logs(&self, service_id: i64) -> Vec<LogEntry> {
        if let Ok(logs_map) = self.logs.lock() {
            logs_map
                .get(&service_id)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .collect()
        } else {
            Vec::new()
        }
    }

    /// 清除某服务的内存日志
    pub fn clear_logs(&self, service_id: i64) {
        if let Ok(mut logs_map) = self.logs.lock() {
            logs_map.remove(&service_id);
        }
    }
}
