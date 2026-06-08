import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import type { Service, DockerContainer, DockerImage, ContainerInspect, DockerSystemDf, DockerVolume, DockerNetwork, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, CpuDetailedUsage, SshConnection, SftpFile, TransferProgress, LocalFileNode, RemoteSystemInfo, RdpConnection, Notification, NotificationLog } from "@/types";

// ===== 全局统一提示 =====

/** 成功提示 */
export function showSuccess(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined);
}

/** 错误提示 */
export function showError(message: string, description?: string) {
  toast.error(message, description ? { description } : undefined);
}

/** 信息提示 */
export function showInfo(message: string, description?: string) {
  toast.info(message, description ? { description } : undefined);
}

/** 警告提示 */
export function showWarning(message: string, description?: string) {
  toast.warning(message, description ? { description } : undefined);
}

// ===== 统一错误处理 =====

/** 结构化应用错误 */
export interface AppError {
  code: string;
  message: string;
  details?: string;
}

/** 从 invokeSafe 抛出的异常中提取可读消息 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/**
 * 统一 invoke wrapper：捕获后端错误并尝试解析为结构化 AppError
 * - 后端返回 JSON 格式错误（包含 code/message）
 * - 非结构化错误统一包装为 INTERNAL_ERROR
 */
async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error: unknown) {
    let appError: AppError;

    if (typeof error === "string") {
      try {
        appError = JSON.parse(error) as AppError;
      } catch {
        appError = { code: "INTERNAL_ERROR", message: error };
      }
    } else if (error instanceof Error) {
      appError = { code: "INTERNAL_ERROR", message: error.message };
    } else {
      appError = { code: "UNKNOWN_ERROR", message: String(error) };
    }

    console.error(`[API] ${cmd} failed:`, appError);
    throw appError;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  await open(url);
}

// ===== 服务管理 =====

export async function listServices(): Promise<Service[]> {
  return invokeSafe("list_services");
}

export async function createService(
  data: Omit<Service, "id" | "status" | "pid" | "ports" | "cpu_percent" | "memory_mb" | "created_at" | "updated_at">
): Promise<number> {
  return invokeSafe("create_service", { req: data });
}

export async function updateService(data: Service): Promise<void> {
  return invokeSafe("update_service", {
    req: { ...data, pid: data.pid ?? undefined },
  });
}

export async function deleteService(id: number): Promise<void> {
  return invokeSafe("delete_service", { id });
}

export async function startService(id: number): Promise<number> {
  return invokeSafe("start_service", { id });
}

export async function stopService(id: number): Promise<void> {
  return invokeSafe("stop_service", { id });
}

export async function restartService(id: number): Promise<number> {
  return invokeSafe("restart_service", { id });
}

export interface LogEntry {
  timestamp: string;
  level: string;
  content: string;
}

export async function getServiceLogs(serviceId: number): Promise<LogEntry[]> {
  return invokeSafe("get_service_logs", { serviceId });
}

// ===== Docker 管理 =====

export async function listContainers(): Promise<DockerContainer[]> {
  return invokeSafe("list_containers");
}

export async function startContainer(containerId: string): Promise<void> {
  return invokeSafe("start_container", { containerId });
}

export async function stopContainer(containerId: string): Promise<void> {
  return invokeSafe("stop_container", { containerId });
}

export async function restartContainer(containerId: string): Promise<void> {
  return invokeSafe("restart_container", { containerId });
}

export async function removeContainer(containerId: string): Promise<void> {
  return invokeSafe("remove_container", { containerId });
}

export async function recreateContainer(containerId: string): Promise<string> {
  return invokeSafe("recreate_container", { containerId });
}

export async function updateContainerPorts(
  containerId: string,
  ports: string[]
): Promise<string> {
  return invokeSafe("update_container_ports", { containerId, ports });
}

export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  return invokeSafe("get_container_logs", { containerId, tail });
}

export async function listImages(): Promise<DockerImage[]> {
  return invokeSafe("list_images");
}

export async function removeImage(imageId: string): Promise<void> {
  return invokeSafe("remove_image", { imageId });
}

export async function pruneImages(): Promise<string> {
  return invokeSafe("prune_images");
}

export async function inspectContainer(containerId: string): Promise<ContainerInspect> {
  return invokeSafe("inspect_container", { containerId });
}

export async function dockerSystemDf(): Promise<DockerSystemDf> {
  return invokeSafe("docker_system_df");
}

// ===== Docker Volume Management =====

