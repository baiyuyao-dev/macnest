import { forwardRef, useImperativeHandle, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import BaseTerminal from "./BaseTerminal";

export interface XTermHandle {
  /** 向终端发送命令（自动附加回车） */
  sendCommand: (command: string) => void;
}

interface XTermProps {
  websocketUrl: string;
  active?: boolean;
  onPathChange?: (path: string) => void;
}

const XTerm = forwardRef<XTermHandle, XTermProps>(function XTerm({ websocketUrl, active, onPathChange }, ref) {
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectWs = useCallback((term: Terminal) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    const existing = wsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      return;
    }

    existing?.close();
    wsRef.current = null;

    const ws = new WebSocket(websocketUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));

      // 配置 shell 自动报告当前工作目录（OSC 7 序列）
      const shellIntegration = [
        'if [ -n "$ZSH_VERSION" ]; then',
        '  precmd() { printf "\\033]7;file://%s%s\\007" "$HOSTNAME" "$PWD" }',
        'elif [ -n "$BASH_VERSION" ]; then',
        '  export PROMPT_COMMAND=\'printf "\\033]7;file://%s%s\\007" "$HOSTNAME" "$PWD"\'',
        'fi',
        '',
      ].join('\n');
      const initBytes = new TextEncoder().encode(shellIntegration + '\r');
      const initB64 = btoa(String.fromCharCode(...initBytes));
      ws.send(initB64);

      keepaliveTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("\0");
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      if (event.data === "\0") return;
      try {
        const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
        term.write(bytes);
      } catch {
        // ignore non-base64
      }
    };

    ws.onclose = () => {
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
      reconnectTimerRef.current = setTimeout(() => {
        if (termRef.current) {
          connectWs(termRef.current);
        }
      }, 1000);
    };

    ws.onerror = () => {};
  }, [websocketUrl]);

  const handleReady = useCallback((term: Terminal) => {
    termRef.current = term;
    term.loadAddon(new WebLinksAddon());

    // 注册 OSC 7 处理器，静默捕获 shell 报告的当前工作目录
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = (term as any).parser;
    if (onPathChange && parser?.registerOscHandler) {
      parser.registerOscHandler(7, (data: string) => {
        try {
          // data 格式: file://hostname/path
          const url = new URL(data);
          const path = decodeURIComponent(url.pathname);
          onPathChange(path);
        } catch {
          const match = data.match(/^file:\/\/[^/]+(.+)$/);
          if (match) {
            onPathChange(decodeURIComponent(match[1]));
          }
        }
        return true; // true = 已消费，不输出到终端
      });
    }

    connectWs(term);
  }, [connectWs, onPathChange]);

  const handleData = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const bytes = new TextEncoder().encode(data);
      const b64 = btoa(String.fromCharCode(...bytes));
      ws.send(b64);
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const handleVisibilityChange = useCallback((visible: boolean) => {
    if (!visible) return;
    const term = termRef.current;
    if (!term) return;
    requestAnimationFrame(() => {
      term.refresh(0, term.rows - 1);
    });
    const ws = wsRef.current;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connectWs(term);
    }
  }, [connectWs]);

  // 暴露 sendCommand 方法给父组件
  useImperativeHandle(ref, () => ({
    sendCommand: (command: string) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const bytes = new TextEncoder().encode(command + "\r");
        const b64 = btoa(String.fromCharCode(...bytes));
        ws.send(b64);
      }
    },
  }));

  // 组件卸载时彻底清理所有资源（不依赖 websocketUrl）
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return (
    <BaseTerminal
      onData={handleData}
      onReady={handleReady}
      onResize={handleResize}
      onVisibilityChange={handleVisibilityChange}
      active={active}
      className="h-full w-full"
    />
  );
});

export default XTerm;
