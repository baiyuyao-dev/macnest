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

export interface CellEdit {
  rowIndex: number;
  colName: string;
  oldValue: unknown;
  newValue: string;
}

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
  showQueryEditor: boolean;
  pendingEdits: Map<string, CellEdit>;
  pageSize: number;

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
  setShowQueryEditor: (show: boolean) => void;
  setCellEdit: (edit: CellEdit) => void;
  removeCellEdit: (rowIndex: number, colName: string) => void;
  commitEdits: () => Promise<void>;
  cancelEdits: () => void;
  setPageSize: (size: number) => void;
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

function editKey(rowIndex: number, colName: string): string {
  return `${rowIndex}:${colName}`;
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
  showQueryEditor: false,
  pendingEdits: new Map(),
  pageSize: 100,

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
      pendingEdits: new Map(),
    });
  },

  selectDatabase: async (database) => {
    const { currentConnectionId } = get();
    if (!currentConnectionId) return;
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
    // 联动：同时加载数据
    await get().loadTableData(table, get().pageSize);
  },

  loadTableData: async (table, limit) => {
    const { currentConnectionId, currentDatabase } = get();
    const pageSize = limit ?? get().pageSize;
    if (!currentConnectionId || !currentDatabase) return null;
    set({ isExecuting: true, pendingEdits: new Map() });
    try {
      const sql = `SELECT * FROM \`${table}\` LIMIT ${pageSize}`;
      const result = await executeMysqlQuery(currentConnectionId, currentDatabase, sql);
      set({ queryResult: result, selectedTable: table, viewMode: "data" });
      // 联动：同时加载结构
      try {
        const structure = await getMysqlTableStructure(currentConnectionId, currentDatabase, table);
        set({ tableStructure: structure });
      } catch {
        // 结构加载失败不影响数据展示
      }
      return result;
    } finally {
      set({ isExecuting: false });
    }
  },

  executeQuery: async (sql) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId) return null;
    set({ isExecuting: true, pendingEdits: new Map() });
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

  setShowQueryEditor: (show) => {
    set({ showQueryEditor: show });
  },

  setCellEdit: (edit) => {
    set((state) => {
      const next = new Map(state.pendingEdits);
      next.set(editKey(edit.rowIndex, edit.colName), edit);
      return { pendingEdits: next };
    });
  },

  removeCellEdit: (rowIndex, colName) => {
    set((state) => {
      const next = new Map(state.pendingEdits);
      next.delete(editKey(rowIndex, colName));
      return { pendingEdits: next };
    });
  },

  commitEdits: async () => {
    const { currentConnectionId, currentDatabase, selectedTable, pendingEdits, queryResult } = get();
    if (!currentConnectionId || !currentDatabase || !selectedTable || pendingEdits.size === 0) return;

    // 按行分组
    const editsByRow = new Map<number, CellEdit[]>();
    for (const edit of pendingEdits.values()) {
      const arr = editsByRow.get(edit.rowIndex) || [];
      arr.push(edit);
      editsByRow.set(edit.rowIndex, arr);
    }

    // 找到主键列
    const pkCol = queryResult?.columns[0] || "id";

    set({ isExecuting: true });
    try {
      for (const [rowIndex, edits] of editsByRow) {
        const pkValue = queryResult?.rows[rowIndex]?.[0];
        if (pkValue === undefined) continue;

        const sets = edits.map((e) => `\`${e.colName}\` = ?`).join(", ");
        const values = edits.map((e) => e.newValue);

        let pkClause: string;
        let pkParam: unknown;
        if (pkValue === null) {
          pkClause = `\`${pkCol}\` IS NULL`;
          pkParam = null;
        } else {
          pkClause = `\`${pkCol}\` = ?`;
          pkParam = pkValue;
        }

        const sql = `UPDATE \`${selectedTable}\` SET ${sets} WHERE ${pkClause}`;
        const params = [...values, pkParam].filter((v) => v !== null);

        await executeMysqlQuery(
          currentConnectionId,
          currentDatabase,
          sql.replace(/\?/g, () => {
            const p = params.shift();
            if (p === null) return "NULL";
            if (typeof p === "string") return `'${p.replace(/'/g, "''")}'`;
            return String(p);
          })
        );
      }
      // 刷新数据
      await get().loadTableData(selectedTable);
    } finally {
      set({ isExecuting: false });
    }
  },

  cancelEdits: () => {
    set({ pendingEdits: new Map() });
  },

  setPageSize: (size) => {
    set({ pageSize: size });
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
