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
  if (status === "Running" || status === "running") return "success";
  if (status === "Sleeping" || status === "sleeping") return "secondary";
  if (status === "Zombie" || status === "zombie") return "warning";
  return "destructive";
}
