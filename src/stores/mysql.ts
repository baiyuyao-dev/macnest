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
  TabState,
  PendingEdit,
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
  loadTableDataPaged,
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
  openTabs: TabState[];
  activeTabIndex: number;
  queryHistory: string[];
  isExecuting: boolean;
  isConnecting: boolean;
  backupTasks: MysqlBackupTask[];

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

  openTab: (table: string) => number;
  closeTab: (index: number) => void;
  switchTab: (index: number) => void;
  setTabSubTab: (tabIndex: number, subTab: "data" | "structure" | "sql") => void;
  setTabFilter: (tabIndex: number, col: string, value: string) => Promise<void>;
  setTabSort: (tabIndex: number, col: string | null, dir: "asc" | "desc" | null) => Promise<void>;
  setTabPage: (tabIndex: number, page: number) => Promise<void>;
  setTabPageSize: (tabIndex: number, size: number) => Promise<void>;
  toggleRowSelection: (tabIndex: number, rowIndex: number) => void;
  toggleColSelection: (tabIndex: number, col: string) => void;
  setTabCellEdit: (tabIndex: number, edit: PendingEdit) => void;
  removeTabCellEdit: (tabIndex: number, rowIndex: number, colName: string) => void;
  commitTabEdits: (tabIndex: number) => Promise<void>;
  cancelTabEdits: (tabIndex: number) => void;
  setTabSqlContent: (tabIndex: number, sql: string) => void;
  reloadTabData: (tabIndex: number) => Promise<void>;
}

function editKey(rowIndex: number, colName: string): string {
  return `${rowIndex}:${colName}`;
}

