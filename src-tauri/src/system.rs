use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    pub os_version: String,
    pub cpu_model: String,
    pub cpu_cores: i32,
    pub memory_total_mb: u64,
    pub uptime_seconds: u64,
}

pub fn get_system_info() -> Result<SystemInfo, String> {
    let hostname = Command::new("hostname")
        .output()
        .map_err(|e| e.to_string())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;

    let os_version = Command::new("sw_vers")
        .args(["-productVersion"])
        .output()
        .map_err(|e| e.to_string())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;

    let cpu_info = Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .map_err(|e| e.to_string())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())?;

    let cpu_cores = Command::new("sysctl")
        .args(["-n", "hw.ncpu"])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<i32>()
                .map_err(|e| e.to_string())
        })?;

    let mem_bytes = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u64>()
                .map_err(|e| e.to_string())
        })?;

    let uptime_output = Command::new("sysctl")
        .args(["-n", "kern.boottime"])
        .output()
        .map_err(|e| e.to_string())?;
    let uptime_str = String::from_utf8_lossy(&uptime_output.stdout);
    // Parse boot time to calculate uptime
    let uptime_seconds = parse_uptime(&uptime_str);

    Ok(SystemInfo {
        hostname,
        os_version: format!("macOS {}", os_version),
        cpu_model: cpu_info,
        cpu_cores,
        memory_total_mb: mem_bytes / 1024 / 1024,
        uptime_seconds,
    })
}

fn parse_uptime(uptime_str: &str) -> u64 {
    // Parse output like "{ sec = 1704067200, usec = 0 }"
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Some(sec_part) = uptime_str.split("sec = ").nth(1) {
        if let Some(sec_str) = sec_part.split(",").next() {
            if let Ok(boot_time) = sec_str.trim().parse::<u64>() {
                return now.saturating_sub(boot_time);
            }
        }
    }
    0
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub disk_percent: f64,
    pub network_rx_kb: u64,
    pub network_tx_kb: u64,
}

pub fn get_resource_usage() -> Result<ResourceUsage, String> {
    // CPU usage via top command
    let cpu_output = Command::new("sh")
        .args([
            "-c",
            "top -l 1 -n 0 | grep 'CPU usage' | head -1",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let cpu_str = String::from_utf8_lossy(&cpu_output.stdout);
    let cpu_percent = parse_cpu_usage(&cpu_str);

    // Memory via vm_stat
    let mem_output = Command::new("vm_stat")
        .output()
        .map_err(|e| e.to_string())?;
    let mem_str = String::from_utf8_lossy(&mem_output.stdout);
    let (memory_used_mb, memory_total_mb, memory_percent) = parse_memory(&mem_str)?;

    Ok(ResourceUsage {
        cpu_percent,
        memory_percent,
        memory_used_mb,
        memory_total_mb,
        disk_percent: 0.0,
        network_rx_kb: 0,
        network_tx_kb: 0,
    })
}

fn parse_cpu_usage(cpu_str: &str) -> f64 {
    // Parse "CPU usage: 10.5% user, 15.3% sys, 74.2% idle"
    if let Some(idle_part) = cpu_str.split("idle").next() {
        // Get the last percentage before idle
        let parts: Vec<&str> = idle_part.split(',').collect();
        if let Some(last) = parts.last() {
            if let Some(percent_str) = last.trim().split('%').next() {
                if let Ok(percent) = percent_str.parse::<f64>() {
                    // This is user + sys, so cpu = 100 - idle
                    return 100.0 - percent;
                }
            }
        }
    }
    0.0
}

fn parse_memory(mem_str: &str) -> Result<(u64, u64, f64), String> {
    let page_size = 4096u64;
    let mut pages_free = 0u64;
    let mut pages_active = 0u64;
    let mut pages_inactive = 0u64;
    let mut pages_wired = 0u64;
    let mut pages_compressed = 0u64;

    for line in mem_str.lines() {
        if line.contains("Pages free:") {
            pages_free = line
                .split(":")
                .nth(1)
                .and_then(|s| {
                    s.trim()
                        .trim_end_matches(".")
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
        } else if line.contains("Pages active:") {
            pages_active = line
                .split(":")
                .nth(1)
                .and_then(|s| {
                    s.trim()
                        .trim_end_matches(".")
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
        } else if line.contains("Pages inactive:") {
            pages_inactive = line
                .split(":")
                .nth(1)
                .and_then(|s| {
                    s.trim()
                        .trim_end_matches(".")
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
        } else if line.contains("Pages wired down:") {
            pages_wired = line
                .split(":")
                .nth(1)
                .and_then(|s| {
                    s.trim()
                        .trim_end_matches(".")
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
        } else if line.contains("Pages occupied by compressor:") {
            pages_compressed = line
                .split(":")
                .nth(1)
                .and_then(|s| {
                    s.trim()
                        .trim_end_matches(".")
                        .parse::<u64>()
                        .ok()
                })
                .unwrap_or(0);
        }
    }

    let memory_total_mb = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u64>()
                .map_err(|e| e.to_string())
        })? / 1024 / 1024;

    let memory_used_mb =
        ((pages_active + pages_inactive + pages_wired + pages_compressed) * page_size) / 1024
            / 1024;
    let memory_percent = if memory_total_mb > 0 {
        (memory_used_mb as f64 / memory_total_mb as f64) * 100.0
    } else {
        0.0
    };

    Ok((memory_used_mb, memory_total_mb, memory_percent))
}

fn parse_disk_usage(disk_str: &str) -> f64 {
    disk_str
        .lines()
        .nth(1)
        .and_then(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts.get(4).map(|s| {
                s.trim_end_matches('%')
                    .parse::<f64>()
                    .unwrap_or(0.0)
            })
        })
        .unwrap_or(0.0)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: i32,
    pub name: String,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub status: String,
    pub command: String,
}

pub fn get_processes() -> Result<Vec<ProcessInfo>, String> {
    let output = Command::new("ps")
        .args(["-axro", "pid,pcpu,pmem,state,comm,command"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut processes = Vec::new();

    for (i, line) in stdout.lines().enumerate() {
        if i == 0 {
            continue;
        } // skip header
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 6 {
            let pid = parts[0].parse::<i32>().unwrap_or(0);
            let cpu = parts[1].parse::<f64>().unwrap_or(0.0);
            let mem = parts[2].parse::<f64>().unwrap_or(0.0);
            let status = parts[3].to_string();
            let name = parts[4].to_string();
            let cmd = parts[5..].join(" ");

            // Filter out kernel processes and low-memory processes
            if mem > 0.1 && !name.starts_with('[') {
                processes.push(ProcessInfo {
                    pid,
                    name,
                    cpu_percent: cpu,
                    memory_mb: mem,
                    status,
                    command: cmd,
                });
            }
        }
    }

    // Sort by memory usage descending
    processes.sort_by(|a, b| b.memory_mb.partial_cmp(&a.memory_mb).unwrap());
    processes.truncate(30);
    Ok(processes)
}

pub fn get_network_io() -> Result<(u64, u64), String> {
    // Get network stats using netstat or ifconfig
    // Returns (rx_kb, tx_kb) since boot
    let output = Command::new("netstat")
        .args(["-ib"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 && parts[0] != "Name" {
            if let Ok(rx) = parts[6].parse::<u64>() {
                total_rx += rx / 1024;
            }
            if let Ok(tx) = parts[9].parse::<u64>() {
                total_tx += tx / 1024;
            }
        }
    }

    Ok((total_rx, total_tx))
}
