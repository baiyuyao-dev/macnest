import { useEffect, useState } from "react";
import { Table2, FileCode, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConnectionPanel from "@/components/mysql/ConnectionPanel";
import ObjectTree from "@/components/mysql/ObjectTree";
import QueryEditor from "@/components/mysql/QueryEditor";
import ResultTable from "@/components/mysql/ResultTable";
import TableStructureView from "@/components/mysql/TableStructureView";
import BackupPanel from "@/components/mysql/BackupPanel";
import { useMysqlStore } from "@/stores/mysql";

type MainTab = "query" | "structure" | "backup";

export default function Mysql() {
  const { loadConnections, currentConnectionId, selectedTable } = useMysqlStore();
  const [activeTab, setActiveTab] = useState<MainTab>("query");

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      setActiveTab("structure");
    }
  }, [selectedTable]);

  return (
    <div className="flex h-full">
      <ConnectionPanel />
      <ObjectTree />
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center gap-1 p-2 border-b border-[var(--glass-border)]">
          <Button
            variant={activeTab === "query" ? "default" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("query")}
          >
            <FileCode className="h-3.5 w-3.5" />
            查询
          </Button>
          <Button
            variant={activeTab === "structure" ? "default" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("structure")}
          >
            <Table2 className="h-3.5 w-3.5" />
            结构
          </Button>
          <Button
            variant={activeTab === "backup" ? "default" : "ghost"}
            size="sm"
            className="gap-1"
            onClick={() => setActiveTab("backup")}
          >
            <Clock className="h-3.5 w-3.5" />
            备份
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === "query" && (
            <div className="flex flex-col h-full">
              <div className="h-[50%] border-b border-[var(--glass-border)]">
                <QueryEditor />
              </div>
              <div className="h-[50%]">
                <ResultTable />
              </div>
            </div>
          )}
          {activeTab === "structure" && <TableStructureView />}
          {activeTab === "backup" && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}
