import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal } from "@xterm/xterm";
import BaseTerminal from "./BaseTerminal";
import { tmuxAttachPty, tmuxPtyClose, tmuxPtyResize, tmuxPtyWrite } from "@/lib/api";

export interface TmuxTerminalHandle {
  toggleSelectionMode: () => boolean;
}

interface TmuxTerminalProps {
  sessionName: string;
  onDetach: () => void;
}

const TmuxTerminal = forwardRef<TmuxTerminalHandle, TmuxTerminalProps>(
  ({ sessionName, onDetach }, ref) => {
    const [ptyId, setPtyId] = useState<string | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const termRef = useRef<Terminal | null>(null);
    const ptyIdRef = useRef<string | null>(null);

    useEffect(() => {
      ptyIdRef.current = ptyId;
      if (ptyId && termRef.current) {
        tmuxPtyResize(ptyId, termRef.current.cols, termRef.current.rows).catch(() => {});
      }
    }, [ptyId]);

    useEffect(() => {
      const id = ptyIdRef.current;
      if (!id) return;
      const seq = selectionMode
        ? "\x1b[?1002l\x1b[?1006l"  // 禁用鼠标报告
        : "\x1b[?1002h\x1b[?1006h";  // 恢复鼠标报告
      tmuxPtyWrite(id, new TextEncoder().encode(seq)).catch(() => {});
    }, [selectionMode]);

    useImperativeHandle(ref, () => ({
      toggleSelectionMode: () => {
        setSelectionMode((prev) => !prev);
        return !selectionMode;
      },
    }));

    const handleReady = useCallback(
      async (term: Terminal) => {
        termRef.current = term;

        const { Channel } = await import("@tauri-apps/api/core");
        const channel = new Channel<Uint8Array>((message: unknown) => {
          if (message instanceof Uint8Array) {
            term.write(message);
          } else if (Array.isArray(message)) {
            term.write(new Uint8Array(message));
          }
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
);

TmuxTerminal.displayName = "TmuxTerminal";
export default TmuxTerminal;
