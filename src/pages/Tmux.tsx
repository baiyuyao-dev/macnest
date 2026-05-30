import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Monitor,
  Plus,
  RefreshCw,
  Square,
  ExternalLink,
  Terminal as TerminalIcon,
  Copy,
  Pencil,
  Trash2,
  FolderOpen,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import TmuxTerminal from "@/components/terminal/TmuxTerminal";
import {
  tmuxListSessions,
  tmuxCreateSession,
  tmuxKillSession,
  tmuxRenameSession,
  tmuxUpdateSessionStartDirectory,
  tmuxOpenInGhostty,
} from "@/lib/api";
import type { TmuxSession } from "@/types";

export default function Tmux() {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTmux, setHasTmux] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editName, setEditName] = useState("");
  const [editCwd, setEditCwd] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(400);
  const [dragOverlay, setDragOverlay] = useState<"col-resize" | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      e.preventDefault();
      if (isDragging.current && sidebarRef.current && containerRef.current) {
        const delta = e.clientX - startXRef.current;
        const containerWidth = containerRef.current.offsetWidth;
        const minWidth = 220;
        const maxWidth = containerWidth * 0.6;
        const w = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
        sidebarRef.current.style.width = w + "px";
      }
    };
    const handleUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        const w = sidebarRef.current?.offsetWidth ?? 400;
        setSidebarWidth(w);
      }
      setDragOverlay(null);
    };
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tmuxListSessions();
      setSessions(data);
      setHasTmux(true);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      if (msg.includes("no server")) {
        setSessions([]);
        setHasTmux(true);
      } else {
        setHasTmux(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 当前激活会话的展示名
  const activeDisplayName = useMemo(() => {
    if (!activeSession) return "";
    return sessions.find((s) => s.name === activeSession)?.display_name || activeSession;
  }, [activeSession, sessions]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await tmuxCreateSession({
        name: newName.trim(),
        start_directory: newCwd.trim() || undefined,
      });
      setNewName("");
      setNewCwd("");
      setCreateOpen(false);
      loadSessions();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Create] Failed:", e);
      alert(`创建失败: ${msg}`);
    }
  };

  const handleKill = async () => {
    if (!deleteTarget) return;
    try {
      await tmuxKillSession(deleteTarget);
      // 检查是否删除了当前激活的会话
      const deleted = sessions.find((s) => s.display_name === deleteTarget);
      if (deleted && activeSession === deleted.name) {
        setActiveSession(null);
      }
      setDeleteOpen(false);
      setDeleteTarget("");
      loadSessions();
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Kill] Failed:", e);
      alert(`删除失败: ${msg}`);
    }
  };

  // 统一提取错误消息（处理 AppError 对象）
  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return String(e);
  };

  const handleEdit = async () => {
    if (!editName.trim() || !editTarget) return;
    const trimmedName = editName.trim();
    const trimmedCwd = editCwd.trim();

    // 查找原始会话信息
    const original = sessions.find((s) => s.display_name === editTarget);
    if (!original) {
      alert("会话信息已失效，请刷新后重试");
      return;
    }

    const originalCwd = original.start_directory || "";
    const nameChanged = trimmedName !== editTarget;
    const cwdChanged = trimmedCwd !== originalCwd;

    console.log("[Tmux Edit]", { editTarget, trimmedName, trimmedCwd, originalCwd, nameChanged, cwdChanged });

    if (!nameChanged && !cwdChanged) {
      setEditOpen(false);
      setEditTarget("");
      setEditName("");
      setEditCwd("");
      return; // 没有任何变化
    }

    try {
      // 1. 更新名称（如有变化）
      if (nameChanged) {
        console.log("[Tmux Edit] Renaming:", editTarget, "->", trimmedName);
        await tmuxRenameSession({
          old_name: editTarget,
          new_name: trimmedName,
        });
      }

      // 2. 更新工作目录（如有变化）
      if (cwdChanged) {
        const lookupName = nameChanged ? trimmedName : editTarget;
        console.log("[Tmux Edit] Updating directory for:", lookupName, "->", trimmedCwd);
        await tmuxUpdateSessionStartDirectory(lookupName, trimmedCwd);
      }

      setEditOpen(false);
      setEditTarget("");
      setEditName("");
      setEditCwd("");
      await loadSessions();

      // 3. 如果工作目录变了，提示用户是否需要销毁重建
      if (cwdChanged) {
        const shouldRebuild = confirm(
          "工作目录已更新，但当前运行的 tmux 会话不会自动切换目录。\n\n" +
          "是否需要销毁当前会话并重新创建以应用新目录？\n\n" +
          "⚠️ 警告：此操作会丢失当前会话内的所有状态（如未保存的工作、历史命令等）。"
        );
        if (shouldRebuild) {
          try {
            // 获取最新的 display_name（可能已重命名）
            const displayNameToKill = nameChanged ? trimmedName : editTarget;
            console.log("[Tmux Edit] Rebuilding session:", displayNameToKill);
            await tmuxKillSession(displayNameToKill);
            await tmuxCreateSession({
              name: nameChanged ? trimmedName : editTarget,
              start_directory: trimmedCwd || undefined,
            });
            await loadSessions();
            alert("会话已重建，新工作目录已生效。");
          } catch (e: unknown) {
            const msg = getErrorMessage(e);
            console.error("[Tmux Edit] Rebuild failed:", e);
            alert(`重建失败: ${msg}`);
          }
        }
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Edit] Edit failed:", e);
      alert(`编辑失败: ${msg}`);
    }
  };

  const handleCopy = (session: TmuxSession) => {
    const copyName = session.display_name + "-copy";
    setNewName(copyName);
    setNewCwd(session.start_directory || "");
    setCreateOpen(true);
  };

  const handleAttach = (name: string) => {
    setActiveSession(name);
  };

  const handleDetach = () => {
    setActiveSession(null);
  };

  const handleGhostty = async (displayName: string) => {
    try {
      await tmuxOpenInGhostty(displayName);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      console.error("[Tmux Ghostty] Failed:", e);
      alert(`Ghostty 打开失败: ${msg}`);
    }
  };

  const pickDirectory = async (setter: (path: string) => void) => {
    try {
      const selected = await open({ directory: true });
      if (selected && typeof selected === "string") {
        setter(selected);
      }
    } catch {
      // 用户取消选择，忽略
    }
  };

  if (!hasTmux) {
    return (
      <div className="flex h-full items-center justify-center animate-page-enter">
        <div className="text-center card-macos p-10 max-w-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto mb-5">
            <TerminalIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="mb-2 text-lg font-semibold tracking-tight">未检测到 tmux</h2>
          <p className="text-sm text-muted-foreground">
            请先安装 tmux：brew install tmux
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col animate-page-enter">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-2.5">
          <Monitor className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">Tmux 会话</h1>
          <Badge variant="secondary" className="text-[10px] rounded-full px-2">{sessions.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs rounded-lg btn-macos-secondary" onClick={loadSessions}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            刷新
          </Button>
          <Button size="sm" className="h-8 text-xs rounded-lg btn-macos" onClick={() => { setNewName(""); setNewCwd(""); setCreateOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建会话
          </Button>
        </div>
      </div>

      {/* 拖动时全屏透明覆盖层，防止 xterm 拦截鼠标事件 */}
      {dragOverlay && (
        <div
          className="fixed inset-0 z-[9999]"
          style={{ cursor: dragOverlay }}
        />
      )}

      {/* 主内容 */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* 左侧：会话列表 */}
        <div
          ref={sidebarRef}
          className="overflow-auto p-4 shrink-0"
          style={{ width: activeSession ? sidebarWidth : undefined, flex: activeSession ? undefined : 1 }}
        >
          {sessions.length === 0 && !loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mx-auto mb-4">
                  <TerminalIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">没有 tmux 会话</p>
                <Button size="sm" className="btn-macos" onClick={() => setCreateOpen(true)}>
                  创建第一个会话
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sessions.map((s, i) => (
                <div
                  key={s.name}
                  className={`group card-macos p-4 cursor-pointer transition-all duration-300 hover:bg-accent/40 hover:shadow-glass-lg animate-slide-up ${
                    activeSession === s.name
                      ? "border-primary/50 shadow-glass-lg"
                      : "hover:border-[var(--glass-border-strong)]"
                  }`}
                  style={{ animationDelay: `${i * 50}ms` }}
                  onClick={() => handleAttach(s.name)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`shrink-0 h-2.5 w-2.5 rounded-full ${activeSession === s.name ? "bg-primary animate-pulse-dot" : "bg-emerald-500"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{s.display_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {s.windows} 个窗口 · {s.created_at}
                          {s.start_directory && (
                            <span className="ml-1.5 text-[10px] opacity-70">· {s.start_directory}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {activeSession === s.name ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); handleDetach(); }}
                            title="断开"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => { e.stopPropagation(); handleCopy(s); }} title="复制配置新建"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => { e.stopPropagation(); handleGhostty(s.display_name); }} title="Ghostty 中打开"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => { e.stopPropagation(); handleCopy(s); }} title="复制配置新建"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(s.display_name);
                              setEditName(s.display_name);
                              setEditCwd(s.start_directory || "");
                              setEditOpen(true);
                            }}
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(s.display_name); setDeleteOpen(true); }}
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Horizontal splitter */}
        {activeSession && (
          <div
            className="w-2 shrink-0 z-20 group relative cursor-col-resize"
            onMouseDown={(e) => {
              e.preventDefault();
              isDragging.current = true;
              startXRef.current = e.clientX;
              startWidthRef.current = sidebarRef.current?.offsetWidth ?? 400;
              setDragOverlay("col-resize");
            }}
          >
            <div className="absolute inset-0 -left-1 -right-1" />
            <div className="w-[3px] h-full mx-auto bg-border group-hover:bg-primary rounded-full transition-colors" />
          </div>
        )}

        {/* 右侧：终端区域 */}
        {activeSession && (
          <div className="flex flex-1 flex-col bg-muted m-3 rounded-2xl overflow-hidden border border-[var(--glass-border)]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot" />
                <span className="text-sm font-medium">{activeDisplayName}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg hover:bg-secondary/60"
                  onClick={() => handleGhostty(activeDisplayName)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Ghostty
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 rounded-lg"
                  onClick={handleDetach}
                >
                  <Square className="mr-1 h-3 w-3" />
                  断开
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TmuxTerminal key={activeSession} sessionName={activeSession} onDetach={handleDetach} />
            </div>
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">新建 tmux 会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">会话名称</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如 my-project、web-server"
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleCreate()} className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作目录</Label>
              <div className="flex gap-2 mt-1.5">
                <Input value={newCwd} onChange={(e) => setNewCwd(e.target.value)} placeholder="如 /Users/xxx/projects，留空使用主目录"
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleCreate()} className="input-macos flex-1"
                />
                <Button variant="outline" size="sm" className="h-9 px-3 rounded-lg text-xs"
                  onClick={() => pickDirectory(setNewCwd)} type="button"
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  浏览
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setNewName(""); setNewCwd(""); setCreateOpen(false); }}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleCreate} disabled={!newName.trim()}>创建</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">编辑会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">会话名称</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="会话名称"
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleEdit()} className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作目录</Label>
              <div className="flex gap-2 mt-1.5">
                <Input value={editCwd} onChange={(e) => setEditCwd(e.target.value)} placeholder="如 /Users/xxx/projects"
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleEdit()} className="input-macos flex-1"
                />
                <Button variant="outline" size="sm" className="h-9 px-3 rounded-lg text-xs"
                  onClick={() => pickDirectory(setEditCwd)} type="button"
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-1" />
                  浏览
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                修改工作目录后，当前运行的 tmux 会话不会自动切换。保存后可选择是否销毁重建以应用新目录。
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setEditOpen(false); setEditTarget(""); }}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleEdit} disabled={!editName.trim()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">删除会话</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            确定要销毁 tmux 会话 <strong>"{deleteTarget}"</strong> 吗？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleKill}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
