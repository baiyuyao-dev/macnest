import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Monitor, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { rdpStopSession, rdpSendInput } from "@/lib/api";

interface RdpFramePayload {
  regions: Array<{ left: number; top: number; right: number; bottom: number }>;
  data: string;
}

interface RdpCanvasProps {
  sessionId: string;
  connection: {
    name: string;
    screen_width: number;
    screen_height: number;
  };
  onDisconnect: () => void;
  onExternalClient?: () => void;
}

export default function RdpCanvas({
  sessionId,
  connection,
  onDisconnect,
  onExternalClient,
}: RdpCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const disconnectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const eventName = `rdp-frame-${sessionId}`;
        const unlisten = await listen<RdpFramePayload>(eventName, (event) => {
          if (cancelled) return;
          const payload = event.payload;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          try {
            const binary = atob(payload.data);
            const bytes = new Uint8ClampedArray(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }

            let offset = 0;
            for (const region of payload.regions) {
              const width = region.right - region.left;
              const height = region.bottom - region.top;
              const regionSize = width * height * 4;
              const regionBytes = bytes.subarray(offset, offset + regionSize);
              const imageData = new ImageData(regionBytes, width, height);
              ctx.putImageData(imageData, region.left, region.top);
              offset += regionSize;
            }

            if (status !== "connected") {
              setStatus("connected");
            }
          } catch (err) {
            console.error("RDP frame render failed:", err);
          }
        });

        unlistenRef.current = unlisten;

        // Listen for disconnect
        const disconnectEvent = `rdp-disconnected-${sessionId}`;
        const unlistenDisconnect = await listen(disconnectEvent, () => {
          if (!cancelled && !disconnectedRef.current) {
            disconnectedRef.current = true;
            toast.info("RDP 会话已断开");
            onDisconnect();
          }
        });

        // Listen for connection errors
        const errorEvent = `rdp-error-${sessionId}`;
        const unlistenError = await listen<string>(errorEvent, (event) => {
          if (!cancelled && !disconnectedRef.current) {
            disconnectedRef.current = true;
            console.error("RDP connection error:", event.payload);
            setStatus("error");
            setErrorMsg(event.payload);
          }
        });

        // Store all unlisteners
        unlistenRef.current = () => {
          unlisten();
          unlistenDisconnect();
          unlistenError();
        };
      } catch (err: any) {
        if (!cancelled) {
          console.error("RDP canvas init error:", err);
          setStatus("error");
          setErrorMsg(err.message || "初始化 RDP 会话失败");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [sessionId, onDisconnect, status]);

  const handleDisconnect = useCallback(async () => {
    disconnectedRef.current = true;
    try {
      await rdpStopSession(sessionId);
    } catch (e) {
      // ignore
    }
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    onDisconnect();
  }, [sessionId, onDisconnect]);

  // Mouse event handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== "connected") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = connection.screen_width / rect.width;
      const scaleY = connection.screen_height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      rdpSendInput(sessionId, { event_type: "mousemove", x, y }).catch(() => {});
    },
    [sessionId, status, connection.screen_width, connection.screen_height]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== "connected") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = connection.screen_width / rect.width;
      const scaleY = connection.screen_height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      // button: 0=left, 1=middle, 2=right
      const button = e.button;
      rdpSendInput(sessionId, { event_type: "mousedown", x, y, button }).catch(() => {});
    },
    [sessionId, status, connection.screen_width, connection.screen_height]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (status !== "connected") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = connection.screen_width / rect.width;
      const scaleY = connection.screen_height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      const button = e.button;
      rdpSendInput(sessionId, { event_type: "mouseup", x, y, button }).catch(() => {});
    },
    [sessionId, status, connection.screen_width, connection.screen_height]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">RDP 会话启动失败</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
          {errorMsg}
        </p>
        <div className="flex items-center gap-2">
          {onExternalClient && (
            <Button onClick={onExternalClient} className="btn-macos rounded-lg">
              <ExternalLink className="h-4 w-4 mr-2" />
              使用外部客户端
            </Button>
          )}
          <Button onClick={handleDisconnect} variant="outline" className="rounded-lg">
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--glass-border)] bg-muted/30">
        <div className="flex items-center gap-2">
          <Monitor className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">
            {status === "connecting" ? "正在连接..." : "已连接"}
          </span>
          {status === "connecting" && (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {onExternalClient && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs rounded-lg"
              onClick={onExternalClient}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              外部客户端
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs rounded-lg"
            onClick={handleDisconnect}
          >
            断开
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto flex items-center justify-center bg-black">
        <canvas
          ref={canvasRef}
          width={connection.screen_width}
          height={connection.screen_height}
          className="max-w-full max-h-full cursor-none"
          style={{ imageRendering: "pixelated" }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
        />
      </div>
    </div>
  );
}
