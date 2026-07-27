import React, { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Download, Search, ChevronRight, ChevronDown as ChevronDownIcon } from "lucide-react";

// ── Column definition ─────────────────────────────────────────────────────────
export interface WFColumn<T extends object> {
  key: string;
  label: string;
  /** If true, clicking the header sorts by this column. */
  sortable?: boolean;
  /** Numeric or string value used for sorting. Defaults to render text if omitted. */
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
  /** Text to write into CSV. Defaults to String(sortValue) if omitted. */
  csvValue?: (row: T) => string;
  headerAlign?: "left" | "right";
  cellAlign?: "left" | "right";
}

interface WFTableProps<T extends object> {
  columns: WFColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchFilter?: (row: T, query: string) => boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  skeletonRows?: number;
  csvFilename?: string;
  /** If provided, renders an expand chevron in column 0 and calls this when expanded. */
  renderExpanded?: (row: T) => React.ReactNode;
}

function downloadCsv(filename: string, header: string[], rowsData: string[][]): void {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    header.map(escape).join(","),
    ...rowsData.map(r => r.map(escape).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function WorkforceTable<T extends object>({
  columns, rows, rowKey, onRowClick,
  searchable, searchFilter, searchPlaceholder = "Search…",
  emptyMessage = "No data for this period.",
  loading, skeletonRows = 5,
  csvFilename,
  renderExpanded,
}: WFTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Filter
  const filtered = useMemo(() => {
    if (!query.trim() || !searchFilter) return rows;
    return rows.filter(r => searchFilter(r, query.toLowerCase()));
  }, [rows, query, searchFilter]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleExpand(k: string) {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function handleExport() {
    if (!csvFilename) return;
    const header = columns.map(c => c.label);
    const data = sorted.map(r =>
      columns.map(c => c.csvValue ? c.csvValue(r) : c.sortValue ? String(c.sortValue(r)) : "")
    );
    downloadCsv(csvFilename, header, data);
  }

  function SortIcon({ colKey }: { colKey: string }) {
    if (sortKey !== colKey) return <ChevronsUpDown className="h-3 w-3 opacity-30 inline ml-1" />;
    return sortDir === "asc"
      ? <ChevronUp   className="h-3 w-3 inline ml-1 text-[#0EA5C9]" />
      : <ChevronDown className="h-3 w-3 inline ml-1 text-[#0EA5C9]" />;
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm animate-pulse">
        <div className="h-10 bg-gray-50 border-b border-gray-100" />
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="h-12 border-b border-gray-50 flex items-center px-4 gap-4">
            <div className="h-3 rounded bg-gray-100 w-32" />
            <div className="h-3 rounded bg-gray-100 w-20" />
            <div className="h-3 rounded bg-gray-100 w-16 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      {/* Toolbar */}
      {(searchable || csvFilename) && (
        <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 h-8 rounded-md border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0EA5C9] bg-white"
              />
            </div>
          )}
          {csvFilename && (
            <button
              onClick={handleExport}
              className="ml-auto flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {renderExpanded && <th className="w-8 px-3 py-2.5" />}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap ${
                    col.headerAlign === "right" ? "text-right" : "text-left"
                  } ${col.sortable ? "cursor-pointer hover:text-gray-700 select-none" : ""}`}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && <SortIcon colKey={col.key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (renderExpanded ? 1 : 0)}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map(row => {
                const k = rowKey(row);
                const isExpanded = expandedKeys.has(k);
                return (
                  <React.Fragment key={k}>
                    <tr
                      className={`border-b border-gray-50 last:border-0 transition-colors ${
                        onRowClick ? "cursor-pointer hover:bg-gray-50" : ""
                      } ${isExpanded ? "bg-gray-50" : ""}`}
                      onClick={() => {
                        if (renderExpanded) toggleExpand(k);
                        onRowClick?.(row);
                      }}
                    >
                      {renderExpanded && (
                        <td className="px-3 py-3 w-8">
                          {isExpanded
                            ? <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
                            : <ChevronRight   className="h-3.5 w-3.5 text-gray-400" />}
                        </td>
                      )}
                      {columns.map(col => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 text-gray-700 ${
                            col.cellAlign === "right" ? "text-right" : "text-left"
                          }`}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                    {renderExpanded && isExpanded && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={columns.length + 1} className="px-4 pb-3 pt-0 bg-gray-50">
                          {renderExpanded(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-50 text-xs text-gray-400">
          {sorted.length} {sorted.length === 1 ? "row" : "rows"}
          {query && ` (filtered from ${rows.length})`}
        </div>
      )}
    </div>
  );
}