export async function listVolumes(): Promise<DockerVolume[]> {
  return invokeSafe("list_volumes");
}

export async function removeVolume(name: string): Promise<void> {
  return invokeSafe("remove_volume", { name });
}

export async function pruneVolumes(): Promise<string> {
  return invokeSafe("prune_volumes");
}

// ===== Docker Network Management =====

export async function listNetworks(): Promise<DockerNetwork[]> {
  return invokeSafe("list_networks");
}

export async function removeNetwork(id: string): Promise<void> {
  return invokeSafe("remove_network", { id });
}

export async function pullImage(image: string): Promise<string> {
  return invokeSafe("pull_image", { image });
}

export interface CreateContainerRequest {
  image: string;
  name: string;
  ports: string[];
  env: string[];
  volumes: string[];
  restart_policy: string;
  network: string;
  workdir: string;
  command: string;
  detached: boolean;
  auto_start: boolean;
}

export async function createContainer(req: CreateContainerRequest): Promise<string> {
  return invokeSafe("create_container", { req });
}

export async function getContainerStats(
  containerId: string
): Promise<{
  container_id: string;
  cpu_percent: string;
  memory_usage: string;
  memory_limit: string;
  memory_percent: string;
  net_io: string;
  block_io: string;
}> {
  return invokeSafe("get_container_stats", { containerId });
}

// ===== Docker 容器终端 =====

export async function dockerDetectShells(containerId: string): Promise<string[]> {
  return invokeSafe("docker_detect_shells", { containerId });
}

export async function dockerTerminalConnect(
  containerId: string,
  containerName: string,
  shell: string
): Promise<{ session_id: string; websocket_url: string }> {
  return invokeSafe("docker_terminal_connect", { containerId, containerName, shell });
}

export async function dockerTerminalDisconnect(sessionId: string): Promise<void> {
  return invokeSafe("docker_terminal_disconnect", { sessionId });
}

// ===== 分组管理 =====

export async function listGroups(groupType: string): Promise<Group[]> {
  return invokeSafe("list_groups", { groupType });
}

export async function createGroup(
  data: Omit<Group, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invokeSafe("create_group", { req: { ...data, parent_id: data.parent_id ?? null, start_directory: data.start_directory ?? "" } });
}

export async function updateGroup(data: Group): Promise<void> {
  return invokeSafe("update_group", { req: { ...data, parent_id: data.parent_id ?? null, start_directory: data.start_directory ?? "" } });
}

export async function deleteGroup(id: number): Promise<void> {
  return invokeSafe("delete_group", { id });
}

// ===== 书签管理 =====

export async function listBookmarks(groupId?: number): Promise<Bookmark[]> {
  return invokeSafe("list_bookmarks", { group_id: groupId });
}

export async function createBookmark(
  data: Omit<Bookmark, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invokeSafe("create_bookmark", { req: data });
}

export async function updateBookmark(
  data: Partial<Bookmark> & { id: number }
): Promise<void> {
  return invokeSafe("update_bookmark", {
    req: {
      id: data.id,
      name: data.name,
      url: data.url,
      group_id: data.group_id,
      icon: data.icon,
    },
  });
}

export async function deleteBookmark(id: number): Promise<void> {
  return invokeSafe("delete_bookmark", { id });
}

export interface SafariImportResult {
  groups_imported: number;
  bookmarks_imported: number;
  skipped: number;
}

export async function importSafariBookmarks(): Promise<SafariImportResult> {
  return invokeSafe("import_safari_bookmarks");
}

// ===== 系统监控 =====

export async function getSystemInfo(): Promise<SystemInfo> {
  return invokeSafe("get_system_info");
}

export async function getResourceUsage(): Promise<ResourceUsage> {
  return invokeSafe("get_resource_usage");
}

export async function getProcesses(): Promise<ProcessInfo[]> {
  return invokeSafe("get_processes");
}

export async function getCpuDetailedUsage(): Promise<CpuDetailedUsage> {
  return invokeSafe("get_cpu_detailed_usage");
}

// ===== 设置 =====

export interface AppSettings {
  id: number;
  theme: string;
  auto_refresh_interval: number;
  show_menu_bar: boolean;
  auto_sync_bookmarks_interval: number;
  created_at: string;
  updated_at: string;
}

export async function getSettings(): Promise<AppSettings> {
  return invokeSafe("get_settings");
}

export async function updateSettings(data: {
  theme: string;
  auto_refresh_interval: number;
  show_menu_bar: boolean;
  auto_sync_bookmarks_interval: number;
}): Promise<void> {
  return invokeSafe("update_settings", { req: data });
}

