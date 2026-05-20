use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::process::Command;

/// Locate the docker binary. GUI apps on macOS don't inherit the user's shell PATH,
/// so we check common install locations before falling back to `docker`.
fn docker_path() -> PathBuf {
    if let Ok(path) = std::env::var("DOCKER_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return p;
        }
    }

    let candidates = [
        "/opt/homebrew/bin/docker",      // Apple Silicon Homebrew
        "/usr/local/bin/docker",         // Intel Homebrew
        "/usr/bin/docker",
        "/bin/docker",
    ];

    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return PathBuf::from(c);
        }
    }

    PathBuf::from("docker")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub container_id: String,
    pub name: String,
    pub image: String,
    pub compose_project: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
}

pub async fn list_containers() -> Result<Vec<DockerContainer>, String> {
    let output = Command::new(docker_path())
        .args([
            "ps",
            "-a",
            "--format",
            "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.Labels}}|{{.CreatedAt}}",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 8 {
            let labels = parts[6];
            let compose_project = labels
                .split(',')
                .find(|l| l.starts_with("com.docker.compose.project="))
                .map(|l| l.split('=').nth(1).unwrap_or("").to_string())
                .unwrap_or_default();

            containers.push(DockerContainer {
                id: parts[0].to_string(),
                container_id: parts[0].to_string(),
                name: parts[1].to_string(),
                image: parts[2].to_string(),
                compose_project,
                status: parts[3].to_string(),
                state: parts[4].to_string(),
                ports: parts[5].to_string(),
                created: parts[7].to_string(),
            });
        }
    }

    containers.sort_by(|a, b| {
        let a_running = a.state == "running";
        let b_running = b.state == "running";
        match (b_running, a_running) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(containers)
}

pub async fn start_container(container_id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["start", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn stop_container(container_id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["stop", "-t", "2", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn restart_container(container_id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["restart", "-t", "2", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn remove_container(container_id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["rm", "-f", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn get_container_logs(container_id: &str, tail: i64) -> Result<String, String> {
    let output = Command::new(docker_path())
        .args([
            "logs",
            "--tail",
            &tail.to_string(),
            "--timestamps",
            container_id,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut result = stdout.to_string();
    if !stderr.is_empty() {
        result.push_str("\n--- STDERR ---\n");
        result.push_str(&stderr);
    }

    Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerStats {
    pub container_id: String,
    pub cpu_percent: String,
    pub memory_usage: String,
    pub memory_limit: String,
    pub memory_percent: String,
    pub net_io: String,
    pub block_io: String,
}

pub async fn get_container_stats(container_id: &str) -> Result<ContainerStats, String> {
    let output = Command::new(docker_path())
        .args([
            "stats",
            "--no-stream",
            "--format",
            "{{.Container}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}",
            container_id,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split('|').collect();

    if parts.len() >= 6 {
        let mem_parts: Vec<&str> = parts[2].split(" / ").collect();
        Ok(ContainerStats {
            container_id: parts[0].to_string(),
            cpu_percent: parts[1].to_string(),
            memory_usage: mem_parts.get(0).unwrap_or(&"").to_string(),
            memory_limit: mem_parts.get(1).unwrap_or(&"").to_string(),
            memory_percent: parts[3].to_string(),
            net_io: parts[4].to_string(),
            block_io: parts[5].to_string(),
        })
    } else {
        Err("Failed to parse container stats".to_string())
    }
}

pub async fn get_container_top_processes(container_id: &str) -> Result<String, String> {
    let output = Command::new(docker_path())
        .args(["top", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
