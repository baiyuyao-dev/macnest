import { useEffect } from "react";
import { Table2, FileCode } from "lucide-react";
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
        {/* SQL Editor */}
        <div className="h-[45%] border-b border-[var(--glass-border)]">
          <QueryEditor />
        </div>

        {/* Result / Structure Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] min-h-[36px]">
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
