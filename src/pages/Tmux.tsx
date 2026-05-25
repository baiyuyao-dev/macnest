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
  Trash2,
  Pencil,
  Square,
  ExternalLink,
  Terminal as TerminalIcon,
  Copy,
} from "lucide-react";
import TmuxTerminal from "@/components/terminal/TmuxTerminal";
import type { TmuxTerminalHandle } from "@/components/terminal/TmuxTerminal";
import {
  tmuxListSessions,
  tmuxCreateSession,
  tmuxKillSession,
  tmuxRenameSession,
  tmuxOpenInGhostty,
} from "@/lib/api";
import type { TmuxSession } from "@/types";

export default function Tmux() {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasTmux, setHasTmux] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const terminalRef = useRef<TmuxTerminalHandle>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tmuxListSessions();
      setSessions(data);
      setHasTmux(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
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
      const msg = e instanceof Error ? e.message : String(e);
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
      const msg = e instanceof Error ? e.message : String(e);
      alert(`删除失败: ${msg}`);
    }
  };

  const handleRename = async () => {
    if (!newName.trim() || !renameTarget) return;
    try {
      await tmuxRenameSession({
        old_name: renameTarget,
        new_name: newName.trim(),
      });
      setNewName("");
      setRenameOpen(false);
      setRenameTarget("");
      loadSessions();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`重命名失败: ${msg}`);
    }
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
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : String(e);
      alert(`Ghostty 打开失败: ${msg}`);
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
          <Button size="sm" className="h-8 text-xs rounded-lg btn-macos" onClick={() => { setNewName(""); setCreateOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建会话
          </Button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：会话列表 */}
        <div className={`${activeSession ? "w-[320px]" : "flex-1"} overflow-auto p-4`}>
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${activeSession === s.name ? "bg-primary animate-pulse-dot" : "bg-emerald-500"}`} />
                      <div>
                        <p className="text-sm font-semibold">{s.display_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {s.windows} 个窗口 · {s.created_at}
                          {s.start_directory && (
                            <span className="ml-1.5 text-[10px] opacity-70">· {s.start_directory}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {activeSession === s.name ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500"
                          onClick={(e) => { e.stopPropagation(); handleDetach(); }}
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => { e.stopPropagation(); handleGhostty(s.display_name); }} title="Ghostty 中打开"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-secondary/60"
                            onClick={(e) => { e.stopPropagation(); setRenameTarget(s.display_name); setNewName(s.display_name); setRenameOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(s.display_name); setDeleteOpen(true); }}
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

        {/* 右侧：终端区域 */}
        {activeSession && (
          <div className="flex flex-1 flex-col bg-muted m-3 rounded-2xl overflow-hidden border border-[var(--glass-border)]">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot" />
                <span className="text-sm font-medium">{activeDisplayName}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={selectionMode ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs rounded-lg"
                  onClick={() => {
                    const next = terminalRef.current?.toggleSelectionMode() ?? false;
                    setSelectionMode(next);
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {selectionMode ? "选区中" : "选区"}
                </Button>
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
              <TmuxTerminal ref={terminalRef} key={activeSession} sessionName={activeSession} onDetach={handleDetach} />
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
                onKeyDown={(e) => e.key === "Enter" && handleCreate()} className="input-macos mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">工作目录</Label>
              <Input value={newCwd} onChange={(e) => setNewCwd(e.target.value)} placeholder="如 /Users/xxx/projects，留空使用主目录"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()} className="input-macos mt-1.5"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setNewName(""); setNewCwd(""); setCreateOpen(false); }}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleCreate} disabled={!newName.trim()}>创建</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">重命名会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label className="text-xs">新名称</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename()} className="input-macos mt-1.5" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setRenameOpen(false)}>取消</Button>
              <Button size="sm" className="btn-macos rounded-lg" onClick={handleRename} disabled={!newName.trim()}>重命名</Button>
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
