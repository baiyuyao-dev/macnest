# SFTP 文件管理右键菜单设计

## 概述

为终端页面的 SFTP 文件列表增加右键上下文菜单，替代纯工具栏操作方式，提升操作效率与直觉性。菜单采用 macOS Finder 风格的毛玻璃圆角浮层设计，与现有 UI 风格保持一致。

## 触发范围

- **文件/文件夹行右键**：显示文件相关操作菜单
- **空白区域右键**：显示目录相关操作菜单

## 文件/文件夹右键菜单

菜单宽度约 180px，整体风格与现有 `glass-strong` 一致。

### 菜单项（从上到下）

| 图标 | 标签 | 行为 | 可用条件 |
|---|---|---|---|
| 📂 或 📄 | 打开 | 文件夹→进入目录；文件→触发下载 | 始终可用 |
| ⬇️ | 下载 | 下载选中文件 | 仅文件可用，文件夹禁用 |
| ✏️ | 重命名 | 弹出重命名对话框 | 始终可用 |
| 📋 | 复制路径 | 复制文件完整路径到剪贴板 | 始终可用 |
| 🖥️ | 复制路径到终端 | 发送 `cd <file_path>` 到终端 | 始终可用，仅当 `onSyncToTerminal` 存在时显示 |
| ──── | 分隔线 | ─ | ─ |
| 🗑️ | 删除 | 弹出删除确认对话框 | 始终可用 |

**禁用项样式**：文字 40% 透明度，不可点击，hover 无背景变化。

### 文件夹右键差异

- "打开" 变为"进入目录"
- "下载" 禁用（灰显）

## 空白区域右键菜单

| 图标 | 标签 | 行为 |
|---|---|---|
| 📁+ | 新建文件夹 | 弹出新建文件夹对话框 |
| ⬆️ | 上传文件 | 打开文件选择器上传 |
| 🔄 | 刷新 | 刷新当前目录列表 |
| ──── | 分隔线 | ─ |
| 🖥️ | 同步到终端 | 发送 `cd <current_path>` 到终端 | 仅当 `onSyncToTerminal` 存在时显示 |

## 交互行为

### 触发与关闭

1. 右键按下 → 阻止默认浏览器菜单（`preventDefault`）→ 在鼠标位置显示菜单
2. 菜单显示后：
   - 点击菜单项 → 执行操作 → 菜单关闭
   - 点击菜单外部 → 菜单关闭
   - 按 Escape → 菜单关闭
   - 滚动页面 → 菜单关闭

### 位置计算

- 菜单以鼠标点击位置为左上角锚点
- 如果右侧空间不足（距右边缘 < 200px），菜单向左展开
- 如果下方空间不足（距底边缘 < 菜单高度），菜单向上展开
- 菜单最大高度 400px，超出时内部滚动

### 键盘导航

- 首次打开菜单后，首项获得焦点
- `↑/↓` 在菜单项之间移动焦点
- `Enter` 执行当前聚焦项
- `Escape` 关闭菜单

## 组件设计

### 新增组件：`ContextMenu`

```tsx
interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;        // 显示在右侧的快捷键，如 "⌘C"
  disabled?: boolean;       // 禁用状态
  destructive?: boolean;    // 危险操作（红色文字）
  onClick: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: (ContextMenuItem | "divider")[];
  onClose: () => void;
}
```

**样式规范：**

- 容器：`glass-strong border-[var(--glass-border-strong)] rounded-xl shadow-xl`
- 菜单项：`px-3 py-2 text-xs flex items-center gap-2 cursor-pointer transition-colors`
- 菜单项 hover：`bg-accent/40`
- 菜单项 focus：`bg-accent/40 outline-none`
- 禁用项：`opacity-40 cursor-default hover:bg-transparent`
- 危险项：`text-red-500 hover:bg-red-500/10`
- 分隔线：`h-px bg-[var(--glass-border)] mx-2 my-1`
- 菜单项高度：约 32px
- 菜单内边距：`py-1.5`

### 修改组件：`SftpFileList`

在现有文件列表容器上增加右键事件处理：

1. 给每个文件行添加 `onContextMenu` 处理器
2. 给文件列表容器添加 `onContextMenu` 处理器（空白区域）
3. 使用局部 state 管理菜单显隐和位置

### 菜单项映射

**文件右键 → 菜单项：**

```
open       → 打开/进入目录（调用 onPathChange 或 onDownload）
download   → 下载（调用 onDownload）
rename     → 重命名（调用 openRename）
copyPath   → 复制路径（navigator.clipboard.writeText）
syncToTerm → 复制路径到终端（调用 onSyncToTerminal）
delete     → 删除（调用 onDelete）
```

**空白右键 → 菜单项：**

```
mkdir      → 新建文件夹（弹出对话框）
upload     → 上传文件（调用 onUpload）
refresh    → 刷新（调用 onRefresh）
syncToTerm → 同步到终端（调用 onSyncToTerminal）
```

## 文件改动范围

- `src/components/terminal/SftpFileList.tsx` — 主要改动：添加右键菜单逻辑
- `src/components/terminal/ContextMenu.tsx` — 新增：右键菜单组件

## 依赖

- 无需新增外部依赖
- 复用现有 `lucide-react` 图标和 shadcn/ui 样式体系

## 边界情况

| 场景 | 处理 |
|---|---|
| 菜单超出视口 | 自动调整显示方向（左/右、上/下） |
| 快速连续右键 | 关闭旧菜单，在新位置打开新菜单 |
| 右键后窗口 resize | 菜单自动关闭 |
| 文件列表为空时右键空白 | 正常显示空白区域菜单 |
| 右键后立即滚动 | 菜单关闭，滚动继续 |
