import { useEffect } from "react";
import { Table2, FileCode, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import ObjectTree from "@/components/mysql/ObjectTree";
import QueryEditor from "@/components/mysql/QueryEditor";
import ResultTable from "@/components/mysql/ResultTable";
import TableStructureView from "@/components/mysql/TableStructureView";
import TabBar from "@/components/mysql/TabBar";
import { useMysqlStore } from "@/stores/mysql";

export default function DatabaseManager() {
  const {
    loadConnections,
    openTabs,
    activeTabIndex,
    openTab,
    closeTab,
    switchTab,
    setTabSubTab,
  } = useMysqlStore();

  useEffect(() => {
    loadConnections();
  }, []);

  const tab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;
  const selectedTable = tab?.table ?? null;
  const subTab = tab?.subTab ?? "data";
  const showQueryEditor = subTab === "sql";
  const queryResult = tab?.queryResult ?? null;

  const hasData = queryResult && queryResult.columns.length > 0;
  const hasStructure = selectedTable;

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <ObjectTree onOpenTable={openTab} />

      {/* Right Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Tab Bar */}
        <TabBar
          tabs={openTabs}
          activeIndex={activeTabIndex}
          onSwitch={switchTab}
          onClose={closeTab}
        />

        {tab ? (
          <>
            {/* Sub-tab Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
              {!showQueryEditor && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs gap-1"
                  onClick={() => {
                    if (activeTabIndex >= 0) setTabSubTab(activeTabIndex, "sql");
                  }}
                >
                  <Terminal className="h-3 w-3" />
                  SQL
                </Button>
              )}
              {selectedTable ? (
                <>
                  <span className="text-sm font-medium truncate">
                    {selectedTable}
                  </span>
                  <Button
                    size="sm"
                    variant={subTab === "data" ? "default" : "ghost"}
                    className="h-6 text-xs gap-1"
                    onClick={() => {
                      if (activeTabIndex >= 0) setTabSubTab(activeTabIndex, "data");
                    }}
                  >
                    <FileCode className="h-3 w-3" />
                    数据
                  </Button>
                  <Button
                    size="sm"
                    variant={subTab === "structure" ? "default" : "ghost"}
                    className="h-6 text-xs gap-1"
                    onClick={() => {
                      if (activeTabIndex >= 0) setTabSubTab(activeTabIndex, "structure");
                    }}
                  >
                    <Table2 className="h-3 w-3" />
                    结构
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {hasData ? "查询结果" : "执行查询或选择表以查看数据"}
                </span>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {showQueryEditor && (
                <div className="h-[45%] border-b border-[var(--glass-border)] flex flex-col">
                  <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--glass-border)]">
                    <span className="text-xs font-medium text-muted-foreground">SQL 编辑器</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={() => {
                        if (activeTabIndex >= 0) setTabSubTab(activeTabIndex, "data");
                      }}
                    >
                      <span className="text-xs">✕</span>
                    </Button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <QueryEditor />
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                {subTab === "structure" && hasStructure ? (
                  <TableStructureView />
                ) : (
                  <ResultTable />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            执行查询或选择表以查看数据
          </div>
        )}
      </div>
    </div>
  );
}
