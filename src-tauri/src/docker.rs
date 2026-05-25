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

/// Recreate a container: inspect original config, pull latest image, then stop + remove + re-create.
/// Supports both docker-compose managed and standalone containers.
/// SAFETY: Always pulls image and validates config BEFORE removing old container.
pub async fn recreate_container(container_id: &str) -> Result<String, String> {
    // 1. Inspect container to get full config
    let inspect_output = Command::new(docker_path())
        .args(["inspect", "--format", "{{json .}}", container_id])
        .output()
        .await
        .map_err(|e| format!("inspect failed: {}", e))?;

    if !inspect_output.status.success() {
        return Err(format!(
            "inspect failed: {}",
            String::from_utf8_lossy(&inspect_output.stderr)
        ));
    }

    let inspect_json = String::from_utf8_lossy(&inspect_output.stdout);
    let inspect_data: serde_json::Value = serde_json::from_str(&inspect_json)
        .map_err(|e| format!("Failed to parse inspect output: {}", e))?;

    let name = inspect_data["Name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('/');
    let image = inspect_data["Config"]["Image"]
        .as_str()
        .unwrap_or("");

    if image.is_empty() {
        return Err("Could not determine container image".to_string());
    }

    // 2. Check if managed by docker compose
    let labels = &inspect_data["Config"]["Labels"];
    let compose_project = labels["com.docker.compose.project"].as_str();
    let compose_service = labels["com.docker.compose.service"].as_str();
    let compose_workdir = labels["com.docker.compose.project.working_dir"].as_str();
    let compose_config = labels["com.docker.compose.project.config_files"].as_str();

    if let (Some(project), Some(service)) = (compose_project, compose_service) {
        // Compose-managed: use docker compose up --force-recreate
        let mut args = vec![
            "compose".to_string(),
            "-p".to_string(),
            project.to_string(),
            "up".to_string(),
            "-d".to_string(),
            "--force-recreate".to_string(),
            "--pull".to_string(),
            "always".to_string(),
            service.to_string(),
        ];

        if let Some(config) = compose_config {
            args.insert(2, "-f".to_string());
            args.insert(3, config.to_string());
        }

        let mut cmd = Command::new(docker_path());
        if let Some(wd) = compose_workdir {
            cmd.current_dir(wd);
        }

        let output = cmd.args(&args).output().await.map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "Compose recreate failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        return Ok(format!(
            "{} ({}, via compose)",
            service,
            String::from_utf8_lossy(&output.stdout).trim()
        ));
    }

    // 3. Standalone container: pull image FIRST, then stop + remove + re-create
    let pull_output = Command::new(docker_path())
        .args(["pull", image])
        .output()
        .await
        .map_err(|e| format!("pull failed: {}", e))?;

    if !pull_output.status.success() {
        return Err(format!(
            "Failed to pull image '{}': {}",
            image,
            String::from_utf8_lossy(&pull_output.stderr)
        ));
    }

    // Build docker run arguments from inspect data BEFORE removing old container
    let mut args = vec!["run".to_string(), "-d".to_string()];

    if !name.is_empty() {
        args.push("--name".to_string());
        args.push(name.to_string());
    }

    if let Some(env_arr) = inspect_data["Config"]["Env"].as_array() {
        for e in env_arr {
            if let Some(val) = e.as_str() {
                args.push("-e".to_string());
                args.push(val.to_string());
            }
        }
    }

    if let Some(wd) = inspect_data["Config"]["WorkingDir"].as_str() {
        if !wd.is_empty() {
            args.push("-w".to_string());
            args.push(wd.to_string());
        }
    }

    if let Some(ep_arr) = inspect_data["Config"]["Entrypoint"].as_array() {
        let parts: Vec<String> = ep_arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !parts.is_empty() {
            args.push("--entrypoint".to_string());
            args.push(parts.join(" "));
        }
    } else if let Some(ep) = inspect_data["Config"]["Entrypoint"].as_str() {
        args.push("--entrypoint".to_string());
        args.push(ep.to_string());
    }

    if let Some(label_map) = inspect_data["Config"]["Labels"].as_object() {
        for (k, v) in label_map {
            if k.starts_with("com.docker.compose.") {
                continue;
            }
            if let Some(val) = v.as_str() {
                args.push("-l".to_string());
                args.push(format!("{}={}", k, val));
            } else {
                args.push("-l".to_string());
                args.push(k.to_string());
            }
        }
    }

    let port_bindings = inspect_data["HostConfig"]["PortBindings"].as_object();
    if let Some(bindings) = port_bindings {
        for (container_port, host_bindings) in bindings {
            if let Some(arr) = host_bindings.as_array() {
                for binding in arr {
                    let host_ip = binding["HostIp"].as_str().unwrap_or("");
                    let host_port = binding["HostPort"].as_str().unwrap_or("");
                    let spec = if host_ip.is_empty() || host_ip == "0.0.0.0" {
                        format!("{}:{}", host_port, container_port)
                    } else {
                        format!("{}:{}:{}", host_ip, host_port, container_port)
                    };
                    args.push("-p".to_string());
                    args.push(spec);
                }
            }
        }
    }

    if let Some(exposed) = inspect_data["Config"]["ExposedPorts"].as_object() {
        if port_bindings.map(|m| m.is_empty()).unwrap_or(true) {
            args.push("-P".to_string());
        }
    }

    if let Some(binds) = inspect_data["HostConfig"]["Binds"].as_array() {
        for b in binds {
            if let Some(val) = b.as_str() {
                args.push("-v".to_string());
                args.push(val.to_string());
            }
        }
    }

    if let Some(vol_map) = inspect_data["HostConfig"]["Volumes"].as_object() {
        for (vol, _) in vol_map {
            args.push("-v".to_string());
            args.push(vol.to_string());
        }
    }

    if let Some(network) = inspect_data["HostConfig"]["NetworkMode"].as_str() {
        if !network.is_empty() && network != "default" {
            args.push("--network".to_string());
            args.push(network.to_string());
        }
    }

    if let Some(restart) = inspect_data["HostConfig"]["RestartPolicy"]["Name"].as_str() {
        if !restart.is_empty() && restart != "no" {
            let max_count = inspect_data["HostConfig"]["RestartPolicy"]["MaximumRetryCount"]
                .as_i64()
                .unwrap_or(0);
            let spec = if max_count > 0 {
                format!("{}:{}", restart, max_count)
            } else {
                restart.to_string()
            };
            args.push("--restart".to_string());
            args.push(spec);
        }
    }

    if let Some(user) = inspect_data["Config"]["User"].as_str() {
        if !user.is_empty() {
            args.push("-u".to_string());
            args.push(user.to_string());
        }
    }

    if let Some(hostname) = inspect_data["Config"]["Hostname"].as_str() {
        if !hostname.is_empty() && hostname != name {
            args.push("-h".to_string());
            args.push(hostname.to_string());
        }
    }

    if let Some(privileged) = inspect_data["HostConfig"]["Privileged"].as_bool() {
        if privileged {
            args.push("--privileged".to_string());
        }
    }

    args.push(image.to_string());

    if let Some(cmd_arr) = inspect_data["Config"]["Cmd"].as_array() {
        for c in cmd_arr {
            if let Some(val) = c.as_str() {
                args.push(val.to_string());
            }
        }
    }

    // NOW stop and remove old container (after pull succeeds and args are validated)
    let _ = stop_container(container_id).await;
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    let _ = remove_container(container_id).await;

    // Run new container
    let output = Command::new(docker_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("run failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to recreate container: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
