import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { WorkforceShell, type WFClientItem } from "@/components/WorkforceShell";
import { WorkforceTable, type WFColumn } from "@/components/WorkforceTable";
import { XCircle } from "lucide-react";
import { buildRows, makeColumns, empIds } from "./workforce-employees";
import type { ApiEmployee, ShiftRow, TSEntry, EmployeeRow } from "./workforce-employees";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DeptRow {
  name: string;
  headcount: number;
  totalHours: number;
  overtime: number;
  laborCost: number | null;      // null if ALL employees are salaried
  avgHours: number;
  employees: EmployeeRow[];
  hasSalaried: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtHours(h: number): string {
  if (h === 0) return "0h";
  const m = Math.round(h * 60);
  const hrs = Math.floor(m / 60);
  const min = m % 60;
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`;
}
function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}
function getCurrentWeek(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0]!;
  return { from: fmt(mon), to: fmt(sun) };
}

function groupByDepartment(empRows: EmployeeRow[]): DeptRow[] {
  const map = new Map<string, EmployeeRow[]>();
  for (const r of empRows) {
    const dept = r.department || "Unassigned";
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept)!.push(r);
  }
  // Always show Unassigned last
  const entries = Array.from(map.entries()).sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
  return entries.map(([name, emps]) => {
    const totalHours = Math.round(emps.reduce((s, e) => s + e.hoursWorked, 0) * 10000) / 10000;
    const overtime   = Math.round(emps.reduce((s, e) => s + e.overtime,    0) * 10000) / 10000;
    const hasSalaried = emps.some(e => e.isSalaried);
    const hourlyCost  = emps
      .filter(e => !e.isSalaried && e.laborCost != null)
      .reduce((s, e) => s + (e.laborCost ?? 0), 0);
    const allSalaried = emps.every(e => e.isSalaried);
    return {
      name,
      headcount:  emps.length,
      totalHours,
      overtime,
      laborCost: allSalaried ? null : Math.round(hourlyCost * 100) / 100,
      avgHours:  emps.length > 0 ? Math.round((totalHours / emps.length) * 100) / 100 : 0,
      employees:  emps,
      hasSalaried,
    };
  });
}

// ── Dept column definitions ───────────────────────────────────────────────────
function makeDeptColumns(): WFColumn<DeptRow>[] {
  return [
    {
      key: "name",
      label: "Department",
      sortable: true,
      sortValue: r => r.name,
      render: r => (
        <span className="font-semibold text-gray-900 text-sm">{r.name}</span>
      ),
      csvValue: r => r.name,
    },
    {
      key: "headcount",
      label: "Headcount",
      sortable: true,
      sortValue: r => r.headcount,
      headerAlign: "right",
      cellAlign: "right",
      render: r => <span className="font-mono text-sm text-gray-700">{r.headcount}</span>,
      csvValue: r => String(r.headcount),
    },
    {
      key: "hours",
      label: "Total Hours",
      sortable: true,
      sortValue: r => r.totalHours,
      headerAlign: "right",
      cellAlign: "right",
      render: r => <span className="font-mono text-sm text-gray-800">{fmtHours(r.totalHours)}</span>,
      csvValue: r => String(r.totalHours),
    },
    {
      key: "overtime",
      label: "Overtime",
      sortable: true,
      sortValue: r => r.overtime,
      headerAlign: "right",
      cellAlign: "right",
      render: r => r.overtime > 0
        ? <span className="font-mono text-sm font-medium" style={{ color: "#F59E0B" }}>{fmtHours(r.overtime)}</span>
        : <span className="text-gray-300 text-sm">—</span>,
      csvValue: r => String(r.overtime),
    },
    {
      key: "cost",
      label: "Labor Cost",
      sortable: true,
      sortValue: r => r.laborCost ?? -1,
      headerAlign: "right",
      cellAlign: "right",
      render: r => {
        if (r.laborCost == null) return (
          <span className="text-xs text-gray-400 italic">Salaried dept</span>
        );
        return (
          <span className="font-mono text-sm text-gray-800">
            {fmtCurrency(r.laborCost)}
            {r.hasSalaried && <span className="text-gray-400 text-xs ml-1">(+salaried)</span>}
          </span>
        );
      },
      csvValue: r => r.laborCost != null ? fmtCurrency(r.laborCost) : "Salaried",
    },
    {
      key: "avg",
      label: "Avg Hrs / Employee",
      sortable: true,
      sortValue: r => r.avgHours,
      headerAlign: "right",
      cellAlign: "right",
      render: r => <span className="font-mono text-sm text-gray-700">{fmtHours(r.avgHours)}</span>,
      csvValue: r => String(r.avgHours),
    },
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WorkforceDepartmentsPage() {
  const { user } = useAuth();

  const isSuperAdmin = user?.role === "super_admin";
  const [companyId, setCompanyId] = useState<string>(user?.companyId ?? "");
  const [clients,   setClients]   = useState<WFClientItem[]>([]);

  const week = getCurrentWeek();
  const [fromDate, setFromDate] = useState(week.from);
  const [toDate,   setToDate]   = useState(week.to);

  const [employees, setEmployees] = useState<ApiEmployee[]>([]);
  const [shifts,    setShifts]    = useState<ShiftRow[]>([]);
  const [entries,   setEntries]   = useState<TSEntry[]>([]);
  const [names,     setNames]     = useState<Record<string, string>>({});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [payPeriodSettled, setPayPeriodSettled] = useState(false);

  // Load clients (super_admin)
  useEffect(() => {
    if (!isSuperAdmin) return;
    void (async () => {
      try {
        const r = await fetch("/api/clients", { credentials: "include" });
        const d = await r.json() as { clients?: WFClientItem[] };
        const list = d.clients ?? [];
        setClients(list);
        if (!companyId && list.length > 0) setCompanyId(list[0].id);
      } catch { /* ignore */ }
    })();
  }, [isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pay period
  useEffect(() => {
    if (!companyId) return;
    setPayPeriodSettled(false);
    void (async () => {
      try {
        const r = await fetch(`/api/companies/${encodeURIComponent(companyId)}/pay-period`, { credentials: "include" });
        const d = await r.json() as { from?: string; to?: string };
        if (d.from && d.to) { setFromDate(d.from); setToDate(d.to); }
      } catch { /* keep default */ }
      finally { setPayPeriodSettled(true); }
    })();
  }, [companyId]);

  // Single fetch cycle
  const fetchAll = useCallback(async () => {
    if (!companyId || !fromDate || !toDate) return;
    setLoading(true); setError(null);
    try {
      const cid = encodeURIComponent(companyId);
      const f   = encodeURIComponent(fromDate);
      const t   = encodeURIComponent(toDate);
      const [shiftsRes, entriesRes, employeesRes, namesRes] = await Promise.all([
        fetch(`/api/timesheets/shifts?companyId=${cid}&from=${f}&to=${t}`, { credentials: "include" }),
        fetch(`/api/easyteam/hours?companyId=${cid}&from=${f}&to=${t}`,    { credentials: "include" }),
        fetch(`/api/employees?companyId=${cid}`,                           { credentials: "include" }),
        fetch(`/api/easyteam/company-members?companyId=${cid}`,            { credentials: "include" }),
      ]);
      const sj   = await shiftsRes.json()    as { shifts?: ShiftRow[] };
      const ej   = await entriesRes.json()   as { entries?: TSEntry[] };
      const empj = await employeesRes.json() as { employees?: ApiEmployee[] };
      const nj   = await namesRes.json()     as { names?: Record<string, string> };
      setShifts(sj.shifts ?? []);
      setEntries(ej.entries ?? []);
      setEmployees(empj.employees ?? []);
      setNames(nj.names ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workforce data");
    } finally {
      setLoading(false);
    }
  }, [companyId, fromDate, toDate]);

  useEffect(() => { if (payPeriodSettled) void fetchAll(); }, [fetchAll, payPeriodSettled]);

  // Apply name overrides
  const enrichedEmployees = useMemo((): ApiEmployee[] => {
    if (Object.keys(names).length === 0) return employees;
    return employees.map(emp => {
      const ids = empIds(emp);
      const resolvedName = ids.map(id => names[id]).find(Boolean);
      return resolvedName ? { ...emp, name: resolvedName } : emp;
    });
  }, [employees, names]);

  const empRows  = useMemo(() => buildRows(enrichedEmployees, shifts, entries), [enrichedEmployees, shifts, entries]);
  const deptRows = useMemo(() => groupByDepartment(empRows), [empRows]);

  const deptColumns  = useMemo(() => makeDeptColumns(), []);
  const empColumns   = useMemo(() => makeColumns(), []);

  const totalDepts = deptRows.length;
  const totalEmps  = empRows.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <WorkforceShell
        activeTab="departments"
        companyId={companyId}
        setCompanyId={setCompanyId}
        isSuperAdmin={isSuperAdmin}
        clients={clients}
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
        loading={loading}
        onRefresh={() => void fetchAll()}
      />

      <div className="px-6 py-6 space-y-5">
        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={() => void fetchAll()} className="text-xs text-red-500 underline mt-1">Retry</button>
            </div>
          </div>
        )}

        {/* Summary strip */}
        {!loading && totalDepts > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Departments", value: String(totalDepts) },
              { label: "Total Employees", value: String(totalEmps) },
              {
                label: "Est. Labor Cost",
                value: fmtCurrency(deptRows.reduce((s, d) => s + (d.laborCost ?? 0), 0)),
              },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Departments table with expandable employee rows */}
        <WorkforceTable
          columns={deptColumns}
          rows={deptRows}
          rowKey={r => r.name}
          loading={loading}
          searchable
          searchFilter={(r, q) => r.name.toLowerCase().includes(q)}
          searchPlaceholder="Search department…"
          emptyMessage={
            !companyId
              ? "Select a company to view departments."
              : "No departments or employees configured for this period."
          }
          csvFilename={`departments-${fromDate}-to-${toDate}.csv`}
          renderExpanded={dept => (
            <div className="mt-2 mb-1 rounded-lg border border-gray-200 overflow-hidden">
              <WorkforceTable
                columns={empColumns}
                rows={dept.employees}
                rowKey={r => r.dbId}
                emptyMessage="No employees in this department."
                csvFilename={undefined}
              />
            </div>
          )}
        />

        {/* No-departments empty state */}
        {!loading && !error && totalDepts === 0 && companyId && (
          <div className="rounded-xl border border-gray-100 bg-white p-12 flex flex-col items-center gap-3 text-center shadow-sm">
            <div className="text-3xl">🏢</div>
            <p className="text-gray-600 font-medium">No departments configured</p>
            <p className="text-sm text-gray-400 max-w-xs">
              Assign employees to departments in the People module to see breakdowns here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
