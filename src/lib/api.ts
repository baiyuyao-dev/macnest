import { invoke } from "@tauri-apps/api/core";
import type { Service, DockerContainer, Bookmark, Group, SystemInfo, ResourceUsage, ProcessInfo, SshConnection } from "@/types";

// ===== 服务管理 =====

export async function listServices(): Promise<Service[]> {
  return invoke("list_services");
}

export async function createService(
  data: Omit<Service, "id" | "status" | "pid" | "ports" | "cpu_percent" | "memory_mb" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_service", { req: data });
}

export async function updateService(data: Service): Promise<void> {
  return invoke("update_service", {
    req: { ...data, pid: data.pid ?? undefined },
  });
}

export async function deleteService(id: number): Promise<void> {
  return invoke("delete_service", { id });
}

export async function startService(id: number): Promise<number> {
  return invoke("start_service", { id });
}

export async function stopService(id: number): Promise<void> {
  return invoke("stop_service", { id });
}

export async function restartService(id: number): Promise<number> {
  return invoke("restart_service", { id });
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
  return invoke("get_service_logs", { serviceId });
}

// ===== Docker 管理 =====

export async function listContainers(): Promise<DockerContainer[]> {
  return invoke("list_containers");
}

export async function startContainer(containerId: string): Promise<void> {
  return invoke("start_container", { containerId });
}

export async function stopContainer(containerId: string): Promise<void> {
  return invoke("stop_container", { containerId });
}

export async function restartContainer(containerId: string): Promise<void> {
  return invoke("restart_container", { containerId });
}

export async function removeContainer(containerId: string): Promise<void> {
  return invoke("remove_container", { containerId });
}

export async function getContainerLogs(containerId: string, tail = 100): Promise<string> {
  return invoke("get_container_logs", { containerId, tail });
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
  return invoke("get_container_stats", { containerId });
}

// ===== 分组管理 =====

export async function listGroups(): Promise<Group[]> {
  return invoke("list_groups");
}

export async function createGroup(
  data: Omit<Group, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_group", { req: { ...data, parent_id: data.parent_id ?? null } });
}

export async function updateGroup(data: Group): Promise<void> {
  return invoke("update_group", { req: { ...data, parent_id: data.parent_id ?? null } });
}

export async function deleteGroup(id: number): Promise<void> {
  return invoke("delete_group", { id });
}

// ===== 书签管理 =====

export async function listBookmarks(groupId?: number): Promise<Bookmark[]> {
  return invoke("list_bookmarks", { group_id: groupId });
}

export async function createBookmark(
  data: Omit<Bookmark, "id" | "is_online" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_bookmark", { req: data });
}

export async function updateBookmark(
  data: Partial<Bookmark> & { id: number }
): Promise<void> {
  return invoke("update_bookmark", {
    req: {
      id: data.id,
      name: data.name,
      url: data.url,
      description: data.description,
      group_id: data.group_id,
      icon: data.icon,
      health_check_url: data.health_check_url,
      service_id: data.service_id,
    },
  });
}

export async function deleteBookmark(id: number): Promise<void> {
  return invoke("delete_bookmark", { id });
}

// ===== 系统监控 =====

export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke("get_system_info");
}

export async function getResourceUsage(): Promise<ResourceUsage> {
  return invoke("get_resource_usage");
}

export async function getProcesses(): Promise<ProcessInfo[]> {
  return invoke("get_processes");
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
  return invoke("get_settings");
}

export async function updateSettings(data: {
  theme: string;
  auto_refresh_interval: number;
  show_menu_bar: boolean;
}): Promise<void> {
  return invoke("update_settings", { req: data });
}

// ===== SSH 管理 =====

export async function createSshConnection(
  data: Omit<SshConnection, "id" | "created_at" | "updated_at">
): Promise<number> {
  return invoke("create_ssh_connection", { req: data });
}

export async function listSshConnections(): Promise<SshConnection[]> {
  return invoke("list_ssh_connections");
}

export async function deleteSshConnection(id: number): Promise<void> {
  return invoke("delete_ssh_connection", { id });
}

export async function sshConnect(connectionId: number): Promise<string> {
  return invoke("ssh_connect", { connectionId });
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  return invoke("ssh_disconnect", { sessionId });
}
