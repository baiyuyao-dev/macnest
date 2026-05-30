import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface SftpTreeProps {
  currentPath: string;
  onPathChange: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

const defaultTree: TreeNode[] = [
  {
    name: "/",
    path: "/",
    children: [
      { name: "home", path: "/home" },
      { name: "var", path: "/var" },
      { name: "etc", path: "/etc" },
      { name: "usr", path: "/usr" },
      { name: "tmp", path: "/tmp" },
      { name: "opt", path: "/opt" },
      { name: "root", path: "/root" },
    ],
  },
];

export default function SftpTree({ currentPath, onPathChange }: SftpTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/"]));

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = currentPath === node.path || currentPath.startsWith(node.path + "/");
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center px-2 py-[3px] text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
            isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => {
            onPathChange(node.path);
            if (hasChildren) toggleExpand(node.path);
          }}
        >
          {hasChildren && (
            <span className="mr-0.5 shrink-0" onClick={(e) => { e.stopPropagation(); toggleExpand(node.path); }}>
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 inline" />
              ) : (
                <ChevronRight className="h-3 w-3 inline" />
              )}
            </span>
          )}
          {!hasChildren && <span className="w-3 shrink-0" />}
          <span className="mr-1">{node.path === "/" ? "📁" : "📁"}</span>
          <span className="truncate">{node.name}</span>
        </div>
        {hasChildren && isExpanded &&
          node.children!.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col border-r border-[var(--glass-border)] bg-muted/20 overflow-hidden">
      <div className="bg-muted/40 px-2 py-1.5 text-[10px] font-bold text-muted-foreground border-b border-[var(--glass-border)]">
        📁 远程目录
      </div>
      <div className="flex-1 overflow-y-auto">
        {defaultTree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
