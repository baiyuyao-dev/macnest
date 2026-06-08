import { create } from "zustand";
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
import {
  listMysqlConnections,
  createMysqlConnection,
  updateMysqlConnection,
  deleteMysqlConnection,
  testMysqlConnection,
  mysqlConnect,
  mysqlDisconnect,
  switchMysqlDatabase,
  listMysqlDatabases,
  listMysqlTables,
  listMysqlViews,
  listMysqlTriggers,
  listMysqlFunctions,
  listMysqlEvents,
  getMysqlTableStructure,
  executeMysqlQuery,
  listMysqlBackupTasks,
  createMysqlBackupTask as apiCreateBackupTask,
  deleteMysqlBackupTask as apiDeleteBackupTask,
  toggleMysqlBackupTask as apiToggleBackupTask,
  runMysqlBackupNow as apiRunBackupNow,
} from "@/lib/mysql-api";

interface MysqlState {
  connections: MysqlConnection[];
  currentConnectionId: number | null;
  currentDatabase: string | null;
  databases: DatabaseInfo[];
  tables: TableInfo[];
  views: ViewInfo[];
  triggers: TriggerInfo[];
  functions: FunctionInfo[];
  events: EventInfo[];
  selectedTable: string | null;
  tableStructure: TableStructure | null;
  queryResult: MysqlQueryResult | null;
  queryHistory: string[];
  isExecuting: boolean;
  isConnecting: boolean;
  backupTasks: MysqlBackupTask[];
  viewMode: "data" | "structure";

  loadConnections: () => Promise<void>;
  createConnection: (config: MysqlConnectionConfig) => Promise<number>;
  updateConnection: (id: number, config: MysqlConnectionConfig) => Promise<void>;
  deleteConnection: (id: number) => Promise<void>;
  testConnection: (config: MysqlConnectionConfig) => Promise<boolean>;
  connect: (id: number) => Promise<boolean>;
  disconnect: () => Promise<void>;
  selectDatabase: (database: string) => Promise<void>;
  loadDatabases: () => Promise<void>;
  loadTables: () => Promise<void>;
  loadViews: () => Promise<void>;
  loadTriggers: () => Promise<void>;
  loadFunctions: () => Promise<void>;
  loadEvents: () => Promise<void>;
  loadTableStructure: (table: string) => Promise<void>;
  loadTableData: (table: string, limit?: number) => Promise<MysqlQueryResult | null>;
  executeQuery: (sql: string) => Promise<MysqlQueryResult | null>;
  addQueryHistory: (sql: string) => void;
  setViewMode: (mode: "data" | "structure") => void;
  loadBackupTasks: () => Promise<void>;
  createBackupTask: (
    connectionId: number,
    databaseName: string,
    cronExpression: string,
    backupPath: string
  ) => Promise<number>;
  deleteBackupTask: (id: number) => Promise<void>;
  toggleBackupTask: (id: number, isEnabled: boolean) => Promise<void>;
  runBackupNow: (taskId: number) => Promise<string>;
}

