# Tmux 会话 Pane 布局升级设计

## 背景

当前 MacNest 的 tmux 会话管理只支持单 pane（默认一个窗口一个 pane）。用户需要在创建会话后手动使用 tmux 命令分割窗口，体验不佳。本次升级目标是：

1. 在创建会话时直接指定 pane 数量和布局
2. 移除已不再需要的"复制配置新建"功能
3. 利用 tmux 原生 mouse 支持实现 pane 大小拖拽调整

## 需求

### 1. 删除复制功能
- 会话列表项和未分组列表中的"复制配置新建"按钮（Copy 图标）全部移除
- 相关 `handleCopy` 逻辑、`onCopy` prop 一并清理

### 2. 创建会话时选择 pane 数量与布局

**可选 pane 数量：** 1、2、3、4（最多 4 个）

**布局规则：**

| Pane 数量 | 布局描述 | 对应 tmux 命令 |
|---|---|---|
| 1 | 单 pane，不分割 | 不执行 split |
| 2 + 左右 | 垂直分割，左右并排 | `split-window -h` |
| 2 + 上下 | 水平分割，上下排列 | `split-window -v` |
| 3 | 品字形：上面一个大的，下面两个均分 | `split-window -h` 两次后 `select-layout main-horizontal` |
| 4 | 田字：2×2 均分 | `split-window -h` + `split-window -v` 两次后 `select-layout tiled` |

**创建流程：**
1. 用户打开"新建 tmux 会话"对话框
2. 在现有"会话名称""工作空间""工作目录"字段下方，增加 pane 数量选择（单选：1/2/3/4）
3. 仅当选中 2 时，额外显示布局选择（单选：左右 / 上下）
4. 点击创建后，后端先创建基础 session，然后按上述规则发送 tmux split/layout 命令

### 3. 拖拽调整大小
- tmux 原生已支持：当前 `~/.tmux.conf` 已设置 `set -g mouse on`
- 用户可在已创建的 pane 之间拖拽边框调整大小，无需额外开发

## 数据模型变更

### 后端（Rust）

```rust
// src-tauri/src/tmux/types.rs

pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
    pub group_id: Option<i64>,
    // NEW
    pub pane_count: u8,        // 1..=4，默认 1
    pub layout: Option<String>, // "horizontal" | "vertical"，仅 pane_count=2 时有效
}
```

### 前端（TypeScript）

```typescript
// src/types/index.ts

export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
  group_id?: number | null;
  // NEW
  pane_count?: number;        // 1..=4，默认 1
  layout?: "horizontal" | "vertical"; // 仅 pane_count=2 时有效
}
```

## 后端实现要点

在 `src-tauri/src/tmux/commands.rs` 的 `create_session` 函数中，session 创建成功后：

1. 根据 `pane_count` 发送 `tmux split-window` 命令创建 pane
2. 发送 `tmux select-layout` 命令应用最终布局
3. 所有 tmux 命令均使用 `crate::tmux::get_tmux_path()` 获取的绝对路径
4. 每个 tmux 命令独立执行，检查输出状态

**具体命令序列：**

```
# 2 pane 左右
tmux split-window -h -t <session_name>

# 2 pane 上下
tmux split-window -v -t <session_name>

# 3 pane 品字
tmux split-window -h -t <session_name>
tmux split-window -h -t <session_name>
tmux select-layout -t <session_name> main-horizontal

# 4 pane 田字
tmux split-window -h -t <session_name>
tmux split-window -v -t <session_name>
tmux split-window -v -t <session_name>
tmux select-layout -t <session_name> tiled
```

## 前端 UI 变更

### 新建会话对话框

在现有表单字段下方新增：

1. **Pane 数量**（必选，默认 1）
   - 4 个单选按钮：1 / 2 / 3 / 4

2. **布局方向**（仅 pane=2 时显示）
   - 2 个单选按钮：左右排列 / 上下排列

### 会话列表清理

- 删除每个会话项的 Copy 图标按钮
- 删除未分组列表中的 Copy 图标按钮
- 移除 `handleCopy` 函数和相关 state 逻辑
- 移除 `WorkspaceTreeNode` 组件的 `onCopy` prop

## 错误处理

- tmux split/layout 命令失败时记录 warn 日志，不阻断会话创建
- pane_count 超出 1..4 范围时，后端默认当作 1 处理
- layout 值不在预期范围内时，默认当作 "horizontal" 处理

## 兼容性

- 现有会话（无 pane_count/layout 字段）不受影响
- 前端 `CreateTmuxSessionRequest` 的 pane_count/layout 为可选字段，默认 1 pane
- 编辑会话对话框不增加 pane 布局选项（布局修改在 tmux 内部完成即可）
