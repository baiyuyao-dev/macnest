import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import BaseTerminal from "./BaseTerminal";
import { tmuxAttachPty, tmuxPtyClose, tmuxPtyResize, tmuxPtyWrite } from "@/lib/api";

interface TmuxTerminalProps {
  sessionName: string;
  onDetach: () => void;
}

export default function TmuxTerminal({ sessionName, onDetach }: TmuxTerminalProps) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);

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
        let data: Uint8Array;
        if (message instanceof Uint8Array) {
          data = message;
        } else if (Array.isArray(message)) {
          data = new Uint8Array(message);
        } else {
          return;
        }

        // 过滤 tmux 鼠标模式指令，保留本地选区功能
        const filtered = new TextDecoder().decode(data).replace(
          /\x1b\[\?(1000|1001|1002|1003|1004|1005|1006|1015)[hl]/g,
          ""
        );
        term.write(filtered);
      });

      try {
        const id = await tmuxAttachPty(sessionName, channel, term.cols, term.rows);
        setPtyId(id);
      } catch (e) {
        term.writeln(`\r\n\x1b[31m[Failed to attach: ${e}]\x1b[0m`);
      }
    },
    [sessionName]
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
