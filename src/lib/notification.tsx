import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { dismissNotificationToday } from "./api";

let permissionGranted = false;

/**
 * 初始化通知权限（应用启动时调用一次即可）
 */
export async function initNotificationPermission(): Promise<boolean> {
  permissionGranted = await isPermissionGranted();
  console.log("[notification] permission granted:", permissionGranted);
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
    console.log("[notification] permission after request:", permission, "-> granted:", permissionGranted);
  }
  return permissionGranted;
}

/**
 * 通过 osascript 发送通知（打包后 fallback 方案）
 */
async function notifyViaOsascript(title: string, body: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_osascript_notification", { title, body });
    console.log("[notification] sent via osascript:", title);
  } catch (err) {
    console.error("[notification] osascript also failed:", err);
    toast(title, { description: body });
  }
}

/**
 * 发送 macOS 系统通知（右上角弹出）
 *
 * @param title 通知标题
 * @param body  通知正文
 *
 * 注意：macOS 通知图标由应用 bundle 图标决定，不需要传 icon 参数
 */
export async function notify(
  title: string,
  body: string,
  _icon?: string  // macOS 忽略此参数，保留以兼容接口
): Promise<void> {
  // 诊断：打印 Bundle ID（排查打包后权限绑定问题）
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const bundleId = await invoke<string>("get_bundle_id");
    console.log("[notification] bundleId:", bundleId);
  } catch (e) {
    console.log("[notification] bundleId check unavailable");
  }

  // 每次发送前都重新检查权限（macOS 上权限状态可能变化）
  permissionGranted = await isPermissionGranted();
  console.log("[notification] notify check permission:", permissionGranted);

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
    console.log("[notification] re-requested permission:", permissionGranted);
  }

  if (permissionGranted) {
    try {
      // sendNotification 是同步函数，返回 void
      sendNotification({ title, body });
      console.log("[notification] sent:", title);
    } catch (err) {
      console.error("[notification] plugin failed, fallback to osascript:", err);
      await notifyViaOsascript(title, body);
    }
  } else {
    console.warn("[notification] permission denied, trying osascript anyway");
    await notifyViaOsascript(title, body);
  }
}

/**
 * 批量发送通知（自动去重，避免刷屏）
 */
const recentKeys = new Set<string>();

export async function notifyThrottled(
  key: string,
  title: string,
  body: string,
  cooldownMs = 30_000
): Promise<void> {
  if (recentKeys.has(key)) return;
  recentKeys.add(key);
  setTimeout(() => recentKeys.delete(key), cooldownMs);
  await notify(title, body);
}

/**
 * 监听后端 notification:triggered 事件，同时显示系统通知和交互式 Toast。
 * 在 App.tsx 的 useEffect 中调用一次即可。
 */
export async function initNotificationListener(): Promise<() => void> {
  const unlisten = await listen<{
    id: number;
    title: string;
    body: string;
  }>("notification:triggered", async (event) => {
    const { id, title, body } = event.payload;

    // ① 发 macOS 系统通知（来源正确 = 本应用，点击会聚焦本应用）
    try {
      await notify(title, body);
    } catch (err) {
      console.error("[notification] failed to send system notification:", err);
    }

    // ② 同时显示前端 Toast 卡片，带"今日不再提示"按钮
    toast.custom(
      (t) => (
        <div className="flex items-start gap-3 p-3 rounded-xl border border-[var(--glass-border-strong)] bg-[var(--popover)] shadow-lg min-w-[280px] max-w-[360px]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">{body}</p>
          </div>
          <button
            className="shrink-0 text-[11px] text-blue-500 hover:text-blue-600 hover:underline whitespace-nowrap mt-0.5"
            onClick={async () => {
              try {
                await dismissNotificationToday(id);
                toast.dismiss(t);
                toast.success("已设置今日不再提示");
              } catch (err) {
                console.error("[notification] dismiss failed:", err);
                toast.error("设置失败");
              }
            }}
          >
            今日不再提示
          </button>
        </div>
      ),
      {
        duration: 8_000, // 8 秒自动关闭
      }
    );
  });

  return () => {
    unlisten();
  };
}
