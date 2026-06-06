import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, ChevronDown, Loader2, AlertCircle } from "lucide-react";
import { sftpListDir } from "@/lib/api";
import type { SftpFile } from "@/types";

interface SftpTreeProps {
  sessionId: string;
  currentPath: string;
  onPathChange: (path: string) => void;
}

export default function SftpTree({ sessionId, currentPath, onPathChange }: SftpTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/"]));
  const [childrenMap, setChildrenMap] = useState<Map<string, SftpFile[]>>(new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set());

  // 用 ref 避免闭包依赖频繁变化的状态
  const childrenMapRef = useRef(childrenMap);
  childrenMapRef.current = childrenMap;
  const loadingPathsRef = useRef(loadingPaths);
  loadingPathsRef.current = loadingPaths;
  const failedPathsRef = useRef(failedPaths);
  failedPathsRef.current = failedPaths;
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;
  const loadChildrenRef = useRef<((path: string, retryCount?: number) => Promise<void>) | null>(null);

  const loadChildren = useCallback(async (path: string, retryCount = 0) => {
    if (loadingPathsRef.current.has(path)) return;
    if (childrenMapRef.current.has(path) && !failedPathsRef.current.has(path)) return;

    setLoadingPaths(prev => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    setFailedPaths(prev => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });

    try {
      const files = await sftpListDir(sessionId, path);
      const dirs = files.filter(f => f.is_dir);
      setChildrenMap(prev => {
        const next = new Map(prev);
        next.set(path, dirs);
        return next;
      });
    } catch (err) {
      console.error("[SftpTree] Failed to load children for", path, err);
      if (retryCount < 2) {
        setTimeout(() => loadChildrenRef.current?.(path, retryCount + 1), 500 * (retryCount + 1));
        return;
      }
      setFailedPaths(prev => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [sessionId]);

  loadChildrenRef.current = loadChildren;

  // sessionId 变化时重置并重新加载根目录；延迟加载避免和 SftpFileList 并发冲突
  useEffect(() => {
    setChildrenMap(new Map());
    setExpandedPaths(new Set(["/"]));
    setFailedPaths(new Set());
    const timer = setTimeout(() => {
      loadChildren("/");
    }, 800);
    return () => clearTimeout(timer);
  }, [sessionId, loadChildren]);

  // currentPath 变化时自动展开并加载沿途父目录
  useEffect(() => {
    if (!currentPath || currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : `/${part}`;
      if (!childrenMapRef.current.has(path) || failedPathsRef.current.has(path)) {
        loadChildrenRef.current?.(path);
      }
    }
    setExpandedPaths(prev => {
      const next = new Set(prev);
      next.add("/");
      let p = "";
      for (const part of parts) {
        p = p ? `${p}/${part}` : `/${part}`;
        next.add(p);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // 点击节点：toggle 展开/收起，同时按需加载子目录
  const handleNodeClick = (path: string) => {
    const isExpanded = expandedPathsRef.current.has(path);

    if (!isExpanded) {
      // 未展开：先展开，再异步加载子目录，同时切换右侧文件列表
      if (currentPath !== path) {
        onPathChange(path);
      }
      toggleExpand(path);
      if (!childrenMapRef.current.has(path) || failedPathsRef.current.has(path)) {
        loadChildrenRef.current?.(path);
      }
    } else {
      // 已展开：直接收起，不触发路径切换（避免和 useEffect 冲突）
      toggleExpand(path);
    }
  };

  // 点击展开箭头：只切换展开状态，不触发路径切换
  const handleToggleClick = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const isExpanded = expandedPathsRef.current.has(path);
    if (!isExpanded) {
      toggleExpand(path);
      if (!childrenMapRef.current.has(path) || failedPathsRef.current.has(path)) {
        loadChildrenRef.current?.(path);
      }
    } else {
      toggleExpand(path);
    }
  };

  const renderNode = (path: string, name: string, depth: number) => {
    const isExpanded = expandedPaths.has(path);
    const children = childrenMap.get(path);
    const isLoading = loadingPaths.has(path);
    const isFailed = failedPaths.has(path);
    const isActive = currentPath === path || currentPath.startsWith(path + "/");
    // 已展开的节点始终显示箭头（允许收起空目录）；未加载的节点也显示箭头以便展开
    const hasChildren = isLoading || isFailed || isExpanded || (children ? children.length > 0 : true);

    return (
      <div key={path}>
        <div
          className={`flex items-center px-2 py-[3px] text-[10px] cursor-pointer whitespace-nowrap transition-colors ${
            isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          }`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => handleNodeClick(path)}
        >
          {hasChildren ? (
            <span
              className="mr-0.5 shrink-0 inline-flex items-center justify-center w-3 h-3"
              onClick={(e) => handleToggleClick(e, path)}
            >
              {isLoading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
              ) : isFailed ? (
                <AlertCircle className="h-2.5 w-2.5 text-destructive" />
              ) : isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="mr-1 shrink-0">{isExpanded && hasChildren ? "📂" : "📁"}</span>
          <span className="truncate">{name}</span>
        </div>
        {isExpanded && children?.map((child) =>
          renderNode(child.path, child.name, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col border-r border-[var(--glass-border)] bg-muted/20 overflow-hidden">
      <div className="bg-muted/40 px-2 py-1.5 text-[10px] font-bold text-muted-foreground border-b border-[var(--glass-border)]">
        📁 远程目录
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderNode("/", "根目录", 0)}
      </div>
    </div>
  );
}
