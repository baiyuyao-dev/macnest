import { useMysqlStore } from "@/stores/mysql";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TableStructureView() {
  const { openTabs, activeTabIndex } = useMysqlStore();
  const tab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;
  const tableStructure = tab?.tableStructure ?? null;
  const selectedTable = tab?.table ?? null;

  if (!selectedTable || !tableStructure) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        选择一个表查看结构
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4">
      <h3 className="text-sm font-semibold">表: {selectedTable}</h3>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">字段</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">名称</TableHead>
              <TableHead className="text-xs">类型</TableHead>
              <TableHead className="text-xs">可空</TableHead>
              <TableHead className="text-xs">键</TableHead>
              <TableHead className="text-xs">默认值</TableHead>
              <TableHead className="text-xs">额外</TableHead>
              <TableHead className="text-xs">注释</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableStructure.columns.map((col: { name: string; data_type: string; is_nullable: string; key: string; default_value: string | null; extra: string; comment: string }) => (
              <TableRow key={col.name} className="text-xs">
                <TableCell className="font-mono">{col.name}</TableCell>
                <TableCell>{col.data_type}</TableCell>
                <TableCell>{col.is_nullable}</TableCell>
                <TableCell>{col.key}</TableCell>
                <TableCell className="text-muted-foreground">
                  {col.default_value || "-"}
                </TableCell>
                <TableCell>{col.extra || "-"}</TableCell>
                <TableCell>{col.comment || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {tableStructure.indexes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">索引</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">名称</TableHead>
                <TableHead className="text-xs">字段</TableHead>
                <TableHead className="text-xs">类型</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableStructure.indexes.map((idx: { name: string; columns: string; non_unique: boolean }) => (
                <TableRow key={idx.name} className="text-xs">
                  <TableCell className="font-mono">{idx.name}</TableCell>
                  <TableCell>{idx.columns}</TableCell>
                  <TableCell>{idx.non_unique ? "普通" : "唯一"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