// ===== SSH 管理 =====

export async function createSshConnection(
  data: Omit<SshConnection, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invokeSafe("create_ssh_connection", { req: { ...data, group_id: data.group_id ?? null } });
}

export async function listSshConnections(): Promise<SshConnection[]> {
  return invokeSafe("list_ssh_connections");
}

export async function updateSshConnection(
  data: SshConnection
): Promise<void> {
  return invokeSafe("update_ssh_connection", {
    req: { ...data, group_id: data.group_id ?? null },
  });
}

export async function deleteSshConnection(id: number): Promise<void> {
  return invokeSafe("delete_ssh_connection", { id });
}

export async function sshConnect(connectionId: number): Promise<{ session_id: string; websocket_url: string }> {
  return invokeSafe("ssh_connect", { connectionId });
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  return invokeSafe("ssh_disconnect", { sessionId });
}

export async function getActiveSshSessionsCount(): Promise<number> {
  return invokeSafe("ssh_active_sessions_count");
}

export interface ShellIntegrationResult {
  bashrc_modified: boolean;
  zshrc_modified: boolean;
  script_uploaded: boolean;
}

export async function getSshSystemInfo(sessionId: string): Promise<RemoteSystemInfo> {
  return invokeSafe("get_ssh_system_info", { sessionId });
}

export async function installSshShellIntegration(
  sessionId: string
): Promise<ShellIntegrationResult> {
  return invokeSafe("install_ssh_shell_integration", { sessionId });
}

// ===== SFTP 文件管理 =====

export async function sftpListDir(
  sessionId: string,
  path: string
): Promise<SftpFile[]> {
  return invokeSafe("sftp_list_dir", { sessionId, path });
}

export async function sftpDelete(
  sessionId: string,
  path: string,
  isDir: boolean
): Promise<void> {
  return invokeSafe("sftp_delete", { sessionId, path, isDir });
}

export async function sftpMkdir(
  sessionId: string,
  path: string
): Promise<void> {
  return invokeSafe("sftp_mkdir", { sessionId, path });
}

export async function sftpRename(
  sessionId: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  return invokeSafe("sftp_rename", { sessionId, oldPath, newPath });
}

export async function sftpGetFileInfo(
  sessionId: string,
  path: string
): Promise<SftpFile> {
  return invokeSafe("sftp_get_file_info", { sessionId, path });
}

export async function sftpUpload(
  sessionId: string,
  transferId: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  return invokeSafe("sftp_upload", { sessionId, transferId, localPath, remotePath });
}

export async function sftpDownload(
  sessionId: string,
  transferId: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  return invokeSafe("sftp_download", { sessionId, transferId, remotePath, localPath });
}

export async function sftpGetProgress(
  transferId: string
): Promise<TransferProgress | null> {
  return invokeSafe("sftp_get_progress", { transferId });
}

export async function sftpCancelTransfer(
  transferId: string
): Promise<void> {
  return invokeSafe("sftp_cancel_transfer", { transferId });
}

export async function sftpClearCompleted(): Promise<void> {
  return invokeSafe("sftp_clear_completed");
}

export async function sftpReadFile(
  sessionId: string,
  path: string
): Promise<string> {
  return invokeSafe("sftp_read_file", { sessionId, path });
}

export async function sftpWriteFile(
  sessionId: string,
  path: string,
  content: string
): Promise<void> {
  return invokeSafe("sftp_write_file", { sessionId, path, content });
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

export async function tmuxListSessions(): Promise<TmuxSession[]> {
  return invokeSafe("tmux_list_sessions");
}

export async function tmuxCreateSession(req: CreateTmuxSessionRequest): Promise<void> {
  return invokeSafe("tmux_create_session", { req });
}

export async function tmuxKillSession(name: string): Promise<void> {
  return invokeSafe("tmux_kill_session", { name });
}

export async function tmuxRenameSession(req: RenameTmuxSessionRequest): Promise<void> {
  return invokeSafe("tmux_rename_session", { req });
}

export async function tmuxUpdateSessionStartDirectory(
  display_name: string,
  start_directory: string
): Promise<void> {
  return invokeSafe("tmux_update_session_start_directory", {
    displayName: display_name,
    startDirectory: start_directory,
  });
}

export async function tmuxUpdateSessionGroupId(
  display_name: string,
  group_id: number | null
): Promise<void> {
  return invokeSafe("tmux_update_session_group_id", {
    displayName: display_name,
    groupId: group_id,
  });
}

export async function tmuxIsAvailable(): Promise<boolean> {
  return invokeSafe("tmux_is_available");
}

export async function tmuxAttachPty(
  sessionName: string,
  channel: unknown,
  cols: number,
  rows: number
): Promise<string> {
  return invokeSafe("tmux_attach_pty", { sessionName, channel, cols, rows });
}

export async function tmuxPtyWrite(ptyId: string, data: Uint8Array): Promise<void> {
  return invokeSafe("tmux_pty_write", { ptyId, data: Array.from(data) });
}

export async function tmuxPtyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  return invokeSafe("tmux_pty_resize", { ptyId, cols, rows });
}

