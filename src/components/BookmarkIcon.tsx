import { useState } from "react";
import {
  LayoutDashboard, Server, Database, Globe, Terminal,
  Cpu, HardDrive, Code, Box, Layers, Zap, Shield,
  Settings, FileText, Link, BookOpen, BarChart3, FlaskConical,
  Cloud, MessageSquare, Mail, Calendar,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard, "server": Server, "database": Database,
  "globe": Globe, "terminal": Terminal, "cpu": Cpu, "hard-drive": HardDrive,
  "code": Code, "box": Box, "layers": Layers, "zap": Zap, "shield": Shield,
  "settings": Settings, "file-text": FileText, "link": Link, "book-open": BookOpen,
  "bar-chart": BarChart3, "flask": FlaskConical, "cloud": Cloud,
  "message-square": MessageSquare, "mail": Mail, "calendar": Calendar,
};

function getLucideIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Link;
}

function getFaviconUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `http://${url}`);
    return `${u.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

interface BookmarkIconProps {
  icon: string;
  url: string;
  className?: string;
}

export default function BookmarkIcon({ icon, url, className }: BookmarkIconProps) {
  const [showImg, setShowImg] = useState(false);

  // 用户手动选了 Lucide 图标（非 link 且非 http）
  if (icon && icon !== "link" && !icon.startsWith("http")) {
    const IconComp = getLucideIcon(icon);
    return <IconComp className={className} />;
  }

  // 用户手动设置图片 URL，或默认情况
  const src = icon?.startsWith("http") ? icon : getFaviconUrl(url);

  if (!src) {
    const IconComp = getLucideIcon("link");
    return <IconComp className={className} />;
  }

  return (
    <>
      {!showImg && <Link className={className} />}
      <img
        src={src}
        alt=""
        className={className}
        style={{ display: showImg ? "block" : "none" }}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth > 1 && e.currentTarget.naturalHeight > 1) {
            setShowImg(true);
          }
        }}
      />
    </>
  );
}
