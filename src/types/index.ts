export interface Service {
  id: number;
  name: string;
  description: string;
  command: string;
  cwd: string;
  env_vars: string;
  auto_start: boolean;
  restart_policy: "always" | "on-failure" | "never";
  max_restarts: number;
  port_auto_detect: boolean;
  status: "running" | "stopped" | "error" | "restarting";
  pid: number | null;
  ports: string;
  cpu_percent: number;
  memory_mb: number;
  created_at: string;
  updated_at: string;
}

export interface DockerContainer {
  id: string;
  container_id: string;
  name: string;
  image: string;
  compose_project: string;
  status: string;
  state: string;
  ports: string;
  cpu_percent: string;
  memory_usage: string;
  created: string;
}

export interface Group {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  group_type: string;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: number;
  name: string;
  url: string;
  description: string;
  group_id: number | null;
  icon: string;
  service_id: number | null;
  health_check_url: string;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResourceSnapshot {
  id: number;
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  network_rx_mb: number;
  network_tx_mb: number;
}

export interface SystemInfo {
  hostname: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number;
  memory_total_mb: number;
  uptime_seconds: number;
  local_ip: string;
}

export interface ServiceLog {
  id: number;
  service_id: number;
  content: string;
  level: "info" | "warn" | "error" | "stdout" | "stderr";
  created_at: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
  status: string;
  command: string;
}

export interface ResourceUsage {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  disk_percent: number;
  network_rx_mb: number;
  network_tx_mb: number;
}

export interface SshConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type:
    | { type: "Password"; password: string }
    | { type: "PublicKey"; key_path: string; passphrase?: string };
  group_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SshSessionInfo {
  session_id: string;
  connection_id: number;
  host: string;
  username: string;
  connected: boolean;
  connected_at: string;
  websocket_port: number;
}

export interface SshConnectResponse {
  session_id: string;
  websocket_url: string;
}

export interface SftpFile {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  permissions: string;
  owner: string;
  group: string;
}

export interface SftpTransfer {
  id: string;
  file_name: string;
  direction: "upload" | "download";
  total_bytes: number;
  transferred_bytes: number;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
}

export interface TransferProgress {
  id: string;
  file_name: string;
  direction: string;
  total_bytes: number;
  transferred_bytes: number;
  status: string;
}

// ===== Tmux 管理 =====

export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  created_at: string;
  pid: number;
}

export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
}

export interface RenameTmuxSessionRequest {
  old_name: string;
  new_name: string;
}
