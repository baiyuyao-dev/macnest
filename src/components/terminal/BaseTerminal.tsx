import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface BaseTerminalProps {
  onData: (data: string) => void;
  onReady: (term: Terminal) => void;
  onResize?: (cols: number, rows: number) => void;
  onVisibilityChange?: (visible: boolean) => void;
  active?: boolean;
  className?: string;
}

export default function BaseTerminal({
  onData,
  onReady,
  onResize,
  onVisibilityChange,
  active,
  className,
}: BaseTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    const container = terminalRef.current;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let initialized = false;

    const initTerminal = () => {
      if (initialized) return;
      initialized = true;

      term = new Terminal({
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

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);
      fitAddon.fit();
      term.focus();
      term.refresh(0, term.rows - 1);

      term.onData((data) => {
        onData(data);
      });

      term.onResize(({ cols, rows }) => {
        onResize?.(cols, rows);
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      onResize?.(term.cols, term.rows);
      onReady(term);
    };

    // 如果容器已有有效尺寸，立即初始化；否则延迟到 ResizeObserver 检测到有效尺寸
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      initTerminal();
    }

    // ResizeObserver：处理延迟初始化 + 后续尺寸变化
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        if (!initialized && width > 0 && height > 0) {
          initTerminal();
        }

        if (initialized && width > 0 && height > 0) {
          fitAddon?.fit();
          if (lastWidth === 0 || lastHeight === 0) {
            requestAnimationFrame(() => {
              term?.refresh(0, term.rows - 1);
            });
          }
        }

        lastWidth = width;
        lastHeight = height;
      }
    });
    resizeObserver.observe(container);

    // IntersectionObserver：检测从 visibility:hidden 恢复后的刷新
    // React 通过修改 CSS property（非 attribute）设置 visibility，MutationObserver 监听不到
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && initialized) {
            requestAnimationFrame(() => {
              fitAddon?.fit();
              term?.refresh(0, term.rows - 1);
            });
            onVisibilityChange?.(true);
          } else if (!entry.isIntersecting) {
            onVisibilityChange?.(false);
          }
        }
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      term?.dispose();
      termRef.current = null;
    };
  }, [onData, onReady, onResize, onVisibilityChange]);

  useEffect(() => {
    if (active && termRef.current) {
      termRef.current.focus();
    }
  }, [active]);

  return <div ref={terminalRef} className={className ?? "h-full w-full"} />;
}
