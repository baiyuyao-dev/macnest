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
    pub local_ip: String,
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

    let local_ip = get_local_ip();

    Ok(SystemInfo {
        hostname,
        os_version: format!("macOS {}", os_version),
        cpu_model: cpu_info,
        cpu_cores,
        memory_total_mb: mem_bytes / 1024 / 1024,
        uptime_seconds,
        local_ip,
    })
}

fn get_local_ip() -> String {
    // Try common macOS interfaces
    for iface in &["en0", "en1", "en2", "en3"] {
        if let Ok(output) = Command::new("ipconfig").args(["getifaddr", iface]).output() {
            let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ip.is_empty() {
                return ip;
            }
        }
    }
    // Fallback: parse ifconfig
    if let Ok(output) = Command::new("sh")
        .args([
            "-c",
            "ifconfig | grep 'inet ' | grep -v 127.0.0.1 | head -1 | awk '{print $2}'",
        ])
        .output()
    {
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !ip.is_empty() {
            return ip;
        }
    }
    "Unknown".to_string()
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

    // Memory via vm_stat (more accurate than top on macOS)
    let (memory_used_mb, memory_total_mb, memory_percent) = get_memory_usage()?;

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

fn get_memory_usage() -> Result<(u64, u64, f64), String> {
    // Total physical memory
    let total_bytes = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u64>()
                .map_err(|e| e.to_string())
        })?;
    let total_mb = total_bytes / 1024 / 1024;

    // Memory stats via vm_stat (more reliable than top across macOS versions)
    let vm_output = Command::new("vm_stat")
        .output()
        .map_err(|e| e.to_string())?;
    let vm_str = String::from_utf8_lossy(&vm_output.stdout);

    let mut page_size: u64 = 16384;
    let mut pages_free: u64 = 0;
    let mut pages_active: u64 = 0;
    let mut pages_inactive: u64 = 0;
    let mut pages_speculative: u64 = 0;
    let mut pages_wired: u64 = 0;
    let mut pages_compressed: u64 = 0;
    let mut pages_purgeable: u64 = 0;

    for line in vm_str.lines() {
        if line.contains("page size of") {
            if let Some(start) = line.find("page size of ") {
                let after = &line[start + "page size of ".len()..];
                if let Some(end) = after.find(" bytes") {
                    page_size = after[..end].parse::<u64>().unwrap_or(16384);
                }
            }
        } else if line.starts_with("Pages free:") {
            pages_free = parse_vm_stat_value(line);
        } else if line.starts_with("Pages active:") {
            pages_active = parse_vm_stat_value(line);
        } else if line.starts_with("Pages inactive:") {
            pages_inactive = parse_vm_stat_value(line);
        } else if line.starts_with("Pages speculative:") {
            pages_speculative = parse_vm_stat_value(line);
        } else if line.starts_with("Pages wired down:") {
            pages_wired = parse_vm_stat_value(line);
        } else if line.starts_with("Pages occupied by compressor:") {
            pages_compressed = parse_vm_stat_value(line);
        } else if line.starts_with("Pages purgeable:") {
            pages_purgeable = parse_vm_stat_value(line);
        }
    }

    // Calculate memory usage like Activity Monitor:
    // Used = active + wired + speculative + compressed
    // (inactive + free + purgeable are treated as available/cache)
    let used_pages = pages_active + pages_wired + pages_speculative + pages_compressed;
    let used_mb = used_pages * page_size / 1024 / 1024;

    let percent = if total_mb > 0 {
        (used_mb as f64 / total_mb as f64) * 100.0
    } else {
        0.0
    };

    Ok((used_mb, total_mb, percent))
}

fn parse_vm_stat_value(line: &str) -> u64 {
    line.split(':')
        .nth(1)
        .map(|s| s.trim().trim_end_matches('.').replace(',', ""))
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
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
    // Use rss (resident set size in KB) instead of pmem — pmem is a coarse percentage
    // and macOS ps %mem is unreliable for large-memory apps.
    let output = Command::new("ps")
        .args(["-axo", "pid,pcpu,rss,state,comm,command"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Total physical memory for percentage calculation
    let total_kb = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| e.to_string())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<u64>()
                .map_err(|e| e.to_string())
        })? / 1024; // bytes -> KB

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
            let rss_kb = parts[2].parse::<u64>().unwrap_or(0);
            let raw_status = parts[3];
            let comm = parts[4];
            let cmd = parts[5..].join(" ");

            // rss in MB
            let mem_mb = rss_kb as f64 / 1024.0;

            // Translate ps state to Chinese
            // S (sleep/interruptible) is the normal state for most processes
            let status = match raw_status.chars().next().unwrap_or('?') {
                'R' | 'S' | 'I' => "运行中",
                'T' => "停止",
                'Z' => "僵尸",
                'U' => "不可中断",
                'W' => "等待",
                _ => raw_status,
            }
            .to_string();

            let name = extract_process_name(&cmd, comm);

            // Filter out kernel processes and very-low-memory processes
            if mem_mb >= 1.0 && !name.starts_with('[') {
                processes.push(ProcessInfo {
                    pid,
                    name,
                    cpu_percent: cpu,
                    memory_mb: mem_mb,
                    status,
                    command: cmd,
                });
            }
        }
    }

    // Sort by actual memory usage (MB) descending
    processes.sort_by(|a, b| {
        b.memory_mb.partial_cmp(&a.memory_mb).unwrap_or(std::cmp::Ordering::Equal)
    });
    processes.truncate(10);
    Ok(processes)
}