export async function tmuxPtyClose(ptyId: string): Promise<void> {
  return invokeSafe("tmux_pty_close", { ptyId });
}

export async function tmuxOpenInGhostty(sessionName: string): Promise<void> {
  return invokeSafe("tmux_open_in_ghostty", { sessionName });
}

export async function tmuxGenerateConfig(): Promise<string> {
  return invokeSafe("tmux_generate_config");
}

export async function tmuxHasClaudeProcess(sessionName: string): Promise<boolean> {
  return invokeSafe("tmux_has_claude_process", { sessionName });
}

// ===== 本地文件管理 =====

export async function localListDir(path: string): Promise<LocalFileNode[]> {
  return invokeSafe("local_list_dir", { path });
}

export async function localReadFile(path: string): Promise<string> {
  return invokeSafe("local_read_file", { path });
}

export async function localWriteFile(path: string, content: string): Promise<void> {
  return invokeSafe("local_write_file", { path, content });
}

export async function localOpenFile(path: string, app?: string): Promise<void> {
  return invokeSafe("local_open_file", { path, app });
}

export interface InstalledApp {
  name: string;
  bundle_id: string;
  path: string;
}

export async function localGetInstalledApps(): Promise<InstalledApp[]> {
  return invokeSafe("local_get_installed_apps");
}

export async function localGetRecommendedApps(extension: string): Promise<string[]> {
  return invokeSafe("local_get_recommended_apps", { extension });
}

// ===== RDP 管理 =====

export async function createRdpConnection(
  data: Omit<RdpConnection, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invokeSafe("create_rdp_connection", { req: data });
}

export async function listRdpConnections(): Promise<RdpConnection[]> {
  return invokeSafe("list_rdp_connections");
}

export async function updateRdpConnection(data: RdpConnection): Promise<void> {
  return invokeSafe("update_rdp_connection", { req: data });
}

export async function deleteRdpConnection(id: number): Promise<void> {
  return invokeSafe("delete_rdp_connection", { id });
}

export async function rdpConnect(connectionId: number): Promise<void> {
  return invokeSafe("rdp_connect", { connectionId });
}

export async function rdpStartSession(connectionId: number): Promise<{ session_id: string }> {
  return invokeSafe("rdp_start_session", { connectionId });
}

export async function rdpStopSession(sessionId: string): Promise<void> {
  return invokeSafe("rdp_stop_session", { sessionId });
}

export interface RdpInputEvent {
  event_type: "mousemove" | "mousedown" | "mouseup" | "keydown" | "keyup";
  x?: number;
  y?: number;
  button?: number;
  scancode?: number;
}

export async function rdpSendInput(sessionId: string, event: RdpInputEvent): Promise<void> {
  return invokeSafe("rdp_send_input", { sessionId, ...event });
}

export async function localRevealInFinder(path: string): Promise<void> {
  return invokeSafe("local_reveal_in_finder", { path });
}

// ===== 通知管理 =====

export interface CreateNotificationRequest {
  name: string;
  notify_type: "scheduled" | "monitor";
  content: string;
  trigger_condition: string;
}

export async function listNotifications(): Promise<Notification[]> {
  return invokeSafe("list_notifications");
}

export async function createNotification(
  data: CreateNotificationRequest
): Promise<number> {
  return invokeSafe("create_notification", { req: data });
}

export async function updateNotification(data: Notification): Promise<void> {
  return invokeSafe("update_notification", { req: data });
}

export async function deleteNotification(id: number): Promise<void> {
  return invokeSafe("delete_notification", { id });
}

export async function toggleNotification(id: number, enabled: boolean): Promise<void> {
  return invokeSafe("toggle_notification", { id, enabled });
}

export async function listNotificationLogs(notificationId: number): Promise<NotificationLog[]> {
  return invokeSafe("list_notification_logs", { notificationId });
}
