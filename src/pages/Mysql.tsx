import { useEffect } from "react";
import { Table2, FileCode, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import ObjectTree from "@/components/mysql/ObjectTree";
import QueryEditor from "@/components/mysql/QueryEditor";
import ResultTable from "@/components/mysql/ResultTable";
import TableStructureView from "@/components/mysql/TableStructureView";
import { useMysqlStore } from "@/stores/mysql";

export default function Mysql() {
  const {
    loadConnections,
    selectedTable,
    viewMode,
    setViewMode,
    showQueryEditor,
    setShowQueryEditor,
    queryResult,
  } = useMysqlStore();

  useEffect(() => {
    loadConnections();
  }, []);

  const hasData = queryResult && queryResult.columns.length > 0;
  const hasStructure = selectedTable;

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <ObjectTree />

      {/* Right Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Query Editor — collapsible */}
        {showQueryEditor && (
          <div className="h-[45%] border-b border-[var(--glass-border)] flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--glass-border)]">
              <span className="text-xs font-medium text-muted-foreground">SQL 编辑器</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0"
                onClick={() => setShowQueryEditor(false)}
              >
                <span className="text-xs">✕</span>
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <QueryEditor />
            </div>
          </div>
        )}

        {/* Result / Structure Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
            {!showQueryEditor && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs gap-1"
                onClick={() => setShowQueryEditor(true)}
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
                  variant={viewMode === "data" ? "default" : "ghost"}
                  className="h-6 text-xs gap-1"
                  onClick={() => setViewMode("data")}
                >
                  <FileCode className="h-3 w-3" />
                  数据
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "structure" ? "default" : "ghost"}
                  className="h-6 text-xs gap-1"
                  onClick={() => setViewMode("structure")}
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
            {viewMode === "structure" && hasStructure ? (
              <TableStructureView />
            ) : (
              <ResultTable />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