fn extract_process_name(cmd: &str, comm: &str) -> String {
    // Try to extract app name from macOS .app bundle path
    // e.g. /Applications/IntelliJ IDEA.app/Contents/MacOS/idea -> "IntelliJ IDEA"
    if let Some(app_pos) = cmd.find(".app/") {
        let before = &cmd[..app_pos];
        if let Some(last_slash) = before.rfind('/') {
            return before[last_slash + 1..].to_string();
        }
    }
    // Fallback to basename of first command token
    let first = cmd.split_whitespace().next().unwrap_or(comm);
    std::path::Path::new(first)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(comm)
        .to_string()
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

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuThermal {
    pub temperature_celsius: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuPressure {
    pub user_pressure: f64,
    pub system_pressure: f64,
    pub total_pressure: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuCoreLoad {
    pub core_index: i32,
    pub usage_percent: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuDetailedUsage {
    pub thermal: CpuThermal,
    pub pressure: CpuPressure,
    pub cores: Vec<CpuCoreLoad>,
}

pub fn get_cpu_detailed_usage() -> Result<CpuDetailedUsage, String> {
    let thermal = get_cpu_thermal()?;
    let pressure = get_cpu_pressure()?;
    let cores = get_cpu_core_loads()?;
    Ok(CpuDetailedUsage { thermal, pressure, cores })
}

fn get_cpu_thermal() -> Result<CpuThermal, String> {
    // Method 1: sysinfo temperature sensors (works on most macOS hardware)
    use sysinfo::Components;
    let components = Components::new_with_refreshed_list();
    for component in &components {
        let label = component.label().to_lowercase();
        if label.contains("cpu") || label.contains("die") || label.contains("core") || label.contains("pkg") {
            let temp = component.temperature();
            if temp > 0.0 {
                return Ok(CpuThermal { temperature_celsius: temp as f64 });
            }
        }
    }

    // Method 2: osx-cpu-temp (brew install osx-cpu-temp)
    if let Ok(output) = Command::new("osx-cpu-temp").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(temp_str) = stdout.trim().split('°').next() {
            if let Ok(temp) = temp_str.parse::<f64>() {
                return Ok(CpuThermal { temperature_celsius: temp });
            }
        }
    }

    // Method 3: istats (gem install iStats)
    if let Ok(output) = Command::new("istats").args(["cpu", "temp"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(temp_str) = line.split("°C").next() {
                let temp_str = temp_str.trim();
                if let Ok(temp) = temp_str.parse::<f64>() {
                    return Ok(CpuThermal { temperature_celsius: temp });
                }
                let parts: Vec<&str> = temp_str.split_whitespace().collect();
                if let Some(last) = parts.last() {
                    if let Ok(temp) = last.parse::<f64>() {
                        return Ok(CpuThermal { temperature_celsius: temp });
                    }
                }
            }
        }
    }

    Ok(CpuThermal { temperature_celsius: 0.0 })
}

fn get_cpu_pressure() -> Result<CpuPressure, String> {
    // Use memory_pressure command on macOS
    let output = Command::new("memory_pressure")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut user_pressure = 0.0;
    let mut system_pressure = 0.0;
    let mut total_pressure = 0.0;

    for line in stdout.lines() {
        if line.contains("System-wide memory free percentage:") {
            if let Some(percent_str) = line.split(':').nth(1) {
                let percent_str = percent_str.trim().trim_end_matches('%');
                if let Ok(percent) = percent_str.parse::<f64>() {
                    // memory_pressure shows free percentage, convert to pressure
                    total_pressure = 100.0 - percent;
                }
            }
        }
    }

    // Also try to get from vm_stats if available
    if let Ok(output) = Command::new("sh")
        .args(["-c", "vm_stat 2>/dev/null | grep 'Pages free'"])
        .output()
    {
        let _stdout = String::from_utf8_lossy(&output.stdout);
        // This is a fallback, pressure is already estimated above
    }

    // If memory_pressure didn't work, estimate from vm_stat
    if total_pressure == 0.0 {
        if let Ok((_used_mb, _total_mb, percent)) = get_memory_usage() {
            total_pressure = percent;
        }
    }

    // Estimate user vs system split (rough approximation)
    user_pressure = total_pressure * 0.7;
    system_pressure = total_pressure * 0.3;

    Ok(CpuPressure { user_pressure, system_pressure, total_pressure })
}

fn get_cpu_core_loads() -> Result<Vec<CpuCoreLoad>, String> {
    use sysinfo::{CpuRefreshKind, RefreshKind, System};

    let mut s = System::new_with_specifics(
        RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
    );

    // sysinfo needs a delay between refreshes to calculate CPU usage accurately
    std::thread::sleep(std::time::Duration::from_millis(500));
    s.refresh_cpu_all();

    let mut cores = Vec::new();
    for (i, cpu) in s.cpus().iter().enumerate() {
        cores.push(CpuCoreLoad {
            core_index: i as i32,
            usage_percent: cpu.cpu_usage() as f64,
        });
    }

    Ok(cores)
}
