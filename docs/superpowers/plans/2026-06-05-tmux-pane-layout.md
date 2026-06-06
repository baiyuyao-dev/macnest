# Tmux Pane Layout 升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 tmux 会话时支持 1-4 个 pane 布局选择，删除复制功能，利用 tmux mouse 原生支持拖拽调整 pane 大小。

**Architecture:** 后端在 `create_session` 中根据 `pane_count` 和 `layout` 发送 `tmux split-window` 和 `tmux select-layout` 命令。前端在新建对话框增加 pane 数量选择和布局选择 UI，并删除所有复制按钮。

**Tech Stack:** React + TypeScript (前端), Rust + Tauri (后端), tmux

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|---|---|---|
| `src-tauri/src/tmux/types.rs` | 修改 | CreateTmuxSessionRequest 添加 pane_count / layout 字段 |
| `src-tauri/src/tmux/commands.rs` | 修改 | create_session 增加 pane 分割和布局命令 |
| `src/types/index.ts` | 修改 | CreateTmuxSessionRequest 添加 pane_count / layout 字段 |
| `src/pages/Tmux.tsx` | 修改 | 删除复制按钮/handleCopy/onCopy；新建对话框增加 pane 布局选择 |

---

### Task 1: 后端类型更新 — CreateTmuxSessionRequest 新增字段

**Files:**
- 修改: `src-tauri/src/tmux/types.rs`

- [ ] **Step 1: 在 CreateTmuxSessionRequest 中添加 pane_count 和 layout**

打开 `src-tauri/src/tmux/types.rs`，在 `CreateTmuxSessionRequest` 中新增两个字段：

```rust
/// 创建会话请求
#[derive(Debug, Deserialize)]
pub struct CreateTmuxSessionRequest {
    pub name: String,
    pub start_directory: Option<String>,
    pub command: Option<String>,
    pub group_id: Option<i64>,
    // NEW
    #[serde(default = "default_pane_count")]
    pub pane_count: u8,
    pub layout: Option<String>,
}

fn default_pane_count() -> u8 {
    1
}
```

- [ ] **Step 2: 编译验证后端类型**

Run: `cd src-tauri && cargo check`
Expected: 通过编译，无错误

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/tmux/types.rs
git commit -m "feat(tmux): CreateTmuxSessionRequest 增加 pane_count 和 layout 字段

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 后端创建会话增加 pane 分割逻辑

**Files:**
- 修改: `src-tauri/src/tmux/commands.rs`

- [ ] **Step 1: 在 create_session 中 session 创建成功后添加 pane 分割**

在 `src-tauri/src/tmux/commands.rs` 的 `create_session` 函数中，在 `source_tmux_config()` 调用之后、数据库保存之前，插入以下代码：

找到这行代码作为插入点：
```rust
    // 重新加载配置，确保新会话继承最新的 ~/.tmux.conf
    source_tmux_config();
```

在其后插入：

```rust
    // 根据 pane_count 和 layout 创建 pane 布局
    let pane_count = req.pane_count.clamp(1, 4);
    if pane_count > 1 {
        let tmux = crate::tmux::get_tmux_path();
        
        match pane_count {
            2 => {
                // 2 pane: 根据 layout 选择左右或上下
                let split_flag = match req.layout.as_deref() {
                    Some("vertical") => "-v",
                    _ => "-h", // 默认左右
                };
                let _ = Command::new(&tmux)
                    .args(["split-window", split_flag, "-t", &tmux_name])
                    .output();
            }
            3 => {
                // 3 pane 品字形: 先分两个，再用 main-horizontal 布局
                let _ = Command::new(&tmux)
                    .args(["split-window", "-h", "-t", &tmux_name])
                    .output();
                let _ = Command::new(&tmux)
                    .args(["split-window", "-h", "-t", &tmux_name])
                    .output();
                let _ = Command::new(&tmux)
                    .args(["select-layout", "-t", &tmux_name, "main-horizontal"])
                    .output();
            }
            4 => {
                // 4 pane 田字: 先分三个，再用 tiled 布局
                let _ = Command::new(&tmux)
                    .args(["split-window", "-h", "-t", &tmux_name])
                    .output();
                let _ = Command::new(&tmux)
                    .args(["split-window", "-v", "-t", &tmux_name])
                    .output();
                let _ = Command::new(&tmux)
                    .args(["split-window", "-v", "-t", &tmux_name])
                    .output();
                let _ = Command::new(&tmux)
                    .args(["select-layout", "-t", &tmux_name, "tiled"])
                    .output();
            }
            _ => {}
        }
    }
```

- [ ] **Step 2: 编译验证后端逻辑**

