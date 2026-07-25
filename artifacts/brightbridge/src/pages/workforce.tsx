import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Clock, TrendingUp, DollarSign, CheckCircle2, AlertTriangle,
  Users, Calendar, Activity, RefreshCw, Loader2, Building2,
  Bell, Zap, Info, XCircle, ChevronRight, Timer, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Brand constants ──────────────────────────────────────────────────────────
const NAVY   = "#1B3A6B";
const DARK   = "#284362";
const TEAL   = "#0EA5C9";
const SUCCESS = "#10B981";
const WARN    = "#F59E0B";
const ERR     = "#EF4444";
const PANEL   = { background: DARK, borderColor: "rgba(255,255,255,0.1)" } as const;

// ── Types ────────────────────────────────────────────────────────────────────
interface ShiftRow {
  easyteamShiftId: string;
  employeeId: string | null;
  companyId: string;
  easyteamLocationId: string;
  utcStartTime: string;
  utcEndTime: string | null;
  durationMs: number;
  payableDurationMs: number;
  active: boolean;
  missedPunch: boolean;
  extendedBreak: boolean;
  longShift: boolean;
}
interface ShiftsSummary {
  totalShifts: number;
  totalPayableHours: number;
  activeNow: number;
  missedPunchCount: number;
  extendedBreakCount: number;
}
interface ShiftsData { summary: ShiftsSummary; shifts: ShiftRow[] }
interface TrendDay   { date?: string; day?: string; duration: number; amount: number }
interface TrendData  { totals: { duration: number; amount: number }; days: TrendDay[] }
interface TSEntry {
  employeeId: string; hoursWorked: number; breakDeduction: number;
  approvedHours: number; managerApproved?: boolean;
}
interface Employee {
  id?: string; employeeId?: string; employeeDisplayId?: string;
  name?: string; firstName?: string; lastName?: string;
  department?: string; position?: string; status?: string;
}
interface ClientItem { id: string; name?: string }

interface WorkforceData {
  shiftsData:  ShiftsData | null;
  trendData:   TrendData  | null;
  entries:     TSEntry[];
  employees:   Employee[];
  names:       Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtHours(h: number): string {
  if (h === 0) return "0h";
  const totalMin = Math.round(h * 60);
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`;
}
function fmtMs(ms: number): string { return fmtHours(ms / 3_600_000); }

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

function fmtDateLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to   + "T12:00:00");
  return `${f.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function computeOvertime(shifts: ShiftRow[]): number {
  const weeklyMs = new Map<string, number>();
  for (const s of shifts) {
    if (!s.employeeId) continue;
    const d = new Date(s.utcStartTime);
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const key = `${s.employeeId}_${mon.toISOString().split("T")[0]}`;
    weeklyMs.set(key, (weeklyMs.get(key) ?? 0) + s.payableDurationMs);
  }
  const limitMs = 40 * 3_600_000;
  let ot = 0;
  for (const [, ms] of weeklyMs) { if (ms > limitMs) ot += ms - limitMs; }
  return Math.round(ot / 3_600_000 * 100) / 100;
}

function empDisplayName(empId: string, names: Record<string, string>, employees: Employee[]): string {
  if (names[empId]) return names[empId];
  const e = employees.find(x => x.employeeId === empId || x.employeeDisplayId === empId || x.id === empId);
  if (!e) return empId;
  return (e.name ?? [e.firstName, e.lastName].filter(Boolean).join(" ")) || empId;
}

function deptHours(shifts: ShiftRow[], employees: Employee[]): { dept: string; hours: number; headcount: number }[] {
  const empToDept = new Map<string, string>();
  for (const e of employees) {
    const eid = e.employeeId ?? e.employeeDisplayId ?? e.id;
    if (eid && e.department) empToDept.set(eid, e.department);
  }
  const deptMs = new Map<string, number>();
  const deptEmp = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (!s.employeeId) continue;
    const dept = empToDept.get(s.employeeId) ?? "Unassigned";
    deptMs.set(dept, (deptMs.get(dept) ?? 0) + s.payableDurationMs);
    if (!deptEmp.has(dept)) deptEmp.set(dept, new Set());
    deptEmp.get(dept)!.add(s.employeeId);
  }
  return Array.from(deptMs.entries())
    .map(([dept, ms]) => ({ dept, hours: Math.round(ms / 3_600_000 * 100) / 100, headcount: deptEmp.get(dept)?.size ?? 0 }))
    .sort((a, b) => b.hours - a.hours);
}

interface AlertItem { level: "warn" | "error" | "info"; text: string; link: string }

function buildAlerts(
  shifts: ShiftRow[],
  entries: TSEntry[],
): AlertItem[] {
  const alerts: AlertItem[] = [];
  const missed = shifts.filter(s => s.missedPunch).length;
  if (missed > 0) alerts.push({ level: "warn",  text: `${missed} missed punch${missed === 1 ? "" : "es"} — employee clocked in but never out`, link: "/timesheets" });
  const ext    = shifts.filter(s => s.extendedBreak).length;
  if (ext > 0)    alerts.push({ level: "warn",  text: `${ext} extended break${ext === 1 ? "" : "s"} detected`, link: "/timesheets" });
  const pending = entries.filter(e => !e.managerApproved).length;
  if (pending > 0) alerts.push({ level: "info", text: `${pending} timesheet${pending === 1 ? "" : "s"} awaiting manager approval`, link: "/timesheets" });
  const unmapped = shifts.filter(s => !s.employeeId).length;
  if (unmapped > 0) alerts.push({ level: "error", text: `${unmapped} shift${unmapped === 1 ? "" : "s"} with unrecognised employee — sync registry may need updating`, link: "/timesheets" });
  return alerts;
}

// ── Sub-components ───────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/10 p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }}>
      <div className="h-3 w-24 rounded bg-white/10 mb-3" />
      <div className="h-7 w-16 rounded bg-white/15" />
    </div>
  );
}

