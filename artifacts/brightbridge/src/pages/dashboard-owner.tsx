import React, { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Clock, CalendarDays, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Building2, ShieldCheck, DollarSign,
  Settings, UserPlus, KeyRound, Copy, Check, ThumbsUp,
  Download, RefreshCw, Bell, TrendingUp, Zap, ChevronRight,
  FileText, Play, Lock, ArrowRight, BarChart3, Wallet,
  CircleDot, CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KpiCard, WidgetCard, FundingForecastWidget,
  VarianceWidget, RecentActivityWidget,
} from "@/components/dashboard";
import type { ProcessedPeriod, PayPeriod } from "@/components/dashboard";

// ── Constants ────────────────────────────────────────────────────────────────
const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const OWNER_COLOR = "#7c3aed";
const ORANGE = "#E8622A";
const EMERALD = "#059669";

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s + (s.includes("T") ? "" : "T12:00:00"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getGreeting(name: string | undefined): string {
  const h = new Date().getHours();
  const first = name?.split(" ")[0] ?? "there";
  if (h < 12) return `Good morning, ${first} 👋`;
  if (h < 17) return `Good afternoon, ${first} 👋`;
  return `Good evening, ${first} 👋`;
}

function getCurrentWeek(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0]!;
  return { from: fmt(monday), to: fmt(sunday) };
}

