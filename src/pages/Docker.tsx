import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Container,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Search,
  RotateCcw,
  Box,
  ArrowRight,
  AlertTriangle,
  Loader2,
  Terminal,
  Hammer,
  FileText,
  X,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Image,
  Database,
  Globe,
} from "lucide-react";
import type { DockerContainer, DockerImage, ContainerInspect, DockerSystemDf, DockerVolume, DockerNetwork } from "@/types";
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  recreateContainer,
  getContainerStats,
  getContainerLogs,
  listImages,
  removeImage,
  pruneImages,
  inspectContainer,
  dockerSystemDf,
  pullImage,
  createContainer,
  dockerDetectShells,
  dockerTerminalConnect,
  dockerTerminalDisconnect,
  listVolumes,
  removeVolume,
  pruneVolumes,
  listNetworks,
  removeNetwork,
} from "@/lib/api";
import type { CreateContainerRequest } from "@/lib/api";
import DockerTerminalDialog, { type DockerTerminalTab } from "@/components/terminal/DockerTerminalDialog";

type ContainerState = "all" | "running" | "stopped" | "paused";
type PendingAction = "starting" | "stopping" | "restarting" | "removing" | "recreating";

interface ContainerStats {
  containerId: string;
  cpu_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
}

const MIN_LOADING_MS = 500;

const stateTabs: { value: ContainerState; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "stopped", label: "已停止" },
  { value: "paused", label: "暂停" },
];

function getStateCount(tabs: typeof stateTabs, containers: DockerContainer[], value: ContainerState): number | null {
  if (value === "all") return null;
  if (value === "stopped") return containers.filter((c) => c.state === "exited" || c.state === "stopped").length;
  return containers.filter((c) => c.state === value).length;
}

/* ── Loading spinner ── */
function LoadingSpinner({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="card-macos py-16 animate-slide-up flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  switch (state) {
    case "running":
      return <Badge className="badge-macos badge-macos-success rounded-full">运行中</Badge>;
    case "exited":
    case "stopped":
      return <Badge variant="secondary" className="text-[10px] rounded-full">已停止</Badge>;
    case "paused":
      return <Badge className="badge-macos badge-macos-warning rounded-full">暂停</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] rounded-full">{state}</Badge>;
  }
}

function ResourceCell({ containerId, statsMap }: { containerId: string; statsMap: Map<string, ContainerStats> }) {
  const stats = statsMap.get(containerId);
  if (!stats) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <div className="space-y-0.5">
      <div className="text-[11px]">
        CPU: <span className="font-medium font-mono">{stats.cpu_percent.toFixed(1)}%</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {stats.memory_usage_mb.toFixed(0)}MB / {stats.memory_limit_mb.toFixed(0)}MB
      </div>
    </div>
  );
}

