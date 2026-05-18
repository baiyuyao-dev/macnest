import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import BaseTerminal from "./BaseTerminal";

interface XTermProps {
  websocketUrl: string;
}

export default function XTerm({ websocketUrl }: XTermProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);

  const handleReady = useCallback((term: Terminal) => {
    termRef.current = term;
    term.loadAddon(new WebLinksAddon());

    const ws = new WebSocket(websocketUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnected to SSH session\x1b[0m\r\n");
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      let data: Uint8Array;
      if (typeof event.data === "string") {
        data = new TextEncoder().encode(event.data);
      } else {
        data = new Uint8Array(event.data);
      }
      term.write(data);
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[31m[Connection closed]\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[Connection error]\x1b[0m");
    };
  }, [websocketUrl]);

  const handleData = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(data));
    }
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return <BaseTerminal onData={handleData} onReady={handleReady} className="h-full w-full" />;
}
