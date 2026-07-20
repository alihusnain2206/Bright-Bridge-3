import React, { useState, useCallback, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Clock, CalendarDays, Calendar,
  Play, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Building2, ShieldCheck, DollarSign,
  Settings, UserPlus, KeyRound, Copy, Check,
  ThumbsUp, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const OWNER_COLOR = "#7c3aed";
const ORANGE = "#E8622A";

interface EasyTeamEmployee {
  id: string; name: string; role?: string;
  timeTrackingEnabled?: boolean; isVisible?: boolean;
  wage?: number; wageType?: "hourly";
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

function formatDateLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to + "T12:00:00");
  return `${f.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
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

export default function OwnerDashboard() {
  const { user, company, location: authLocation } = useAuth();
  const qc = useQueryClient();

  // ── EasyTeam launcher ─────────────────────────────────────
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError]     = useState("");
  const [tokenDecoded, setTokenDecoded] = useState<Record<string, unknown> | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState(false);
  const etLaunchedRef = useRef(false);
  const { launch, navigateToDate } = useEasyTeamLauncher("et-owner-container", undefined, 520);

  // ── Timesheets & Approval ──────────────────────────────────
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
  const employeeNames = Object.fromEntries(companyEmployees.map(e => [e.id, e.name]));

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
    setPulling(true);
    setApprovalDone(false);
    setApprovalDataSource(null);
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
        setHours(d.entries);
        setApprovalDone(true);
        setApprovedAt(new Date().toISOString());
        setApprovalDataSource(d.dataSource ?? null);
      }
    } catch { /* ignore */ }
    finally { setApproving(false); }
  };

  // Fetch employees + pay period + initial hours on mount
  useEffect(() => { void fetchCompanyEmployees(); }, [fetchCompanyEmployees]);
  useEffect(() => { void fetchHours(); }, [fetchHours]);
  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/companies/${user.companyId}/pay-period`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { from: string; to: string; frequency: string }) => {
        if (d.from && d.to) {
          setFromDate(d.from);
          setToDate(d.to);
          if (etLaunchedRef.current) navigateToDate(d.from, d.to);
        }
        if (d.frequency) setPayFrequency(d.frequency);
      })
      .catch(() => { /* keep default */ });
  }, [user?.companyId, navigateToDate]);

  // ── Role management ───────────────────────────────────────
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
    if (!createName.trim() || !createEmail.trim()) {
      setCreateError("Name and email are required"); return;
    }
    setCreateLoading(true); setCreateError("");
    try {
      const res = await fetch("/api/auth/create-sub-role", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(), email: createEmail.trim(),
          role: createRole, position: createPosition.trim() || undefined,
        }),
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

  // ── EasyTeam launch ───────────────────────────────────────
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
      const tokenData = await tokenRes.json() as {
        token?: string; decoded?: Record<string, unknown>;
        exchangeWarning?: boolean; error?: string;
      };
      if (!tokenRes.ok || !tokenData.token) { setTokenError(tokenData.error ?? "Token generation failed"); return; }
      if (tokenData.exchangeWarning) setExchangeWarning(true);
      if (tokenData.decoded) setTokenDecoded(tokenData.decoded);

      const empRes = await fetch(`/api/employees?companyId=${encodeURIComponent(user.companyId ?? "")}`, { credentials: "include" });
      const empData = await empRes.json() as { employees?: ApiEmployee[] };
      const apiEmployees: EasyTeamEmployee[] = (empData.employees ?? []).map((e) => ({
        id: e.employeeId,
        name: [e.firstName, e.lastName].join(" ").trim(),
        role: e.position ?? "Staff",
        timeTrackingEnabled: true,
        wage: e.hourlyWage ?? 1500,
        wageType: "hourly",
      }));

      const ownerSelf: EasyTeamEmployee = {
        id: user.employeeId!,
        name: user.name,
        role: user.position,
        timeTrackingEnabled: false,
        isVisible: false,
        wage: user.hourlyWage ?? 2500,
        wageType: "hourly",
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
        allLaunchLocations = [{
          ...fallback,
          latitude:  fallback.latitude  !== 0 ? fallback.latitude  : (company?.latitude  ?? 40.7357),
          longitude: fallback.longitude !== 0 ? fallback.longitude : (company?.longitude ?? -74.1724),
        }];
      }
      launch(tokenData.token, {
        page: Pages.TIMESHEET,
        employees: allEmployees,
        organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
        locations: allLaunchLocations,
        fromDate, toDate,
      });
      etLaunchedRef.current = true;
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  }, [user, launch, fromDate, toDate, authLocation, company]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: OWNER_COLOR }} />
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Company Owner</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{company?.name ?? "Your Company"}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Welcome back, {user?.name?.split(" ")[0]}. Full company access — scoped to your location.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium"
          style={{ background: `${OWNER_COLOR}15`, borderColor: `${OWNER_COLOR}40`, color: OWNER_COLOR }}>
          <Building2 className="h-3.5 w-3.5" />
          {company?.name ?? "Company"}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {[
          { icon: <Users className="h-5 w-5" />,       label: "People",     href: "/people" },
          { icon: <Clock className="h-5 w-5" />,        label: "Time Clock", href: "/timeclock" },
          { icon: <CalendarDays className="h-5 w-5" />, label: "Timesheets", href: "/timesheets" },
          { icon: <Calendar className="h-5 w-5" />,     label: "Schedule",   href: "/schedule" },
          { icon: <DollarSign className="h-5 w-5" />,   label: "Payroll",    href: "/manager-payroll" },
          { icon: <ShieldCheck className="h-5 w-5" />,  label: "Compliance", href: "/people/compliance" },
          { icon: <Settings className="h-5 w-5" />,     label: "Config",     href: "/config" },
        ].map(({ icon, label, href }) => (
          <Link key={label} href={href}>
            <button className="w-full flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 bg-white hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/5 transition-colors group">
              <span className="text-gray-400 group-hover:text-[#7c3aed] transition-colors">{icon}</span>
              <span className="text-[11px] font-medium text-gray-600 group-hover:text-[#7c3aed]">{label}</span>
            </button>
          </Link>
        ))}
      </div>

      {/* ── Team Access Management ───────────────────────────── */}
      <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" style={{ color: OWNER_COLOR }} />
            <h2 className="text-white font-semibold text-sm">Team Access</h2>
            <span className="text-white/40 text-xs">— manage login accounts for your company</span>
          </div>
          <Button size="sm"
            className="h-7 px-3 gap-1.5 text-xs font-semibold"
            style={{ background: OWNER_COLOR, color: "#fff" }}
            onClick={() => { setShowCreateForm(v => !v); setCreatedCreds(null); setCreateError(""); }}>
            <UserPlus className="h-3.5 w-3.5" />
            Add Account
          </Button>
        </div>

        <div className="p-6 space-y-5">
          {/* New credentials alert */}
          {createdCreds && (
            <div className="rounded-xl border p-4 space-y-2"
              style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.25)" }}>
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="h-4 w-4" /> Account created — share these credentials securely
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                {[
                  { label: "Email", value: createdCreds.email },
                  { label: "Password", value: createdCreds.password },
                  { label: "Role", value: createdCreds.role },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                    <span className="text-white/40 text-xs w-14 shrink-0">{label}</span>
                    <span className="text-emerald-300 font-mono text-xs flex-1 truncate">{value}</span>
                    <CopyButton text={value} />
                  </div>
                ))}
              </div>
              <button onClick={() => setCreatedCreds(null)} className="text-white/30 text-[11px] hover:text-white/60 mt-1">
                Dismiss
              </button>
            </div>
          )}

          {/* Create form */}
          {showCreateForm && (
            <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.15)" }}>
              <p className="text-white/70 text-sm font-medium">New account for {company?.name}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Full name *</label>
                  <Input value={createName} onChange={e => setCreateName(e.target.value)}
                    placeholder="e.g. Jane Smith" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Email *</label>
                  <Input value={createEmail} onChange={e => setCreateEmail(e.target.value)}
                    type="email" placeholder="jane@example.com" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Role *</label>
                  <select value={createRole} onChange={e => setCreateRole(e.target.value as "owner" | "employee")}
                    className="w-full h-9 rounded-md bg-white/10 border border-white/20 text-white text-sm px-3 focus:outline-none">
                    <option value="employee" className="bg-[#284362]">Employee — time clock + own records</option>
                    <option value="owner"    className="bg-[#284362]">Owner — full company access</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-white/50 text-xs">Position / title</label>
                  <Input value={createPosition} onChange={e => setCreatePosition(e.target.value)}
                    placeholder="e.g. Lead Teacher" className="bg-white/10 border-white/20 text-white placeholder:text-white/30 h-9 text-sm" />
                </div>
              </div>
              {createError && (
                <p className="text-red-400 text-xs flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />{createError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleCreateRole} disabled={createLoading}
                  className="h-8 px-4 text-xs font-semibold" style={{ background: OWNER_COLOR, color: "#fff" }}>
                  {createLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Creating…</> : "Create Account"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCreateForm(false); setCreateError(""); }}
                  className="h-8 px-4 text-xs text-white/50 hover:text-white hover:bg-white/10">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Accounts table */}
          {accountsLoading ? (
            <div className="flex items-center gap-2 text-white/40 text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-white/30 text-sm py-2">No accounts found for this company.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div key={acc.id} className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: ROLE_BADGE[acc.role]?.color ?? "#6b7280" }}>
                    {acc.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium truncate">{acc.name}</span>
                      <RoleBadge role={acc.role} />
                    </div>
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

      {/* ── Timesheets & Approval ──────────────────────────────── */}
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
              <span className="text-white/70 font-medium">{company?.name}</span>
              {payFrequency && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/60 border border-white/10">
                  {FREQ_LABEL[payFrequency] ?? payFrequency}
                </span>
              )}
              {" · "}<span className="text-white/70">{formatDateLabel(fromDate, toDate)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <input type="date" value={fromDate}
                onChange={e => { setFromDate(e.target.value); setHours([]); setApprovalDone(false); }}
                className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]" />
              <span className="text-white/30 text-xs">→</span>
              <input type="date" value={toDate}
                onChange={e => { setToDate(e.target.value); setHours([]); setApprovalDone(false); }}
                className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]" />
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
                  {approvalDataSource === "easyteam" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-orange-500/20 text-orange-400 border border-orange-500/20">Live EasyTeam data</span>
                  )}
                  {approvalDataSource === "seeded" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/40 border border-white/10">Demo data</span>
                  )}
                </div>
                <p className="text-emerald-400/60 text-xs mt-0.5">
                  Approved {approvedAt ? new Date(approvedAt).toLocaleString() : "just now"} · Super Admin can now sync these hours in the Payroll tab
                </p>
              </div>
              <button onClick={() => { setApprovalDone(false); setApprovalDataSource(null); setHours([]); void fetchHours(); }}
                className="text-white/30 hover:text-white/50 text-xs underline underline-offset-2 shrink-0">
                Re-approve
              </button>
            </div>
          )}

          {hoursLoading && hours.length === 0 ? (
            <div className="py-8 flex items-center justify-center gap-2 text-white/30 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading hours…
            </div>
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
                      <td className="py-2.5 text-white/80">{employeeNames[e.employeeId] ?? (e.employeeId.includes("-") && e.employeeId.length > 20 ? "External Staff" : e.employeeId)}</td>
                      <td className="py-2.5 text-right text-white/60">{formatHours(e.hoursWorked)}</td>
                      <td className="py-2.5 text-right text-amber-400/60">−{formatHours(e.breakDeduction)}</td>
                      <td className="py-2.5 text-right">
                        {approvalDone ? (
                          <span className="text-white font-semibold">{formatHours(editedHours[e.employeeId] ?? e.approvedHours)}</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <input type="number" min="0" step="0.25"
                              value={editedHours[e.employeeId] ?? e.approvedHours}
                              onChange={ev => setEditedHours(prev => ({ ...prev, [e.employeeId]: parseFloat(ev.target.value) || 0 }))}
                              className="w-20 text-right bg-white/10 text-white rounded px-1.5 py-0.5 text-sm border border-white/20 focus:outline-none focus:border-white/40" />
                            <input type="text" placeholder="note (optional)"
                              value={editNotes[e.employeeId] ?? ""}
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

      {/* ── Access summary ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
          <div className="px-5 py-4 border-b border-white/10">
            <h3 className="text-white font-semibold text-sm">What you can do</h3>
          </div>
          <ul className="p-5 space-y-2.5">
            {[
              "Full People hub (hire, onboard, terminate)",
              "Timesheets & schedules for your company",
              "Payroll (company-scoped)",
              "Compliance & documents",
              "Webhooks & config",
              "EasyTeam time tracking",
              "Create Owner / Employee accounts",
            ].map(item => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-white/70">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
          <div className="px-5 py-4 border-b border-white/10">
            <h3 className="text-white font-semibold text-sm">Platform limits</h3>
          </div>
          <ul className="p-5 space-y-2.5">
            {[
              "Switch to other companies",
              "BrightBridge platform admin",
              "Global payroll reports",
            ].map(item => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <span className="text-white/70">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