export default function Docker() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("-");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ContainerState>("all");
  const [statsMap, setStatsMap] = useState<Map<string, ContainerStats>>(new Map());

  // Pending actions for visual feedback
  const [pendingActions, setPendingActions] = useState<Record<string, PendingAction>>({});

  // Delete confirm states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [containerToDelete, setContainerToDelete] = useState<DockerContainer | null>(null);

  // Recreate confirm states
  const [recreateConfirmOpen, setRecreateConfirmOpen] = useState(false);
  const [containerToRecreate, setContainerToRecreate] = useState<DockerContainer | null>(null);

  // Terminal states
  const [terminalTabs, setTerminalTabs] = useState<DockerTerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [shellSelectorOpen, setShellSelectorOpen] = useState(false);
  const [shellSelectorContainer, setShellSelectorContainer] = useState<DockerContainer | null>(null);
  const [availableShells, setAvailableShells] = useState<string[]>([]);
  const [shellLoading, setShellLoading] = useState(false);

  // Log viewer states
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<DockerContainer | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [logTail, setLogTail] = useState<number>(100);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Compose group expansion state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // System overview state
  const [systemDf, setSystemDf] = useState<DockerSystemDf | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"containers" | "images" | "volumes" | "networks">("containers");

  // Image states
  const [images, setImages] = useState<DockerImage[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageSearch, setImageSearch] = useState("");
  const [imagePruneLoading, setImagePruneLoading] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<DockerImage | null>(null);
  const [imageDeleteOpen, setImageDeleteOpen] = useState(false);

  // Volume states
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeSearch, setVolumeSearch] = useState("");
  const [volumePruneLoading, setVolumePruneLoading] = useState(false);
  const [volumeToDelete, setVolumeToDelete] = useState<DockerVolume | null>(null);
  const [volumeDeleteOpen, setVolumeDeleteOpen] = useState(false);

  // Network states
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkSearch, setNetworkSearch] = useState("");
  const [networkToDelete, setNetworkToDelete] = useState<DockerNetwork | null>(null);
  const [networkDeleteOpen, setNetworkDeleteOpen] = useState(false);

  // Detail panel state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContainer, setDetailContainer] = useState<DockerContainer | null>(null);
  const [detailData, setDetailData] = useState<ContainerInspect | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Pull image states
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [pullImageName, setPullImageName] = useState("");
  const [pullLoading, setPullLoading] = useState(false);
  const [pullResult, setPullResult] = useState("");

  // Create container states
  type PortBinding = { hostPort: string; containerPort: string; protocol: "tcp" | "udp" };

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    image: "",
    name: "",
    ports: [{ hostPort: "", containerPort: "", protocol: "tcp" as "tcp" | "udp" }],
    env: [""],
    volumes: [""],
    restart_policy: "no",
    network: "bridge",
    workdir: "",
    command: "",
    detached: true,
    auto_start: true,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContainers = useCallback(async (showSkeleton = false) => {
    const start = Date.now();
    if (showSkeleton) setInitialLoading(true);
    try {
      const [data, df] = await Promise.all([
        listContainers(),
        dockerSystemDf().catch(() => null),
      ]);
      setContainers(data);
      setSystemDf(df);
      setLastRefresh(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      const running = data.filter((c: DockerContainer) => c.state === "running");
      if (running.length > 0) {
        const newStatsMap = new Map<string, ContainerStats>();
        await Promise.all(
          running.map(async (container: DockerContainer) => {
            try {
              const stats = await getContainerStats(container.container_id);
              newStatsMap.set(container.container_id, {
                containerId: container.container_id,
                cpu_percent: parseFloat(stats.cpu_percent),
                memory_usage_mb: parseFloat(stats.memory_usage),
                memory_limit_mb: parseFloat(stats.memory_limit),
                memory_percent: parseFloat(stats.memory_percent),
              });
            } catch {
              /* ignore stats errors */
            }
          })
        );
        setStatsMap(newStatsMap);
      } else {
        setStatsMap(new Map());
      }
    } catch (error) {
      console.error("Failed to load containers:", error);
    } finally {
      if (showSkeleton) {
        const remain = MIN_LOADING_MS - (Date.now() - start);
        if (remain > 0) {
          timerRef.current = setTimeout(() => setInitialLoading(false), remain);
        } else {
          setInitialLoading(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    loadContainers(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loadContainers]);

  useEffect(() => {
    const interval = setInterval(() => loadContainers(), 8000);
    return () => clearInterval(interval);
  }, [loadContainers]);

  const filteredContainers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return containers.filter((c) => {
      const matchesSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        (c.compose_project || "").toLowerCase().includes(q);
      const matchesState =
        stateFilter === "all"
          ? true
          : stateFilter === "stopped"
          ? c.state === "exited" || c.state === "stopped"
          : c.state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [containers, searchQuery, stateFilter]);

  const parsedPortsMap = useMemo(() => {
    const map = new Map<string, { host: string; container: string }[]>();
    for (const c of containers) {
      if (!c.ports) {
        map.set(c.container_id, []);
        continue;
      }
      const result: { host: string; container: string }[] = [];
      for (const part of c.ports.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const arrowMatch = trimmed.match(/(\d+)[:\/](\d+)/);
        if (arrowMatch) result.push({ host: arrowMatch[1], container: arrowMatch[2] });
      }
      map.set(c.container_id, result);
    }
    return map;
  }, [containers]);

  const setPending = (id: string, action: PendingAction | null) => {
    setPendingActions((prev) => {
      const next = { ...prev };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  };

  // ─── Compose group logic ──────────────────────────────────
  const { groupedContainers, groupOrder } = useMemo(() => {
    const groups = new Map<string, DockerContainer[]>();
    for (const c of filteredContainers) {
      const key = c.compose_project || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    // Sort groups: running containers first, then by name
    const order = Array.from(groups.keys()).sort((a, b) => {
      const aRunning = (groups.get(a) || []).some((c) => c.state === "running");
      const bRunning = (groups.get(b) || []).some((c) => c.state === "running");
      if (aRunning !== bRunning) return bRunning ? 1 : -1;
      return a.localeCompare(b);
    });
    return { groupedContainers: groups, groupOrder: order };
  }, [filteredContainers]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleStartGroup = async (containers: DockerContainer[]) => {
    const stopped = containers.filter((c) => c.state !== "running");
    for (const c of stopped) setPending(c.container_id, "starting");
    await Promise.all(
      stopped.map(async (c) => {
        try {
          await startContainer(c.container_id);
        } catch (error) {
          console.error(`Failed to start ${c.name}:`, error);
        }
      })
    );
    await new Promise((r) => setTimeout(r, 1500));
    await loadContainers();
    for (const c of stopped) setPending(c.container_id, null);
  };

  const handleStopGroup = async (containers: DockerContainer[]) => {
    const running = containers.filter((c) => c.state === "running");
    for (const c of running) setPending(c.container_id, "stopping");
    await Promise.all(
      running.map(async (c) => {
        try {
          await stopContainer(c.container_id);
        } catch (error) {
          console.error(`Failed to stop ${c.name}:`, error);
        }
      })
    );
    await new Promise((r) => setTimeout(r, 1500));
    await loadContainers();
    for (const c of running) setPending(c.container_id, null);
  };

  const handleRestartGroup = async (containers: DockerContainer[]) => {
    for (const c of containers) setPending(c.container_id, "restarting");
    await Promise.all(
      containers.map(async (c) => {
        try {
          await restartContainer(c.container_id);
        } catch (error) {
          console.error(`Failed to restart ${c.name}:`, error);
        }
      })
    );
    await new Promise((r) => setTimeout(r, 1500));
    await loadContainers();
    for (const c of containers) setPending(c.container_id, null);
  };

  const handleStart = async (id: string) => {
    setPending(id, "starting");
    try {
      await startContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error: any) {
      console.error("Failed to start container:", error);
      alert(`启动容器失败: ${error.message || error}`);
    } finally {
      setPending(id, null);
    }
  };

  const handleStop = async (id: string) => {
    setPending(id, "stopping");
    try {
      await stopContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error: any) {
      console.error("Failed to stop container:", error);
      alert(`停止容器失败: ${error.message || error}`);
    } finally {
      setPending(id, null);
    }
  };

  const handleRestart = async (id: string) => {
    setPending(id, "restarting");
    try {
      await restartContainer(id);
      await new Promise((r) => setTimeout(r, 1500));
      await loadContainers();
    } catch (error: any) {
      console.error("Failed to restart container:", error);
      alert(`重启容器失败: ${error.message || error}`);
    } finally {
      setPending(id, null);
    }
  };

  const openRecreateConfirm = (container: DockerContainer) => {
    setContainerToRecreate(container);
    setRecreateConfirmOpen(true);
  };

  const handleRecreate = async () => {
    if (!containerToRecreate) return;
    const id = containerToRecreate.container_id;
    setRecreateConfirmOpen(false);
    setContainerToRecreate(null);
    setPending(id, "recreating");
    try {
      await recreateContainer(id);
      await loadContainers();
    } catch (error: any) {
      console.error("Failed to recreate container:", error);
      alert(`重建容器失败: ${error.message || error}`);
    } finally {
      setPending(id, null);
    }
  };

  const openDeleteConfirm = (container: DockerContainer) => {
    if (container.state === "running") return;
    setContainerToDelete(container);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!containerToDelete) return;
    setPending(containerToDelete.container_id, "removing");
    try {
      await removeContainer(containerToDelete.container_id);
      setDeleteConfirmOpen(false);
      setContainerToDelete(null);
      loadContainers();
    } catch (error) {
      console.error("Failed to remove container:", error);
    } finally {
      setPending(containerToDelete.container_id, null);
    }
  };

  // ─── Terminal handlers ────────────────────────────────────
  const handleOpenTerminal = async (container: DockerContainer) => {
    // If already has a tab for this container, switch to it
    const existing = terminalTabs.find((t) => t.containerId === container.container_id);
    if (existing) {
      setActiveTerminalId(existing.id);
      setTerminalDialogOpen(true);
      return;
    }
    // Detect available shells
    setShellLoading(true);
    try {
      const shells = await dockerDetectShells(container.container_id);
      setAvailableShells(shells);
      if (shells.length <= 1) {
        // Only one shell (or fallback to /bin/sh), connect directly
        await connectTerminal(container, shells[0] || "/bin/sh");
      } else {
        // Show shell selector
        setShellSelectorContainer(container);
        setShellSelectorOpen(true);
      }
    } catch {
      // Fallback to /bin/sh
      await connectTerminal(container, "/bin/sh");
    } finally {
      setShellLoading(false);
    }
  };

  const connectTerminal = async (container: DockerContainer, shell: string) => {
    try {
      const res = await dockerTerminalConnect(
        container.container_id,
        container.name,
        shell
      );
      const tab: DockerTerminalTab = {
        id: res.session_id,
        containerId: container.container_id,
        containerName: container.name,
        shell,
        websocketUrl: res.websocket_url,
      };
      setTerminalTabs((prev) => [...prev, tab]);
      setActiveTerminalId(tab.id);
      setTerminalDialogOpen(true);
      setShellSelectorOpen(false);
    } catch (error) {
      console.error("Failed to connect terminal:", error);
    }
  };

  const handleCloseTerminalTab = async (tabId: string) => {
    try {
      await dockerTerminalDisconnect(tabId);
    } catch {
      // ignore disconnect errors
    }
    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTerminalId === tabId) {
        setActiveTerminalId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  };

  const handleTerminalDialogClose = (open: boolean) => {
    setTerminalDialogOpen(open);
    if (!open) {
      // Disconnect all sessions when dialog closes
      for (const tab of terminalTabs) {
        dockerTerminalDisconnect(tab.id).catch(() => {});
      }
      setTerminalTabs([]);
      setActiveTerminalId(null);
    }
  };

  // ─── Log viewer handlers ──────────────────────────────────
  const handleOpenLogs = async (container: DockerContainer) => {
    setLogContainer(container);
    setLogDialogOpen(true);
    setLogLoading(true);
    try {
      const logs = await getContainerLogs(container.container_id, logTail);
      setLogContent(logs);
    } catch (error) {
      console.error("Failed to load container logs:", error);
      setLogContent("加载日志失败");
    } finally {
      setLogLoading(false);
    }
  };

  const handleCloseLogs = () => {
    setLogDialogOpen(false);
    setLogContainer(null);
    setLogContent("");
  };

  const handleRefreshLogs = async () => {
    if (!logContainer) return;
    setLogLoading(true);
    try {
      const logs = await getContainerLogs(logContainer.container_id, logTail);
      setLogContent(logs);
    } catch (error) {
      console.error("Failed to refresh logs:", error);
    } finally {
      setLogLoading(false);
    }
  };

  const handleLogTailChange = async (tail: number) => {
    setLogTail(tail);
    if (!logContainer) return;
    setLogLoading(true);
    try {
      const logs = await getContainerLogs(logContainer.container_id, tail);
      setLogContent(logs);
    } catch (error) {
      console.error("Failed to load logs:", error);
    } finally {
      setLogLoading(false);
    }
  };

  // Auto-scroll logs to bottom when content changes
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logContent]);

  // ─── Image handlers ───────────────────────────────────────
  const loadImages = useCallback(async () => {
    setImageLoading(true);
    try {
      const data = await listImages();
      setImages(data);
    } catch (error) {
      console.error("Failed to load images:", error);
    } finally {
      setImageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "images") {
      loadImages();
    }
  }, [activeTab, loadImages]);

  useEffect(() => {
    if (createDialogOpen && images.length === 0) {
      loadImages();
    }
  }, [createDialogOpen, images.length, loadImages]);

  const handleRemoveImage = async () => {
    if (!imageToDelete) return;
    try {
      await removeImage(imageToDelete.id);
      setImageDeleteOpen(false);
      setImageToDelete(null);
      loadImages();
    } catch (error) {
      console.error("Failed to remove image:", error);
    }
  };

  const openImageDelete = (image: DockerImage) => {
    if (image.containers > 0) return;
    setImageToDelete(image);
    setImageDeleteOpen(true);
  };

  const handlePruneImages = async () => {
    setImagePruneLoading(true);
    try {
      await pruneImages();
      loadImages();
    } catch (error) {
      console.error("Failed to prune images:", error);
    } finally {
      setImagePruneLoading(false);
    }
  };

  const handleOpenDetail = async (container: DockerContainer) => {
    setDetailContainer(container);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await inspectContainer(container.container_id);
      setDetailData(data);
    } catch (error) {
      console.error("Failed to inspect container:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setDetailContainer(null);
    setDetailData(null);
  };

  // ─── Volume handlers ──────────────────────────────────────
  const loadVolumes = useCallback(async () => {
    setVolumeLoading(true);
    try {
      const data = await listVolumes();
      setVolumes(data);
    } catch (error) {
      console.error("Failed to load volumes:", error);
    } finally {
      setVolumeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "volumes") {
      loadVolumes();
    }
  }, [activeTab, loadVolumes]);

  const handleRemoveVolume = async () => {
    if (!volumeToDelete) return;
    try {
      await removeVolume(volumeToDelete.name);
      setVolumeDeleteOpen(false);
      setVolumeToDelete(null);
      loadVolumes();
    } catch (error) {
      console.error("Failed to remove volume:", error);
    }
  };

  const openVolumeDelete = (volume: DockerVolume) => {
    setVolumeToDelete(volume);
    setVolumeDeleteOpen(true);
  };

  const handlePruneVolumes = async () => {
    setVolumePruneLoading(true);
    try {
      await pruneVolumes();
      loadVolumes();
    } catch (error) {
      console.error("Failed to prune volumes:", error);
    } finally {
      setVolumePruneLoading(false);
    }
  };

  // ─── Network handlers ─────────────────────────────────────
  const loadNetworks = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const data = await listNetworks();
      setNetworks(data);
    } catch (error) {
      console.error("Failed to load networks:", error);
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "networks") {
      loadNetworks();
    }
  }, [activeTab, loadNetworks]);

  // Load all tab data on mount so counts are available immediately
  useEffect(() => {
    loadContainers(true);
    loadImages();
    loadVolumes();
    loadNetworks();
  }, []);

  const handleRemoveNetwork = async () => {
    if (!networkToDelete) return;
    try {
      await removeNetwork(networkToDelete.id);
      setNetworkDeleteOpen(false);
      setNetworkToDelete(null);
      loadNetworks();
    } catch (error) {
      console.error("Failed to remove network:", error);
    }
  };

  const openNetworkDelete = (network: DockerNetwork) => {
    setNetworkToDelete(network);
    setNetworkDeleteOpen(true);
  };

  // ─── Pull image handlers ──────────────────────────────────
  const handlePullImage = async () => {
    if (!pullImageName.trim()) return;
    setPullLoading(true);
    setPullResult("");
    try {
      const result = await pullImage(pullImageName.trim());
      setPullResult(result);
      if (activeTab === "images") {
        loadImages();
      }
    } catch (error: any) {
      setPullResult(`错误: ${error.message || error}`);
    } finally {
      setPullLoading(false);
    }
  };

  const handleClosePullDialog = () => {
    setPullDialogOpen(false);
    setPullImageName("");
    setPullResult("");
    setPullLoading(false);
  };

  // ─── Create container handlers ────────────────────────────
  const handleCreateContainer = async () => {
    if (!createForm.image.trim()) return;
    const name = createForm.name.trim();
    if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      alert("容器名称只能包含字母、数字、下划线、点和连字符，且不能以特殊字符开头");
      return;
    }
    setCreateLoading(true);
    try {
      const formattedPorts = createForm.ports
        .map((p) => {
          const cp = p.containerPort.trim();
          if (!cp) return "";
          const hp = p.hostPort.trim();
          const proto = p.protocol === "udp" ? "/udp" : "";
          return hp ? `${hp}:${cp}${proto}` : `${cp}${proto}`;
        })
        .filter(Boolean);
      const result = await createContainer({
        image: createForm.image.trim(),
        name: createForm.name.trim(),
        ports: formattedPorts,
        env: createForm.env.filter((e) => e.trim()),
        volumes: createForm.volumes.filter((v) => v.trim()),
        restart_policy: createForm.restart_policy,
        network: createForm.network,
        workdir: createForm.workdir,
        command: createForm.command,
        detached: createForm.detached,
        auto_start: createForm.auto_start,
      });
      setCreateDialogOpen(false);
      setCreateForm({
        image: "",
        name: "",
        ports: [{ hostPort: "", containerPort: "", protocol: "tcp" as "tcp" | "udp" }],
        env: [""],
        volumes: [""],
        restart_policy: "no",
        network: "bridge",
        workdir: "",
        command: "",
        detached: true,
        auto_start: true,
      });
      loadContainers(true);
    } catch (error: any) {
      console.error("Failed to create container:", error);
      alert(`创建容器失败: ${error.message || error}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    setCreateForm({
      image: "",
      name: "",
      ports: [{ hostPort: "", containerPort: "", protocol: "tcp" as "tcp" | "udp" }],
      env: [""],
      volumes: [""],
      restart_policy: "no",
      network: "bridge",
      workdir: "",
      command: "",
      detached: true,
      auto_start: true,
    });
  };

  const updateCreateForm = (key: string, value: any) => {
    setCreateForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateArrayField = (field: "env" | "volumes", index: number, value: string) => {
    setCreateForm((prev) => {
      const arr = [...prev[field]];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  };

  const addArrayField = (field: "env" | "volumes") => {
    setCreateForm((prev) => ({
      ...prev,
      [field]: [...prev[field], ""],
    }));
  };

  const removeArrayField = (field: "env" | "volumes", index: number) => {
    setCreateForm((prev) => {
      const arr = prev[field].filter((_, i) => i !== index);
      if (arr.length === 0) arr.push("");
      return { ...prev, [field]: arr };
    });
  };

  // Port-specific helpers
  const updatePortField = (index: number, key: "hostPort" | "containerPort" | "protocol", value: string) => {
    setCreateForm((prev) => {
      const arr = [...prev.ports];
      arr[index] = { ...arr[index], [key]: value };
      return { ...prev, ports: arr };
    });
  };

  const addPortField = () => {
    setCreateForm((prev) => ({
      ...prev,
      ports: [...prev.ports, { hostPort: "", containerPort: "", protocol: "tcp" as "tcp" | "udp" }],
    }));
  };

  const removePortField = (index: number) => {
    setCreateForm((prev) => {
      const arr = prev.ports.filter((_, i) => i !== index);
      if (arr.length === 0) arr.push({ hostPort: "", containerPort: "", protocol: "tcp" });
      return { ...prev, ports: arr };
    });
  };

  const filteredImages = useMemo(() => {
    const q = imageSearch.toLowerCase().trim();
    if (!q) return images;
    return images.filter(
      (img) =>
        img.repository.toLowerCase().includes(q) ||
        img.tag.toLowerCase().includes(q) ||
        img.id.toLowerCase().includes(q)
    );
  }, [images, imageSearch]);

  return (
    <div className="p-6 space-y-5 animate-page-enter">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Docker</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理本地 Docker 容器与镜像</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">最后刷新: {lastRefresh}</span>
          <Button variant="outline" size="sm" className="btn-macos-secondary rounded-xl h-8 text-xs" onClick={() => {
            if (activeTab === "containers") loadContainers(true);
            else if (activeTab === "images") loadImages();
            else if (activeTab === "volumes") loadVolumes();
            else if (activeTab === "networks") loadNetworks();
          }} disabled={loading}>
            <RotateCcw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="animate-slide-up" style={{ animationDelay: "50ms" }}>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "containers" | "images" | "volumes" | "networks")}>
          <TabsList className="rounded-xl p-1 h-9">
            <TabsTrigger value="containers" className="text-xs rounded-lg px-4 py-1.5">
              <Container className="h-3.5 w-3.5 mr-1.5" />
              容器 ({containers.length})
            </TabsTrigger>
            <TabsTrigger value="images" className="text-xs rounded-lg px-4 py-1.5">
              <Image className="h-3.5 w-3.5 mr-1.5" />
              镜像 ({images.length})
            </TabsTrigger>
            <TabsTrigger value="volumes" className="text-xs rounded-lg px-4 py-1.5">
              <Database className="h-3.5 w-3.5 mr-1.5" />
              卷 ({volumes.length})
            </TabsTrigger>
            <TabsTrigger value="networks" className="text-xs rounded-lg px-4 py-1.5">
              <Globe className="h-3.5 w-3.5 mr-1.5" />
              网络 ({networks.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "containers" ? (
        <>
          {/* Search & Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "100ms" }}>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索容器名称 / 镜像 / Compose项目..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input-macos pl-10" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 p-0.5 rounded-xl bg-muted/50">
                {stateTabs.map((tab) => (
                  <Button key={tab.value} variant={stateFilter === tab.value ? "default" : "ghost"} size="sm" onClick={() => setStateFilter(tab.value)}
                    className={`text-xs rounded-lg transition-all duration-200 ${stateFilter === tab.value ? "bg-primary text-primary-foreground shadow-glass" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab.label}
                    {tab.value !== "all" && (
                      <span className="ml-1 text-[10px] opacity-60">{getStateCount(stateTabs, containers, tab.value)}</span>
                    )}
                  </Button>
                ))}
              </div>
              <Button variant="default" size="sm" className="rounded-xl h-8 text-xs bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => setCreateDialogOpen(true)}>
                <Box className="mr-1.5 h-3.5 w-3.5" />
                创建容器
              </Button>
            </div>
          </div>

          {/* System Overview */}
          {systemDf && (
            <div className="grid grid-cols-3 gap-3 animate-slide-up" style={{ animationDelay: "100ms" }}>
              <div className="card-macos p-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">容器</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-xl font-bold">{systemDf.containers_active}</span>
                    <span className="text-xs text-muted-foreground">/ {systemDf.containers_total}</span>
                  </div>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                  <Container className="h-4 w-4" />
                </div>
              </div>
              <div className="card-macos p-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">镜像</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-xl font-bold">{systemDf.images_active}</span>
                    <span className="text-xs text-muted-foreground">/ {systemDf.images_total}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{systemDf.images_size}</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
                  <Image className="h-4 w-4" />
                </div>
              </div>
              <div className="card-macos p-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">卷</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-xl font-bold">{systemDf.volumes_active}</span>
                    <span className="text-xs text-muted-foreground">/ {systemDf.volumes_total}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{systemDf.volumes_size}</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <FolderOpen className="h-4 w-4" />
                </div>
              </div>
            </div>
          )}

          {/* Container Table */}
          {initialLoading ? (
            <LoadingSpinner label="加载容器列表…" />
          ) : containers.length === 0 ? (
            <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <Container className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-medium">未检测到 Docker 容器</p>
                  <p className="text-xs text-muted-foreground mt-1">请确保 Docker 正在运行</p>
                </div>
              </div>
            </div>
          ) : filteredContainers.length === 0 ? (
            <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的容器</p>
              </div>
            </div>
          ) : (
            <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "150ms" }}>
              {/* Table Header */}
              <div className="hidden md:grid md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] bg-muted/30 border-b border-[var(--glass-border)]">
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">镜像</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">状态</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">端口映射</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">资源</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
              </div>

              {/* Table Rows — Grouped by Compose Project */}
              <div className="divide-y divide-[var(--glass-border)]">
                {groupOrder.map((groupKey) => {
                  const groupContainers = groupedContainers.get(groupKey) || [];
                  const isExpanded = expandedGroups.has(groupKey);
                  const runningCount = groupContainers.filter((c) => c.state === "running").length;
                  const hasComposeProject = groupKey !== "";
                  const displayName = hasComposeProject ? groupKey : "独立容器";

                  return (
                    <div key={groupKey} className={hasComposeProject ? "border-b border-[var(--glass-border)] last:border-b-0" : ""}>
                      {/* Group Header */}
                      {hasComposeProject && (
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => toggleGroup(groupKey)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                            <span className="text-sm font-semibold truncate">{displayName}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 rounded-full">
                              {runningCount}/{groupContainers.length} 运行中
                            </Badge>
                          </div>
                          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600" title="启动全部"
                              onClick={() => handleStartGroup(groupContainers)}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-600" title="停止全部"
                              onClick={() => handleStopGroup(groupContainers)}
                            >
                              <Square className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" title="重启全部"
                              onClick={() => handleRestartGroup(groupContainers)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Group Containers */}
                      {(!hasComposeProject || isExpanded) && groupContainers.map((container) => (
                        <div key={container.id} className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_100px_1fr_120px_200px] items-center px-4 py-3 hover:bg-accent/30 transition-colors group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <button
                                className="font-medium truncate text-sm text-left hover:text-primary transition-colors cursor-pointer"
                                onClick={() => handleOpenDetail(container)}
                              >
                                {container.name}
                              </button>
                              {container.compose_project && !hasComposeProject && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5 rounded-full">{container.compose_project}</Badge>
                              )}
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground truncate">{container.image}</div>
                          <div className="py-1 md:py-0"><StateBadge state={container.state} /></div>
                          <div className="flex flex-wrap gap-1">
                            {(parsedPortsMap.get(container.container_id) ?? []).length > 0 ? (parsedPortsMap.get(container.container_id) ?? []).map((p, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] h-5 px-1.5 flex items-center gap-0.5 rounded-full font-mono">
                                {p.host}<ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />{p.container}
                              </Badge>
                            )) : "-"}
                          </div>
                          <div className="text-sm">{container.state === "running" ? <ResourceCell containerId={container.container_id} statsMap={statsMap} /> : "-"}</div>
                          <div className="flex items-center justify-end gap-0.5">
                            {container.state === "running" && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-secondary/60" title="终端"
                                disabled={shellLoading} onClick={() => handleOpenTerminal(container)}
                              >
                                {shellLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-blue-500 hover:bg-blue-500/10 hover:text-blue-600" title="日志"
                              onClick={() => handleOpenLogs(container)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            {container.state === "running" ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 hover:bg-red-500/10 hover:text-red-600" title="停止"
                                disabled={!!pendingActions[container.container_id]} onClick={() => handleStop(container.container_id)}
                              >
                                {pendingActions[container.container_id] === "stopping" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600" title="启动"
                                disabled={!!pendingActions[container.container_id]} onClick={() => handleStart(container.container_id)}
                              >
                                {pendingActions[container.container_id] === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-amber-500 hover:bg-amber-500/10 hover:text-amber-600" title="重启"
                              disabled={!!pendingActions[container.container_id]} onClick={() => handleRestart(container.container_id)}
                            >
                              {pendingActions[container.container_id] === "restarting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-purple-500 hover:bg-purple-500/10 hover:text-purple-600" title="重建"
                              disabled={!!pendingActions[container.container_id]} onClick={() => openRecreateConfirm(container)}
                            >
                              {pendingActions[container.container_id] === "recreating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon"
                              className={`h-8 w-8 rounded-lg ${container.state === "running" ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                              title={container.state === "running" ? "请先停止容器" : "删除"}
                              disabled={container.state === "running" || !!pendingActions[container.container_id]}
                              onClick={() => openDeleteConfirm(container)}
                            >
                              {pendingActions[container.container_id] === "removing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : activeTab === "images" ? (
        <>
          {/* Image Search & Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "100ms" }}>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索镜像名称 / Tag..." value={imageSearch} onChange={(e) => setImageSearch(e.target.value)} className="input-macos pl-10" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl h-8 text-xs" onClick={handlePruneImages} disabled={imagePruneLoading}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {imagePruneLoading ? "清理中..." : "清理悬空镜像"}
              </Button>
              <Button variant="default" size="sm" className="rounded-xl h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white" onClick={() => setPullDialogOpen(true)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                拉取镜像
              </Button>
            </div>
          </div>

          {/* Image Table */}
          {imageLoading ? (
            <LoadingSpinner label="加载镜像列表…" />
          ) : images.length === 0 ? (
            <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <Image className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-medium">未检测到 Docker 镜像</p>
                  <p className="text-xs text-muted-foreground mt-1">请确保 Docker 正在运行</p>
                </div>
              </div>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的镜像</p>
              </div>
            </div>
          ) : (
            <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="hidden md:grid md:grid-cols-[2fr_100px_120px_120px_120px] bg-muted/30 border-b border-[var(--glass-border)]">
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">镜像</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Tag</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">大小</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">引用</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
              </div>
              <div className="divide-y divide-[var(--glass-border)]">
                {filteredImages.map((img) => (
                  <div key={img.id} className="grid grid-cols-1 md:grid-cols-[2fr_100px_120px_120px_120px] items-center px-4 py-3 hover:bg-accent/30 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <Image className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-medium truncate text-sm">{img.repository}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{img.id.slice(0, 12)}</p>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">{img.tag}</div>
                    <div className="text-sm text-muted-foreground">{img.size}</div>
                    <div className="text-sm">
                      {img.containers > 0 ? (
                        <Badge variant="outline" className="text-[10px] rounded-full">{img.containers} 容器</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">未引用</span>
                      )}
                    </div>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="icon"
                        className={`h-8 w-8 rounded-lg ${img.containers > 0 ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                        title={img.containers > 0 ? "镜像正被容器引用" : "删除镜像"}
                        disabled={img.containers > 0}
                        onClick={() => openImageDelete(img)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : activeTab === "volumes" ? (
        <>
          {/* Volume Search & Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "100ms" }}>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索卷名称..." value={volumeSearch} onChange={(e) => setVolumeSearch(e.target.value)} className="input-macos pl-10" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-xl h-8 text-xs" onClick={handlePruneVolumes} disabled={volumePruneLoading}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {volumePruneLoading ? "清理中..." : "清理未使用卷"}
              </Button>
            </div>
          </div>

          {/* Volume Table */}
          {volumeLoading ? (
            <LoadingSpinner label="加载卷列表…" />
          ) : volumes.length === 0 ? (
            <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <Database className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-medium">未检测到 Docker 卷</p>
                  <p className="text-xs text-muted-foreground mt-1">请确保 Docker 正在运行</p>
                </div>
              </div>
            </div>
          ) : volumes.filter((v) => v.name.toLowerCase().includes(volumeSearch.toLowerCase())).length === 0 ? (
            <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的卷</p>
              </div>
            </div>
          ) : (
            <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="hidden md:grid md:grid-cols-[2fr_120px_2fr_120px_100px] bg-muted/30 border-b border-[var(--glass-border)]">
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">驱动</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">挂载点</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">范围</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
              </div>
              <div className="divide-y divide-[var(--glass-border)]">
                {volumes
                  .filter((v) => v.name.toLowerCase().includes(volumeSearch.toLowerCase()))
                  .map((vol) => (
                    <div key={vol.name} className="grid grid-cols-1 md:grid-cols-[2fr_120px_2fr_120px_100px] items-center px-4 py-3 hover:bg-accent/30 transition-colors group">
                      <div className="flex items-center gap-2 min-w-0">
                        <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="font-medium truncate text-sm">{vol.name}</p>
                      </div>
                      <div className="text-sm text-muted-foreground">{vol.driver}</div>
                      <div className="text-sm text-muted-foreground truncate" title={vol.mountpoint}>{vol.mountpoint}</div>
                      <div className="text-sm text-muted-foreground">{vol.scope}</div>
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="删除卷" onClick={() => openVolumeDelete(vol)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      ) : activeTab === "networks" ? (
        <>
          {/* Network Search */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-up" style={{ animationDelay: "100ms" }}>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索网络名称..." value={networkSearch} onChange={(e) => setNetworkSearch(e.target.value)} className="input-macos pl-10" />
            </div>
          </div>

          {/* Network Table */}
          {networkLoading ? (
            <LoadingSpinner label="加载网络列表…" />
          ) : networks.length === 0 ? (
            <div className="card-macos py-16 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <Globe className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-medium">未检测到 Docker 网络</p>
                  <p className="text-xs text-muted-foreground mt-1">请确保 Docker 正在运行</p>
                </div>
              </div>
            </div>
          ) : networks.filter((n) => n.name.toLowerCase().includes(networkSearch.toLowerCase())).length === 0 ? (
            <div className="card-macos py-12 animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="text-center">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">没有找到匹配的网络</p>
              </div>
            </div>
          ) : (
            <div className="card-macos overflow-hidden animate-slide-up" style={{ animationDelay: "150ms" }}>
              <div className="hidden md:grid md:grid-cols-[2fr_2fr_120px_120px_100px] bg-muted/30 border-b border-[var(--glass-border)]">
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">ID</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">名称</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">驱动</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">范围</div>
                <div className="px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">操作</div>
              </div>
              <div className="divide-y divide-[var(--glass-border)]">
                {networks
                  .filter((n) => n.name.toLowerCase().includes(networkSearch.toLowerCase()))
                  .map((net) => (
                    <div key={net.id} className="grid grid-cols-1 md:grid-cols-[2fr_2fr_120px_120px_100px] items-center px-4 py-3 hover:bg-accent/30 transition-colors group">
                      <div className="flex items-center gap-2 min-w-0">
                        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground font-mono truncate">{net.id.slice(0, 12)}</p>
                      </div>
                      <div className="font-medium truncate text-sm">{net.name}</div>
                      <div className="text-sm text-muted-foreground">{net.driver}</div>
                      <div className="text-sm text-muted-foreground">{net.scope}</div>
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="icon"
                          className={`h-8 w-8 rounded-lg ${["bridge", "host", "none"].includes(net.name) ? "text-muted-foreground opacity-50 cursor-not-allowed" : "text-destructive hover:text-destructive hover:bg-destructive/10"}`}
                          title={["bridge", "host", "none"].includes(net.name) ? "默认网络不可删除" : "删除网络"}
                          disabled={["bridge", "host", "none"].includes(net.name)}
                          onClick={() => openNetworkDelete(net)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* ─── Recreate Confirm Dialog ───────────────────────── */}
      <Dialog open={recreateConfirmOpen} onOpenChange={setRecreateConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-500 text-sm font-semibold">
              <Hammer className="h-4 w-4" />
              确认重建容器
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要重建容器 <span className="font-medium text-foreground">{containerToRecreate?.name}</span> 吗？
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              容器将被停止、删除，拉取最新镜像后重新创建。原有数据卷会保留。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setRecreateConfirmOpen(false)}>取消</Button>
            <Button variant="default" size="sm" className="rounded-lg bg-blue-500 hover:bg-blue-600 text-white" onClick={handleRecreate}>
              <Hammer className="mr-1.5 h-3.5 w-3.5" />
              确认重建
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm Dialog ─────────────────────────── */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除容器
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除容器 <span className="font-medium text-foreground">{containerToDelete?.name}</span> 吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Shell Selector Dialog ─────────────────────────── */}
      <Dialog open={shellSelectorOpen} onOpenChange={setShellSelectorOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Terminal className="h-4 w-4" />
              选择 Shell — {shellSelectorContainer?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {availableShells.map((shell) => (
              <Button
                key={shell}
                variant="outline"
                className="w-full justify-start text-xs rounded-lg font-mono"
                onClick={() => shellSelectorContainer && connectTerminal(shellSelectorContainer, shell)}
              >
                {shell}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Image Delete Confirm Dialog ───────────────────── */}
      <Dialog open={imageDeleteOpen} onOpenChange={setImageDeleteOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除镜像
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除镜像 <span className="font-medium text-foreground">{imageToDelete?.repository}:{imageToDelete?.tag}</span> 吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setImageDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleRemoveImage}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Volume Delete Confirm Dialog ────────────────── */}
      <Dialog open={volumeDeleteOpen} onOpenChange={setVolumeDeleteOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除卷
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除卷 <span className="font-medium text-foreground">{volumeToDelete?.name}</span> 吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setVolumeDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleRemoveVolume}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Network Delete Confirm Dialog ───────────────── */}
      <Dialog open={networkDeleteOpen} onOpenChange={setNetworkDeleteOpen}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              确认删除网络
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              确定要删除网络 <span className="font-medium text-foreground">{networkToDelete?.name}</span> 吗？此操作不可撤销。
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setNetworkDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" className="rounded-lg" onClick={handleRemoveNetwork}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Log Viewer Dialog ───────────────────────────── */}
      <Dialog open={logDialogOpen} onOpenChange={(open) => { if (!open) handleCloseLogs(); }}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[56rem] max-w-[95vw] h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                {logContainer?.name} - 日志
              </div>
              <div className="flex items-center gap-2">
                {/* Tail selector */}
                <div className="flex items-center gap-1">
                  {[100, 500, 1000].map((n) => (
                    <Button
                      key={n}
                      variant={logTail === n ? "default" : "ghost"}
                      size="sm"
                      className={`h-6 text-[10px] px-2 rounded-md ${logTail === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => handleLogTailChange(n)}
                    >
                      最近 {n}
                    </Button>
                  ))}
                  <Button
                    variant={logTail === 0 ? "default" : "ghost"}
                    size="sm"
                    className={`h-6 text-[10px] px-2 rounded-md ${logTail === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => handleLogTailChange(0)}
                  >
                    全部
                  </Button>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={handleRefreshLogs} disabled={logLoading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${logLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={handleCloseLogs}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div
            ref={logScrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5"
          >
            {logLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">加载中...</span>
              </div>
            ) : !logContent ? (
              <p className="text-muted-foreground text-center py-8">暂无日志</p>
            ) : (
              logContent.split("\n").map((line, idx) => {
                const isStderr = line.includes("--- STDERR ---");
                const isTimestamp = /^\d{4}-\d{2}-\d{2}T/.test(line);
                return (
                  <div key={idx} className={`break-all ${isStderr ? "text-red-400 font-semibold" : isTimestamp ? "text-emerald-400/80" : "text-foreground/90"}`}>
                    {line || " "}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Container Detail Dialog ─────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={(open) => { if (!open) handleCloseDetail(); }}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[48rem] max-w-[95vw] h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-blue-500" />
                {detailContainer?.name} - 详情
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={handleCloseDetail}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">加载中...</span>
              </div>
            ) : !detailData ? (
              <p className="text-muted-foreground text-center py-8">无法获取容器详情</p>
            ) : (
              <>
                {/* Basic Info */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">基本信息</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex gap-2"><span className="text-muted-foreground">ID:</span> <span className="font-mono">{detailData.id.slice(0, 12)}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">镜像:</span> <span>{detailData.image}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">状态:</span> <span className="capitalize">{detailData.state}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">主机名:</span> <span>{detailData.hostname}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">工作目录:</span> <span className="font-mono">{detailData.working_dir || "-"}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">用户:</span> <span>{detailData.user || "root"}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">网络模式:</span> <span>{detailData.network_mode || "-"}</span></div>
                    <div className="flex gap-2"><span className="text-muted-foreground">重启策略:</span> <span>{detailData.restart_policy} {detailData.restart_count > 0 ? `(${detailData.restart_count}次)` : ""}</span></div>
                  </div>
                </div>

                {/* Entrypoint & Command */}
                {(detailData.entrypoint || detailData.cmd) && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">启动命令</h4>
                    {detailData.entrypoint && (
                      <div className="text-sm"><span className="text-muted-foreground">Entrypoint:</span> <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{detailData.entrypoint}</span></div>
                    )}
                    {detailData.cmd && (
                      <div className="text-sm"><span className="text-muted-foreground">Command:</span> <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{detailData.cmd}</span></div>
                    )}
                  </div>
                )}

                {/* Environment Variables */}
                {detailData.env.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">环境变量</h4>
                    <div className="space-y-1">
                      {detailData.env.map((e, i) => (
                        <div key={i} className="text-xs font-mono bg-muted/50 px-2 py-1 rounded break-all">{e}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mounts */}
                {detailData.mounts.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">挂载卷</h4>
                    <div className="space-y-1">
                      {detailData.mounts.map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] rounded-full shrink-0">{m.type_}</Badge>
                          <span className="font-mono text-muted-foreground truncate">{m.source}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-mono truncate">{m.destination}</span>
                          {m.mode && <span className="text-muted-foreground">({m.mode})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ports */}
                {detailData.ports.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">端口绑定</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detailData.ports.map((p, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] rounded-full font-mono">
                          {p.ip && p.ip !== "0.0.0.0" ? `${p.ip}:` : ""}{p.host_port} → {p.container_port}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Labels */}
                {detailData.labels.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Labels</h4>
                    <div className="space-y-1">
                      {detailData.labels.map(([k, v], i) => (
                        <div key={i} className="text-xs">
                          <span className="font-mono text-muted-foreground">{k}</span>
                          {v && <span className="font-mono"> = {v}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Pull Image Dialog ───────────────────────────── */}
      <Dialog open={pullDialogOpen} onOpenChange={(open) => { if (!open) handleClosePullDialog(); }}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="h-4 w-4 text-blue-500" />
              拉取镜像
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">镜像名称</label>
              <Input
                placeholder="nginx:alpine 或 mysql:8.0"
                value={pullImageName}
                onChange={(e) => setPullImageName(e.target.value)}
                className="input-macos"
                onKeyDown={(e) => e.key === "Enter" && handlePullImage()}
              />
              <p className="text-[10px] text-muted-foreground mt-1">格式: 镜像名:标签，如 nginx:alpine</p>
            </div>
            {pullResult && (
              <div className="bg-muted/50 rounded-lg p-3 max-h-48 overflow-y-auto">
                <pre className="text-[11px] font-mono whitespace-pre-wrap">{pullResult}</pre>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={handleClosePullDialog}>关闭</Button>
              <Button variant="default" size="sm" className="rounded-lg bg-blue-500 hover:bg-blue-600 text-white" onClick={handlePullImage} disabled={pullLoading || !pullImageName.trim()}>
                {pullLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                {pullLoading ? "拉取中..." : "拉取"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Create Container Dialog ───────────────────────── */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open) handleCloseCreateDialog(); }}>
        <DialogContent className="glass-strong border-[var(--glass-border-strong)] w-[42rem] max-w-[95vw] h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Box className="h-4 w-4 text-blue-500" />
              创建容器
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Required: Image */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">镜像 <span className="text-red-500">*</span></label>
              <Select value={createForm.image} onValueChange={(v) => updateCreateForm("image", v)}>
                <SelectTrigger className="input-macos h-9">
                  <SelectValue placeholder="选择镜像..." />
                </SelectTrigger>
                <SelectContent>
                  {images.map((img) => (
                    <SelectItem key={img.id} value={`${img.repository}:${img.tag}`}>
                      {img.repository}:{img.tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">容器名称</label>
              <Input placeholder="my-nginx" value={createForm.name} onChange={(e) => updateCreateForm("name", e.target.value)} className="input-macos" />
            </div>

            {/* Command */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">启动命令 (可选)</label>
              <Input
                placeholder="自定义启动命令，留空时基础镜像会自动保持运行"
                value={createForm.command}
                onChange={(e) => updateCreateForm("command", e.target.value)}
                className="input-macos"
              />
              <p className="text-[10px] text-muted-foreground">
                提示：基础镜像（ubuntu、alpine 等）留空时会自动附加 tail -f /dev/null 保持运行。如需自定义行为可填写命令。
              </p>
            </div>

            {/* Workdir */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">工作目录 (可选)</label>
              <Input placeholder="/app" value={createForm.workdir} onChange={(e) => updateCreateForm("workdir", e.target.value)} className="input-macos" />
            </div>

            {/* Ports */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">端口映射</label>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={addPortField}>+ 添加</Button>
              </div>
              {createForm.ports.map((port, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="grid grid-cols-[1fr_1fr_80px] gap-2 flex-1">
                    <div className="space-y-0.5">
                      <label className="text-[10px] text-muted-foreground">主机端口</label>
                      <Input placeholder="8080" value={port.hostPort} onChange={(e) => updatePortField(i, "hostPort", e.target.value)} className="input-macos text-xs h-8" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[10px] text-muted-foreground">容器端口</label>
                      <Input placeholder="80" value={port.containerPort} onChange={(e) => updatePortField(i, "containerPort", e.target.value)} className="input-macos text-xs h-8" />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[10px] text-muted-foreground">协议</label>
                      <select
                        value={port.protocol}
                        onChange={(e) => updatePortField(i, "protocol", e.target.value)}
                        className="w-full h-8 px-2 rounded-lg border border-[var(--glass-border)] bg-background text-xs"
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </div>
                  </div>
                  {createForm.ports.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-4" onClick={() => removePortField(i)}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              ))}
            </div>

            {/* Environment Variables */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">环境变量</label>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => addArrayField("env")}>+ 添加</Button>
              </div>
              {createForm.env.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <Input placeholder="KEY=VALUE" value={e} onChange={(ev) => updateArrayField("env", i, ev.target.value)} className="input-macos text-xs" />
                  {createForm.env.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeArrayField("env", i)}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              ))}
            </div>

            {/* Volumes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">挂载卷</label>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => addArrayField("volumes")}>+ 添加</Button>
              </div>
              {createForm.volumes.map((vol, i) => (
                <div key={i} className="flex gap-2">
                  <Input placeholder="/host/path:/container/path" value={vol} onChange={(e) => updateArrayField("volumes", i, e.target.value)} className="input-macos text-xs" />
                  {createForm.volumes.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeArrayField("volumes", i)}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              ))}
            </div>

            {/* Restart Policy & Network */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">重启策略</label>
                <select
                  value={createForm.restart_policy}
                  onChange={(e) => updateCreateForm("restart_policy", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-background text-xs"
                >
                  <option value="no">不重启</option>
                  <option value="always">总是重启</option>
                  <option value="unless-stopped">除非手动停止</option>
                  <option value="on-failure">失败时重启</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">网络模式</label>
                <select
                  value={createForm.network}
                  onChange={(e) => updateCreateForm("network", e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-background text-xs"
                >
                  <option value="bridge">bridge</option>
                  <option value="host">host</option>
                  <option value="none">none</option>
                </select>
              </div>
            </div>
          </div>
          <div className="px-5 py-4 border-t border-[var(--glass-border)] flex justify-end gap-2 shrink-0">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={handleCloseCreateDialog}>取消</Button>
            <Button variant="default" size="sm" className="rounded-lg bg-blue-500 hover:bg-blue-600 text-white" onClick={handleCreateContainer} disabled={createLoading || !createForm.image.trim()}>
              {createLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Box className="mr-1.5 h-3.5 w-3.5" />}
              {createLoading ? "创建中..." : "创建容器"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Docker Terminal Dialog ────────────────────────── */}
      <DockerTerminalDialog
        open={terminalDialogOpen}
        onOpenChange={handleTerminalDialogClose}
        tabs={terminalTabs}
        activeTabId={activeTerminalId}
        onActiveTabChange={setActiveTerminalId}
        onCloseTab={handleCloseTerminalTab}
      />
    </div>
  );
}
