import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import BaseTerminal from "./BaseTerminal";
import { tmuxAttachPty, tmuxHasClaudeProcess, tmuxPtyClose, tmuxPtyResize, tmuxPtyWrite } from "@/lib/api";

interface TmuxTerminalProps {
  sessionName: string;
  onDetach: () => void;
  onIdle?: (idle: boolean) => void;
  readVersion?: number;
}

const IDLE_THRESHOLD_MS = 3000;
const SPINNER_IDLE_THRESHOLD_MS = 8000;

// Claude Code "Processing..." / "Thinking" 等关键词 — 检测到说明还在工作中
const WORKING_KEYWORDS = ["Processing", "Thinking", "Analyzing", "Generating"];

// 输出中是否包含"工作中"的指示（spinner 或关键词）
function outputHasWorkingIndicator(data: Uint8Array | number[]): boolean {
  // 1. 检测 Braille spinner (U+2800-U+28FF)
  // UTF-8: E2 A0 80-FF, E2 A1 80-FF, E2 A2 80-FF, E2 A3 80-FF
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0xe2 && data[i + 1] >= 0xa0 && data[i + 1] <= 0xa3) {
      return true; // 任何 Braille pattern 都认为在 spinner
    }
  }

  // 2. 检测关键词（转为字符串匹配）
  try {
    const text = new TextDecoder().decode(
      data instanceof Uint8Array ? data : new Uint8Array(data)
    );
    for (const kw of WORKING_KEYWORDS) {
      if (text.includes(kw)) return true;
    }
  } catch {
    // ignore decode errors
  }

  return false;
}

export default function TmuxTerminal({ sessionName, onDetach, onIdle, readVersion = 0 }: TmuxTerminalProps) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [hasClaude, setHasClaude] = useState(false);
  const termRef = useRef<Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleNotifiedRef = useRef(false);
  const lastWorkingRef = useRef(false);
  const prevReadVersionRef = useRef(readVersion);
  const claudeCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询检测 tmux session 中是否有 claude 进程
  useEffect(() => {
    const check = async () => {
      try {
        const found = await tmuxHasClaudeProcess(sessionName);
        setHasClaude((prev) => {
          if (prev && !found) {
            // claude 退出了 → 清理 idle 状态
            idleNotifiedRef.current = false;
            lastWorkingRef.current = false;
            if (idleTimerRef.current) {
              clearTimeout(idleTimerRef.current);
              idleTimerRef.current = null;
            }
          }
          return found;
        });
      } catch {
        // ignore
      }
    };

    check(); // 立即查一次
    claudeCheckRef.current = setInterval(check, 5000);
    return () => {
      if (claudeCheckRef.current) {
        clearInterval(claudeCheckRef.current);
        claudeCheckRef.current = null;
      }
    };
  }, [sessionName]);

  // 用户已读（readVersion 变化）→ 重置 idle 状态，允许下一轮检测
  useEffect(() => {
    if (readVersion !== prevReadVersionRef.current) {
      prevReadVersionRef.current = readVersion;
      idleNotifiedRef.current = false;
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }
  }, [readVersion]);

  useEffect(() => {
    ptyIdRef.current = ptyId;
    // 补发 resize：ptyId 设置时，用 term 当前尺寸同步一次
    if (ptyId && termRef.current) {
      tmuxPtyResize(ptyId, termRef.current.cols, termRef.current.rows).catch(() => {});
    }
  }, [ptyId]);

  const handleReady = useCallback(
    async (term: Terminal) => {
      termRef.current = term;

      const { Channel } = await import("@tauri-apps/api/core");
      const channel = new Channel<Uint8Array>((message: unknown) => {
        let data: Uint8Array | number[] = [];
        if (message instanceof Uint8Array) {
          data = message;
          term.write(message);
        } else if (Array.isArray(message)) {
          data = message;
          term.write(new Uint8Array(message));
        }

        // 没有 claude 进程 → 不做 idle 检测
        if (!hasClaude) return;

        // 检测 claude code 是否还在工作中（spinner 或 Processing/Thinking 关键词）
        const isWorking = outputHasWorkingIndicator(data);
        if (isWorking) {
          lastWorkingRef.current = true;
        }

        // 有输出时重置 idle 计时器
        if (idleNotifiedRef.current) {
          idleNotifiedRef.current = false;
          onIdle?.(false);
        }
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
        }

        // 如果最近检测到过工作中指示，用更长的超时（避免思考间隙误判）
        const threshold = lastWorkingRef.current ? SPINNER_IDLE_THRESHOLD_MS : IDLE_THRESHOLD_MS;
        idleTimerRef.current = setTimeout(() => {
          if (!idleNotifiedRef.current) {
            idleNotifiedRef.current = true;
            lastWorkingRef.current = false; // 超时后重置工作状态
            onIdle?.(true);
          }
        }, threshold);
      });

      try {
        const id = await tmuxAttachPty(sessionName, channel, term.cols, term.rows);
        setPtyId(id);
      } catch (e) {
        term.writeln(`\r\n\x1b[31m[Failed to attach: ${e}]\x1b[0m`);
      }
    },
    [sessionName, hasClaude]
  );

  const handleData = useCallback((data: string) => {
    const id = ptyIdRef.current;
    if (id) {
      tmuxPtyWrite(id, new TextEncoder().encode(data)).catch(() => {});
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const id = ptyIdRef.current;
    if (id) {
      tmuxPtyResize(id, cols, rows).catch(() => {});
    }
  }, []);

  useEffect(() => {
    return () => {
      const id = ptyIdRef.current;
      if (id) {
        tmuxPtyClose(id).catch(() => {});
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      if (claudeCheckRef.current) {
        clearInterval(claudeCheckRef.current);
      }
    };
  }, []);

  return (
    <BaseTerminal
      onData={handleData}
      onReady={handleReady}
      onResize={handleResize}
      className="h-full w-full"
    />
  );
}