Run: `cd src-tauri && cargo check`
Expected: 通过编译，无错误

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/tmux/commands.rs
git commit -m "feat(tmux): create_session 支持多 pane 布局分割

- 1 pane: 不分割
- 2 pane: 支持左右(horizontal)和上下(vertical)
- 3 pane: 品字形 main-horizontal
- 4 pane: 田字 tiled

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 前端类型更新 — CreateTmuxSessionRequest 新增字段

**Files:**
- 修改: `src/types/index.ts`

- [ ] **Step 1: 在 TypeScript 类型中添加 pane_count 和 layout**

打开 `src/types/index.ts`，找到 `CreateTmuxSessionRequest` 接口，修改为：

```typescript
export interface CreateTmuxSessionRequest {
  name: string;
  start_directory?: string;
  command?: string;
  group_id?: number | null;
  // NEW
  pane_count?: number; // 1..=4，默认 1
  layout?: "horizontal" | "vertical"; // 仅 pane_count=2 时有效
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): CreateTmuxSessionRequest 增加 pane_count 和 layout

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 前端删除复制功能

**Files:**
- 修改: `src/pages/Tmux.tsx`

- [ ] **Step 1: 从 WorkspaceTreeNode 组件中删除 onCopy prop 和复制按钮**

找到 `WorkspaceTreeNode` 的 props 定义，删除 `onCopy`：

```typescript
// 找到这个接口，删除 onCopy 行
onCopy: (session: TmuxSession) => void;
```

找到 WorkspaceTreeNode 组件体中 session 项渲染部分的复制按钮（大约在第 269-282 行），删除整个 `<button>`：

```tsx
// 删除这段代码
<button
  onClick={(e) => {
    e.stopPropagation();
    onCopy(s);
  }}
  className={`h-6 w-6 rounded-lg flex items-center justify-center ${
    activeSession === s.name
      ? "text-primary-foreground hover:bg-white/20"
      : "hover:bg-secondary/60"
  }`}
  title="复制配置新建"
>
  <Copy className="h-3.5 w-3.5" />
</button>
```

同时，在 WorkspaceTreeNode 的递归调用处（大约第 220-236 行）删除 `onCopy={onCopy}` 属性。

- [ ] **Step 2: 从主组件中删除 handleCopy 函数和 onCopy 传递**

找到并删除 `handleCopy` 函数（大约第 933-939 行）：

```typescript
// 删除这段
const handleCopy = (session: TmuxSession) => {
  const copyName = session.display_name + "-copy";
  setNewName(copyName);
  setNewCwd(session.start_directory || "");
  setNewGroupId(session.group_id ?? null);
  setCreateOpen(true);
};
```

找到 `WorkspaceTreeNode` 的 JSX 调用处（大约第 1533-1550 行），删除 `onCopy={handleCopy}`。

- [ ] **Step 3: 从未分组会话列表中删除复制按钮**

找到未分组 session 的渲染（大约第 1487-1501 行），删除其中的复制按钮：

```tsx
// 删除这段
<button
  onClick={(e) => {
    e.stopPropagation();
    handleCopy(s);
  }}
  className={`h-6 w-6 rounded-lg flex items-center justify-center ${
    activeSession === s.name
      ? "text-primary-foreground hover:bg-white/20"
      : "hover:bg-secondary/60"
  }`}
  title="复制配置新建"
>
  <Copy className="h-3.5 w-3.5" />
</button>
```

- [ ] **Step 4: 从 import 中删除 Copy 图标（如果不再使用）**

检查 `Copy` 是否还在其他地方使用。如果只在复制功能中使用，从 import 中删除：

```typescript
// 从 import 列表中删除 Copy
import {
  Monitor,
  Plus,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  // Copy,  // 删除这行
  Pencil,
  Trash2,
  // ...
} from "lucide-react";
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Tmux.tsx
git commit -m "feat(tmux): 删除会话复制功能

复制功能已被工作空间创建覆盖，清理相关 UI 和逻辑。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 前端新建对话框增加 pane 布局选择

**Files:**
- 修改: `src/pages/Tmux.tsx`

- [ ] **Step 1: 添加 pane 布局相关的 state**

在主组件 `Tmux()` 的 state 声明区域（大约在第 646-657 行附近），在 `newGroupId` 之后添加：

```typescript
  const [newPaneCount, setNewPaneCount] = useState<number>(1);
  const [newLayout, setNewLayout] = useState<"horizontal" | "vertical">("horizontal");
```

- [ ] **Step 2: 在 handleCreate 中传递 pane_count 和 layout**

找到 `handleCreate` 函数（大约第 774-792 行），修改为：

