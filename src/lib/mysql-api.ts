import { invoke } from "@tauri-apps/api/core";
import type {
  MysqlConnection,
  MysqlConnectionConfig,
  DatabaseInfo,
  TableInfo,
  ViewInfo,
  TriggerInfo,
  FunctionInfo,
  EventInfo,
  TableStructure,
  MysqlQueryResult,
  MysqlBackupTask,
} from "@/types";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error: unknown) {
    throw new Error(getErrorMessage(error));
  }
}

// === 连接管理 ===

export async function createMysqlConnection(config: MysqlConnectionConfig): Promise<number> {
  return invokeSafe("mysql_create_connection", { req: config });
}

export async function listMysqlConnections(): Promise<MysqlConnection[]> {
  return invokeSafe("mysql_list_connections");
}

export async function updateMysqlConnection(
  id: number,
  config: MysqlConnectionConfig
): Promise<void> {
  return invokeSafe("mysql_update_connection", { req: { id, ...config } });
}

export async function deleteMysqlConnection(id: number): Promise<void> {
  return invokeSafe("mysql_delete_connection", { id });
}

export async function testMysqlConnection(
  config: MysqlConnectionConfig
): Promise<boolean> {
  return invokeSafe("mysql_test_connection", { req: config });
}

export async function mysqlConnect(connectionId: number): Promise<boolean> {
  return invokeSafe("mysql_connect", { connectionId });
}

export async function mysqlDisconnect(connectionId: number): Promise<void> {
  return invokeSafe("mysql_disconnect", { connectionId });
}

// === 元数据 ===

export async function listMysqlDatabases(connectionId: number): Promise<DatabaseInfo[]> {
  return invokeSafe("mysql_list_databases", { connectionId });
}

export async function listMysqlTables(
  connectionId: number,
  database: string
): Promise<TableInfo[]> {
  return invokeSafe("mysql_list_tables", { connectionId, database });
}

export async function listMysqlViews(
  connectionId: number,
  database: string
): Promise<ViewInfo[]> {
  return invokeSafe("mysql_list_views", { connectionId, database });
}

export async function listMysqlTriggers(
  connectionId: number,
  database: string
): Promise<TriggerInfo[]> {
  return invokeSafe("mysql_list_triggers", { connectionId, database });
}

export async function listMysqlFunctions(
  connectionId: number,
  database: string
): Promise<FunctionInfo[]> {
  return invokeSafe("mysql_list_functions", { connectionId, database });
}

export async function listMysqlEvents(
  connectionId: number,
  database: string
): Promise<EventInfo[]> {
  return invokeSafe("mysql_list_events", { connectionId, database });
}

export async function getMysqlTableStructure(
  connectionId: number,
  database: string,
  table: string
): Promise<TableStructure> {
  return invokeSafe("mysql_get_table_structure", { connectionId, database, table });
}

// === 查询执行 ===

export async function executeMysqlQuery(
  connectionId: number,
  database: string,
  sql: string
): Promise<MysqlQueryResult> {
  return invokeSafe("mysql_execute_query", {
    req: { connection_id: connectionId, database, sql },
  });
}

// === 备份任务 ===

export async function createMysqlBackupTask(
  connectionId: number,
  databaseName: string,
  cronExpression: string,
  backupPath: string
): Promise<number> {
  return invokeSafe("mysql_create_backup_task", {
    req: { connection_id: connectionId, database_name: databaseName, cron_expression: cronExpression, backup_path: backupPath },
  });
}

export async function listMysqlBackupTasks(): Promise<MysqlBackupTask[]> {
  return invokeSafe("mysql_list_backup_tasks");
}

export async function deleteMysqlBackupTask(id: number): Promise<void> {
  return invokeSafe("mysql_delete_backup_task", { id });
}

export async function toggleMysqlBackupTask(id: number, isEnabled: boolean): Promise<void> {
  return invokeSafe("mysql_toggle_backup_task", { id, isEnabled });
}

export async function runMysqlBackupNow(taskId: number): Promise<string> {
  return invokeSafe("mysql_run_backup_now", { taskId });
}
