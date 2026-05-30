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

    // Wait briefly and verify the container is actually running
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    let inspect = Command::new(docker_path())
        .args(["inspect", "--format", "{{.State.Status}}", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let status = String::from_utf8_lossy(&inspect.stdout).trim().to_string();
    if status != "running" {
        let logs = Command::new(docker_path())
            .args(["logs", "--tail", "5", container_id])
            .output()
            .await;
        let log_hint = logs.ok().and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout);
            if s.trim().is_empty() { None } else { Some(format!("\n最近日志: {}", s.trim())) }
        }).unwrap_or_default();
        return Err(format!(
            "容器启动后立刻退出（状态: {}）。可能原因：镜像默认命令是交互式 shell（如 bash），创建时缺少 -it 参数。建议删除后重新创建，或在创建时指定保持运行的命令（如 sleep 300）。{}",
            status, log_hint
        ));
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

    // Wait briefly and verify the container is actually running
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    let inspect = Command::new(docker_path())
        .args(["inspect", "--format", "{{.State.Status}}", container_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let status = String::from_utf8_lossy(&inspect.stdout).trim().to_string();
    if status != "running" {
        return Err(format!(
            "容器重启后立刻退出（状态: {}）。可能原因：镜像默认命令是交互式 shell，创建时缺少 -it 参数。建议删除后重新创建。",
            status
        ));
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

/// 重建容器的核心逻辑，支持端口覆盖。
/// 如果 `override_ports` 为 Some，则使用传入的端口列表替代原配置中的端口绑定。
async fn do_recreate_container(
    container_id: &str,
    override_ports: Option<Vec<String>>,
) -> Result<String, String> {
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

    // 3. Standalone container: stop + remove + re-create
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

    // ── Port bindings: use override if provided ──
    if let Some(ref ports) = override_ports {
        for port in ports {
            if !port.is_empty() {
                args.push("-p".to_string());
                args.push(port.clone());
            }
        }
    } else {
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

    // Stop and remove old container, then re-create
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

/// Recreate a container: inspect original config, pull latest image, then stop + remove + re-create.
/// Supports both docker-compose managed and standalone containers.
/// SAFETY: Always pulls image and validates config BEFORE removing old container.
pub async fn recreate_container(container_id: &str) -> Result<String, String> {
    do_recreate_container(container_id, None).await
}

/// Update container port mappings by recreating the container.
/// All other configuration (env, volumes, labels, etc.) is preserved.
pub async fn update_container_ports(
    container_id: &str,
    ports: Vec<String>,
) -> Result<String, String> {
    do_recreate_container(container_id, Some(ports)).await
}

// === Image Management ===

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
    pub containers: i64,
}

pub async fn list_images() -> Result<Vec<DockerImage>, String> {
    let output = Command::new(docker_path())
        .args([
            "images",
            "--format",
            "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}|{{.Containers}}",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut images = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 6 {
            images.push(DockerImage {
                id: parts[0].to_string(),
                repository: parts[1].to_string(),
                tag: parts[2].to_string(),
                size: parts[3].to_string(),
                created: parts[4].to_string(),
                containers: parts[5].parse().unwrap_or(0),
            });
        }
    }

    Ok(images)
}

pub async fn remove_image(image_id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["rmi", image_id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn prune_images() -> Result<String, String> {
    let output = Command::new(docker_path())
        .args(["image", "prune", "-f"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub async fn pull_image(image: &str) -> Result<String, String> {
    let output = Command::new(docker_path())
        .args(["pull", image])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("{}", stderr));
    }

    let mut result = stdout.to_string();
    if !stderr.is_empty() {
        result.push_str("\n");
        result.push_str(&stderr);
    }
    Ok(result)
}

// === Container Create ===

#[derive(Debug, Deserialize)]
pub struct CreateContainerRequest {
    pub image: String,
    pub name: String,
    pub ports: Vec<String>,       // "8080:80" or "127.0.0.1:8080:80/udp"
    pub env: Vec<String>,         // "KEY=VALUE"
    pub volumes: Vec<String>,     // "/host:/container" or "/host:/container:ro"
    pub restart_policy: String,   // "no", "always", "unless-stopped", "on-failure"
    pub network: String,          // "bridge", "host", "none", or custom network name
    pub workdir: String,
    pub command: String,          // optional override command
    pub detached: bool,           // always true for GUI, but kept for clarity
    pub auto_start: bool,         // start after create
}

pub async fn create_container(req: &CreateContainerRequest) -> Result<String, String> {
    let subcmd = if req.auto_start { "run" } else { "create" };
    let mut args = vec![subcmd.to_string()];

    if req.detached && req.auto_start {
        args.push("-d".to_string());
    }

    // Always allocate a pseudo-TTY and keep stdin open so shells (e.g. ubuntu bash)
    // stay alive in detached mode instead of exiting immediately.
    args.push("-i".to_string());
    args.push("-t".to_string());

    if !req.name.is_empty() {
        args.push("--name".to_string());
        args.push(req.name.clone());
    }

    for port in &req.ports {
        if !port.is_empty() {
            args.push("-p".to_string());
            args.push(port.clone());
        }
    }

    for e in &req.env {
        if !e.is_empty() {
            args.push("-e".to_string());
            args.push(e.clone());
        }
    }

    for vol in &req.volumes {
        if !vol.is_empty() {
            args.push("-v".to_string());
            args.push(vol.clone());
        }
    }

    if !req.restart_policy.is_empty() && req.restart_policy != "no" {
        args.push("--restart".to_string());
        args.push(req.restart_policy.clone());
    }

    if !req.network.is_empty() && req.network != "bridge" {
        args.push("--network".to_string());
        args.push(req.network.clone());
    }

    if !req.workdir.is_empty() {
        args.push("-w".to_string());
        args.push(req.workdir.clone());
    }

    args.push(req.image.clone());

    if !req.command.is_empty() {
        // Split command by spaces (simple parsing)
        for part in req.command.split_whitespace() {
            args.push(part.to_string());
        }
    } else {
        // Auto-detect base images whose default command is an interactive shell.
        // In detached mode these exit immediately; attach a keep-alive command.
        let img_lower = req.image.to_lowercase();
        let is_base_image = [
            "ubuntu", "alpine", "debian", "centos", "fedora", "rocky",
            "arch", "busybox", "amazonlinux", "opensuse", "void",
        ]
        .iter()
        .any(|name| img_lower.contains(name));
        if is_base_image {
            args.push("tail".to_string());
            args.push("-f".to_string());
            args.push("/dev/null".to_string());
        }
    }

    let output = Command::new(docker_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("{}", stderr));
    }

    let container_id = stdout.trim().to_string();

    // If auto-started, verify the container is actually running
    if req.auto_start {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let inspect = Command::new(docker_path())
            .args(["inspect", "--format", "{{.State.Status}}", &container_id])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let status = String::from_utf8_lossy(&inspect.stdout).trim().to_string();
        if status != "running" {
            let mut hint = format!(
                "容器创建后立即退出（状态: {}）。",
                status
            );
            // Check if image entrypoint/cmd is an interactive shell
            let img_inspect = Command::new(docker_path())
                .args(["inspect", "--format", "{{json .Config}}", &req.image])
                .output()
                .await;
            if let Ok(img) = img_inspect {
                let cfg = String::from_utf8_lossy(&img.stdout);
                if cfg.contains("bash") || cfg.contains("sh") {
                    hint.push_str(" 该镜像默认启动交互式 shell，请在[启动命令]中填写保持运行的命令（如 sleep 300 或 tail -f /dev/null），否则 detached 模式下 shell 会立即退出。");
                }
            }
            return Err(hint);
        }
    }

    let mut result = stdout.to_string();
    if !stderr.is_empty() {
        result.push_str("\n");
        result.push_str(&stderr);
    }
    Ok(result.trim().to_string())
}

// === Container Inspect ===

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerInspect {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub created: String,
    pub restart_policy: String,
    pub restart_count: i64,
    pub hostname: String,
    pub working_dir: String,
    pub user: String,
    pub entrypoint: String,
    pub cmd: String,
    pub env: Vec<String>,
    pub labels: Vec<(String, String)>,
    pub mounts: Vec<ContainerMount>,
    pub ports: Vec<ContainerPort>,
    pub network_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerMount {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub type_: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerPort {
    pub ip: String,
    pub host_port: String,
    pub container_port: String,
    pub protocol: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerSystemDf {
    pub containers_total: i64,
    pub containers_active: i64,
    pub containers_size: String,
    pub images_total: i64,
    pub images_active: i64,
    pub images_size: String,
    pub volumes_total: i64,
    pub volumes_active: i64,
    pub volumes_size: String,
}

pub async fn system_df() -> Result<DockerSystemDf, String> {
    let output = Command::new(docker_path())
        .args(["system", "df", "--format", "{{json .}}"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers_total = 0i64;
    let mut containers_active = 0i64;
    let mut containers_size = "0B".to_string();
    let mut images_total = 0i64;
    let mut images_active = 0i64;
    let mut images_size = "0B".to_string();
    let mut volumes_total = 0i64;
    let mut volumes_active = 0i64;
    let mut volumes_size = "0B".to_string();

    for line in stdout.lines() {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(line) {
            let t = data["Type"].as_str().unwrap_or("");
            let total = data["TotalCount"].as_i64().unwrap_or(0);
            let active = data["Active"].as_i64().unwrap_or(0);
            let size = data["Size"].as_str().unwrap_or("0B").to_string();
            match t {
                "Images" => {
                    images_total = total;
                    images_active = active;
                    images_size = size;
                }
                "Containers" => {
                    containers_total = total;
                    containers_active = active;
                    containers_size = size;
                }
                "Local Volumes" => {
                    volumes_total = total;
                    volumes_active = active;
                    volumes_size = size;
                }
                _ => {}
            }
        }
    }

    Ok(DockerSystemDf {
        containers_total,
        containers_active,
        containers_size,
        images_total,
        images_active,
        images_size,
        volumes_total,
        volumes_active,
        volumes_size,
    })
}

// === Volume Management ===

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub scope: String,
    pub labels: String,
}

pub async fn list_volumes() -> Result<Vec<DockerVolume>, String> {
    let output = Command::new(docker_path())
        .args([
            "volume",
            "ls",
            "--format",
            "{{.Name}}|{{.Driver}}|{{.Mountpoint}}|{{.Scope}}|{{.Labels}}",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut volumes = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            volumes.push(DockerVolume {
                name: parts[0].to_string(),
                driver: parts[1].to_string(),
                mountpoint: parts[2].to_string(),
                scope: parts[3].to_string(),
                labels: parts[4].to_string(),
            });
        }
    }

    volumes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(volumes)
}

pub async fn remove_volume(name: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["volume", "rm", name])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn prune_volumes() -> Result<String, String> {
    let output = Command::new(docker_path())
        .args(["volume", "prune", "-f"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// === Network Management ===

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerNetwork {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
}

pub async fn list_networks() -> Result<Vec<DockerNetwork>, String> {
    let output = Command::new(docker_path())
        .args([
            "network",
            "ls",
            "--format",
            "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut networks = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 4 {
            networks.push(DockerNetwork {
                id: parts[0].to_string(),
                name: parts[1].to_string(),
                driver: parts[2].to_string(),
                scope: parts[3].to_string(),
            });
        }
    }

    networks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(networks)
}

pub async fn remove_network(id: &str) -> Result<(), String> {
    let output = Command::new(docker_path())
        .args(["network", "rm", id])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub async fn inspect_container(container_id: &str) -> Result<ContainerInspect, String> {
    let output = Command::new(docker_path())
        .args([
            "inspect",
            "--format",
            "{{json .}}",
            container_id,
        ])
        .output()
        .await
        .map_err(|e| format!("inspect failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "inspect failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse inspect output: {}", e))?;

    // Parse env
    let mut env = Vec::new();
    if let Some(env_arr) = data["Config"]["Env"].as_array() {
        for e in env_arr {
            if let Some(val) = e.as_str() {
                env.push(val.to_string());
            }
        }
    }

    // Parse labels
    let mut labels = Vec::new();
    if let Some(label_map) = data["Config"]["Labels"].as_object() {
        for (k, v) in label_map {
            if let Some(val) = v.as_str() {
                labels.push((k.clone(), val.to_string()));
            }
        }
    }

    // Parse mounts
    let mut mounts = Vec::new();
    if let Some(mount_arr) = data["Mounts"].as_array() {
        for m in mount_arr {
            mounts.push(ContainerMount {
                source: m["Source"].as_str().unwrap_or("").to_string(),
                destination: m["Destination"].as_str().unwrap_or("").to_string(),
                mode: m["Mode"].as_str().unwrap_or("").to_string(),
                type_: m["Type"].as_str().unwrap_or("").to_string(),
            });
        }
    }

    // Parse ports
    let mut ports = Vec::new();
    if let Some(port_bindings) = data["HostConfig"]["PortBindings"].as_object() {
        for (container_port, bindings) in port_bindings {
            if let Some(arr) = bindings.as_array() {
                for binding in arr {
                    ports.push(ContainerPort {
                        ip: binding["HostIp"].as_str().unwrap_or("").to_string(),
                        host_port: binding["HostPort"].as_str().unwrap_or("").to_string(),
                        container_port: container_port.clone(),
                        protocol: "tcp".to_string(),
                    });
                }
            }
        }
    }

    let restart_policy = data["HostConfig"]["RestartPolicy"]["Name"]
        .as_str()
        .unwrap_or("no")
        .to_string();

    let entrypoint_parts: Vec<String> = data["Config"]["Entrypoint"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    let cmd_parts: Vec<String> = data["Config"]["Cmd"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    Ok(ContainerInspect {
        id: data["Id"].as_str().unwrap_or("").to_string(),
        name: data["Name"].as_str().unwrap_or("").trim_start_matches('/').to_string(),
        image: data["Config"]["Image"].as_str().unwrap_or("").to_string(),
        status: data["State"]["Status"].as_str().unwrap_or("").to_string(),
        state: data["State"]["Status"].as_str().unwrap_or("").to_string(),
        created: data["Created"].as_str().unwrap_or("").to_string(),
        restart_policy,
        restart_count: data["RestartCount"].as_i64().unwrap_or(0),
        hostname: data["Config"]["Hostname"].as_str().unwrap_or("").to_string(),
        working_dir: data["Config"]["WorkingDir"].as_str().unwrap_or("").to_string(),
        user: data["Config"]["User"].as_str().unwrap_or("").to_string(),
        entrypoint: entrypoint_parts.join(" "),
        cmd: cmd_parts.join(" "),
        env,
        labels,
        mounts,
        ports,
        network_mode: data["HostConfig"]["NetworkMode"].as_str().unwrap_or("").to_string(),
    })
}
