# MacOps - macOS 本地运维面板

MacOps 是一款专为 macOS 设计的轻量级运维面板，帮助你在本地统一管理进程服务、Docker 容器和服务导航书签。

## 功能特性

| 模块 | 功能 |
|------|------|
| **仪表盘** | 系统资源概览、服务状态统计、快速访问书签 |
| **服务管理** | 添加/编辑/删除服务、启动/停止/重启、进程守护、实时日志、端口检测 |
| **Docker 管理** | 容器列表、启动/停止/重启、日志查看、资源监控 |
| **服务导航** | 书签管理、分类过滤、25种图标、网格/列表视图、快速打开 |
| **系统监控** | CPU/内存实时图表、进程列表、系统信息 |
| **设置** | 深色/浅色主题、自动刷新、菜单栏常驻、数据导入导出 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| UI 组件 | Tailwind CSS 3.4 + shadcn/ui |
| 图表 | Recharts |
| 路由 | React Router DOM v7 |
| 状态管理 | Zustand |
| 桌面框架 | Tauri v2 + Rust |
| 数据库 | SQLite (rusqlite) |
| 系统信息 | macOS sysctl/ps/vm_stat/lsof |

## 环境要求

- **macOS** 11.0 或更高版本
- **Node.js** 18+ 和 npm
- **Rust** 1.77+（通过 rustup 安装）
- **Docker Desktop**（可选，用于 Docker 管理功能）

## 快速开始

### 1. 克隆项目

```bash
git clone <项目地址> macops
cd macops
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 安装 Rust 依赖（Tauri CLI）

```bash
cargo install tauri-cli --locked
```

### 4. 开发模式运行

```bash
npm run tauri dev
```

这会同时启动前端开发服务器和 Tauri 桌面应用。

### 5. 构建发行版

```bash
npm run tauri build
```

构建完成后，`.dmg` 安装包位于 `src-tauri/target/release/bundle/dmg/` 目录。

## 使用说明

### 添加第一个服务（如 frpc）

1. 点击左侧菜单「服务」
2. 点击右上角「添加服务」按钮
3. 填写表单：
   - 名称：`内网穿透-frpc`
   - 命令：`/usr/local/bin/frpc -c /Users/你的用户名/.frp/frpc.toml`
   - 工作目录：`/Users/你的用户名`
   - 重启策略：失败时重启
   - 勾选「自动启动」和「自动检测端口」
4. 点击保存，服务将自动启动

### 添加 Docker 容器快捷管理

Docker 页面会自动列出你本地 Docker Desktop 中的所有容器，支持启动/停止/重启/查看日志。

### 添加服务导航书签

1. 点击左侧菜单「导航」
2. 点击「添加书签」
3. 填写名称、URL（如 `http://localhost:8080`）、选择分类和图标
4. 在仪表盘可快速访问

### 菜单栏常驻

在设置中开启「显示菜单栏图标」，MacOps 会常驻在菜单栏，点击图标可快速查看服务状态。

## 项目结构

```
macops/
├── src/                      # 前端源码
│   ├── pages/                # 页面组件
│   │   ├── Dashboard.tsx     # 仪表盘
│   │   ├── Services.tsx      # 服务管理
│   │   ├── Docker.tsx        # Docker 管理
│   │   ├── Bookmarks.tsx     # 服务导航
│   │   ├── System.tsx        # 系统监控
│   │   └── Settings.tsx      # 设置
│   ├── components/
│   │   ├── Layout.tsx        # 侧边栏布局
│   │   └── ui/               # UI 组件库
│   ├── lib/
│   │   ├── api.ts            # Tauri IPC API 封装
│   │   └── utils.ts          # 工具函数
│   ├── stores/
│   │   └── theme.ts          # 主题状态
│   ├── types/
│   │   └── index.ts          # TypeScript 类型
│   ├── App.tsx               # 路由配置
│   ├── main.tsx              # 入口
│   └── styles.css            # 全局样式
├── src-tauri/                # Rust 后端
│   ├── src/
│   │   ├── main.rs           # 入口 + 托盘
│   │   ├── commands.rs       # IPC 命令（18个）
│   │   ├── database.rs       # SQLite 数据库层
│   │   ├── process.rs        # 进程管理器
│   │   ├── docker.rs         # Docker CLI 封装
│   │   └── system.rs         # 系统信息采集
│   ├── Cargo.toml            # Rust 依赖
│   └── tauri.conf.json       # Tauri 配置
├── package.json              # npm 配置
├── tailwind.config.js        # Tailwind 配置
└── vite.config.ts            # Vite 配置
```

