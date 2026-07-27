import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { WorkforceShell, fmtWFDateLabel, type WFClientItem } from "@/components/WorkforceShell";
import { WorkforceTable, type WFColumn } from "@/components/WorkforceTable";
import { XCircle, CheckCircle2, Clock, AlertTriangle, DollarSign } from "lucide-react";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ShiftRow {
  easyteamShiftId: string;
  employeeId: string | null;
  payableDurationMs: number;
  utcStartTime: string;
  missedPunch: boolean;
  extendedBreak: boolean;
  longShift: boolean;
}
interface TSEntry {
  employeeId: string;
  hoursWorked: number;
  breakDeduction: number;
  approvedHours: number;
  managerApproved?: boolean;
}
interface ApiEmployee {
  id: string;
  companyId?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  position?: string;
  jobTitle?: string;
  department?: string | null;
  status?: string;
  payType?: string | null;
  hourlyWage?: number | null;     // cents
  annualSalary?: number | null;   // cents
  employeeId?: string | null;
  employeeDisplayId?: string | null;
}

interface EmployeeRow {
  dbId: string;
  canonicalId: string;   // ID used in shifts/entries
  name: string;
  jobTitle: string;
  department: string;
  hoursWorked: number;
  overtime: number;
  punchExceptions: number;
  punchBreakdown: { missed: number; extended: number; longShift: number };
  approvalStatus: "Approved" | "Manager-edited" | "Pending";
  laborCost: number | null;   // null = salaried
  isSalaried: boolean;
  annualSalary: number | null;
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
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Per-employee per-ISO-week overtime (>40h) */
function computeEmpOvertime(empShifts: ShiftRow[]): number {
  const weekMs = new Map<string, number>();
  for (const s of empShifts) {
    const d = new Date(s.utcStartTime);
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const wk = mon.toISOString().split("T")[0]!;
    weekMs.set(wk, (weekMs.get(wk) ?? 0) + s.payableDurationMs);
  }
  const limit = 40 * 3_600_000;
  let ot = 0;
  for (const [, ms] of weekMs) if (ms > limit) ot += ms - limit;
  return Math.round(ot / 3_600_000 * 10000) / 10000;
}

/** Build all ID variants for an employee so shift/entry matching works regardless of ID format */
function empIds(e: ApiEmployee): string[] {
  return [e.id, e.employeeId, e.employeeDisplayId].filter((x): x is string => !!x);
}

function buildRows(
  employees: ApiEmployee[],
  shifts: ShiftRow[],
  entries: TSEntry[],
): EmployeeRow[] {
  return employees.map(emp => {
    const ids = empIds(emp);

    const empShifts = shifts.filter(s => s.employeeId && ids.includes(s.employeeId));
    const entry     = entries.find(e => ids.includes(e.employeeId));

    const hoursWorked = entry
      ? entry.hoursWorked
      : Math.round(empShifts.reduce((s, r) => s + r.payableDurationMs, 0) / 3_600_000 * 10000) / 10000;

    const overtime = computeEmpOvertime(empShifts);

    const missed    = empShifts.filter(s => s.missedPunch).length;
    const extended  = empShifts.filter(s => s.extendedBreak).length;
    const longShift = empShifts.filter(s => s.longShift).length;

    let approvalStatus: EmployeeRow["approvalStatus"] = "Pending";
    if (entry?.managerApproved) {
      approvalStatus = Math.abs(entry.approvedHours - entry.hoursWorked) < 0.01
        ? "Approved"
        : "Manager-edited";
    }

    const isSalaried = emp.payType === "salary";
    const laborCost = isSalaried
      ? null
      : emp.hourlyWage != null
        ? Math.round((emp.hourlyWage / 100) * hoursWorked * 100) / 100
        : null;

    return {
      dbId:           emp.id,
      canonicalId:    ids[0] ?? emp.id,
      name:           emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(" ") || "(Unnamed)",
      jobTitle:       emp.jobTitle ?? emp.position ?? "—",
      department:     emp.department ?? "Unassigned",
      hoursWorked,
      overtime,
      punchExceptions: missed + extended + longShift,
      punchBreakdown: { missed, extended, longShift },
      approvalStatus,
      laborCost,
      isSalaried,
      annualSalary: emp.annualSalary ?? null,
    };
  });
}

// ── Column definitions ────────────────────────────────────────────────────────
function makeColumns(): WFColumn<EmployeeRow>[] {
  return [
    {
      key: "name",
      label: "Employee",
      sortable: true,
      sortValue: r => r.name,
      render: r => (
        <div>
          <div className="font-medium text-gray-900 text-sm">{r.name}</div>
          <div className="text-xs text-gray-400 mt-0.5">{r.jobTitle}</div>
        </div>
      ),
      csvValue: r => `${r.name} — ${r.jobTitle}`,
    },
    {
      key: "department",
      label: "Department",
      sortable: true,
      sortValue: r => r.department,
      render: r => <span className="text-sm">{r.department}</span>,
      csvValue: r => r.department,
    },
    {
      key: "hours",
      label: "Hours Worked",
      sortable: true,
      sortValue: r => r.hoursWorked,
      headerAlign: "right",
      cellAlign: "right",
      render: r => (
        <span className="font-mono text-sm text-gray-800">{fmtHours(r.hoursWorked)}</span>
      ),
      csvValue: r => String(r.hoursWorked),
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
      key: "exceptions",
      label: "Punch Exceptions",
      sortable: true,
      sortValue: r => r.punchExceptions,
      headerAlign: "right",
      cellAlign: "right",
      render: r => {
        if (r.punchExceptions === 0) return <span className="text-gray-300 text-sm">—</span>;
        const { missed, extended, longShift } = r.punchBreakdown;
        const parts = [
          missed    > 0 ? `${missed} missed punch${missed > 1 ? "es" : ""}` : "",
          extended  > 0 ? `${extended} extended break${extended > 1 ? "s" : ""}` : "",
          longShift > 0 ? `${longShift} long shift${longShift > 1 ? "s" : ""}` : "",
        ].filter(Boolean).join(" · ");
        return (
          <UITooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 font-mono text-sm font-medium cursor-default"
                style={{ color: "#EF4444" }}>
                <AlertTriangle className="h-3 w-3" />
                {r.punchExceptions}
              </span>
            </TooltipTrigger>
            <TooltipContent>{parts}</TooltipContent>
          </UITooltip>
        );
      },
      csvValue: r => String(r.punchExceptions),
    },
    {
      key: "approval",
      label: "Approval Status",
      sortable: true,
      sortValue: r => r.approvalStatus,
      render: r => {
        if (r.approvalStatus === "Approved") return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        );
        if (r.approvalStatus === "Manager-edited") return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
            <Clock className="h-3 w-3" /> Edited
          </span>
        );
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
            <Clock className="h-3 w-3" /> Pending
          </span>
        );
      },
      csvValue: r => r.approvalStatus,
    },
    {
      key: "cost",
      label: "Labor Cost",
      sortable: true,
      sortValue: r => r.laborCost ?? -1,
      headerAlign: "right",
      cellAlign: "right",
      render: r => {
        if (r.isSalaried) return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#1B3A6B] bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
            <DollarSign className="h-3 w-3" /> Salaried
          </span>
        );
        if (r.laborCost == null) return <span className="text-gray-300 text-sm">—</span>;
        return <span className="font-mono text-sm text-gray-800">{fmtCurrency(r.laborCost)}</span>;
      },
      csvValue: r => r.isSalaried ? "Salaried" : r.laborCost != null ? fmtCurrency(r.laborCost) : "—",
    },
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WorkforceEmployeesPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

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

  // Load clients list (super_admin)
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

  // Load pay period
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

  // Single fetch cycle keyed on (companyId, fromDate, toDate)
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
      const sj = await shiftsRes.json()    as { shifts?: ShiftRow[] };
      const ej = await entriesRes.json()   as { entries?: TSEntry[] };
      const empj = await employeesRes.json() as { employees?: ApiEmployee[] };
      const nj = await namesRes.json()     as { names?: Record<string, string> };
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

  // Apply name overrides from the names map
  const enrichedEmployees = useMemo((): ApiEmployee[] => {
    if (Object.keys(names).length === 0) return employees;
    return employees.map(emp => {
      const ids = empIds(emp);
      const resolvedName = ids.map(id => names[id]).find(Boolean);
      return resolvedName ? { ...emp, name: resolvedName } : emp;
    });
  }, [employees, names]);

  const rows = useMemo(
    () => buildRows(enrichedEmployees, shifts, entries),
    [enrichedEmployees, shifts, entries],
  );

  const columns = useMemo(() => makeColumns(), []);

  const totalHours   = useMemo(() => rows.reduce((s, r) => s + r.hoursWorked, 0), [rows]);
  const totalCost    = useMemo(() => rows.reduce((s, r) => s + (r.laborCost ?? 0), 0), [rows]);
  const totalOT      = useMemo(() => rows.reduce((s, r) => s + r.overtime, 0), [rows]);
  const pendingCount = useMemo(() => rows.filter(r => r.approvalStatus === "Pending").length, [rows]);

  // unused — fmtWFDateLabel used in WorkforceShell only
  void fmtWFDateLabel;

  return (
    <div className="min-h-screen bg-gray-50">
      <WorkforceShell
        activeTab="employees"
        companyId={companyId}
        setCompanyId={id => { setCompanyId(id); }}
        isSuperAdmin={isSuperAdmin}
        clients={clients}
        fromDate={fromDate}
        setFromDate={d => { setFromDate(d); }}
        toDate={toDate}
        setToDate={d => { setToDate(d); }}
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
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Employees", value: String(rows.length) },
              { label: "Total Hours", value: fmtHours(totalHours) },
              { label: "Overtime", value: totalOT > 0 ? fmtHours(totalOT) : "None" },
              { label: "Est. Labor Cost", value: fmtCurrency(totalCost) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Pending approval notice */}
        {!loading && pendingCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2.5">
            <Clock className="h-4 w-4 flex-shrink-0" />
            {pendingCount} employee{pendingCount > 1 ? "s" : ""} with pending timesheet approval
          </div>
        )}

        {/* Main table */}
        <WorkforceTable
          columns={columns}
          rows={rows}
          rowKey={r => r.dbId}
          loading={loading}
          onRowClick={r => navigate(`/people/${r.dbId}`)}
          searchable
          searchFilter={(r, q) =>
            r.name.toLowerCase().includes(q) ||
            r.jobTitle.toLowerCase().includes(q) ||
            r.department.toLowerCase().includes(q)
          }
          searchPlaceholder="Search by name, title, or department…"
          emptyMessage={!companyId ? "Select a company to view employees." : "No employees found for this period."}
          csvFilename={`employees-${fromDate}-to-${toDate}.csv`}
        />
      </div>
    </div>
  );
}

// re-export helper so departments page can import it
export { buildRows, makeColumns, empIds };
export type { ApiEmployee, ShiftRow, TSEntry, EmployeeRow };