function createTabState(table: string): TabState {
  return {
    table,
    subTab: "data",
    filters: {},
    sortCol: null,
    sortDir: null,
    page: 0,
    pageSize: 100,
    selectedRows: new Set(),
    selectedCols: new Set(),
    pendingEdits: new Map(),
    queryResult: null,
    tableStructure: null,
    totalRows: 0,
    sqlEditorContent: `SELECT * FROM \`${table}\``,
  };
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
  openTabs: [],
  activeTabIndex: -1,
  queryHistory: [],
  isExecuting: false,
  isConnecting: false,
  backupTasks: [],

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
        openTabs: [],
        activeTabIndex: -1,
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
      openTabs: [],
      activeTabIndex: -1,
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

    const tabIndex = get().openTab(table);
    const structure = await getMysqlTableStructure(currentConnectionId, currentDatabase, table);

    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], tableStructure: structure, subTab: "structure" };
      }
      return { openTabs: tabs };
    });

    await get().reloadTabData(tabIndex);
  },

  loadTableData: async (table, limit) => {
    const { currentConnectionId, currentDatabase } = get();
    if (!currentConnectionId || !currentDatabase) return null;

    const tabIndex = get().openTab(table);
    const pageSize = limit ?? get().openTabs[tabIndex]?.pageSize ?? 100;

    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = {
          ...tabs[tabIndex],
          pageSize,
          pendingEdits: new Map(),
          subTab: "data",
        };
      }
      return { openTabs: tabs, isExecuting: true };
    });

    try {
      const resp = await loadTableDataPaged(
        currentConnectionId,
        currentDatabase,
        table,
        0,
        pageSize,
        {},
        null,
        null
      );
      const result: MysqlQueryResult = {
        columns: resp.columns,
        rows: resp.rows,
        affected_rows: null,
        execution_time_ms: resp.execution_time_ms,
      };
      set((state) => {
        const tabs = [...state.openTabs];
        if (tabIndex >= 0 && tabIndex < tabs.length) {
          tabs[tabIndex] = { ...tabs[tabIndex], queryResult: result, totalRows: resp.total_rows };
        }
        return { openTabs: tabs };
      });

      try {
        const structure = await getMysqlTableStructure(currentConnectionId, currentDatabase, table);
        set((state) => {
          const tabs = [...state.openTabs];
          if (tabIndex >= 0 && tabIndex < tabs.length) {
            tabs[tabIndex] = { ...tabs[tabIndex], tableStructure: structure };
          }
          return { openTabs: tabs };
        });
      } catch {
        // ignore structure load failure
      }

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
      set((state) => {
        const tabs = [...state.openTabs];
        const idx = state.activeTabIndex;
        if (idx >= 0 && idx < tabs.length) {
          tabs[idx] = { ...tabs[idx], queryResult: result };
        }
        return { openTabs: tabs };
      });
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

  openTab: (table) => {
    const state = get();
    const existingIndex = state.openTabs.findIndex((t) => t.table === table);
    if (existingIndex !== -1) {
      set({ activeTabIndex: existingIndex });
      return existingIndex;
    }
    const newTab = createTabState(table);
    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabIndex: state.openTabs.length,
    }));
    return state.openTabs.length;
  },

  closeTab: (index) => {
    set((state) => {
      const openTabs = state.openTabs.filter((_, i) => i !== index);
      let activeTabIndex = state.activeTabIndex;
      if (activeTabIndex === index) {
        activeTabIndex = openTabs.length > 0 ? Math.min(index, openTabs.length - 1) : -1;
      } else if (activeTabIndex > index) {
        activeTabIndex -= 1;
      }
      return { openTabs, activeTabIndex };
    });
  },

  switchTab: (index) => {
    if (index >= 0 && index < get().openTabs.length) {
      set({ activeTabIndex: index });
    }
  },

  setTabSubTab: (tabIndex, subTab) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], subTab };
      }
      return { openTabs: tabs };
    });
  },

  setTabFilter: async (tabIndex, col, value) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        const filters = { ...tabs[tabIndex].filters, [col]: value };
        tabs[tabIndex] = { ...tabs[tabIndex], filters, page: 0 };
      }
      return { openTabs: tabs };
    });
    await get().reloadTabData(tabIndex);
  },

  setTabSort: async (tabIndex, col, dir) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], sortCol: col, sortDir: dir, page: 0 };
      }
      return { openTabs: tabs };
    });
    await get().reloadTabData(tabIndex);
  },

  setTabPage: async (tabIndex, page) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], page };
      }
      return { openTabs: tabs };
    });
    await get().reloadTabData(tabIndex);
  },

  setTabPageSize: async (tabIndex, size) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], pageSize: size, page: 0 };
      }
      return { openTabs: tabs };
    });
    await get().reloadTabData(tabIndex);
  },

  toggleRowSelection: (tabIndex, rowIndex) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        const selectedRows = new Set(tabs[tabIndex].selectedRows);
        if (selectedRows.has(rowIndex)) {
          selectedRows.delete(rowIndex);
        } else {
          selectedRows.add(rowIndex);
        }
        tabs[tabIndex] = { ...tabs[tabIndex], selectedRows };
      }
      return { openTabs: tabs };
    });
  },

  toggleColSelection: (tabIndex, col) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        const selectedCols = new Set(tabs[tabIndex].selectedCols);
        if (selectedCols.has(col)) {
          selectedCols.delete(col);
        } else {
          selectedCols.add(col);
        }
        tabs[tabIndex] = { ...tabs[tabIndex], selectedCols };
      }
      return { openTabs: tabs };
    });
  },

  setTabCellEdit: (tabIndex, edit) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        const pendingEdits = new Map(tabs[tabIndex].pendingEdits);
        if (edit.type === "cell") {
          pendingEdits.set(editKey(edit.rowIndex, edit.colName), edit);
        } else if (edit.type === "delete") {
          pendingEdits.set(`delete:${edit.rowIndex}`, edit);
        }
        tabs[tabIndex] = { ...tabs[tabIndex], pendingEdits };
      }
      return { openTabs: tabs };
    });
  },

  removeTabCellEdit: (tabIndex, rowIndex, colName) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        const pendingEdits = new Map(tabs[tabIndex].pendingEdits);
        pendingEdits.delete(editKey(rowIndex, colName));
        tabs[tabIndex] = { ...tabs[tabIndex], pendingEdits };
      }
      return { openTabs: tabs };
    });
  },

  commitTabEdits: async (tabIndex) => {
    const { currentConnectionId, currentDatabase, openTabs } = get();
    const tab = openTabs[tabIndex];
    if (!currentConnectionId || !currentDatabase || !tab || tab.pendingEdits.size === 0) return;

    const queryResult = tab.queryResult;
    const pkCol = queryResult?.columns[0] || "id";

    const deleteEdits: PendingEdit[] = [];
    const updateEditsByRow = new Map<number, PendingEdit[]>();

    for (const edit of tab.pendingEdits.values()) {
      if (edit.type === "delete") {
        deleteEdits.push(edit);
      } else if (edit.type === "cell") {
        const arr = updateEditsByRow.get(edit.rowIndex) || [];
        arr.push(edit);
        updateEditsByRow.set(edit.rowIndex, arr);
      }
    }

    set({ isExecuting: true });
    try {
      // Execute DELETEs first, grouped by row using primary key
      for (const edit of deleteEdits) {
        const pkValue = edit.pkValue;
        if (pkValue === undefined) continue;

        let pkClause: string;
        let pkParam: unknown;
        if (pkValue === null) {
          pkClause = `\`${pkCol}\` IS NULL`;
          pkParam = null;
        } else {
          pkClause = `\`${pkCol}\` = ?`;
          pkParam = pkValue;
        }

        const sql = `DELETE FROM \`${tab.table}\` WHERE ${pkClause}`;
        const params = [pkParam].filter((v) => v !== null);

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

      // Execute UPDATEs grouped by row
      for (const [rowIndex, edits] of updateEditsByRow) {
        const firstEdit = edits[0];
        const pkValue = firstEdit.pkValue;
        if (pkValue === undefined) continue;

        const sets = edits.map((e) => `\`${(e as Extract<PendingEdit, { type: "cell" }>).colName}\` = ?`).join(", ");
        const values = edits.map((e) => (e as Extract<PendingEdit, { type: "cell" }>).newValue);

        let pkClause: string;
        let pkParam: unknown;
        if (pkValue === null) {
          pkClause = `\`${pkCol}\` IS NULL`;
          pkParam = null;
        } else {
          pkClause = `\`${pkCol}\` = ?`;
          pkParam = pkValue;
        }

        const sql = `UPDATE \`${tab.table}\` SET ${sets} WHERE ${pkClause}`;
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

      // Reload tab data and clear pending edits
      await get().reloadTabData(tabIndex);
      set((state) => {
        const tabs = [...state.openTabs];
        if (tabIndex >= 0 && tabIndex < tabs.length) {
          tabs[tabIndex] = { ...tabs[tabIndex], pendingEdits: new Map() };
        }
        return { openTabs: tabs };
      });
    } finally {
      set({ isExecuting: false });
    }
  },

  cancelTabEdits: (tabIndex) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], pendingEdits: new Map() };
      }
      return { openTabs: tabs };
    });
  },

  setTabSqlContent: (tabIndex, sql) => {
    set((state) => {
      const tabs = [...state.openTabs];
      if (tabIndex >= 0 && tabIndex < tabs.length) {
        tabs[tabIndex] = { ...tabs[tabIndex], sqlEditorContent: sql };
      }
      return { openTabs: tabs };
    });
  },

  reloadTabData: async (tabIndex) => {
    const { currentConnectionId, currentDatabase, openTabs } = get();
    const tab = openTabs[tabIndex];
    if (!currentConnectionId || !currentDatabase || !tab) return;

    set({ isExecuting: true });
    try {
      const resp = await loadTableDataPaged(
        currentConnectionId,
        currentDatabase,
        tab.table,
        tab.page,
        tab.pageSize,
        tab.filters,
        tab.sortCol,
        tab.sortDir
      );
      const result: MysqlQueryResult = {
        columns: resp.columns,
        rows: resp.rows,
        affected_rows: null,
        execution_time_ms: resp.execution_time_ms,
      };
      set((state) => {
        const tabs = [...state.openTabs];
        if (tabIndex >= 0 && tabIndex < tabs.length) {
          tabs[tabIndex] = { ...tabs[tabIndex], queryResult: result, totalRows: resp.total_rows };
        }
        return { openTabs: tabs };
      });
    } finally {
      set({ isExecuting: false });
    }
  },
}));
