import React, { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { resolveEasyTeamOrg } from "@/lib/easyteam-org";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  Building2, Users, MapPin, Play, Zap,
  Terminal, RefreshCw, CheckCircle2, XCircle, AlertTriangle, AlertCircle,
  Clock, ThumbsUp, Loader2, Download, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const ORANGE = "#E8622A";

/** Format decimal hours into human-readable "Xm" / "Xh Ym" — matches EasyTeam's display style.
 *  Uses Math.round to avoid floating-point floor errors (e.g. 2min stored as 0.0333h → 1.998m
 *  would floor to 1m incorrectly). */
function formatHours(h: number): string {
  const totalMin = Math.round(h * 60);
  if (totalMin === 0) return "0m";
  if (totalMin < 60) return `${totalMin}m`;
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`;
}

interface TokenData { token: string; decoded: Record<string, unknown>; role: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string }
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

const FREQ_LABEL: Record<string, string> = {
  BiWeekly: "Bi-Weekly",
  Weekly: "Weekly",
  SemiMonthly: "Semi-Monthly",
  Monthly: "Monthly",
};

function formatDateLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to + "T12:00:00");
  return `${f.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

interface EasyTeamEmployee {
  id: string;
  /** EasyTeam's own UUID for this employee (set for employees who registered in EasyTeam
   *  directly). If present, this must be used as the id in the SDK employees array so the
   *  SDK can match their shifts to the correct named row. */
  easyteamUuid?: string;
  name: string; role: string; timeTrackingEnabled: boolean; isVisible?: boolean;
  wage: number; wageType: "hourly"; status?: string; locationId?: string;
}

// Fallback coords for seeded companies when API locations haven't been fetched yet.
const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW": [{ id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO = ["View own company timesheets", "Edit timesheets", "Manage schedules", "Approve time off", "Clock in/out"];
const CANNOT_DO = ["See other companies", "BrightBridge admin panel", "Super admin features", "View all-company reports"];

export default function ManagerDashboard() {
  const { user, company, location } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [companyEmployees, setCompanyEmployees] = useState<EasyTeamEmployee[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // Approval state
  const [hours, setHours] = useState<TimesheetEntry[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalDone, setApprovalDone] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [approvalDataSource, setApprovalDataSource] = useState<"easyteam" | "seeded" | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // Per-employee hour overrides — manager can edit before clicking Approve
  const [editedHours, setEditedHours] = useState<Record<string, number>>({});
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});

  // ── Unmatched-hours diagnostic ─────────────────────────────────
  interface UnmatchedResult {
    period: { from: string; to: string };
    totalShifts: number;
    matched: Array<{ etUuid: string; employeeId: string; name: string; hoursWorked: number; breakHours: number }>;
    unmatched: Array<{ etUuid: string; hoursWorked: number; breakHours: number }>;
    summary: { matchedEmployees: number; unmatchedEmployees: number; totalMatchedHours: number; totalUnmatchedHours: number };
  }
  const [unmatchedOpen,    setUnmatchedOpen]    = useState(false);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [unmatchedResult,  setUnmatchedResult]  = useState<UnmatchedResult | null>(null);
  const [unmatchedError,   setUnmatchedError]   = useState<string | null>(null);
  const [removingUuid,     setRemovingUuid]     = useState<string | null>(null);
  const [removeResults,    setRemoveResults]    = useState<Record<string, string>>({});

  const initWeek = getCurrentWeek();
  const [fromDate, setFromDate] = useState(initWeek.from);
  const [toDate, setToDate] = useState(initWeek.to);
  const [payFrequency, setPayFrequency] = useState<string | null>(null);

  // Build locations for EasyTeam SDK. Use the hardcoded map for known companies; fall back to
  // the location returned by the auth API (set on the manager's user record) so that dynamically-
  // created companies (e.g. Happy Kids Daycare) still get a valid location entry.
  const authLocation = location ? [{ id: location.id, name: location.name, latitude: location.latitude, longitude: location.longitude }] : [];
  const companyLocations = COMPANY_LOCATIONS[user?.companyId ?? ""] ?? authLocation;

  // Derived name lookup from live employee list
  const employeeNames = Object.fromEntries(companyEmployees.map((e) => [e.id, e.name]));
  const employeeStatuses = Object.fromEntries(companyEmployees.map((e) => [e.id, e.status]));

  const { launch, navigateToDate } = useEasyTeamLauncher("mgr-et-container", undefined, 700);
  // Track whether EasyTeam has been launched at least once so we know when auto-navigate is safe
  const etLaunchedRef = React.useRef(false);

  const handleCheckUnmatched = useCallback(async () => {
    if (!user?.companyId) return;
    setUnmatchedLoading(true); setUnmatchedError(null); setUnmatchedOpen(true);
    try {
      const r = await fetch(
        `/api/easyteam/debug/unmatched-shifts?companyId=${encodeURIComponent(user.companyId)}&from=${fromDate}&to=${toDate}&_t=${Date.now()}`,
        { credentials: "include", cache: "no-store" }
      );
      const d = await r.json() as UnmatchedResult & { error?: string };
      if (d.error) { setUnmatchedError(d.error); return; }
      setUnmatchedResult(d);
    } catch (e) {
      setUnmatchedError(String(e));
    } finally { setUnmatchedLoading(false); }
  }, [user?.companyId, fromDate, toDate]);

  const handleRemoveUuid = useCallback(async (etUuid: string) => {
    if (!user?.companyId) return;
    setRemovingUuid(etUuid);
    try {
      const r = await fetch("/api/easyteam/debug/remove-uuid", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etUuid, companyId: user.companyId, from: fromDate, to: toDate }),
      });
      const d = await r.json() as { blocklisted?: boolean; shiftsDeleted?: number; deleteErrors?: string[]; error?: string };
      if (d.error) {
        setRemoveResults(prev => ({ ...prev, [etUuid]: `Error: ${d.error}` }));
      } else if (d.shiftsDeleted && d.shiftsDeleted > 0) {
        setRemoveResults(prev => ({ ...prev, [etUuid]: `Removed — ${d.shiftsDeleted} shift${d.shiftsDeleted !== 1 ? "s" : ""} deleted from EasyTeam` }));
      } else {
        setRemoveResults(prev => ({ ...prev, [etUuid]: "Blocklisted — will be ignored in all future syncs" }));
      }
      void handleCheckUnmatched();
    } catch (e) {
      setRemoveResults(prev => ({ ...prev, [etUuid]: `Error: ${String(e)}` }));
    } finally { setRemovingUuid(null); }
  }, [user?.companyId, fromDate, toDate, handleCheckUnmatched]);

  const fetchHours = useCallback(async () => {
    if (!user?.companyId) return;
    setHoursLoading(true);
    try {
      const d = await fetch(
        `/api/easyteam/hours?from=${fromDate}&to=${toDate}&companyId=${user.companyId}`,
        { credentials: "include" }
      ).then(r => r.json()) as { entries: TimesheetEntry[]; synced: boolean };
      setHours(d.entries ?? []);
      // Seed editable hours from whatever EasyTeam/store returned so manager sees a pre-filled value
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

  const handleApprove = async () => {
    if (!user?.companyId) return;
    setApproving(true);
    try {
      // Build per-employee entries with manager's (potentially edited) approved hours
      const entries = hours.map(e => ({
        employeeId:      e.employeeId,
        approvedHours:   editedHours[e.employeeId] ?? e.approvedHours,
        managerEditNote: editNotes[e.employeeId] || undefined,
      }));
      const d = await fetch("/api/easyteam/hours/approve", {
        method: "POST",
        credentials: "include",
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

  const handlePullHours = useCallback(async () => {
    if (!user?.companyId) return;
    setPulling(true);
    setApprovalDone(false);
    setApprovalDataSource(null);
    try {
      const r = await fetch("/api/easyteam/hours/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromDate, to: toDate, companyId: user.companyId }),
      });
      const d = await r.json() as {
        success?: boolean;
        skippedUnknownEmployees?: number;
        skippedForeignShifts?: number;
      };
      await fetchHours();
      setLastSyncedAt(new Date());
      // Auto-expand the unmatched diagnostic panel when the sync found employees it couldn't match.
      // Most managers will never click the manual "Check for unmatched hours" link,
      // so surface it automatically when there's something to act on.
      if (d.skippedUnknownEmployees && d.skippedUnknownEmployees > 0) {
        void handleCheckUnmatched();
      }
    } catch { /* ignore */ }
    finally { setPulling(false); }
  }, [user?.companyId, fromDate, toDate, fetchHours, handleCheckUnmatched]);

  const fetchCompanyEmployees = useCallback(async () => {
    if (!user?.companyId) return [];
    const d = await fetch(`/api/easyteam/employees?companyId=${user.companyId}`, { credentials: "include" })
      .then(r => r.json()) as { employees: EasyTeamEmployee[] };
    const list = d.employees ?? [];
    setCompanyEmployees(list);
    return list;
  }, [user?.companyId]);

  useEffect(() => { void fetchCompanyEmployees(); }, [fetchCompanyEmployees]);

  // Fetch the company's pay schedule and snap the date range to the current pay period.
  // If EasyTeam is already running, also navigate its iframe to the same period.
  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/companies/${user.companyId}/pay-period`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { from: string; to: string; frequency: string }) => {
        if (d.from && d.to) {
          setFromDate(d.from);
          setToDate(d.to);
          // If EasyTeam iframe is already loaded, navigate it to the correct period too
          if (etLaunchedRef.current) {
            navigateToDate(d.from, d.to);
          }
        }
        if (d.frequency) setPayFrequency(d.frequency);
      })
      .catch(() => { /* keep default week on error */ });
  }, [user?.companyId, navigateToDate]);

  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/clients/by-company/${user.companyId}`, { credentials: "include" })
      .then(r => r.json())
      .then((c: { id: string }) => setClientId(c.id))
      .catch(() => { /* ignore */ });
  }, [user?.companyId]);

  useEffect(() => {
    fetchEvents();
    const iv = setInterval(fetchEvents, 10000);
    return () => clearInterval(iv);
  }, []);

  // On mount: read what's in the store. Manager clicks "Pull Hours" to sync fresh from EasyTeam.
  // Auto-pulling caused issues with dynamic companies (no locationId → sync returns 0 → wipes table).
  useEffect(() => { void fetchHours(); }, [fetchHours]);

  const fetchEvents = async () => {
    try {
      const d = await fetch("/api/easyteam/webhooks", { credentials: "include" }).then(r => r.json()) as { events: WebhookEvent[] };
      setEvents((d.events ?? []).slice(0, 10));
    } catch { /* ignore */ }
  };

  const generateToken = async () => {
    if (!user) return;
    setTokenLoading(true);
    setTokenError("");
    try {
      // Fetch token, employees, and locations in parallel
      const companyIdEnc = encodeURIComponent(user.companyId ?? "");
      const [tokenRes, freshEmployees, locData] = await Promise.all([
        fetch("/api/auth/token-by-role", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        }),
        fetchCompanyEmployees(),
        fetch(`/api/locations?companyId=${companyIdEnc}`, { credentials: "include" })
          .then(r => r.json() as Promise<{ locations?: Array<{ id: string; name: string; latitude: number | null; longitude: number | null; isActive: boolean }> }>)
          .catch(() => ({ locations: [] as Array<{ id: string; name: string; latitude: number | null; longitude: number | null; isActive: boolean }> })),
      ]);

      const data = await tokenRes.json() as TokenData;
      if (!tokenRes.ok) { setTokenError("Token generation failed"); return; }
      setTokenData(data);

      // Phase 3: use locations from API — covers all locations for this company including
      // wizard-created ones. Fall back to hardcoded coords for backward compatibility.
      const apiLocations = (locData.locations ?? [])
        .filter((l) => l.isActive)
        .map((l) => ({ id: l.id, name: l.name, latitude: l.latitude ?? 40.7357, longitude: l.longitude ?? -74.1724 }));

      const allLaunchLocations = apiLocations.length > 0
        ? apiLocations
        : (COMPANY_LOCATIONS[user.companyId ?? ""] ?? companyLocations).map(loc => ({
            ...loc,
            latitude: loc.latitude !== 0 ? loc.latitude : 40.7357,
            longitude: loc.longitude !== 0 ? loc.longitude : -74.1724,
          }));

      if (allLaunchLocations.length === 0) {
        setTokenError("No location data available for this company");
        return;
      }

      // Company employees for dynamic companies may be empty (not seeded in our store).
      // Pass whatever we have — EasyTeam fetches its own employee records from its backend.
      // Do NOT fall back to other companies' employees; that maps the wrong people to this
      // location and causes a blank timesheet in the iframe.
      const launchEmployees = (freshEmployees ?? []).length > 0
        ? (freshEmployees ?? [])
        : companyEmployees;

      // EasyTeam iframe requires the JWT's employeeId to be present in the employees array.
      // The employees endpoint only returns staff — the manager themselves is never included.
      // Without this, the iframe throws "Current employee ID ... not found in the provided
      // employees list" for every manager on every company.
      // timeTrackingEnabled: false + isVisible: false tells EasyTeam this person is a
      // reviewer, not a tracked employee, so they don't appear as a row in the timesheet.
      // The entry still satisfies EasyTeam's requirement that the JWT's employeeId exists
      // in the employees list — there is no "reviewer-only" role in EasyTeam's SDK.
      const managerSelf: EasyTeamEmployee = {
        id: user.employeeId!,
        name: user.name,
        role: user.position,
        timeTrackingEnabled: false,
        isVisible: false,
        wage: user.hourlyWage ?? 2500,
        wageType: "hourly",
      };
      // Use easyteamUuid as the SDK id when available: employees who registered directly in
      // EasyTeam have a UUID that differs from our internal ID. Using our internal ID causes
      // their shifts to appear in the Total but not in a named row.
      const sdkEmployees = launchEmployees.map(e => ({ ...e, id: e.easyteamUuid ?? e.id }));
      const allLaunchEmployees = user.employeeId && !sdkEmployees.some(e => e.id === user.employeeId)
        ? [managerSelf, ...sdkEmployees]
        : sdkEmployees;

      launch(data.token, {
        page: Pages.TIMESHEET,
        employees: allLaunchEmployees,
        organization: resolveEasyTeamOrg(user?.companyId, company?.name, company?.easyteamOrgId),
        locations: allLaunchLocations,
        fromDate,
        toDate,
      });
      etLaunchedRef.current = true;
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#284362]">{company?.name ?? "Manager"} Dashboard</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#d97706" }}>Manager</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">Welcome, {user?.name}</p>
      </div>

      {/* Company info card — always visible */}
      <div className="rounded-2xl bg-white border p-5 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg text-gray-900">{company?.name}</h2>
            <p className="text-sm text-muted-foreground">Your managed location</p>
          </div>
          <Building2 className="h-6 w-6 text-[#E8622A]" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />{location?.address ?? company?.address ?? "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4 shrink-0" />{companyEmployees.length} staff members
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-600 font-medium">Location active</span>
          </div>
        </div>
      </div>

      {/* Timesheets & Approval — combined panel */}
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>

          {/* Header */}
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
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/60 border border-white/10">
                    {FREQ_LABEL[payFrequency] ?? payFrequency}
                  </span>
                )}
                {" · "}<span className="text-white/70">{formatDateLabel(fromDate, toDate)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setHours([]); setApprovalDone(false); }}
                  className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]"
                />
                <span className="text-white/30 text-xs">→</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setHours([]); setApprovalDone(false); }}
                  className="h-7 text-xs rounded border border-white/20 bg-white/10 text-white px-2 [color-scheme:dark]"
                />
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <Button
                  onClick={() => void handlePullHours()}
                  disabled={pulling || hoursLoading}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-sm font-medium bg-white/5 border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  {pulling
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pulling…</>
                    : <><Download className="h-3.5 w-3.5" /> Pull Hours</>}
                </Button>
                {lastSyncedAt && !pulling && (
                  <span className="text-white/25 text-[10px]">
                    Synced {lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>
              <Button onClick={() => void generateToken()} disabled={tokenLoading} size="sm"
                className="gap-1.5 text-sm font-semibold text-white border-0" style={{ background: ORANGE }}>
                <Play className="h-3.5 w-3.5" />
                {tokenLoading ? "Loading…" : tokenData ? "Reload EasyTeam" : "Open EasyTeam"}
              </Button>
            </div>
          </div>

          {/* EasyTeam iframe area */}
          {tokenError && (
            <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
              <AlertTriangle className="h-4 w-4" />{tokenError}
            </div>
          )}
          {!tokenData && !tokenLoading && !tokenError && (
            <div className="py-10 flex flex-col items-center justify-center gap-2 border-b border-white/10">
              <Play className="h-8 w-8 text-white/15" />
              <p className="text-white/35 text-sm">Click <span className="text-white/60 font-medium">Open EasyTeam</span> to review timesheets in the iframe</p>
              <p className="text-white/20 text-xs">— or click <span className="text-white/40 font-medium">Pull Hours</span> to fetch hours directly without opening the iframe</p>
            </div>
          )}
          <div id="mgr-et-container" className={`w-full ${tokenData ? "border-b border-white/10" : ""}`} />

          {/* Hours section */}
          <div className="px-6 py-5">

            {/* Approved banner */}
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
                <button
                  onClick={() => { setApprovalDone(false); setApprovalDataSource(null); setHours([]); void fetchHours(); }}
                  className="text-white/30 hover:text-white/50 text-xs underline underline-offset-2 shrink-0"
                >
                  Re-approve
                </button>
              </div>
            )}

            {/* Hours table or empty state */}
            {hoursLoading && hours.length === 0 ? (
              <div className="py-8 flex items-center justify-center gap-2 text-white/30 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading hours…
              </div>
            ) : hours.length === 0 ? (
              <div className="py-6 text-center text-white/30 text-sm space-y-1">
                <p>No shifts recorded for this period yet.</p>
                <p className="text-white/20 text-xs">Data auto-refreshes on load — click <span className="text-white/35">Pull Hours</span> to force a manual refresh.</p>
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
                    {hours.map((e) => (
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
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={editedHours[e.employeeId] ?? e.approvedHours}
                                onChange={ev => setEditedHours(prev => ({ ...prev, [e.employeeId]: parseFloat(ev.target.value) || 0 }))}
                                className="w-20 text-right bg-white/10 text-white rounded px-1.5 py-0.5 text-sm border border-white/20 focus:outline-none focus:border-white/40"
                              />
                              <input
                                type="text"
                                placeholder="note (optional)"
                                value={editNotes[e.employeeId] ?? ""}
                                onChange={ev => setEditNotes(prev => ({ ...prev, [e.employeeId]: ev.target.value }))}
                                className="w-28 text-right bg-transparent text-white/40 rounded px-1.5 py-0.5 text-xs border border-white/10 focus:outline-none placeholder:text-white/20"
                              />
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

                {/* Approve button — appears below the table when hours are loaded and not yet approved */}
                {!approvalDone && (
                  <div className="mt-5 flex justify-end border-t border-white/10 pt-4">
                    <Button
                      onClick={() => void handleApprove()}
                      disabled={approving}
                      className="gap-2 text-sm font-semibold text-white border-0 px-5"
                      style={{ background: ORANGE }}
                    >
                      {approving
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Approving…</>
                        : <><ThumbsUp className="h-4 w-4" /> Approve Hours</>}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* ── Unmatched-hours diagnostic ───────────────────── */}
            <div className="mt-6 border-t border-white/10 pt-5">
              <button
                onClick={() => unmatchedResult || unmatchedLoading ? setUnmatchedOpen(o => !o) : void handleCheckUnmatched()}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="font-medium">Check for unmatched EasyTeam hours</span>
                {unmatchedResult && (unmatchedOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />)}
                {unmatchedLoading && <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />}
                {unmatchedResult && !unmatchedLoading && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    unmatchedResult.summary.unmatchedEmployees > 0
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                  }`}>
                    {unmatchedResult.summary.unmatchedEmployees > 0
                      ? `${unmatchedResult.summary.unmatchedEmployees} unmatched · ${unmatchedResult.summary.totalUnmatchedHours}h`
                      : "All matched"}
                  </span>
                )}
              </button>

              {unmatchedError && (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{unmatchedError}
                </div>
              )}

              {unmatchedOpen && unmatchedResult && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg px-3 py-2 border border-white/10" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="text-white/40 mb-0.5">Total shifts in period</div>
                      <div className="text-white font-semibold">{unmatchedResult.totalShifts}</div>
                    </div>
                    <div className={`rounded-lg px-3 py-2 border ${unmatchedResult.summary.unmatchedEmployees > 0 ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
                      <div className="text-white/40 mb-0.5">Unmatched hours</div>
                      <div className={`font-semibold ${unmatchedResult.summary.unmatchedEmployees > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {unmatchedResult.summary.totalUnmatchedHours}h ({unmatchedResult.summary.unmatchedEmployees} UUID{unmatchedResult.summary.unmatchedEmployees !== 1 ? "s" : ""})
                      </div>
                    </div>
                  </div>

                  {unmatchedResult.matched.length > 0 && (
                    <div>
                      <div className="text-xs text-white/30 uppercase tracking-wide mb-1.5">Matched employees</div>
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-white/5">
                          {unmatchedResult.matched.map(e => (
                            <tr key={e.etUuid}>
                              <td className="py-1.5 text-white/70">{e.name}</td>
                              <td className="py-1.5 text-right text-white/50">{e.hoursWorked}h worked</td>
                              <td className="py-1.5 text-right text-white/30 pl-3 font-mono text-[10px]">{e.etUuid.slice(0, 8)}…</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {unmatchedResult.unmatched.length > 0 && (
                    <div>
                      <div className="text-xs text-amber-400/70 uppercase tracking-wide mb-1.5">⚠ Unmatched UUIDs (hours not imported)</div>
                      <div className="space-y-2">
                        {unmatchedResult.unmatched.map(e => (
                          <div key={e.etUuid} className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-mono text-amber-300/80 text-[10px] break-all flex-1">{e.etUuid}</span>
                              <span className="text-amber-400 font-semibold text-xs shrink-0">{e.hoursWorked}h</span>
                            </div>
                            {removeResults[e.etUuid] ? (
                              <p className={`text-[10px] mt-1.5 ${removeResults[e.etUuid]?.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                                ✓ {removeResults[e.etUuid]}
                              </p>
                            ) : (
                              <button
                                onClick={() => void handleRemoveUuid(e.etUuid)}
                                disabled={removingUuid === e.etUuid}
                                className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-400/70 hover:text-amber-300 disabled:opacity-50 transition-colors"
                              >
                                {removingUuid === e.etUuid
                                  ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Removing…</>
                                  : <><AlertTriangle className="h-2.5 w-2.5" /> Remove &amp; block from future syncs</>}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-white/25 text-[10px] mt-2">These EasyTeam employee IDs have no matching BrightBridge employee. Removing will block them from all future syncs and attempt to delete their shifts from EasyTeam.</p>
                    </div>
                  )}

                  {unmatchedResult.unmatched.length === 0 && unmatchedResult.matched.length > 0 && (
                    <p className="text-emerald-400/60 text-xs">All EasyTeam hours are accounted for — no unmatched UUIDs in this period.</p>
                  )}

                  <button onClick={() => void handleCheckUnmatched()} className="text-white/25 text-[10px] hover:text-white/50 underline underline-offset-2">
                    Refresh
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Access comparison + Token side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl bg-white border p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">Access for Managers</h3>
            <div>
              <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">You can</div>
              {CAN_DO.map(item => (
                <div key={item} className="flex items-center gap-2 py-1.5 text-sm text-gray-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />{item}
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">You cannot</div>
              {CANNOT_DO.map(item => (
                <div key={item} className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />{item}
                </div>
              ))}
            </div>
          </div>

          {tokenData ? (
            <div className="rounded-2xl overflow-hidden border" style={PANEL}>
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-white/50" />
                <span className="text-white font-semibold text-sm">Decoded JWT</span>
                <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300">Manager</span>
              </div>
              <div className="px-5 py-4 overflow-auto">
                <pre className="text-xs text-emerald-300 font-mono leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(decodeJwt(tokenData.token) ?? tokenData.decoded, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed flex items-center justify-center p-10 text-center text-muted-foreground text-sm">
              Generate a token to see the decoded JWT payload here.
            </div>
          )}
        </div>

        {/* Events */}
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-white/50" />
              <span className="text-white font-semibold text-sm">Live EasyTeam Events</span>
            </div>
            <button onClick={fetchEvents} className="text-white/40 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
          {events.length === 0 ? (
            <div className="px-6 py-10 text-center text-white/30 text-sm">No events yet. Try using the EasyTeam panel above.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {events.map((ev) => (
                <div key={ev.id} className="px-6 py-3 flex items-center gap-4 text-sm">
                  <span className="text-white/40 text-xs font-mono w-20 shrink-0">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#E8622A]/20 text-[#E8622A]">{ev.event}</span>
                  <span className="text-white/60 text-xs">{ev.employee_id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
  );
}
