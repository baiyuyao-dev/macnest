import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import ContextMenu, { type ContextMenuItemOrDivider } from "./ContextMenu";
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
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItemOrDivider[];
  }>({ open: false, x: 0, y: 0, items: [] });

  useEffect(() => {
    if (!terminalRef.current) return;
    const container = terminalRef.current;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let initialized = false;

    // 捕获阶段拦截右键 mousedown，阻止 xterm.js 把右键转成 ANSI 序列发给 tmux
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.stopImmediatePropagation();
      }
    };
    container.addEventListener("mousedown", handleMouseDown, true);

    // 捕获阶段拦截 contextmenu，阻止浏览器默认菜单，并弹出自定义菜单
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      const localTerm = termRef.current;
      if (!localTerm) return;

      const hasSelection = localTerm.hasSelection();
      const items: ContextMenuItemOrDivider[] = [
        {
          id: "copy",
          label: "复制",
          shortcut: "⌘C",
          disabled: !hasSelection,
          onClick: () => {
            writeText(localTerm.getSelection()).catch(() => {});
          },
        },
        {
          id: "paste",
          label: "粘贴",
          shortcut: "⌘V",
          onClick: async () => {
            try {
              const text = await readText();
              if (text) {
                localTerm.paste(text);
              }
            } catch {
              // ignore
            }
          },
        },
        "divider",
        {
          id: "select-all",
          label: "全选",
          shortcut: "⌘A",
          onClick: () => {
            localTerm.selectAll();
          },
        },
      ];

      setContextMenu({ open: true, x: e.clientX, y: e.clientY, items });
    };
    container.addEventListener("contextmenu", handleContextMenu, true);

    const initTerminal = () => {
      if (initialized) return;
      initialized = true;

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: 'Menlo, "DejaVu Sans Mono", "Courier New", monospace',
        fontSize: 14,
        allowProposedApi: true,
        macOptionClickForcesSelection: true,
        theme: {
          background: "#1a1a2e",
          foreground: "#e0e0e0",
          cursor: "#10b981",
          selectionBackground: "#3b82f6",
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

      // Cmd+C 复制选中文本；Cmd+V 粘贴；Cmd+A 全选；Escape 阻止冒泡避免 Dialog 捕获
      const localTerm = term;
      localTerm.attachCustomKeyEventHandler((e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          return true;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
          e.preventDefault();
          localTerm.selectAll();
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "c" && localTerm.hasSelection()) {
          e.preventDefault();
          writeText(localTerm.getSelection()).catch(() => {});
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "v") {
          e.preventDefault();
          readText()
            .then((text) => {
              if (text) {
                localTerm.paste(text);
              }
            })
            .catch(() => {});
          return false;
        }
        return true;
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
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("contextmenu", handleContextMenu, true);
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

  return (
    <>
      <div className={`${className ?? "h-full w-full"} pr-2 box-border overflow-hidden`}>
        <div ref={terminalRef} className="h-full w-full" />
      </div>
      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenu.items}
        onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}
