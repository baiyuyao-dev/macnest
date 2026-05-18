import { create } from "zustand";

export interface TerminalTab {
  id: string;
  name: string;
  connectionId: number;
  sessionId: string;
  websocketUrl: string;
}

interface TerminalStore {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: (tab: TerminalTab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  clearTabs: () => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.connectionId === tab.connectionId);
      if (existing) {
        return { activeTabId: existing.id };
      }
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),
  removeTab: (id) =>
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const newActive =
        state.activeTabId === id
          ? newTabs.length > 0
            ? newTabs[newTabs.length - 1].id
            : null
          : state.activeTabId;
      return { tabs: newTabs, activeTabId: newActive };
    }),
  setActiveTab: (id) => set({ activeTabId: id }),
  clearTabs: () => set({ tabs: [], activeTabId: null }),
}));
