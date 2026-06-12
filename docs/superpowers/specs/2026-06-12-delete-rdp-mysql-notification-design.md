# 删除 RDP、MySQL 数据库管理、通知功能设计

## 目标

从 MacNest 中彻底删除以下三个功能的所有代码、依赖和数据库表：

1. **RDP**（远程桌面）
2. **数据库管理**（MySQL 管理器）
3. **通知**（定时/监控通知与 macOS 系统通知测试）

删除范围覆盖前端、后端、数据库 schema 及项目依赖。

## 删除清单

### 前端

#### 删除文件

- `src/pages/Rdp.tsx`
- `src/pages/DatabaseManager.tsx`
- `src/pages/Notifications.tsx`
- `src/components/rdp/RdpCanvas.tsx`
- `src/components/mysql/BackupDialog.tsx`
- `src/components/mysql/BackupPanel.tsx`
- `src/components/mysql/ConnectionDialog.tsx`
- `src/components/mysql/ConnectionPanel.tsx`
- `src/components/mysql/ErrorBoundary.tsx`
- `src/components/mysql/ObjectTree.tsx`
- `src/components/mysql/QueryEditor.tsx`
- `src/components/mysql/ResultTable.tsx`
- `src/components/mysql/TabBar.tsx`
- `src/components/mysql/TableStructureView.tsx`
- `src/lib/mysql-api.ts`
- `src/lib/notification.tsx`
- `src/stores/mysql.ts`

#### 修改文件

- `src/App.tsx`
  - 移除 RDP、DatabaseManager、Notifications 页面 import
  - 移除 `/rdp`、`/database`、`/notifications` 路由
  - 移除 `initNotificationListener` 初始化逻辑
- `src/components/Layout.tsx`
  - 从 `navItems` 中移除 RDP、数据库管理、通知三个菜单项
  - 移除未使用的图标 import（`ScreenShare`、`Bell`、`DatabaseIcon`）
- `src/lib/api.ts`
  - 移除 RDP 相关 API 函数：`createRdpConnection`、`listRdpConnections`、`updateRdpConnection`、`deleteRdpConnection`、`rdpConnect`、`rdpStartSession`、`rdpStopSession`、`rdpSendInput`
  - 移除通知相关 API 函数：`listNotifications`、`createNotification`、`updateNotification`、`deleteNotification`、`toggleNotification`、`listNotificationLogs`、`dismissNotificationToday`
  - 移除 `RdpConnection`、`Notification`、`NotificationLog` 类型 import
- `src/types/index.ts`
  - 移除 RDP 类型：`RdpConnection`
  - 移除通知类型：`Notification`、`NotificationLog`
  - 移除 MySQL 类型：`MysqlConnection`、`MysqlConnectionConfig`、`DatabaseInfo`、`TableInfo`、`ViewInfo`、`TriggerInfo`、`FunctionInfo`、`EventInfo`、`ColumnInfo`、`IndexInfo`、`TableStructure`、`MysqlQueryResult`、`MysqlBackupTask`、`MysqlObjectType`、`MysqlObject`、`PendingEdit`、`TabState`、`LoadTableDataRequest`、`LoadTableDataResponse`
- `src/pages/Settings.tsx`
  - 移除通知测试区块（系统通知测试、权限检查、通知发送按钮等）
  - 移除 `@/lib/notification` import

### 后端

#### 删除文件/目录

- `src-tauri/src/rdp/` 整个目录
  - `mod.rs`
  - `encoder.rs`
  - `manager.rs`
  - `network_client.rs`
  - `session.rs`
- `src-tauri/src/mysql/` 整个目录
  - `mod.rs`
  - `backup.rs`
  - `connection.rs`
  - `query.rs`
  - `schema.rs`
- `src-tauri/src/notification_scheduler.rs`

#### 修改文件

- `src-tauri/src/main.rs`
  - 移除 `mod rdp;`、`mod mysql;`、`mod notification_scheduler;`
  - 从 `AppState` 中移除 `rdp_session_manager`
  - 移除 `notification_scheduler::start_scheduler(...)` 调用
  - 从 `generate_handler!` 中移除 RDP、MySQL、通知相关命令
