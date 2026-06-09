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
  start_count?: number;
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

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
  containers: number;
}

export interface ContainerMount {
  source: string;
  destination: string;
  mode: string;
  type_: string;
}

export interface ContainerPort {
  ip: string;
  host_port: string;
  container_port: string;
  protocol: string;
}

export interface DockerSystemDf {
  containers_total: number;
  containers_active: number;
  containers_size: string;
  images_total: number;
  images_active: number;
  images_size: string;
  volumes_total: number;
  volumes_active: number;
  volumes_size: string;
}

export interface ContainerInspect {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  restart_policy: string;
  restart_count: number;
  hostname: string;
  working_dir: string;
  user: string;
  entrypoint: string;
  cmd: string;
  env: string[];
  labels: [string, string][];
  mounts: ContainerMount[];
  ports: ContainerPort[];
  network_mode: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  labels: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface Group {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  group_type: string;
  start_directory: string;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: number;
  name: string;
  url: string;
  group_id: number | null;
  icon: string;
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

export interface RemoteSystemInfo {
  hostname: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  memory_percent: number;
  disk_total: string;
  disk_used: string;
  disk_available: string;
  disk_usage_percent: string;
  disk_usage_percent_num: number;
  load_1m: string;
  load_5m: string;
  load_15m: string;
  latency_ms: number;
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

export interface LocalFileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  permissions: string;
  children?: LocalFileNode[];
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
  display_name: string;
  windows: number;
  attached: boolean;
  created_at: string;
  pid: number;
  start_directory?: string;
  group_id?: number | null;
  group_name?: string;
  is_external?: boolean;
}

export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
  group_id?: number | null;
  pane_count?: number;
  layout?: "horizontal" | "vertical";
}

export interface RenameTmuxSessionRequest {
  old_name: string;
  new_name: string;
}

export interface CpuThermal {
  temperature_celsius: number;
}

export interface CpuPressure {
  user_pressure: number;
  system_pressure: number;
  total_pressure: number;
}

export interface CpuCoreLoad {
  core_index: number;
  usage_percent: number;
}

export interface CpuDetailedUsage {
  thermal: CpuThermal;
  pressure: CpuPressure;
  cores: CpuCoreLoad[];
}

// ===== RDP 管理 =====

export interface RdpConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  domain: string;
  screen_width: number;
  screen_height: number;
  color_depth: number;
  group_id: number | null;
  created_at: string;
  updated_at: string;
}

// ===== 通知管理 =====

export interface Notification {
  id: number;
  name: string;
  notify_type: "scheduled" | "monitor";
  content: string;
  trigger_condition: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: number;
  notification_id: number;
  title: string;
  body: string;
  triggered_at: string;
  trigger_value?: number;
}

// ===== MySQL 管理 =====

export interface MysqlConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string;
  created_at: string;
  updated_at: string;
}

export interface MysqlConnectionConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface DatabaseInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  engine: string | null;
  rows: number | null;
  size_mb: number | null;
}

export interface ViewInfo {
  name: string;
}

export interface TriggerInfo {
  name: string;
  event: string;
  table: string;
  timing: string;
}

export interface FunctionInfo {
  name: string;
}

export interface EventInfo {
  name: string;
  status: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: string;
  key: string;
  default_value: string | null;
  extra: string;
  comment: string;
}

export interface IndexInfo {
  name: string;
  columns: string;
  non_unique: boolean;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export interface MysqlQueryResult {
  columns: string[];
  rows: any[][];
  affected_rows: number | null;
  execution_time_ms: number;
}

export interface MysqlBackupTask {
  id: number;
  connection_id: number;
  database_name: string;
  cron_expression: string;
  backup_path: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

export type MysqlObjectType = "table" | "view" | "trigger" | "function" | "event";

export interface MysqlObject {
  name: string;
  type: MysqlObjectType;
  database: string;
}

// ===== 数据库管理器标签页状态 =====

export type PendingEdit =
  | { type: "cell"; rowIndex: number; colName: string; oldValue: unknown; newValue: string; pkValue: unknown }
  | { type: "delete"; rowIndex: number; pkValue: unknown };

export interface TabState {
  table: string;
  subTab: "data" | "structure" | "sql";
  filters: Record<string, string>;
  sortCol: string | null;
  sortDir: "asc" | "desc" | null;
  page: number;
  pageSize: number;
  selectedRows: Set<number>;
  selectedCols: Set<string>;
  pendingEdits: Map<string, PendingEdit>;
  queryResult: MysqlQueryResult | null;
  tableStructure: TableStructure | null;
  totalRows: number;
  sqlEditorContent: string;
}

export interface LoadTableDataRequest {
  connection_id: number;
  database: string;
  table: string;
  page: number;
  page_size: number;
  filters: Record<string, string>;
  sort_col: string | null;
  sort_dir: "asc" | "desc" | null;
}

export interface LoadTableDataResponse {
  columns: string[];
  rows: any[][];
  total_rows: number;
  execution_time_ms: number;
}
