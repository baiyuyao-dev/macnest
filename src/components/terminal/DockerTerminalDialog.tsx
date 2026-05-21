import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import XTerm from "@/components/terminal/XTerm";

export interface DockerTerminalTab {
  id: string; // session_id from backend
  containerId: string;
  containerName: string;
  shell: string;
  websocketUrl: string;
}

interface DockerTerminalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: DockerTerminalTab[];
  activeTabId: string | null;
  onActiveTabChange: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export default function DockerTerminalDialog({
  open,
  onOpenChange,
  tabs,
  activeTabId,
  onActiveTabChange,
  onCloseTab,
}: DockerTerminalDialogProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[90vw] max-w-5xl p-0 overflow-hidden">
        <div className="flex flex-col h-[80vh]">
          {/* Tab bar */}
          <div className="flex items-center border-b border-[var(--glass-border)] bg-muted/30 shrink-0">
            <div className="flex-1 flex items-center overflow-x-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-b-2 transition-colors whitespace-nowrap ${
                    tab.id === activeTabId
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => onActiveTabChange(tab.id)}
                >
                  <span>{tab.containerName}</span>
                  <span className="text-muted-foreground/60 font-mono">({tab.shell.replace("/bin/", "")})</span>
                  <button
                    className="ml-1 h-4 w-4 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted flex items-center justify-center transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 mr-1 shrink-0 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Terminal content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab ? (
              <XTerm websocketUrl={activeTab.websocketUrl} active={true} />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                没有活动的终端会话
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