```typescript
  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await tmuxCreateSession({
        name: newName.trim(),
        start_directory: newCwd.trim() || undefined,
        group_id: newGroupId,
        pane_count: newPaneCount,
        layout: newPaneCount === 2 ? newLayout : undefined,
      });
      setNewName("");
      setNewCwd("");
      setNewGroupId(null);
      setNewPaneCount(1); // 重置
      setNewLayout("horizontal"); // 重置
      setCreateOpen(false);
      loadSessions();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Create] Failed:", e);
      alert(`创建失败: ${msg}`);
    }
  };
```

- [ ] **Step 3: 在新建会话对话框中增加 pane 数量选择 UI**

找到新建会话对话框（`<Dialog open={createOpen}>` 内部，大约第 1754 行开始），在工作空间选择之后、工作目录之前，插入以下 JSX：

```tsx
            {/* Pane 数量选择 */}
            <div>
              <Label className="text-xs">Pane 数量</Label>
              <div className="flex gap-2 mt-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setNewPaneCount(n)}
                    className={`flex-1 h-9 rounded-xl border text-sm font-medium transition-all ${
                      newPaneCount === n
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-[var(--glass-border)] hover:border-primary/50 text-muted-foreground hover:bg-accent/30"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                创建 {newPaneCount} 个终端窗格
              </p>
            </div>

            {/* 2 pane 时显示布局选择 */}
            {newPaneCount === 2 && (
              <div>
                <Label className="text-xs">布局方向</Label>
                <div className="flex gap-2 mt-1.5">
                  <button
                    onClick={() => setNewLayout("horizontal")}
                    className={`flex-1 h-9 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                      newLayout === "horizontal"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-[var(--glass-border)] hover:border-primary/50 text-muted-foreground hover:bg-accent/30"
                    }`}
                  >
                    <span className="inline-block w-4 h-3 border border-current rounded-sm">
                      <span className="block w-1/2 h-full border-r border-current" />
                    </span>
                    左右
                  </button>
                  <button
                    onClick={() => setNewLayout("vertical")}
                    className={`flex-1 h-9 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                      newLayout === "vertical"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-[var(--glass-border)] hover:border-primary/50 text-muted-foreground hover:bg-accent/30"
                    }`}
                  >
                    <span className="inline-block w-4 h-3 border border-current rounded-sm">
                      <span className="block w-full h-1/2 border-b border-current" />
                    </span>
                    上下
                  </button>
                </div>
              </div>
            )}
```

- [ ] **Step 4: 确保取消按钮重置 pane state**

找到取消按钮的 onClick（在新建对话框底部），确保重置 pane state：

```typescript
onClick={() => {
  setNewName("");
  setNewCwd("");
  setNewGroupId(null);
  setNewPaneCount(1);      // 重置
  setNewLayout("horizontal"); // 重置
  setCreateOpen(false);
}}
```

- [ ] **Step 5: 构建验证前端**

Run: `cd /Users/baiyuyao/code_tools/Kimi_Agent_mac运维面板方案/macnest && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add src/pages/Tmux.tsx
git commit -m "feat(tmux): 新建会话支持 pane 数量与布局选择

- 支持 1/2/3/4 个 pane
- 2 pane 时可选择左右或上下布局
- 3 pane 品字、4 pane 田字为固定布局

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: 全量构建验证

- [ ] **Step 1: 后端编译**

Run: `cd src-tauri && cargo check`
Expected: 通过编译，无错误

- [ ] **Step 2: 前端类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit（如有变化）**

如果构建过程中有修复，一并提交。

---

## 自审检查

### Spec 覆盖检查

| 设计需求 | 对应 Task |
|---|---|
| 删除复制功能 | Task 4 |
| pane 数量 1-4 选择 | Task 5 (UI) + Task 2 (后端) |
| 2 pane 左右/上下布局 | Task 5 (UI) + Task 2 (后端) |
| 3 pane 品字形 | Task 2 |
| 4 pane 田字 | Task 2 |
| 拖拽调整大小（已有 mouse on）| 无需实现 |

### Placeholder 扫描
- 无 TBD / TODO
- 所有步骤包含具体代码
- 所有文件路径准确
- 所有命令和预期输出明确

### 类型一致性
- Rust: `pane_count: u8`, `layout: Option<String>`（"horizontal" / "vertical"）
- TS: `pane_count?: number`, `layout?: "horizontal" | "vertical"`
- 前端传递 `layout` 时仅在 `pane_count === 2` 时设置，否则 `undefined`
- 后端 `req.layout.as_deref()` 匹配 `"vertical"`，默认 `"horizontal"`
- ✅ 一致
