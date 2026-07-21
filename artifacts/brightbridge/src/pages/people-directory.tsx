import React, { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, ChevronUp, ChevronDown, ChevronsUpDown, ArrowLeft, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout";
import { useAuth } from "@/hooks/useAuth";

const NAVY = "#1B3A6B";
const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];

function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  active:     { label: "Active",      bg: "#d1fae5", color: "#065f46" },
  onboarding: { label: "Onboarding",  bg: "#dbeafe", color: "#1e40af" },
  pending:    { label: "Pending",     bg: "#fef3c7", color: "#92400e" },
  on_leave:   { label: "On Leave",    bg: "#f3e8ff", color: "#6b21a8" },
  terminated: { label: "Terminated",  bg: "#fee2e2", color: "#991b1b" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { label: status, bg: "#f3f4f6", color: "#374151" };
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

interface Employee {
  id: string;
  firstName: string; lastName: string; email: string;
  position: string; department?: string | null;
  employmentType: string; status: string;
  startDate?: string | null;
  complianceScore?: number | null;
}

type SortKey = "name" | "position" | "department" | "status" | "startDate";

function SortIcon({ col, sortCol, sortDir }: { col: SortKey; sortCol: SortKey; sortDir: "asc" | "desc" }) {
  if (col !== sortCol) return <ChevronsUpDown className="h-3 w-3 text-gray-300 ml-1 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 text-[#0EA5C9] ml-1 inline" />
    : <ChevronDown className="h-3 w-3 text-[#0EA5C9] ml-1 inline" />;
}

const PER_PAGE = 25;

export default function PeopleDirectoryPage() {
  const { user } = useAuth();
  const companyId = user?.role === "super_admin" ? "" : (user?.companyId ?? "");

  const { data, isLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["people-directory", companyId],
    queryFn: () => {
      const url = companyId
        ? `/api/employees?companyId=${companyId}`
        : "/api/employees";
      return fetch(url, { credentials: "include" }).then(r => r.json() as Promise<{ employees: Employee[] }>);
    },
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortCol, setSortCol] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const employees = data?.employees ?? [];

  const addEmpHref = companyId ? `/clients/${companyId}/employees/new` : "/clients";

  const filtered = useMemo(() => {
    let list = employees;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.position.toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
      );
    }
    if (filterStatus) list = list.filter(e => e.status === filterStatus);
    return [...list].sort((a, b) => {
      let av = "", bv = "";
      if (sortCol === "name")       { av = `${a.firstName} ${a.lastName}`; bv = `${b.firstName} ${b.lastName}`; }
      else if (sortCol === "position")   { av = a.position;       bv = b.position; }
      else if (sortCol === "department") { av = a.department ?? ""; bv = b.department ?? ""; }
      else if (sortCol === "status")     { av = a.status;          bv = b.status; }
      else if (sortCol === "startDate")  { av = a.startDate ?? ""; bv = b.startDate ?? ""; }
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [employees, search, filterStatus, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageEmployees = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSort(col: SortKey) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  }

  const statuses = [...new Set(employees.map(e => e.status))];

  return (
    <AppLayout>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/people">
              <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeft className="h-4 w-4 text-gray-500" />
              </button>
            </Link>
            <div className="p-2 rounded-lg" style={{ background: "#EFF6FF" }}>
              <Users className="h-5 w-5" style={{ color: NAVY }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: NAVY }}>Employee Directory</h1>
              <p className="text-xs text-gray-500">
                {isLoading ? "Loading…" : `${employees.length} employee${employees.length !== 1 ? "s" : ""} total`}
              </p>
            </div>
          </div>
          <Link href={addEmpHref}>
            <Button size="sm" style={{ background: NAVY }} className="text-white hover:opacity-90 gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Add Employee
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder="Search by name, role, department…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="h-8 rounded-md border border-gray-200 text-sm px-2 bg-white text-gray-700 min-w-[130px]"
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            {statuses.map(s => (
              <option key={s} value={s}>{STATUS_STYLES[s]?.label ?? s}</option>
            ))}
          </select>
          {(search || filterStatus) && (
            <button
              className="text-xs text-[#0EA5C9] hover:underline"
              onClick={() => { setSearch(""); setFilterStatus(""); setPage(1); }}
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100" style={{ background: "#F8FAFC" }}>
                  {(["name","position","department","status","startDate"] as SortKey[]).map(col => (
                    <th
                      key={col}
                      className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:text-gray-800 transition-colors"
                      onClick={() => toggleSort(col)}
                    >
                      {col === "startDate" ? "Start Date" : col.charAt(0).toUpperCase() + col.slice(1)}
                      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
                    </th>
                  ))}
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                    Employment
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!isLoading && pageEmployees.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                      No employees match your filters.
                    </td>
                  </tr>
                )}
                {!isLoading && pageEmployees.map(emp => {
                  const fullName = `${emp.firstName} ${emp.lastName}`;
                  const color = avatarColor(fullName);
                  const startFmt = emp.startDate
                    ? new Date(emp.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "—";
                  const empTypeFmt = emp.employmentType === "full_time" ? "Full-time"
                    : emp.employmentType === "part_time" ? "Part-time"
                    : emp.employmentType ?? "—";
                  return (
                    <tr key={emp.id} className="hover:bg-gray-50/60 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                            style={{ background: color }}>
                            {initials(fullName)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{fullName}</p>
                            <p className="text-[11px] text-gray-400 truncate">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm">{emp.position || "—"}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{emp.department || "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={emp.status} /></td>
                      <td className="px-4 py-3 text-gray-500 text-sm whitespace-nowrap">{startFmt}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{empTypeFmt}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/people/${emp.id}`}>
                          <span className="text-xs text-[#0EA5C9] hover:underline opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            View →
                          </span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages} · {filtered.length} employees
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="h-7 px-2 text-xs">← Prev</Button>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                  className="h-7 px-2 text-xs">Next →</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
