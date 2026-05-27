import { useEffect, useRef, useLayoutEffect, type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
  onClick: () => void;
}

export type ContextMenuItemOrDivider = ContextMenuItem | "divider";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItemOrDivider[];
  onClose: () => void;
}

export default function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 在浏览器绘制前调整位置，避免菜单闪现到错误位置
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;

    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let ax = x;
    let ay = y;

    // 水平：超出右侧则紧贴鼠标左侧展开
    if (x + rect.width > vw - 8) {
      ax = x - rect.width;
    }
    if (ax < 8) ax = 8;

    // 垂直：先向下展开，放不下再向上
    if (y + rect.height > vh - 8) {
      ay = y - rect.height;
    }
    if (ay < 8) ay = 8;

    el.style.left = `${ax}px`;
    el.style.top = `${ay}px`;
  }, [open, x, y]);

  // 事件监听
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    const handleClick = () => onCloseRef.current();
    const handleScroll = () => onCloseRef.current();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleClick, { once: true });
    window.addEventListener("scroll", handleScroll, { once: true, capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 glass-strong border border-[var(--glass-border-strong)] rounded-xl shadow-xl py-1.5 min-w-[180px] max-w-[260px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) =>
        item === "divider" ? (
          <div key={`div-${idx}`} className="h-px bg-[var(--glass-border)] mx-2 my-1" />
        ) : (
          <button
            key={item.id}
            className={`w-full px-3 py-2 text-xs flex items-center gap-2 transition-colors text-left outline-none ${
              item.disabled
                ? "opacity-40 cursor-default"
                : item.destructive
                ? "text-red-500 hover:bg-red-500/10 cursor-pointer"
                : "hover:bg-accent/40 cursor-pointer focus:bg-accent/40"
            }`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-muted-foreground ml-2 shrink-0">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}
