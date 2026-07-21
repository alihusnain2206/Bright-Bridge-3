import React, { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  UserPlus, Search, ChevronUp, ChevronDown, ChevronsUpDown,
  ArrowLeft, Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
      style={{ background: s.bg, color: s.color }}>{s.label}</span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const color = value >= 90 ? "#10b981" : value >= 70 ? "#0ea5c9" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-500">{value}%</span>
    </div>
  );
}

interface Employee {
  id: string;
  firstName: string; lastName: string; email: string;
  position: string; department?: string | null;
  employmentType: string; status: string;
  startDate?: string | null;
  onboardingProgress?: number | null;
}

function isNewHire(emp: Employee): boolean {
  if (emp.status === "onboarding" || emp.status === "pending") return true;
  if (!emp.startDate) return false;
  return (Date.now() - new Date(emp.startDate).getTime()) < 30 * 86400000;
}

type SortKey = "name" | "position" | "department" | "status" | "startDate" | "onboarding";

function SortIcon({ col, sortCol, sortDir }: { col: SortKey; sortCol: SortKey; sortDir: "asc" | "desc" }) {
  if (col !== sortCol) return <ChevronsUpDown className="h-3 w-3 text-gray-300 ml-1 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 text-[#0EA5C9] ml-1 inline" />
    : <ChevronDown className="h-3 w-3 text-[#0EA5C9] ml-1 inline" />;
}

const PER_PAGE = 25;

export default function PeopleNewHiresPage() {
  const { user } = useAuth();
  const companyId = user?.role === "super_admin" ? "" : (user?.companyId ?? "");
  const addEmpHref = companyId ? `/clients/${companyId}/employees/new` : "/clients";

  const { data, isLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["people-new-hires", companyId],
    queryFn: () => {
      const url = companyId ? `/api/employees?companyId=${companyId}` : "/api/employees";
      return fetch(url, { credentials: "include" }).then(r => r.json() as Promise<{ employees: Employee[] }>);
    },
    staleTime: 60_000,
  });

  const [search, setSearch]           = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortCol, setSortCol]         = useState<SortKey>("startDate");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [page, setPage]               = useState(1);

  const allEmployees = data?.employees ?? [];
  const newHires     = useMemo(() => allEmployees.filter(isNewHire), [allEmployees]);

  const filtered = useMemo(() => {
    let list = newHires;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.position ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
      );
    }
    if (filterStatus) list = list.filter(e => e.status === filterStatus);

    return [...list].sort((a, b) => {
      let av: string | number = "", bv: string | number = "";
      if (sortCol === "name")       { av = `${a.firstName} ${a.lastName}`; bv = `${b.firstName} ${b.lastName}`; }
      else if (sortCol === "position")   { av = a.position ?? "";      bv = b.position ?? ""; }
      else if (sortCol === "department") { av = a.department ?? "";    bv = b.department ?? ""; }
      else if (sortCol === "status")     { av = a.status;              bv = b.status; }
      else if (sortCol === "startDate")  { av = a.startDate ?? "";     bv = b.startDate ?? ""; }
      else if (sortCol === "onboarding") { av = a.onboardingProgress ?? 0; bv = b.onboardingProgress ?? 0; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [newHires, search, filterStatus, sortCol, sortDir]);

  const totalPages    = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageEmployees = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSort(col: SortKey) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  }

  const anyFilter = !!(search || filterStatus);

  const COLS: { key: SortKey; label: string }[] = [
    { key: "name",       label: "Name" },
    { key: "position",   label: "Position" },
    { key: "department", label: "Department" },
    { key: "status",     label: "Status" },
    { key: "startDate",  label: "Start Date" },
    { key: "onboarding", label: "Onboarding" },
  ];

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/people">
            <button className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <ArrowLeft className="h-4 w-4 text-gray-500" />
            </button>
          </Link>
          <div className="p-2 rounded-lg" style={{ background: "#EFF6FF" }}>
            <UserPlus className="h-5 w-5" style={{ color: NAVY }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: NAVY }}>New Hires</h1>
            <p className="text-xs text-gray-500">
              {isLoading ? "Loading…" : `${newHires.length} new hire${newHires.length !== 1 ? "s" : ""} — joined in last 30 days or currently onboarding`}
            </p>
          </div>
        </div>
        <Link href={addEmpHref}>
          <Button size="sm" style={{ background: NAVY }} className="text-white hover:opacity-90 gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Add Employee
          </Button>
        </Link>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search name, email, position…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="h-9 rounded-md border border-gray-200 text-sm px-2.5 bg-white text-gray-700 min-w-[140px]"
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {anyFilter && (
            <button className="text-xs text-[#0EA5C9] hover:underline"
              onClick={() => { setSearch(""); setFilterStatus(""); setPage(1); }}>
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Showing <span className="font-medium text-gray-600">{filtered.length}</span> new hire{filtered.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100" style={{ background: "#F8FAFC" }}>
                {COLS.map(({ key, label }) => (
                  <th key={key}
                    className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:text-gray-800 transition-colors"
                    onClick={() => toggleSort(key)}>
                    {label}
                    <SortIcon col={key} sortCol={sortCol} sortDir={sortDir} />
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && pageEmployees.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                    {anyFilter ? "No new hires match your filters." : "No new hires in the last 30 days."}
                  </td>
                </tr>
              )}
              {!isLoading && pageEmployees.map(emp => {
                const fullName = `${emp.firstName} ${emp.lastName}`;
                const color = avatarColor(fullName);
                const startFmt = emp.startDate
                  ? new Date(emp.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";
                const daysAgo = emp.startDate
                  ? Math.floor((Date.now() - new Date(emp.startDate).getTime()) / 86400000)
                  : null;
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
                    <td className="px-4 py-3 text-gray-500 text-sm whitespace-nowrap">
                      <div>{startFmt}</div>
                      {daysAgo !== null && daysAgo >= 0 && (
                        <div className="text-[11px] text-gray-400">{daysAgo === 0 ? "Today" : `${daysAgo}d ago`}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar value={emp.onboardingProgress ?? 0} />
                    </td>
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">Page {page} of {totalPages} · {filtered.length} employees</span>
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
  );
}