- `src-tauri/src/commands.rs`
  - 移除 RDP 命令：`create_rdp_connection`、`list_rdp_connections`、`update_rdp_connection`、`delete_rdp_connection`、`rdp_start_session`、`rdp_stop_session`、`rdp_send_input`
  - 移除通知命令：`send_osascript_notification`、`check_macos_notification_permission`、`get_bundle_id`、`get_app_path`、`is_in_applications`、`reinstall_to_applications`、`create_notification`、`list_notifications`、`update_notification`、`delete_notification`、`toggle_notification`、`list_notification_logs`、`dismiss_notification_today`
  - 移除 MySQL 命令：`mysql_create_connection`、`mysql_list_connections`、`mysql_update_connection`、`mysql_delete_connection`、`mysql_test_connection`、`mysql_connect`、`mysql_disconnect`、`mysql_switch_database`、`mysql_list_databases`、`mysql_list_tables`、`mysql_list_views`、`mysql_list_triggers`、`mysql_list_functions`、`mysql_list_events`、`mysql_get_table_structure`、`mysql_execute_query`、`mysql_load_table_data_paged`、`mysql_create_backup_task`、`mysql_list_backup_tasks`、`mysql_delete_backup_task`、`mysql_toggle_backup_task`、`mysql_run_backup_now`、`mysql_dump_table`
- `src-tauri/src/database.rs`
  - 移除 structs：`RdpConnection`、`Notification`、`NotificationLog`、`MysqlConnection`、`MysqlBackupTask`
  - 移除 `init()` 中相关 `CREATE TABLE` 语句
  - 移除 RDP/Notification/MySQL 的 CRUD 方法
  - 从 `delete_group` 中移除对 `rdp_connections` 的清理逻辑
  - 添加启动迁移，DROP 以下旧表：
    - `rdp_connections`
    - `notifications`
    - `notification_logs`
    - `notification_dismiss`
    - `mysql_connections`
    - `mysql_backup_tasks`

### 依赖清理

- `src-tauri/Cargo.toml`
  - 移除 `tauri-plugin-notification`
  - 移除 `sqlx`
  - 移除 `cron`
  - 移除 `urlencoding`
  - 移除所有 `ironrdp-*`、`ironrdp`、`ironrdp-core`
  - 移除 `tokio-rustls`、`socket2`、`tracing`、`url`、`rustls`、`webpki-roots`、`image`、`ureq`、`x509-cert`
  - 保留 `chrono`（`process`、`ssh`、`tmux` 仍在使用）
- `package.json`
  - 移除 `@tauri-apps/plugin-notification`

## 数据迁移策略

在 `database.rs` 的 `init()` 末尾添加一次性迁移：

```rust
let _ = conn.execute_batch(
    "DROP TABLE IF EXISTS rdp_connections;
     DROP TABLE IF EXISTS notification_logs;
     DROP TABLE IF EXISTS notification_dismiss;
     DROP TABLE IF EXISTS notifications;
     DROP TABLE IF EXISTS mysql_backup_tasks;
     DROP TABLE IF EXISTS mysql_connections;"
);
```

SQLite 的 `DROP TABLE` 会同时删除表结构和数据。由于外键约束（`mysql_backup_tasks` 引用 `mysql_connections`），需要先删除子表再删除父表。

## 验证计划

1. `cargo check` / `cargo build` 通过
2. `pnpm tauri dev` 或 `pnpm build` 通过 TypeScript 编译
3. 启动应用后菜单中不再显示 RDP、数据库管理、通知
4. 访问 `/rdp`、`/database`、`/notifications` 路由返回空白或 404
5. 检查 SQLite 数据库，确认相关表已不存在
6. 清理 `src-tauri/target` 和 `node_modules` 中残留的编译缓存（可选）

## 风险与回滚

- 删除后无法恢复这些功能的数据，用户历史配置会丢失。
- 由于 Git 版本控制已存在，如需回滚可通过 `git revert` 或从旧分支恢复。
- 本次删除不修改除上述功能外的其他模块（SSH、Docker、Tmux、书签、服务等保持原样）。
