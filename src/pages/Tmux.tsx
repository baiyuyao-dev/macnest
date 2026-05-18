import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
} from "lucide-react";
import TmuxTerminal from "@/components/terminal/TmuxTerminal";
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
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);

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

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await tmuxCreateSession({ name: newName.trim() });
    setNewName("");
    setCreateOpen(false);
    loadSessions();
  };

  const handleKill = async (name: string) => {
    if (!confirm(`确定要删除 tmux 会话 "${name}" 吗？`)) return;
    await tmuxKillSession(name);
    if (activeSession === name) {
      setActiveSession(null);
    }
    loadSessions();
  };

  const handleRename = async () => {
    if (!newName.trim() || !renameTarget) return;
    await tmuxRenameSession({
      old_name: renameTarget,
      new_name: newName.trim(),
    });
    setNewName("");
    setRenameOpen(false);
    if (activeSession === renameTarget) {
      setActiveSession(newName.trim());
    }
    loadSessions();
  };

  const handleAttach = (name: string) => {
    setActiveSession(name);
  };

  const handleDetach = () => {
    setActiveSession(null);
  };

  const handleGhostty = async (name: string) => {
    await tmuxOpenInGhostty(name);
  };

  if (!hasTmux) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <TerminalIcon className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">未检测到 tmux</h2>
          <p className="mb-4 text-muted-foreground">
            请先安装 tmux：brew install tmux
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Tmux 会话</h1>
          <Badge variant="secondary">{sessions.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadSessions}>
            <RefreshCw className="mr-1 h-4 w-4" />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setNewName("");
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            新建会话
          </Button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：会话列表 */}
        <div
          className={`${activeSession ? "w-[320px]" : "flex-1"} overflow-auto border-r p-4`}
        >
          {sessions.length === 0 && !loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <TerminalIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-muted-foreground">没有 tmux 会话</p>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  创建第一个会话
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <Card
                  key={s.name}
                  className={`cursor-pointer transition-colors ${
                    activeSession === s.name
                      ? "border-primary bg-primary/5"
                      : "hover:bg-accent"
                  }`}
                  onClick={() => handleAttach(s.name)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-3 w-3 rounded-full ${
                            s.attached ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        <div>
                          <p className="font-semibold">{s.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.windows} 个窗口 · {s.created_at}
                            {s.attached && " · 已连接"}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {activeSession === s.name ? (
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDetach();
                            }}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGhostty(s.name);
                              }}
                              title="Ghostty 中打开"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameTarget(s.name);
                                setNewName(s.name);
                                setRenameOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleKill(s.name);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：终端区域 */}
        {activeSession && (
          <div className="flex flex-1 flex-col bg-[#0f0f1a]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-white">
                  {activeSession}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={() => handleGhostty(activeSession)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Ghostty
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-red-400 hover:bg-white/10 hover:text-red-300"
                  onClick={handleDetach}
                >
                  <Square className="mr-1 h-3 w-3" />
                  断开
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TmuxTerminal
                key={activeSession}
                sessionName={activeSession}
                onDetach={handleDetach}
              />
            </div>
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 tmux 会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>会话名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如 frpc-dev"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!newName.trim()}>
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>新名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                取消
              </Button>
              <Button onClick={handleRename} disabled={!newName.trim()}>
                重命名
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