function SoonPill({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-white/40 cursor-default select-none">
      {label}
      <span className="text-xs px-1.5 py-0.5 rounded-full border border-white/15 text-white/35" style={{ fontSize: "10px" }}>
        Soon
      </span>
    </span>
  );
}

interface KpiCardProps {
  icon: React.ReactNode; label: string; value: string;
  sub?: string; color?: string; link?: string;
  disabled?: boolean; tooltip?: string;
}
function KpiCard({ icon, label, value, sub, color = TEAL, link, disabled, tooltip }: KpiCardProps) {
  const inner = (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-2 transition-all ${disabled ? "opacity-50" : link ? "hover:border-white/25 cursor-pointer" : ""}`}
      style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50 font-medium uppercase tracking-wider">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold text-white/90">{value}</div>
      {sub && <div className="text-xs text-white/40">{sub}</div>}
      {disabled && <div className="text-xs px-2 py-0.5 rounded-full w-fit border border-white/15 text-white/40" style={{ fontSize: "10px" }}>Coming Soon</div>}
    </div>
  );
  if (tooltip) {
    return (
      <UITooltip>
        <TooltipTrigger asChild>{link ? <Link href={link}>{inner}</Link> : inner}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </UITooltip>
    );
  }
  if (link) return <Link href={link}>{inner}</Link>;
  return inner;
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function WorkforcePage() {
  const { user } = useAuth();

  // Company selection (super_admin can switch; owner is fixed)
  const [companyId, setCompanyId] = useState<string>(user?.companyId ?? "");
  const [clients, setClients] = useState<ClientItem[]>([]);
  const isSuperAdmin = user?.role === "super_admin";

  // Date range
  const week = getCurrentWeek();
  const [fromDate, setFromDate] = useState(week.from);
  const [toDate,   setToDate]   = useState(week.to);

  // Data
  const [data,    setData]    = useState<WorkforceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Load clients list for super_admin selector ──
  useEffect(() => {
    if (!isSuperAdmin) return;
    void (async () => {
      try {
        const r = await fetch("/api/clients", { credentials: "include" });
        const d = await r.json() as { clients?: ClientItem[] };
        const list = d.clients ?? [];
        setClients(list);
        if (!companyId && list.length > 0) setCompanyId(list[0].id);
      } catch { /* ignore */ }
    })();
  }, [isSuperAdmin]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load pay period once per company ──
  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      try {
        const r = await fetch(`/api/companies/${encodeURIComponent(companyId)}/pay-period`, { credentials: "include" });
        const d = await r.json() as { from?: string; to?: string };
        if (d.from && d.to) { setFromDate(d.from); setToDate(d.to); }
      } catch { /* keep current week */ }
    })();
  }, [companyId]);

  // ── Single data fetch — keyed on companyId + date range ──
  const fetchAll = useCallback(async () => {
    if (!companyId || !fromDate || !toDate) return;
    setLoading(true);
    setError(null);
    try {
      const cid = encodeURIComponent(companyId);
      const f   = encodeURIComponent(fromDate);
      const t   = encodeURIComponent(toDate);
      const [shiftsRes, trendRes, entriesRes, employeesRes, namesRes] = await Promise.all([
        fetch(`/api/timesheets/shifts?companyId=${cid}&from=${f}&to=${t}`,  { credentials: "include" }),
        fetch(`/api/timesheets/trend?companyId=${cid}&from=${f}&to=${t}`,   { credentials: "include" }),
        fetch(`/api/easyteam/hours?companyId=${cid}&from=${f}&to=${t}`,     { credentials: "include" }),
        fetch(`/api/employees?companyId=${cid}`,                            { credentials: "include" }),
        fetch(`/api/easyteam/company-members?companyId=${cid}`,             { credentials: "include" }),
      ]);

      const shiftsJson    = await shiftsRes.json()    as { summary?: ShiftsSummary; shifts?: ShiftRow[] };
      const trendJson     = await trendRes.json()     as { totals?: { duration: number; amount: number }; days?: TrendDay[] };
      const entriesJson   = await entriesRes.json()   as { entries?: TSEntry[] };
      const employeesJson = await employeesRes.json() as { employees?: Employee[] };
      const namesJson     = await namesRes.json()     as { names?: Record<string, string> };

      setData({
        shiftsData: (shiftsJson.summary && shiftsJson.shifts)
          ? { summary: shiftsJson.summary, shifts: shiftsJson.shifts }
          : null,
        trendData:  (trendJson.totals && trendJson.days)
          ? { totals: trendJson.totals, days: trendJson.days }
          : null,
        entries:    entriesJson.entries ?? [],
        employees:  employeesJson.employees ?? [],
        names:      namesJson.names ?? {},
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load workforce data");
    } finally {
      setLoading(false);
    }
  }, [companyId, fromDate, toDate]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // ── Computed values ──────────────────────────────────────────────────────
  const shifts    = data?.shiftsData?.shifts ?? [];
  const summary   = data?.shiftsData?.summary;
  const trend     = data?.trendData;
  const entries   = data?.entries ?? [];
  const employees = data?.employees ?? [];
  const names     = data?.names ?? {};

  const overtimeHours  = useMemo(() => computeOvertime(shifts), [shifts]);
  const deptBreakdown  = useMemo(() => deptHours(shifts, employees), [shifts, employees]);
  const alerts         = useMemo(() => buildAlerts(shifts, entries), [shifts, entries]);
  const pendingApproval = entries.filter(e => !e.managerApproved);

  const approvalDonut = useMemo(() => {
    const approved  = entries.filter(e =>  e.managerApproved && Math.abs(e.approvedHours - e.hoursWorked) < 0.01).length;
    const edited    = entries.filter(e =>  e.managerApproved && Math.abs(e.approvedHours - e.hoursWorked) >= 0.01).length;
    const pending   = entries.filter(e => !e.managerApproved).length;
    return [
      { name: "Approved",       value: approved, color: SUCCESS },
      { name: "Manager-edited", value: edited,   color: WARN    },
      { name: "Pending",        value: pending,  color: "#6B7280" },
    ].filter(d => d.value > 0);
  }, [entries]);

  const trendChartData = useMemo(() => {
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return (trend?.days ?? []).map(d => {
      const raw = (d.date ?? d.day ?? "").trim();
      // EasyTeam returns either "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS".
      // Take the first 10 chars to isolate the date portion, then match.
      // Never construct a Date object — timezone shifts corrupt bare date strings.
      const datePart = raw.slice(0, 10);
      const parts = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const label = parts
        ? `${MONTHS[parseInt(parts[2]!, 10) - 1] ?? "?"} ${parseInt(parts[3]!, 10)}`
        : raw;
      return {
        date:   label,
        hours:  Math.round(d.duration / 3_600_000 * 10) / 10,
        amount: Math.round(d.amount * 100) / 100,
      };
    });
  }, [trend]);

  const longShiftCount = shifts.filter(s => s.longShift).length;

  const hasData = !!summary;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg, #0e1f3a 0%, #112244 60%, #0a1525 100%)" }}>

      {/* ── Header ── */}
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Workforce Management &amp; Attendance</h1>
            <p className="text-sm text-white/50 mt-0.5">{fmtDateLabel(fromDate, toDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Company selector — super_admin only */}
            {isSuperAdmin && clients.length > 0 && (
              <Select value={companyId} onValueChange={v => setCompanyId(v)}>
                <SelectTrigger className="h-8 w-44 text-xs border-white/20 bg-white/5 text-white">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name ?? c.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* Date range */}
            <input
              type="date" value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="h-8 rounded border border-white/20 bg-white/5 px-2 text-xs text-white [color-scheme:dark]"
            />
            <span className="text-white/40 text-xs">–</span>
            <input
              type="date" value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="h-8 rounded border border-white/20 bg-white/5 px-2 text-xs text-white [color-scheme:dark]"
            />
            <Button
              size="sm" variant="ghost"
              onClick={() => void fetchAll()}
              disabled={loading}
              className="h-8 text-xs text-white/70 border border-white/20 hover:bg-white/10"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {/* Sub-nav */}
        <div className="flex items-center gap-5 mt-4 text-sm">
          <span className="text-[#0EA5C9] border-b-2 border-[#0EA5C9] pb-1 font-medium cursor-default">Overview</span>
          <SoonPill label="My Team" />
          <SoonPill label="All Employees" />
          <SoonPill label="Locations" />
          <SoonPill label="Departments" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{error}</p>
              <button onClick={() => void fetchAll()} className="text-xs text-red-400 underline mt-1">Retry</button>
            </div>
          </div>
        )}

        {/* ── KPI Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {loading && !hasData
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : (<>
                <KpiCard
                  icon={<Clock className="h-4 w-4" />}
                  label="Total Hours"
                  value={trend ? fmtMs(trend.totals.duration) : (summary ? fmtHours(summary.totalPayableHours) : "—")}
                  sub={summary ? `${summary.totalShifts} shifts` : undefined}
                  color={TEAL}
                />
                <UITooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <KpiCard
                        icon={<TrendingUp className="h-4 w-4" />}
                        label="Overtime Hours"
                        value={fmtHours(overtimeHours)}
                        sub="Over 40h/week rule"
                        color={overtimeHours > 0 ? WARN : SUCCESS}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Computed per employee per ISO week. Hours above 40h/week counted as overtime.</TooltipContent>
                </UITooltip>
                <KpiCard
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Est. Labor Cost"
                  value={trend ? fmtCurrency(trend.totals.amount) : "—"}
                  sub="From EasyTeam reports"
                  color="#818cf8"
                />
                <KpiCard
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Pending Approvals"
                  value={String(pendingApproval.length)}
                  sub={pendingApproval.length === 0 ? "All approved" : "Tap to review"}
                  color={pendingApproval.length > 0 ? WARN : SUCCESS}
                  link="/timesheets"
                />
                <KpiCard
                  icon={<Activity className="h-4 w-4" />}
                  label="Active Now"
                  value={summary ? String(summary.activeNow) : "—"}
                  sub="Clocked in"
                  color={summary?.activeNow ? SUCCESS : "rgba(255,255,255,0.4)"}
                />
                <UITooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <KpiCard
                        icon={<UserCheck className="h-4 w-4" />}
                        label="Attendance Rate"
                        value="—"
                        disabled
                        tooltip="Requires schedule data"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Requires schedule data — schedules endpoint returns empty in this environment</TooltipContent>
                </UITooltip>
              </>)
          }
        </div>

        {/* ── Row 2: Trend chart + Punch Status ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Weekly Hours Trend */}
          <div className="xl:col-span-2 rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Weekly Hours Trend</h2>
              <span className="text-xs text-white/40">{fmtDateLabel(fromDate, toDate)}</span>
            </div>
            {loading && !trend ? (
              <div className="h-48 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white/30" /></div>
            ) : trendChartData.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <TrendingUp className="h-8 w-8 text-white/15" />
                <p className="text-sm text-white/35">No shift data in this period</p>
                <p className="text-xs text-white/25">Pull hours from EasyTeam to populate this chart</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={TEAL} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={TEAL} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#1e3a5f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "rgba(255,255,255,0.8)" }}
                    formatter={(v: number, name: string) =>
                      name === "hours" ? [`${v}h`, "Hours"] : [`$${v.toFixed(2)}`, "Cost"]
                    }
                  />
                  <Area type="monotone" dataKey="hours" stroke={TEAL} strokeWidth={2} fill="url(#hoursGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Punch Status */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <h2 className="text-sm font-semibold text-white mb-4">Punch Status</h2>
            {loading && !summary ? (
              <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : !summary ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Timer className="h-8 w-8 text-white/15" />
                <p className="text-sm text-white/35">No data</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: "Missed Punch",    count: summary.missedPunchCount,   icon: <AlertTriangle className="h-4 w-4" />, color: ERR,     link: "/timesheets" },
                  { label: "Extended Break",  count: summary.extendedBreakCount, icon: <Timer        className="h-4 w-4" />, color: WARN,    link: "/timesheets" },
                  { label: "Long Shift",      count: longShiftCount,             icon: <Clock        className="h-4 w-4" />, color: "#818cf8", link: "/timesheets" },
                  { label: "Clocked In Now",  count: summary.activeNow,          icon: <Activity     className="h-4 w-4" />, color: SUCCESS, link: "/timesheets" },
                ].map(({ label, count, icon, color, link }) => (
                  <Link key={label} href={link}>
                    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5 cursor-pointer" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="flex items-center gap-2.5">
                        <span style={{ color }}>{icon}</span>
                        <span className="text-sm text-white/75">{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: count > 0 ? color : "rgba(255,255,255,0.3)" }}>{count}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-white/20" />
                      </div>
                    </div>
                  </Link>
                ))}
                <div className="pt-2 border-t border-white/8">
                  <div className="flex items-center justify-between px-1 text-xs text-white/35">
                    <span>Total shifts in period</span>
                    <span className="font-medium text-white/50">{summary.totalShifts}</span>
                  </div>
                  <div className="flex items-center justify-between px-1 text-xs text-white/35 mt-1">
                    <span>Total payable hours</span>
                    <span className="font-medium text-white/50">{fmtHours(summary.totalPayableHours)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Row 3: Timesheets Needing Approval + Approval Status donut ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Timesheets Needing Approval */}
          <div className="xl:col-span-2 rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Timesheets Needing Approval</h2>
              <Link href="/timesheets">
                <Button size="sm" variant="ghost" className="h-7 text-xs text-[#0EA5C9] hover:text-[#0EA5C9] hover:bg-white/5 gap-1">
                  Go to Timesheets <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            {loading && entries.length === 0 ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : pendingApproval.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/40" />
                <p className="text-sm text-white/50">
                  {entries.length === 0 ? "No timesheet data for this period" : "All timesheets approved"}
                </p>
                {entries.length === 0 && (
                  <p className="text-xs text-white/30">Pull hours first, then approve via the Timesheets page</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {pendingApproval.map(e => (
                  <div
                    key={e.employeeId}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: "rgba(14,165,201,0.2)", color: TEAL }}>
                        {empDisplayName(e.employeeId, names, employees).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm text-white/80">{empDisplayName(e.employeeId, names, employees)}</p>
                        <p className="text-xs text-white/40">{fmtHours(e.hoursWorked)} worked · {fmtHours(e.approvedHours)} approved</p>
                      </div>
                    </div>
                    <Link href="/timesheets">
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 border border-white/15 text-white/60 hover:text-white hover:bg-white/5">
                        Review
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Approval Status donut */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-semibold text-white">Approval Status</h2>
              <UITooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-white/30" /></TooltipTrigger>
                <TooltipContent>Based on manager approval records in BrightBridge — not EasyTeam submission states</TooltipContent>
              </UITooltip>
            </div>
            {loading && entries.length === 0 ? (
              <div className="h-40 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white/30" /></div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <CheckCircle2 className="h-8 w-8 text-white/15" />
                <p className="text-sm text-white/35">No approval data</p>
              </div>
            ) : approvalDonut.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <p className="text-sm text-white/35">No entries in period</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={approvalDonut} cx="50%" cy="50%" innerRadius={38} outerRadius={58}
                      dataKey="value" strokeWidth={0}
                    >
                      {approvalDonut.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1e3a5f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, name: string) => [`${v} employee${v !== 1 ? "s" : ""}`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-1">
                  {approvalDonut.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                        <span className="text-white/60">{d.name}</span>
                      </div>
                      <span className="font-medium text-white/70">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Row 4: Department Overview + Alerts ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Department Overview */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-4 w-4 text-white/40" />
              <h2 className="text-sm font-semibold text-white">Department Overview</h2>
            </div>
            {loading && deptBreakdown.length === 0 ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : deptBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <Building2 className="h-8 w-8 text-white/15" />
                <p className="text-sm text-white/35">No department data</p>
                <p className="text-xs text-white/25">Shifts must map to employees with assigned departments</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const maxH = Math.max(...deptBreakdown.map(d => d.hours), 0.001);
                  return deptBreakdown.map(d => (
                    <div key={d.dept}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-white/75 font-medium">{d.dept}</span>
                          <span className="text-white/35">{d.headcount} staff</span>
                        </div>
                        <span className="text-white/55 font-medium">{fmtHours(d.hours)}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${(d.hours / maxH) * 100}%`, background: TEAL }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          {/* Alerts & Notifications */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-4 w-4 text-white/40" />
              <h2 className="text-sm font-semibold text-white">Alerts &amp; Notifications</h2>
              {alerts.length > 0 && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(239,68,68,0.15)", color: ERR }}>
                  {alerts.length}
                </span>
              )}
            </div>
            {loading && alerts.length === 0 ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />)}</div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/30" />
                <p className="text-sm text-white/50">All clear — no alerts for this period</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <Link key={i} href={a.link}>
                    <div
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-white/5 transition-colors"
                      style={{ border: `1px solid ${a.level === "error" ? "rgba(239,68,68,0.2)" : a.level === "warn" ? "rgba(245,158,11,0.2)" : "rgba(14,165,201,0.15)"}` }}
                    >
                      <span className="mt-0.5 flex-shrink-0" style={{ color: a.level === "error" ? ERR : a.level === "warn" ? WARN : TEAL }}>
                        {a.level === "error" ? <XCircle className="h-4 w-4" /> : a.level === "warn" ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                      </span>
                      <p className="text-xs text-white/70 leading-relaxed">{a.text}</p>
                      <ChevronRight className="h-3.5 w-3.5 text-white/20 flex-shrink-0 mt-0.5 ml-auto" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 5: Quick Actions + Coming Soon cards ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Quick Actions */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h2 className="text-sm font-semibold text-white">Quick Actions</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Pull Hours",        sub: "Sync from EasyTeam",  link: "/timesheets",  icon: <RefreshCw  className="h-4 w-4" />, color: TEAL   },
                { label: "Approve Timesheets",sub: "Review & sign off",   link: "/timesheets",  icon: <CheckCircle2 className="h-4 w-4" />, color: SUCCESS },
                { label: "View Schedule",     sub: "EasyTeam schedule",   link: "/schedule",    icon: <Calendar   className="h-4 w-4" />, color: "#818cf8" },
                { label: "Manage People",     sub: "Employee directory",  link: "/people",      icon: <Users      className="h-4 w-4" />, color: WARN   },
              ].map(({ label, sub, link, icon, color }) => (
                <Link key={label} href={link}>
                  <div
                    className="rounded-lg px-3 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/8 transition-colors"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <span style={{ color }}>{icon}</span>
                    <div>
                      <p className="text-xs font-medium text-white/80">{label}</p>
                      <p className="text-xs text-white/35">{sub}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Coming Soon cards */}
          <div className="rounded-xl border p-5" style={PANEL}>
            <h2 className="text-sm font-semibold text-white mb-4">Additional Features</h2>
            <div className="space-y-2">
              {[
                { label: "Time Off Taken",      note: "Activates once time-off data is available from the EasyTeam schedule" },
                { label: "Time Off Calendar",   note: "Activates once time-off data is available from the EasyTeam schedule" },
                { label: "Schedule Coverage",   note: "Activates once schedule endpoint returns data — currently empty in sandbox" },
              ].map(({ label, note }) => (
                <div
                  key={label}
                  className="flex items-start justify-between rounded-lg px-3 py-3 opacity-50"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div>
                    <p className="text-sm text-white/60 font-medium">{label}</p>
                    <p className="text-xs text-white/35 mt-0.5">{note}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full border border-white/15 text-white/35 flex-shrink-0 ml-3" style={{ fontSize: "10px" }}>
                    Coming Soon
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
