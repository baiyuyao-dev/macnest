import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface BaseTerminalProps {
  onData: (data: string) => void;
  onReady: (term: Terminal) => void;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
}

export default function BaseTerminal({ onData, onReady, onResize, className }: BaseTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const container = terminalRef.current;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: 'Menlo, "DejaVu Sans Mono", "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#10b981",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();
    term.focus();

    term.onData((data) => {
      onData(data);
    });

    term.onResize(({ cols, rows }) => {
      onResize?.(cols, rows);
    });

    // 跟踪容器尺寸，用于检测从隐藏(display:none/visibility:hidden)恢复后的首次有效尺寸
    let lastWidth = 0;
    let lastHeight = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // 正常 resize：只要尺寸有效就 fit
        if (width > 0 && height > 0) {
          fitAddon.fit();
          // 如果是从 0 尺寸恢复（tab/路由切换），强制刷新整屏
          if (lastWidth === 0 || lastHeight === 0) {
            requestAnimationFrame(() => {
              term.refresh(0, term.rows - 1);
            });
          }
        }
        lastWidth = width;
        lastHeight = height;
      }
    });
    resizeObserver.observe(container);

    // 额外：监听容器及父链的 display/visibility style 变化，在变为可见时立即触发 resize
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          const el = mutation.target as HTMLElement;
          const style = window.getComputedStyle(el);
          if (style.visibility !== "hidden" && style.display !== "none") {
            // 容器变为可见，延迟确保布局完成后 fit + refresh
            requestAnimationFrame(() => {
              fitAddon.fit();
              term.refresh(0, term.rows - 1);
            });
          }
        }
      }
    });
    let target: HTMLElement | null = container;
    while (target) {
      mutationObserver.observe(target, { attributes: true, attributeFilter: ["style"] });
      target = target.parentElement;
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 同步初始尺寸
    onResize?.(term.cols, term.rows);
    onReady(term);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [onData, onReady, onResize]);

  return <div ref={terminalRef} className={className ?? "h-full w-full"} />;
}
