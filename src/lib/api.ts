import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { Service, DockerContainer, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, SshConnection, SftpFile, TransferProgress } from "@/types";

// ===== 统一错误处理 =====

/** 结构化应用错误 */
export interface AppError {
  code: string;
  message: string;
  details?: string;
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

export async function getServiceLogs(
  serviceId: number
): Promise<
  {
    id: number;
    service_id: number;
    content: string;
    level: string;
    created_at: string;
  }[]
> {
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

export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  return invokeSafe("get_container_logs", { containerId, tail });
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
  return invokeSafe("create_group", { req: { ...data, parent_id: data.parent_id ?? null } });
}

export async function updateGroup(data: Group): Promise<void> {
  return invokeSafe("update_group", { req: { ...data, parent_id: data.parent_id ?? null } });
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
      description: data.description,
      group_id: data.group_id,
      icon: data.icon,
      service_id: data.service_id,
    },
  });
}

export async function deleteBookmark(id: number): Promise<void> {
  return invokeSafe("delete_bookmark", { id });
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

// ===== 设置 =====

export interface AppSettings {
  id: number;
  theme: string;
  auto_refresh_interval: number;
  show_menu_bar: boolean;
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
