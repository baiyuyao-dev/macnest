import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";

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
  const [pos, setPos] = useState<[number, number]>([x, y]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", onClose, { once: true });
    window.addEventListener("scroll", onClose, { once: true, capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [open, handleKeyDown, onClose]);

  useEffect(() => {
    if (!open || !menuRef.current) return;

    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let ax = x;
    let ay = y;

    if (x + rect.width > vw - 8) ax = vw - rect.width - 8;
    if (y + rect.height > vh - 8) ay = y - rect.height;
    if (ax < 8) ax = 8;
    if (ay < 8) ay = 8;

    setPos([ax, ay]);
  }, [open, x, y]);

  if (!open) return null;

  const [adjustedX, adjustedY] = pos;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 glass-strong border border-[var(--glass-border-strong)] rounded-xl shadow-xl py-1.5 min-w-[180px] max-w-[260px]"
      style={{ left: adjustedX, top: adjustedY }}
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