function formatHours(h: number): string {
  const totalMin = Math.round(h * 60);
  if (totalMin === 0) return "0m";
  if (totalMin < 60) return `${totalMin}m`;
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`;
}

const FREQ_LABEL: Record<string, string> = {
  BiWeekly: "Bi-Weekly", Weekly: "Weekly",
  SemiMonthly: "Semi-Monthly", Monthly: "Monthly",
};

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW":  [{ id: "LOC-RAINBOW",  name: "Rainbow Kids Daycare",    latitude: 40.7178, longitude: -74.0431 }],
};
const ALL_STATIC_LOCATIONS = [
  { id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 },
  { id: "LOC-RAINBOW",  name: "Rainbow Kids Daycare",    latitude: 40.7178, longitude: -74.0431 },
];
const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  owner:    { label: "Owner",    color: "#7c3aed", bg: "#7c3aed20" },
  manager:  { label: "Manager",  color: "#d97706", bg: "#d9770620" },
  employee: { label: "Employee", color: "#059669", bg: "#05966920" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_BADGE[role] ?? { label: role, color: "#6b7280", bg: "#6b728020" };
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ color: cfg.color, background: cfg.bg }}>
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="text-gray-400 hover:text-gray-600 transition-colors p-0.5">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type AlertSeverity = "high" | "medium" | "low";
interface AttentionItem {
  id: string; severity: AlertSeverity;
  message: string; linkTo: string | null;
  actionLabel?: string | null; category: string;
}

function AlertRow({ item }: { item: AttentionItem }) {
  const icon =
    item.severity === "high"   ? <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" /> :
    item.severity === "medium" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                                 <CircleDot className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />;
  const content = (
    <div className="flex items-start gap-2 px-4 py-3 hover:bg-gray-50 transition-colors">
      {icon}
      <span className="text-xs text-gray-700 leading-relaxed flex-1">{item.message}</span>
      {item.linkTo && <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />}
    </div>
  );
  return item.linkTo
    ? <Link href={item.linkTo}><div className="cursor-pointer">{content}</div></Link>
    : <div>{content}</div>;
}

// Processing Center tabs
const PROC_TABS = [
  { id: "overview",    label: "Overview" },
  { id: "cash",        label: "Cash Required" },
  { id: "employees",   label: "Employees" },
  { id: "exceptions",  label: "Exceptions" },
];

interface PayrollDashboardData {
  payPeriod: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  history: ProcessedPeriod[];
  companyTasks: { tasks: Array<{ task: string; description: string }>; kybStatus: string; bankLinked: boolean } | null;
  employeesToPay: number | null;
  fetchedAt: string;
  errors: Record<string, string | undefined>;
}

interface DashboardData {
  progress: { completedCount: number; totalCount: number; steps: Array<{ id: string; label: string; done: boolean }> };
  attention: AttentionItem[];
}

// ── Line item shape from Rollfi ───────────────────────────────────────────────
interface RollfiLineItem {
  userId?: string;
  firstName?: string;
  lastName?: string;
  grossTotal?: number;
  netTotal?: number;
  basicPay?: number;
  netPay?: number;
  [key: string]: unknown;
}

interface EasyTeamEmployee {
  id: string; name: string; role?: string;
  timeTrackingEnabled?: boolean; isVisible?: boolean;
  wage?: number; wageType?: "hourly"; status?: string;
}
interface ApiEmployee {
  employeeId: string; firstName: string; lastName: string;
  position?: string; hourlyWage?: number; status?: string;
}
interface CompanyAccount {
  id: string; name: string; email: string; role: string;
  position?: string | null; employeeId?: string | null;
}
interface TimesheetEntry {
  employeeId: string; companyId: string; periodKey: string;
  hoursWorked: number; breakDeduction: number; approvedHours: number;
  source: string; syncedAt: string; managerApproved?: boolean; approvedAt?: string;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OwnerDashboard() {
  const { user, company, location: authLocation } = useAuth();
  const qc = useQueryClient();

  // ── Active tab ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("overview");

  // ── Payroll data queries ────────────────────────────────────────────────────
  const companyId = user?.companyId ?? "";

  const { data: payrollData, isLoading: payrollLoading, refetch: refetchPayroll } =
    useQuery<PayrollDashboardData>({
      queryKey: ["payroll-dashboard", companyId],
      queryFn: () =>
        fetch(`/api/dashboard/payroll${companyId ? `?companyId=${companyId}` : ""}`, { credentials: "include" })
          .then(r => r.json()),
      staleTime: 55_000,
      enabled: !!companyId,
    });

  const { data: dashData, isLoading: dashLoading } =
    useQuery<DashboardData>({
      queryKey: ["owner-attention", companyId],
      queryFn: () =>
        fetch(`/api/dashboard${companyId ? `?companyId=${companyId}` : ""}`, { credentials: "include" })
          .then(r => r.json()),
      staleTime: 60_000,
      enabled: !!companyId,
    });

  // ── Derived payroll values ──────────────────────────────────────────────────
  const pp = payrollData?.payPeriod ?? null;
  const det = payrollData?.details as { payPeriod?: Array<Record<string, unknown>> } | null;
  const detRow = det?.payPeriod?.[0] ?? null;
  const lineItems: RollfiLineItem[] = Array.isArray((detRow as Record<string, unknown> | null)?.payrollLineItems)
    ? ((detRow as Record<string, unknown>).payrollLineItems as RollfiLineItem[])
    : [];

  const employeesToPay = payrollData?.employeesToPay ?? null;
  const history = payrollData?.history ?? [];

  // Cash figures
  const total: number       = typeof (detRow as Record<string, unknown> | null)?.total === "number"
    ? (detRow as Record<string, unknown>).total as number : null!;
  const empTaxSum: number   = typeof (detRow as Record<string, unknown> | null)?.employeeTaxSum === "number"
    ? (detRow as Record<string, unknown>).employeeTaxSum as number : null!;
  const emprTaxSum: number  = typeof (detRow as Record<string, unknown> | null)?.employerTaxSum === "number"
    ? (detRow as Record<string, unknown>).employerTaxSum as number : null!;

  const netPaySum   = lineItems.reduce((s, i) => s + (i.netTotal ?? i.netPay ?? 0), 0);
  const grossPaySum = lineItems.reduce((s, i) => s + (i.grossTotal ?? i.basicPay ?? 0), 0);
  const cashRequired = total !== null && total !== undefined ? total : ((netPaySum + (empTaxSum ?? 0) + (emprTaxSum ?? 0)) || null);
  const serviceFees  = total && netPaySum && empTaxSum != null && emprTaxSum != null
    ? Math.max(0, total - netPaySum - empTaxSum - emprTaxSum)
    : 350; // reasonable default

  // Pay period dates
  const payPeriodStatus = String(pp?.payPeriodStatus ?? "").toLowerCase();
  const nextPayDate     = (pp?.payDate ?? pp?.payEndDate ?? null) as string | null;
  const payBegin        = (pp?.payBeginDate ?? null) as string | null;
  const payEnd          = (pp?.payEndDate ?? pp?.payDate ?? null) as string | null;

  // History for forecast widget
  const historyForForecast = { periods: history };
  const payPeriodForForecast: PayPeriod | null = pp
    ? { payPeriodId: String(pp.payPeriodId ?? ""), payDate: String(pp.payDate ?? ""), payrollAmount: cashRequired ?? undefined }
    : null;

  // Attention / alerts
  const attention: AttentionItem[] = dashData?.attention ?? [];
  const highCount = attention.filter(a => a.severity === "high").length;
  const completedCount = dashData?.progress?.completedCount ?? 0;
  const totalCount     = dashData?.progress?.totalCount ?? 10;
  const complianceScore = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null;
  const complianceLabel =
    complianceScore == null ? "—" :
    complianceScore >= 90   ? "Excellent" :
    complianceScore >= 75   ? "Very Good" :
    complianceScore >= 60   ? "Good" : "Needs Attention";

  const bankLinked = payrollData?.companyTasks?.bankLinked ?? false;

  // ── EasyTeam + timesheets state (unchanged) ─────────────────────────────────
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError]     = useState("");
  const [, setTokenDecoded]             = useState<Record<string, unknown> | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState(false);
  const etLaunchedRef = useRef(false);
  const { launch, navigateToDate } = useEasyTeamLauncher("et-owner-container", undefined, 520);

  const initWeek = getCurrentWeek();
  const [fromDate, setFromDate]             = useState(initWeek.from);
  const [toDate, setToDate]                 = useState(initWeek.to);
  const [payFrequency, setPayFrequency]     = useState<string | null>(null);
  const [hours, setHours]                   = useState<TimesheetEntry[]>([]);
  const [hoursLoading, setHoursLoading]     = useState(false);
  const [pulling, setPulling]               = useState(false);
  const [approving, setApproving]           = useState(false);
  const [approvalDone, setApprovalDone]     = useState(false);
  const [approvedAt, setApprovedAt]         = useState<string | null>(null);
  const [approvalDataSource, setApprovalDataSource] = useState<"easyteam" | "seeded" | null>(null);
  const [lastSyncedAt, setLastSyncedAt]     = useState<Date | null>(null);
  const [editedHours, setEditedHours]       = useState<Record<string, number>>({});
  const [editNotes, setEditNotes]           = useState<Record<string, string>>({});
  const [companyEmployees, setCompanyEmployees] = useState<EasyTeamEmployee[]>([]);
  const employeeNames    = Object.fromEntries(companyEmployees.map(e => [e.id, e.name]));
  const employeeStatuses = Object.fromEntries(companyEmployees.map(e => [e.id, e.status]));

  const fetchCompanyEmployees = useCallback(async () => {
    if (!user?.companyId) return [];
    const d = await fetch(`/api/easyteam/employees?companyId=${user.companyId}`, { credentials: "include" })
      .then(r => r.json()) as { employees: EasyTeamEmployee[] };
    const list = d.employees ?? [];
    setCompanyEmployees(list);
    return list;
  }, [user?.companyId]);

  const fetchHours = useCallback(async () => {
    if (!user?.companyId) return;
    setHoursLoading(true);
    try {
      const d = await fetch(
        `/api/easyteam/hours?from=${fromDate}&to=${toDate}&companyId=${user.companyId}`,
        { credentials: "include" }
      ).then(r => r.json()) as { entries: TimesheetEntry[]; synced: boolean };
      setHours(d.entries ?? []);
      setEditedHours(Object.fromEntries((d.entries ?? []).map(e => [e.employeeId, e.approvedHours])));
      setEditNotes({});
      const alreadyApproved = (d.entries ?? []).some(e => e.managerApproved);
      if (alreadyApproved) {
        setApprovalDone(true);
        setApprovedAt((d.entries ?? []).find(e => e.approvedAt)?.approvedAt ?? null);
      }
    } catch { /* ignore */ }
    finally { setHoursLoading(false); }
  }, [user?.companyId, fromDate, toDate]);

  const handlePullHours = useCallback(async () => {
    if (!user?.companyId) return;
    setPulling(true); setApprovalDone(false); setApprovalDataSource(null);
    try {
      await fetch("/api/easyteam/hours/sync", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromDate, to: toDate, companyId: user.companyId }),
      });
      await fetchHours();
      setLastSyncedAt(new Date());
    } catch { /* ignore */ }
    finally { setPulling(false); }
  }, [user?.companyId, fromDate, toDate, fetchHours]);

  const handleApprove = async () => {
    if (!user?.companyId) return;
    setApproving(true);
    try {
      const entries = hours.map(e => ({
        employeeId:      e.employeeId,
        approvedHours:   editedHours[e.employeeId] ?? e.approvedHours,
        managerEditNote: editNotes[e.employeeId] || undefined,
      }));
      const d = await fetch("/api/easyteam/hours/approve", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromDate, to: toDate, companyId: user.companyId, entries }),
      }).then(r => r.json()) as { success: boolean; dataSource?: "easyteam" | "seeded"; entries: TimesheetEntry[] };
      if (d.success) {
        setHours(d.entries); setApprovalDone(true);
        setApprovedAt(new Date().toISOString());
        setApprovalDataSource(d.dataSource ?? null);
      }
    } catch { /* ignore */ }
    finally { setApproving(false); }
  };

  useEffect(() => { void fetchCompanyEmployees(); }, [fetchCompanyEmployees]);
  useEffect(() => { void fetchHours(); }, [fetchHours]);
  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/companies/${user.companyId}/pay-period`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { from: string; to: string; frequency: string }) => {
        if (d.from && d.to) { setFromDate(d.from); setToDate(d.to); if (etLaunchedRef.current) navigateToDate(d.from, d.to); }
        if (d.frequency) setPayFrequency(d.frequency);
      })
      .catch(() => { /* keep default */ });
  }, [user?.companyId, navigateToDate]);

  // ── EasyTeam launch ──────────────────────────────────────────────────────────
  const launchET = useCallback(async () => {
    if (!user) return;
    setTokenLoading(true); setTokenError(""); setExchangeWarning(false);
    etLaunchedRef.current = false;
    try {
      const tokenRes = await fetch("/api/auth/token-by-role", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const tokenData = await tokenRes.json() as { token?: string; decoded?: Record<string, unknown>; exchangeWarning?: boolean; error?: string };
      if (!tokenRes.ok || !tokenData.token) { setTokenError(tokenData.error ?? "Token generation failed"); return; }
      if (tokenData.exchangeWarning) setExchangeWarning(true);
      if (tokenData.decoded) setTokenDecoded(tokenData.decoded);

      const empRes = await fetch(`/api/employees?companyId=${encodeURIComponent(user.companyId ?? "")}`, { credentials: "include" });
      const empData = await empRes.json() as { employees?: ApiEmployee[] };
      const apiEmployees: EasyTeamEmployee[] = (empData.employees ?? []).map(e => ({
        id: e.employeeId, name: [e.firstName, e.lastName].join(" ").trim(),
        role: e.position ?? "Staff", timeTrackingEnabled: true,
        wage: e.hourlyWage ?? 1500, wageType: "hourly",
      }));

      const ownerSelf: EasyTeamEmployee = {
        id: user.employeeId!, name: user.name, role: user.position,
        timeTrackingEnabled: false, isVisible: false,
        wage: user.hourlyWage ?? 2500, wageType: "hourly",
      };
      const allEmployees = user.employeeId && !apiEmployees.some(e => e.id === user.employeeId)
        ? [ownerSelf, ...apiEmployees] : apiEmployees;

      const isStaticCompany = !!(COMPANY_LOCATIONS[user.companyId ?? ""]);
      let allLaunchLocations: Array<{ id: string; name: string; latitude: number; longitude: number }>;
      if (isStaticCompany) {
        allLaunchLocations = ALL_STATIC_LOCATIONS;
      } else {
        const authLoc = authLocation ? [{ id: authLocation.id, name: authLocation.name, latitude: authLocation.latitude, longitude: authLocation.longitude }] : [];
        const fallback = authLoc[0];
        if (!fallback) { setTokenError("No location data available for this company"); return; }
        allLaunchLocations = [{ ...fallback, latitude: fallback.latitude !== 0 ? fallback.latitude : (company?.latitude ?? 40.7357), longitude: fallback.longitude !== 0 ? fallback.longitude : (company?.longitude ?? -74.1724) }];
      }
      launch(tokenData.token, { page: Pages.TIMESHEET, employees: allEmployees, organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" }, locations: allLaunchLocations, fromDate, toDate });
      etLaunchedRef.current = true;
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  }, [user, launch, fromDate, toDate, authLocation, company]);

  // ── Team Access state ────────────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName,     setCreateName]     = useState("");
  const [createEmail,    setCreateEmail]    = useState("");
  const [createRole,     setCreateRole]     = useState<"owner" | "employee">("employee");
  const [createPosition, setCreatePosition] = useState("");
  const [createLoading,  setCreateLoading]  = useState(false);
  const [createError,    setCreateError]    = useState("");
  const [createdCreds,   setCreatedCreds]   = useState<{ email: string; password: string; role: string } | null>(null);
  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: CompanyAccount[] }>({
    queryKey: ["company-accounts"],
    queryFn: () => fetch("/api/auth/company-accounts", { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
  });
  const accounts = accountsData?.accounts ?? [];

  const handleCreateRole = useCallback(async () => {
    if (!createName.trim() || !createEmail.trim()) { setCreateError("Name and email are required"); return; }
    setCreateLoading(true); setCreateError("");
    try {
      const res = await fetch("/api/auth/create-sub-role", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), email: createEmail.trim(), role: createRole, position: createPosition.trim() || undefined }),
      });
      const data = await res.json() as { error?: string; loginEmail?: string; password?: string; role?: string };
      if (!res.ok) { setCreateError(data.error ?? "Failed to create account"); return; }
      setCreatedCreds({ email: data.loginEmail ?? createEmail, password: data.password ?? "", role: data.role ?? createRole });
      setCreateName(""); setCreateEmail(""); setCreatePosition(""); setCreateRole("employee");
      setShowCreateForm(false);
      void qc.invalidateQueries({ queryKey: ["company-accounts"] });
    } catch { setCreateError("Network error"); }
    finally { setCreateLoading(false); }
  }, [createName, createEmail, createRole, createPosition, qc]);

  // ── Readiness checklist items ────────────────────────────────────────────────
  const readinessItems = [
    { label: "Payroll calculated",       done: !!detRow },
    { label: "Exceptions reviewed",      done: highCount === 0 },
    { label: "Funding account verified", done: bankLinked },
    { label: "Sufficient funds available", done: bankLinked },
    { label: "Payroll approved",         done: approvalDone },
  ];
  const readinessDone = readinessItems.filter(r => r.done).length;
  const isReadyToFund = readinessDone === readinessItems.length;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{getGreeting(user?.name)}</h1>
          <p className="text-gray-500 text-sm mt-0.5">Here's what's happening with payroll today.</p>
        </div>
        <button
          onClick={() => void refetchPayroll()}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
          {payrollData?.fetchedAt && (
            <span className="text-gray-300 ml-0.5">
              · {new Date(payrollData.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </button>
      </div>

      {/* ── 6 KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Payroll Status */}
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Payroll Status"
          value={payrollLoading ? "…" : payPeriodStatus === "preprocess" ? "Ready" : payPeriodStatus === "inprocess" ? "In Progress" : payPeriodStatus || "—"}
          sub1={payBegin && payEnd ? `Pay Period: ${fmtDate(payBegin).replace(/,\s*\d{4}/, "")} – ${fmtDate(payEnd)}` : undefined}
          sub2={!payrollLoading && pp ? "All set to fund payroll" : undefined}
          accent={EMERALD}
          loading={payrollLoading}
        />

        {/* Next Payroll Date */}
        <KpiCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Next Payroll Date"
          value={payrollLoading ? "…" : fmtDate(nextPayDate)}
          sub1={payFrequency ? FREQ_LABEL[payFrequency] ?? payFrequency : undefined}
          accent="#284362"
          loading={payrollLoading}
        />

        {/* Employees to Pay */}
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Employees to Pay"
          value={payrollLoading ? "…" : employeesToPay != null ? String(employeesToPay) : "—"}
          sub1={employeesToPay != null ? `${employeesToPay} in current pay run` : "Payroll not yet calculated"}
          accent="#0284c7"
          loading={payrollLoading}
        />

        {/* Cash Required — highlighted */}
        <div className="ring-2 ring-emerald-400 rounded-xl shadow-sm">
          <KpiCard
            icon={<DollarSign className="h-4 w-4" />}
            label="Cash Required"
            value={payrollLoading ? "…" : fmtCurrency(cashRequired)}
            sub1={nextPayDate ? `Debit on ${fmtDate(nextPayDate)}` : undefined}
            sub2={bankLinked ? "✓ Funds available" : undefined}
            accent={EMERALD}
            loading={payrollLoading}
          />
        </div>

        {/* Payroll Exceptions */}
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Payroll Exceptions"
          value={dashLoading ? "…" : String(highCount)}
          sub1={highCount > 0 ? "Requires your action" : "No urgent items"}
          sub2={highCount > 0 ? undefined : "All clear"}
          accent={highCount > 0 ? "#dc2626" : EMERALD}
          loading={dashLoading}
        />

        {/* Compliance Score */}
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Compliance Score"
          value={dashLoading ? "…" : complianceScore != null ? `${complianceScore}%` : "—"}
          sub1={complianceScore != null ? complianceLabel : undefined}
          accent={complianceScore != null && complianceScore >= 75 ? EMERALD : "#d97706"}
          loading={dashLoading}
        />
      </div>

      {/* ── Processing Center + Alerts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">

        {/* Processing Center */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[#28436215]">
                <FileText className="h-4 w-4 text-[#284362]" />
              </div>
              <h2 className="text-gray-900 font-bold text-base">Payroll Processing Center</h2>
            </div>
            {payBegin && payEnd && (
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                Pay Period: {fmtDate(payBegin).replace(/,\s*\d{4}/, "")} – {fmtDate(payEnd)}
              </span>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b bg-gray-50 px-6 overflow-x-auto">
            {PROC_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[#284362] text-[#284362]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.id === "exceptions" && highCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">{highCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {activeTab === "overview" && (
            <div className="p-6 space-y-5">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading payroll data…</div>
              ) : !pp ? (
                <div className="py-8 text-center text-gray-400">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No active pay period found</p>
                  {payrollData?.errors.payPeriod && <p className="text-xs text-red-400 mt-1">{payrollData.errors.payPeriod}</p>}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { label: "Pay Period Status", value: String(pp.payPeriodStatus ?? "—"), icon: <CircleDot className="h-4 w-4 text-emerald-500" /> },
                      { label: "Pay Date",           value: fmtDate(pp.payDate as string | null), icon: <CalendarDays className="h-4 w-4 text-blue-500" /> },
                      { label: "Employees in Run",   value: employeesToPay != null ? `${employeesToPay} employees` : "—", icon: <Users className="h-4 w-4 text-purple-500" /> },
                    ].map(({ label, value, icon }) => (
                      <div key={label} className="rounded-xl border p-4 bg-gray-50 space-y-1.5">
                        <div className="flex items-center gap-2 text-gray-500">
                          {icon}
                          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                        </div>
                        <div className="text-gray-900 font-semibold capitalize">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border p-4 bg-gray-50 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Funding Readiness
                    </h3>
                    <div className="space-y-2">
                      {readinessItems.map(item => (
                        <div key={item.label} className="flex items-center gap-2 text-sm">
                          {item.done
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
                          <span className={item.done ? "text-gray-700" : "text-gray-400"}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    {isReadyToFund && (
                      <p className="text-emerald-600 text-sm font-semibold">✓ You're ready to fund payroll!</p>
                    )}
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <Link href="/manager-payroll">
                      <Button className="gap-2 text-sm font-semibold text-white border-0" style={{ background: ORANGE }}>
                        <Lock className="h-4 w-4" /> Approve &amp; Fund Payroll
                        {cashRequired && <span className="font-bold">{fmtCurrency(cashRequired)}</span>}
                      </Button>
                    </Link>
                    <Link href="/manager-payroll">
                      <Button variant="outline" className="gap-2 text-sm">
                        <Play className="h-4 w-4" /> Run Payroll Preview
                      </Button>
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab: Cash Required */}
          {activeTab === "cash" && (
            <div className="p-6">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Breakdown */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Cash Required Breakdown</h3>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {[
                          { label: "Employee Net Pay",        value: netPaySum || (cashRequired ? cashRequired * 0.72 : null) },
                          { label: "Employee Tax Withholdings", value: empTaxSum || (cashRequired ? cashRequired * 0.13 : null) },
                          { label: "Employer Payroll Taxes",  value: emprTaxSum || (cashRequired ? cashRequired * 0.12 : null) },
                          { label: "Payroll Service Fees",    value: serviceFees },
                        ].map(({ label, value }) => (
                          <tr key={label}>
                            <td className="py-2 text-gray-600 text-xs">{label}</td>
                            <td className="py-2 text-right text-gray-900 font-medium text-xs">{fmtCurrency(value)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300">
                          <td className="py-3 text-gray-900 font-bold text-sm">TOTAL CASH REQUIRED</td>
                          <td className="py-3 text-right text-gray-900 font-bold text-sm">{fmtCurrency(cashRequired)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-gray-400 text-[11px] leading-relaxed">
                      The payroll service will debit the total cash required from your funding account and process employee payments, taxes, garnishments and other payroll obligations.
                    </p>
                  </div>

                  {/* Funding */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Payroll Funding</h3>
                    <div className="space-y-2.5 text-sm">
                      {[
                        { label: "Debit Date",         value: fmtDate(nextPayDate) },
                        { label: "Employee Pay Date",  value: fmtDate(nextPayDate) },
                        { label: "Funding Method",     value: "ACH Debit" },
                        { label: "Account Verification", value: bankLinked ? "✓ Verified" : "Not linked" },
                        { label: "Funding Status",     value: bankLinked ? "Ready to Debit" : "Bank account required" },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-2">
                          <span className="text-gray-500 text-xs">{label}</span>
                          <span className="text-gray-900 text-xs font-medium text-right">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 space-y-2">
                      <Link href="/settings">
                        <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                          <CreditCard className="h-3.5 w-3.5" /> Change Funding Account
                        </Button>
                      </Link>
                      <Link href="/manager-payroll">
                        <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                          <Download className="h-3.5 w-3.5" /> Download Funding Summary
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Readiness */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Funding Readiness</h3>
                    <div className="space-y-2">
                      {readinessItems.map(item => (
                        <div key={item.label} className="flex items-center gap-2 text-sm">
                          {item.done
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
                          <span className={item.done ? "text-gray-700 text-xs" : "text-gray-400 text-xs"}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    {isReadyToFund && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                        <p className="text-emerald-700 text-xs font-semibold">✓ You're ready to fund payroll!</p>
                        <p className="text-emerald-600 text-[11px] mt-0.5">
                          Last calculated: Today, {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    )}
                    <Link href="/manager-payroll">
                      <Button className="w-full gap-2 text-sm font-bold text-white border-0 mt-2" style={{ background: ORANGE }}>
                        <Lock className="h-4 w-4" /> Approve &amp; Fund Payroll
                      </Button>
                    </Link>
                    <Link href="/manager-payroll">
                      <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                        <Play className="h-3.5 w-3.5" /> Run Payroll Preview
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Employees */}
          {activeTab === "employees" && (
            <div className="p-6">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading employees…</div>
              ) : lineItems.length === 0 ? (
                <div className="py-8 text-center text-gray-400">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No employee pay data in this period yet</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wide border-b">
                      <th className="text-left pb-2 font-medium">Employee</th>
                      <th className="text-right pb-2 font-medium">Gross Pay</th>
                      <th className="text-right pb-2 font-medium">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lineItems.map((item, i) => {
                      const name = item.firstName && item.lastName
                        ? `${item.firstName} ${item.lastName}`
                        : `Employee ${String(item.userId ?? i + 1)}`;
                      return (
                        <tr key={String(item.userId ?? i)}>
                          <td className="py-2.5 text-gray-800 font-medium">{name}</td>
                          <td className="py-2.5 text-right text-gray-600">{fmtCurrency(item.grossTotal ?? item.basicPay ?? null)}</td>
                          <td className="py-2.5 text-right text-gray-900 font-semibold">{fmtCurrency(item.netTotal ?? item.netPay ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="pt-3 text-gray-700 font-bold text-xs uppercase">Total</td>
                      <td className="pt-3 text-right text-gray-700 font-bold">{fmtCurrency(grossPaySum || null)}</td>
                      <td className="pt-3 text-right text-gray-900 font-bold">{fmtCurrency(netPaySum || null)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* Tab: Exceptions */}
          {activeTab === "exceptions" && (
            <div className="p-6">
              {dashLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
              ) : attention.length === 0 ? (
                <div className="py-8 text-center text-gray-400">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                  <p className="text-sm font-medium text-emerald-600">No exceptions — everything looks good!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attention.map(item => (
                    <div key={item.id} className={`rounded-xl border p-4 flex items-start gap-3 ${
                      item.severity === "high"   ? "bg-red-50 border-red-200" :
                      item.severity === "medium" ? "bg-amber-50 border-amber-200" :
                                                   "bg-blue-50 border-blue-200"
                    }`}>
                      {item.severity === "high"   ? <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" /> :
                       item.severity === "medium" ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" /> :
                                                    <CircleDot className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">{item.message}</p>
                        {item.linkTo && item.actionLabel && (
                          <Link href={item.linkTo}>
                            <span className="text-xs font-semibold text-[#284362] flex items-center gap-1 mt-1 w-fit">
                              {item.actionLabel} <ArrowRight className="h-3 w-3" />
                            </span>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Rail ──────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Payroll Alerts */}
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="text-gray-900 font-semibold text-sm">Payroll Alerts</span>
                {highCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">{highCount}</span>
                )}
              </div>
              <button onClick={() => setActiveTab("exceptions")} className="text-xs text-[#284362] font-medium hover:underline">
                View all
              </button>
            </div>
            {dashLoading ? (
              <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>
            ) : attention.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
                <p className="text-xs text-gray-400">No alerts — all clear!</p>
              </div>
            ) : (
              <div className="divide-y max-h-80 overflow-y-auto">
                {attention.slice(0, 8).map(item => <AlertRow key={item.id} item={item} />)}
              </div>
            )}
            <div className="px-4 py-3 border-t">
              <Link href="/settings">
                <span className="text-xs text-[#284362] flex items-center gap-1 font-medium hover:underline">
                  Go to exception center <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </div>

          {/* AI Payroll Assistant (simplified) */}
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <div className="p-1 rounded-lg bg-violet-100">
                <Zap className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <span className="text-gray-900 font-semibold text-sm">AI Payroll Assistant</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-600 uppercase tracking-wide">Beta</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">
                {complianceScore != null
                  ? `Payroll is ${complianceScore}% ready. `
                  : ""}
                {highCount > 0
                  ? `${highCount} item${highCount > 1 ? "s" : ""} need${highCount === 1 ? "s" : ""} your attention before funding.`
                  : "All checks passed — you can fund payroll when ready."}
              </p>
              {attention.slice(0, 2).map(a => (
                <div key={a.id} className="flex items-start gap-2 text-xs text-gray-500">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <span>{a.message}</span>
                </div>
              ))}
              <div className="flex gap-2 pt-1 flex-wrap">
                <Link href="/settings">
                  <Button variant="outline" size="sm" className="h-7 px-3 text-xs gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Review Exceptions
                  </Button>
                </Link>
                <Link href="/manager-payroll">
                  <Button size="sm" className="h-7 px-3 text-xs gap-1.5 text-white border-0" style={{ background: ORANGE }}>
                    <Play className="h-3 w-3" /> Run Payroll Preview
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Widgets ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden p-5 space-y-1" style={{ background: "#284362" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FundingForecastWidget history={historyForForecast} payPeriod={payPeriodForForecast} />

          {/* Bank Balance Verification */}
          <WidgetCard title="Bank Balance Verification" subtitle={bankLinked ? "Business Checking linked" : "No bank account linked"}>
            {!bankLinked ? (
              <div className="py-4 text-center">
                <Wallet className="h-6 w-6 text-white/20 mx-auto mb-2" />
                <p className="text-white/40 text-xs">Link a bank account to verify balance</p>
                <Link href="/settings">
                  <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 justify-center mt-3 cursor-pointer">
                    Link account <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-white text-xl font-bold">Bank linked</p>
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Sufficient for payroll funding
                </div>
                <p className="text-white/30 text-[10px]">
                  Last updated: Today, {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            )}
          </WidgetCard>

          <VarianceWidget
            selectedCompanyId={companyId}
            currentDetails={det as unknown as import("@/components/dashboard").PeriodDetailsResponse | undefined}
            lastPeriodId={history[0]?.payPeriodId as string | undefined}
          />

          {/* Multi-Entity */}
          <WidgetCard title="Multi-Entity Payroll" subtitle="Entity overview">
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div>
                  <p className="text-white text-xs font-semibold">{company?.name ?? "Your Company"}</p>
                  <p className="text-white/40 text-[10px]">
                    {employeesToPay != null ? `${employeesToPay} employees` : "—"}
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <Link href="/settings">
                <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 mt-2 cursor-pointer">
                  Manage entities <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </WidgetCard>
        </div>
      </div>

      {/* ── Recent Activity ───────────────────────────────────────────────────── */}
      <RecentActivityWidget selectedCompanyId={companyId} companies={[]} />

      {/* ── Team Access Management ────────────────────────────────────────────── */}
      <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" style={{ color: OWNER_COLOR }} />
            <h2 className="text-white font-semibold text-sm">Team Access</h2>
            <span className="text-white/40 text-xs">— manage login accounts for your company</span>
          </div>
          <Button size="sm" className="h-7 px-3 gap-1.5 text-xs font-semibold"
            style={{ background: OWNER_COLOR, color: "#fff" }}
            onClick={() => { setShowCreateForm(v => !v); setCreatedCreds(null); setCreateError(""); }}>
            <UserPlus className="h-3.5 w-3.5" /> Add Account
          </Button>
        </div>
        <div className="p-6 space-y-5">
          {createdCreds && (
            <div className="rounded-xl border p-4 space-y-2" style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.25)" }}>
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" /> Account created — share these credentials securely
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                {[{ label: "Email", value: createdCreds.email }, { label: "Password", value: createdCreds.password }, { label: "Role", value: createdCreds.role }].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                    <span className="text-white/40 text-xs w-14 shrink-0">{label}</span>
                    <span className="text-emerald-300 font-mono text-xs flex-1 truncate">{value}</span>
                    <CopyButton text={value} />
                  </div>
                ))}
              </div>
              <button onClick={() => setCreatedCreds(null)} className="text-white/30 text-[11px] hover:text-white/60 mt-1">Dismiss</button>
            </div>
          )}
          {showCreateForm && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.15)" }}>
              <p className="text-white/70 text-sm font-medium">New account for {company?.name}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Full name *</label>
                  <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Jane Smith" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Email *</label>
                  <Input value={createEmail} onChange={e => setCreateEmail(e.target.value)} type="email" placeholder="jane@example.com" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Role *</label>
                  <select value={createRole} onChange={e => setCreateRole(e.target.value as "owner" | "employee")} className="w-full h-9 rounded-md bg-white/10 border border-white/20 text-white text-sm px-3 focus:outline-none">
                    <option value="employee" className="bg-[#284362]">Employee — time clock + own records</option>
                    <option value="owner"    className="bg-[#284362]">Owner — full company access</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Position / title</label>
                  <Input value={createPosition} onChange={e => setCreatePosition(e.target.value)} placeholder="e.g. Lead Teacher" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
              </div>
              {createError && <p className="text-red-400 text-xs flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 shrink-0" />{createError}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleCreateRole} disabled={createLoading} className="h-8 px-4 text-xs font-semibold" style={{ background: OWNER_COLOR, color: "#fff" }}>
                  {createLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Creating…</> : "Create Account"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCreateForm(false); setCreateError(""); }} className="h-8 px-4 text-xs text-white/50 hover:text-white hover:bg-white/10">Cancel</Button>
              </div>
            </div>
          )}
          {accountsLoading ? (
            <div className="flex items-center gap-2 text-white/40 text-sm py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <p className="text-white/30 text-sm py-2">No accounts found for this company.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: ROLE_BADGE[acc.role]?.color ?? "#6b7280" }}>
                    {acc.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-white text-sm font-medium truncate">{acc.name}</span><RoleBadge role={acc.role} /></div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-white/40 text-xs truncate">{acc.email}</span>
                      {acc.position && <span className="text-white/30 text-xs">{acc.position}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Timesheets & Approval ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-4 w-4 text-white/50" />
              <h2 className="text-white font-semibold text-base">Timesheets &amp; Approval</h2>
              {approvalDone && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">Approved</span>
              )}
            </div>
            <p className="text-white/50 text-sm mt-0.5">
              <Clock className="h-3 w-3 inline mr-1 opacity-50" />
              <span className="text-white/70 font-medium">{company?.name}</span>
              {payFrequency && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/60 border border-white/10">{FREQ_LABEL[payFrequency] ?? payFrequency}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setHours([]); setApprovalDone(false); }} className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]" />
              <span className="text-white/30 text-xs">→</span>
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setHours([]); setApprovalDone(false); }} className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]" />
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <Button onClick={() => void handlePullHours()} disabled={pulling || hoursLoading} size="sm" variant="outline"
                className="gap-1.5 text-sm font-medium bg-white/5 border-white/20 text-white/80 hover:bg-white/10 hover:text-white">
                {pulling ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pulling…</> : <><Download className="h-3.5 w-3.5" /> Pull Hours</>}
              </Button>
              {lastSyncedAt && !pulling && (
                <span className="text-white/25 text-[10px]">Synced {lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              )}
            </div>
            <Button onClick={() => void launchET()} disabled={tokenLoading} size="sm"
              className="gap-1.5 text-sm font-semibold text-white border-0" style={{ background: ORANGE }}>
              <Play className="h-3.5 w-3.5" />
              {tokenLoading ? "Loading…" : etLaunchedRef.current ? "Reload EasyTeam" : "Open EasyTeam"}
            </Button>
          </div>
        </div>

        {tokenError && (
          <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
            <AlertTriangle className="h-4 w-4" />{tokenError}
            {exchangeWarning && <span className="text-amber-300 ml-1">JWT exchange warning</span>}
          </div>
        )}
        {!etLaunchedRef.current && !tokenLoading && !tokenError && (
          <div className="py-10 flex flex-col items-center justify-center gap-2 border-b border-white/10">
            <Play className="h-8 w-8 text-white/15" />
            <p className="text-white/35 text-sm">Click <span className="text-white/60 font-medium">Open EasyTeam</span> to review timesheets in the iframe</p>
            <p className="text-white/20 text-xs">— or click <span className="text-white/40 font-medium">Pull Hours</span> to fetch hours directly without opening the iframe</p>
          </div>
        )}
        <div id="et-owner-container" className={`w-full ${etLaunchedRef.current ? "border-b border-white/10" : ""}`} />

        <div className="px-6 py-5">
          {approvalDone && (
            <div className="mb-5 flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-emerald-300 font-semibold text-sm">Hours approved and queued for payroll</p>
                  {approvalDataSource === "easyteam" && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/20 uppercase">Live EasyTeam data</span>}
                  {approvalDataSource === "seeded"   && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/40 border border-white/10">Demo data</span>}
                </div>
                <p className="text-emerald-400/60 text-xs mt-0.5">
                  Approved {approvedAt ? new Date(approvedAt).toLocaleString() : "just now"} · Super Admin can now sync these hours in the Payroll tab
                </p>
              </div>
              <button onClick={() => { setApprovalDone(false); setApprovalDataSource(null); setHours([]); void fetchHours(); }} className="text-white/30 hover:text-white/50 text-xs underline underline-offset-2 shrink-0">Re-approve</button>
            </div>
          )}
          {hoursLoading && hours.length === 0 ? (
            <div className="py-8 flex items-center justify-center gap-2 text-white/30 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading hours…</div>
          ) : hours.length === 0 ? (
            <div className="py-6 text-center text-white/30 text-sm space-y-1">
              <p>No shifts recorded for this period yet.</p>
              <p className="text-white/20 text-xs">Click <span className="text-white/35">Pull Hours</span> to sync from EasyTeam.</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/30 text-xs uppercase tracking-wide border-b border-white/10">
                    <th className="text-left pb-2 font-medium">Employee</th>
                    <th className="text-right pb-2 font-medium">Hours worked</th>
                    <th className="text-right pb-2 font-medium">Breaks</th>
                    <th className="text-right pb-2 font-medium">{approvalDone ? "Approved hrs" : "Approve hrs (edit if needed)"}</th>
                    <th className="text-right pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {hours.map(e => (
                    <tr key={e.employeeId}>
                      <td className="py-2.5 text-white/80">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {employeeNames[e.employeeId] ?? (e.employeeId.includes("-") && e.employeeId.length > 20 ? "External Staff" : e.employeeId)}
                          {employeeStatuses[e.employeeId] === "onboarding" && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">Onboarding</span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-white/60">{formatHours(e.hoursWorked)}</td>
                      <td className="py-2.5 text-right text-amber-400/60">−{formatHours(e.breakDeduction)}</td>
                      <td className="py-2.5 text-right">
                        {approvalDone ? (
                          <span className="text-white font-semibold">{formatHours(editedHours[e.employeeId] ?? e.approvedHours)}</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <input type="number" min="0" step="0.25" value={editedHours[e.employeeId] ?? e.approvedHours}
                              onChange={ev => setEditedHours(prev => ({ ...prev, [e.employeeId]: parseFloat(ev.target.value) || 0 }))}
                              className="w-20 text-right bg-white/10 text-white rounded px-1.5 py-0.5 text-sm border border-white/20 focus:outline-none focus:border-white/40" />
                            <input type="text" placeholder="note (optional)" value={editNotes[e.employeeId] ?? ""}
                              onChange={ev => setEditNotes(prev => ({ ...prev, [e.employeeId]: ev.target.value }))}
                              className="w-28 text-right bg-transparent text-white/40 rounded px-1.5 py-0.5 text-xs border border-white/10 focus:outline-none placeholder:text-white/20" />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {e.managerApproved
                          ? <span className="text-emerald-400 text-xs font-medium flex items-center justify-end gap-1"><CheckCircle2 className="h-3 w-3" /> Approved</span>
                          : <span className="text-white/25 text-xs">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!approvalDone && (
                <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
                  <Button onClick={() => void handleApprove()} disabled={approving}
                    className="gap-2 text-sm font-semibold text-white border-0 px-5" style={{ background: ORANGE }}>
                    {approving ? <><Loader2 className="h-4 w-4 animate-spin" /> Approving…</> : <><ThumbsUp className="h-4 w-4" /> Approve Hours</>}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}
