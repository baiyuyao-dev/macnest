import { X } from "lucide-react";
import { TabState } from "@/types";

interface TabBarProps {
  tabs: TabState[];
  activeIndex: number;
  onSwitch: (index: number) => void;
  onClose: (index: number) => void;
}

export default function TabBar({ tabs, activeIndex, onSwitch, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-[var(--glass-border)] bg-muted/30 overflow-x-auto">
      {tabs.map((tab, index) => (
        <div
          key={tab.table + index}
          className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--glass-border)] whitespace-nowrap transition-colors ${
            index === activeIndex
              ? "bg-background text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/30"
          }`}
          onClick={() => onSwitch(index)}
        >
          <span className="truncate max-w-[120px]">{tab.table}</span>
          <button
            className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-0.5 rounded"
            onClick={(e) => {
              e.stopPropagation();
              onClose(index);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
