import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ── Formatting ── */

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}天 ${hours}小时 ${minutes}分钟`;
}

export function formatBytes(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, Math.min(i, sizes.length - 1))).toFixed(1)) + " " + sizes[Math.min(i, sizes.length - 1)];
}

export function formatIsoTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return d.toLocaleDateString();
}

/* ── Status helpers ── */

export type BadgeVariant = "success" | "destructive" | "warning" | "secondary";

export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "running": return "success";
    case "error": return "destructive";
    case "restarting": return "warning";
    default: return "secondary";
  }
}

export function processStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "运行中": return "success";
    case "僵尸":
    case "等待": return "warning";
    case "停止":
    case "不可中断": return "destructive";
    default: return "secondary";
  }
}