export const useMysqlStore = create<MysqlState>((set, get) => ({
  connections: [],
  currentConnectionId: null,
  currentDatabase: null,
  databases: [],
  tables: [],
  views: [],
  triggers: [],
  functions: [],
  events: [],
  selectedTable: null,
  tableStructure: null,
  queryResult: null,
  queryHistory: [],
  isExecuting: false,
  isConnecting: false,
  backupTasks: [],
  viewMode: "data",

  loadConnections: async () => {
    const connections = await listMysqlConnections();
    set({ connections });
  },

  createConnection: async (config) => {
    const id = await createMysqlConnection(config);
    await get().loadConnections();
    return id;
  },

  updateConnection: async (id, config) => {
    await updateMysqlConnection(id, config);
    await get().loadConnections();
  },

  deleteConnection: async (id) => {
    await deleteMysqlConnection(id);
    const state = get();
    if (state.currentConnectionId === id) {
      await mysqlDisconnect(id);
      set({
        currentConnectionId: null,
        currentDatabase: null,
        databases: [],
        tables: [],
        views: [],
        triggers: [],
        functions: [],
        events: [],
      });
    }
    await get().loadConnections();
  },

  testConnection: async (config) => {
    return await testMysqlConnection(config);
  },

  connect: async (id) => {
    set({ isConnecting: true });
    try {
      await mysqlConnect(id);
      set({ currentConnectionId: id });
      await get().loadDatabases();
      return true;
    } finally {
      set({ isConnecting: false });
    }
  },

  disconnect: async () => {
    const { currentConnectionId } = get();
    if (currentConnectionId) {
      await mysqlDisconnect(currentConnectionId);
    }
    set({
      currentConnectionId: null,
      currentDatabase: null,
      databases: [],
      tables: [],
      views: [],
      triggers: [],
      functions: [],
      events: [],
      selectedTable: null,
      tableStructure: null,
    });
  },

  selectDatabase: async (database) => {
    const { currentConnectionId } = get();
    if (!currentConnectionId) return;
    // 后端切换数据库（重建连接池）
    await switchMysqlDatabase(currentConnectionId, database);
    set({ currentDatabase: database });
    await Promise.all([
      get().loadTables(),
      get().loadViews(),
      get().loadTriggers(),
      get().loadFunctions(),
      get().loadEvents(),
    ]);
  },

  loadDatabases: async () => {
    const { currentConnectionId } = get();
    if (!currentConnectionId) return;
    const databases = await listMysqlDatabases(currentConnectionId);
    set({ databases });
  },

  loadTables: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const tables = await listMysqlTables(currentConnectionId, currentDatabase);
    set({ tables });
  },

  loadViews: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const views = await listMysqlViews(currentConnectionId, currentDatabase);
    set({ views });
  },

  loadTriggers: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const triggers = await listMysqlTriggers(currentConnectionId, currentDatabase);
    set({ triggers });
  },

  loadFunctions: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const functions = await listMysqlFunctions(currentConnectionId, currentDatabase);
    set({ functions });
  },

  loadEvents: async () => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const events = await listMysqlEvents(currentConnectionId, currentDatabase);
    set({ events });
  },

  loadTableStructure: async (table) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return;
    const structure = await getMysqlTableStructure(currentConnectionId, currentDatabase, table);
    set({ selectedTable: table, tableStructure: structure, viewMode: "structure" });
  },

  loadTableData: async (table, limit = 100) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return null;
    set({ isExecuting: true });
    try {
      const sql = `SELECT * FROM \`${table}\` LIMIT ${limit}`;
      const result = await executeMysqlQuery(currentConnectionId, currentDatabase, sql);
      set({ queryResult: result, selectedTable: table, viewMode: "data" });
      return result;
    } finally {
      set({ isExecuting: false });
    }
  },

  executeQuery: async (sql) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId) return null;
    set({ isExecuting: true });
    try {
      const result = await executeMysqlQuery(
        currentConnectionId,
        currentDatabase || "",
        sql
      );
      set({ queryResult: result });
      get().addQueryHistory(sql);
      return result;
    } finally {
      set({ isExecuting: false });
    }
  },

  addQueryHistory: (sql) => {
    set((state) => {
      const history = [sql, ...state.queryHistory.filter((s) => s !== sql)].slice(0, 50);
      return { queryHistory: history };
    });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  loadBackupTasks: async () => {
    const tasks = await listMysqlBackupTasks();
    set({ backupTasks: tasks });
  },

  createBackupTask: async (connectionId, databaseName, cronExpression, backupPath) => {
    const id = await apiCreateBackupTask(connectionId, databaseName, cronExpression, backupPath);
    await get().loadBackupTasks();
    return id;
  },

  deleteBackupTask: async (id) => {
    await apiDeleteBackupTask(id);
    await get().loadBackupTasks();
  },

  toggleBackupTask: async (id, isEnabled) => {
    await apiToggleBackupTask(id, isEnabled);
    await get().loadBackupTasks();
  },

  runBackupNow: async (taskId) => {
    const path = await apiRunBackupNow(taskId);
    await get().loadBackupTasks();
    return path;
  },
}));