## 核心架构

```
┌──────────────────────────────────────────────────┐
│              React 19 Frontend                    │
│  Dashboard | Services | Docker | Bookmarks       │
├──────────────────────────────────────────────────┤
│           Tauri IPC (invoke/listen)              │
├──────────────────────────────────────────────────┤
│              Rust Backend                         │
│  ┌─────────┐ ┌────────┐ ┌─────────┐ ┌────────┐  │
│  │ Process │ │ Docker │ │ System  │ │ SQLite │  │
│  │ Manager │ │  CLI   │ │ Monitor │ │  .db   │  │
│  │(spawn)  │ │(shell) │ │(sysctl) │ │(local) │  │
│  └─────────┘ └────────┘ └─────────┘ └────────┘  │
├──────────────────────────────────────────────────┤
│                macOS System                       │
│  ┌─────────┐ ┌────────┐ ┌──────────────┐        │
│  │  frpc   │ │ Python │ │ Docker Engine│        │
│  │ Process │ │ Process│ │   (Desktop)  │        │
│  └─────────┘ └────────┘ └──────────────┘        │
└──────────────────────────────────────────────────┘
```

## IPC 命令列表（18个）

| 模块 | 命令 | 说明 |
|------|------|------|
| 服务管理 | `list_services` | 列出所有服务 |
| 服务管理 | `create_service` | 创建服务 |
| 服务管理 | `update_service` | 更新服务配置 |
| 服务管理 | `delete_service` | 删除服务 |
| 服务管理 | `start_service` | 启动服务进程 |
| 服务管理 | `stop_service` | 停止服务进程 |
| 服务管理 | `restart_service` | 重启服务进程 |
| 服务管理 | `get_service_logs` | 获取服务日志 |
| Docker | `list_containers` | 列出所有容器 |
| Docker | `start_container` | 启动容器 |
| Docker | `stop_container` | 停止容器 |
| Docker | `restart_container` | 重启容器 |
| Docker | `remove_container` | 删除容器 |
| Docker | `get_container_logs` | 获取容器日志 |
| Docker | `get_container_stats` | 获取容器资源 |
| 书签 | `list_bookmarks` | 列出书签 |
| 书签 | `create_bookmark` | 创建书签 |
| 书签 | `update_bookmark` | 更新书签 |
| 书签 | `delete_bookmark` | 删除书签 |
| 系统 | `get_system_info` | 获取系统信息 |
| 系统 | `get_resource_usage` | 获取资源使用率 |
| 系统 | `get_processes` | 获取进程列表 |
| 设置 | `get_settings` | 获取应用设置 |
| 设置 | `update_settings` | 更新应用设置 |

## 常见问题

### Q: 构建时提示缺少图标文件？
A: 构建前需要在 `src-tauri/icons/` 目录下放置以下图标文件：
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS 专用)
- `icon.ico` (Windows 专用)
- `icon.png`

可使用 [tauri icon](https://tauri.app/v1/guides/features/icons/) 命令自动生成：
```bash
cargo tauri icon /path/to/your/icon.png
```

### Q: Docker 管理功能无法使用？
A: 确保 Docker Desktop 已安装并运行，且当前用户在 `docker` 用户组中。

### Q: 如何重置所有数据？
A: 在「设置」页面点击「重置所有数据」按钮，数据库文件将被删除。

## License

MIT
