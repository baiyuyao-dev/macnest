# SFTP 右键菜单实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为终端页面 SFTP 文件列表添加 macOS Finder 风格的右键上下文菜单

**Architecture:** 新增独立的 `ContextMenu` 组件负责渲染和定位；在 `SftpFileList` 中集成右键事件处理，根据点击目标（文件/空白）渲染不同菜单项

**Tech Stack:** React + TypeScript + Tailwind CSS + shadcn/ui + lucide-react

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/components/terminal/ContextMenu.tsx` | Create | 通用右键菜单组件（定位、渲染、关闭、键盘导航） |
| `src/components/terminal/SftpFileList.tsx` | Modify | 集成右键事件，映射菜单项到已有操作 |

---

### Task 1: ContextMenu 组件

**Files:**
- Create: `src/components/terminal/ContextMenu.tsx`

- [ ] **Step 1: 创建 ContextMenu 组件**

```tsx
import { useEffect, useRef, useCallback } from "react";
import { type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
  onClick: () => void;
}

export type ContextMenuItemOrDivider = ContextMenuItem | "divider";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItemOrDivider[];
  onClose: () => void;
}

export default function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedX, adjustedY] = adjustPosition(x, y, menuRef);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", onClose, { once: true });
    window.addEventListener("scroll", onClose, { once: true, capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [open, handleKeyDown, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 glass-strong border border-[var(--glass-border-strong)] rounded-xl shadow-xl py-1.5 min-w-[180px] max-w-[240px]"
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) =>
        item === "divider" ? (
          <div key={`div-${idx}`} className="h-px bg-[var(--glass-border)] mx-2 my-1" />
        ) : (
          <button
            key={item.id}
            className={`w-full px-3 py-2 text-xs flex items-center gap-2 transition-colors text-left ${
              item.disabled
                ? "opacity-40 cursor-default"
                : item.destructive
                ? "text-red-500 hover:bg-red-500/10 cursor-pointer"
                : "hover:bg-accent/40 cursor-pointer"
            }`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-muted-foreground ml-2">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}

function adjustPosition(
  x: number,
  y: number,
  ref: React.RefObject<HTMLDivElement | null>
): [number, number] {
  let ax = x;
  let ay = y;
  const el = ref.current;
  if (el) {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + rect.width > vw - 8) ax = vw - rect.width - 8;
    if (y + rect.height > vh - 8) ay = y - rect.height;
    if (ax < 8) ax = 8;
    if (ay < 8) ay = 8;
  }
  return [ax, ay];
}
```

- [ ] **Step 2: 提交**

```bash
git add src/components/terminal/ContextMenu.tsx
git commit -m "feat(sftp): add ContextMenu component for right-click menus

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: SftpFileList 集成右键菜单

**Files:**
- Modify: `src/components/terminal/SftpFileList.tsx`

- [ ] **Step 1: 导入 ContextMenu 及相关图标**

在文件顶部添加导入：

```tsx
import ContextMenu, { type ContextMenuItemOrDivider } from "./ContextMenu";
import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  FileText,
  Pencil,
  Trash2,
  Clipboard,
  Terminal,
  FolderPlus,
  RefreshCw,
  Download,
  // 已有: Folder, ArrowUp, ArrowDown, Trash2, FolderPlus, Pencil, RefreshCw, Terminal
} from "lucide-react";
```

- [ ] **Step 2: 添加菜单状态**

在 `SftpFileList` 组件 state 中添加：

```tsx
const [contextMenu, setContextMenu] = useState<{
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItemOrDivider[];
}>({ open: false, x: 0, y: 0, items: [] });
```

- [ ] **Step 3: 添加文件右键处理器**

在组件内添加：

```tsx
const handleFileContextMenu = (e: React.MouseEvent, file: SftpFile) => {
  e.preventDefault();
  e.stopPropagation();

  const items: ContextMenuItemOrDivider[] = [
    {
      id: "open",
      label: file.is_dir ? "进入目录" : "打开",
      icon: file.is_dir ? <FolderOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />,
      onClick: () => {
        if (file.is_dir) {
          onPathChange(file.path);
        } else {
          onSelectFile(file);
          onDownload();
        }
      },
    },
    {
      id: "download",
      label: "下载",
      icon: <ArrowDown className="h-3.5 w-3.5" />,
      disabled: file.is_dir,
      onClick: () => {
        onSelectFile(file);
        onDownload();
      },
    },
    {
      id: "rename",
      label: "重命名",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => {
        onSelectFile(file);
        openRename();
      },
    },
    {
      id: "copy-path",
      label: "复制路径",
      icon: <Clipboard className="h-3.5 w-3.5" />,
      onClick: () => {
        navigator.clipboard.writeText(file.path).catch(() => {});
      },
    },
  ];

  if (onSyncToTerminal) {
    items.push({
      id: "sync-to-terminal",
      label: "复制路径到终端",
      icon: <Terminal className="h-3.5 w-3.5" />,
      onClick: () => onSyncToTerminal(),
    });
  }

  items.push("divider");
  items.push({
    id: "delete",
    label: "删除",
    icon: <Trash2 className="h-3.5 w-3.5" />,
    destructive: true,
    onClick: () => {
      onSelectFile(file);
      onDelete(file);
    },
  });

  setContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
};
```

- [ ] **Step 4: 添加空白区域右键处理器**

```tsx
const handleBlankContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();

  const items: ContextMenuItemOrDivider[] = [
    {
      id: "mkdir",
      label: "新建文件夹",
      icon: <FolderPlus className="h-3.5 w-3.5" />,
      onClick: () => setShowMkdirDialog(true),
    },
    {
      id: "upload",
      label: "上传文件",
      icon: <ArrowUp className="h-3.5 w-3.5" />,
      onClick: onUpload,
    },
    {
      id: "refresh",
      label: "刷新",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      onClick: onRefresh,
    },
  ];

  if (onSyncToTerminal) {
    items.push("divider");
    items.push({
      id: "sync-to-terminal",
      label: "同步到终端",
      icon: <Terminal className="h-3.5 w-3.5" />,
      onClick: onSyncToTerminal,
    });
  }

  setContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
};
```

- [ ] **Step 5: 绑定右键事件到文件列表**

1. 给文件列表容器添加 `onContextMenu={handleBlankContextMenu}`
2. 给每个文件行添加 `onContextMenu={(e) => handleFileContextMenu(e, file)}`
3. 在组件 JSX 末尾添加 `<ContextMenu ... />`

文件行修改（约第 211-229 行）：

```tsx
<div
  key={file.path}
  className={`flex px-3 py-1.5 text-xs cursor-pointer border-b border-[var(--glass-border)] ${
    selectedFile?.path === file.path
      ? "bg-primary/15"
      : "hover:bg-accent/30"
  }`}
  onClick={() => onSelectFile(file)}
  onDoubleClick={() => handleDoubleClick(file)}
  onContextMenu={(e) => handleFileContextMenu(e, file)}
>
```

文件列表容器修改（约第 164-195 行），在现有 `onDrop` 后添加 `onContextMenu`：

```tsx
onDrop={...}
onContextMenu={handleBlankContextMenu}
```

组件末尾添加 ContextMenu：

```tsx
<ContextMenu
  open={contextMenu.open}
  x={contextMenu.x}
  y={contextMenu.y}
  items={contextMenu.items}
  onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
/>
```

- [ ] **Step 6: 验证编译**

```bash
npm run build 2>&1 | tail -20
```

期望：无 TypeScript 编译错误

- [ ] **Step 7: 提交**

```bash
git add src/components/terminal/SftpFileList.tsx
git commit -m "feat(sftp): add right-click context menu for file list

- File/folder right-click: open, download, rename, copy path, sync to terminal, delete
- Blank area right-click: new folder, upload, refresh, sync to terminal
- macOS Finder-style glass rounded menu

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Spec Coverage Check

| 设计文档要求 | 对应任务 |
|---|---|
| 文件/文件夹右键菜单 | Task 2 Step 3 |
| 空白区域右键菜单 | Task 2 Step 4 |
| 菜单项：打开/下载/重命名/复制路径/同步到终端/删除 | Task 2 Step 3 |
| 菜单项：新建文件夹/上传/刷新/同步到终端 | Task 2 Step 4 |
| 超出视口自动调整 | Task 1 Step 1 `adjustPosition` |
| 毛玻璃圆角风格 | Task 1 Step 1 `glass-strong rounded-xl` |
| Escape 关闭菜单 | Task 1 Step 1 `handleKeyDown` |
| 点击外部关闭 | Task 1 Step 1 `window.addEventListener("click", ...)` |
| 危险操作红色样式 | Task 1 Step 1 `destructive` class |
| 禁用项灰色样式 | Task 1 Step 1 `disabled` class |

## Placeholder Scan

- 无 TBD/TODO/"implement later"
- 所有步骤包含完整代码
- 所有文件路径精确
- 类型签名一致（`ContextMenuItemOrDivider`）
