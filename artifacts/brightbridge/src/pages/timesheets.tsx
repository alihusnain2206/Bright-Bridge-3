import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useGenerateEasyTeamToken, useListClients, useListClientEmployees } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CalendarDays, Key, Play, Activity, AlertCircle, Users, User, RefreshCw, Building2,
  ThumbsUp, Download, CheckCircle2, AlertTriangle, Loader2, Clock, Info, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { TimesheetIllustration } from "@/components/daycare-illustrations";
import { useAuth } from "@/hooks/useAuth";

const CONTAINER_ID = "easyteam-timesheets-container";
const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" } as const;
const ORANGE = "#E8622A";

type ViewMode = "all" | "employee";
interface EasyTeamEvent { type?: string; _receivedAt?: string; [key: string]: unknown; }

interface TimesheetEntry {
  employeeId: string; companyId: string; periodKey: string;
  hoursWorked: number; breakDeduction: number; approvedHours: number;
  source: string; syncedAt: string; managerApproved?: boolean; approvedAt?: string;
}

const FREQ_LABEL: Record<string, string> = {
  BiWeekly: "Bi-Weekly", Weekly: "Weekly",
  SemiMonthly: "Semi-Monthly", Monthly: "Monthly",
};

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

// Fallback coords for seeded companies when API locations haven't been fetched yet.
const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW":  [{ id: "LOC-RAINBOW",  name: "Rainbow Kids Daycare",    latitude: 40.7178, longitude: -74.0431 }],
};

interface ApiEmployee {
  id?: string; employeeId?: string; employeeDisplayId?: string;
  firstName?: string; lastName?: string; name?: string;
  position?: string; hourlyWage?: number; payType?: string;
}

export default function Timesheets() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlClientId = params.get("clientId") ?? "";
  const urlEmployeeId = params.get("employeeId") ?? "";

  const { user, company, location: authLocation } = useAuth();
  const isScoped = user?.role === "owner" || user?.role === "manager";

  // ── Super-admin state ──────────────────────────────────────────
  const [clientId, setClientId] = useState(urlClientId);
  const [employeeId, setEmployeeId] = useState(urlEmployeeId);
  const [viewMode, setViewMode] = useState<ViewMode>(urlEmployeeId ? "employee" : "all");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EasyTeamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isInitialClientChange = useRef(true);
  const autoLaunched = useRef(false);
  const scopedAutoLaunched = useRef(false);
  const etLaunchedRef = useRef(false);

  const { data: clientsData } = useListClients();
  const { data: employeesData } = useListClientEmployees(clientId);
  const generateToken = useGenerateEasyTeamToken();

  // ── Owner/Manager approval state ───────────────────────────────
  const initWeek = getCurrentWeek();
  const [fromDate, setFromDate] = useState(initWeek.from);
  const [toDate,   setToDate]   = useState(initWeek.to);
  const [payFrequency, setPayFrequency] = useState<string | null>(null);
  const [hours,         setHours]         = useState<TimesheetEntry[]>([]);
  const [hoursLoading,  setHoursLoading]  = useState(false);
  const [pulling,       setPulling]       = useState(false);
  const [approving,     setApproving]     = useState(false);
  const [approvalDone,  setApprovalDone]  = useState(false);
  const [approvedAt,    setApprovedAt]    = useState<string | null>(null);
  const [approvalDataSource, setApprovalDataSource] = useState<"easyteam" | "seeded" | null>(null);
  const [lastSyncedAt,  setLastSyncedAt]  = useState<Date | null>(null);
  const [editedHours,   setEditedHours]   = useState<Record<string, number>>({});
  const [editNotes,     setEditNotes]     = useState<Record<string, string>>({});
  const [tokenLoading,  setTokenLoading]  = useState(false);
  const [tokenError,    setTokenError]    = useState("");
  const [syncWarning,   setSyncWarning]   = useState<string | null>(null);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [payTypeMap,    setPayTypeMap]    = useState<Record<string, string>>({});

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

  const [removingUuid, setRemovingUuid] = useState<string | null>(null);
  const [removeResults, setRemoveResults] = useState<Record<string, string>>({});

  const handleRemoveUuid = useCallback(async (etUuid: string) => {
    if (!user?.companyId) return;
    setRemovingUuid(etUuid);
    try {
      const r = await fetch("/api/easyteam/debug/remove-uuid", {
        method: "POST",
        credentials: "include",
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
      // Refresh the unmatched list
      void handleCheckUnmatched();
    } catch (e) {
      setRemoveResults(prev => ({ ...prev, [etUuid]: `Error: ${String(e)}` }));
    } finally { setRemovingUuid(null); }
  }, [user?.companyId, fromDate, toDate, handleCheckUnmatched]);

  const handleEvent = useCallback((event: EasyTeamEvent) => {
    setEvents((prev) => [{ ...event, _receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  const { launch, navigateToDate } = useEasyTeamLauncher(CONTAINER_ID, handleEvent, 780);

  const employees = employeesData?.employees ?? [];
  const selectedClient = clientsData?.clients.find((c) => c.id === clientId);
  const selectedEmployee = employees.find((e) => e.id === employeeId);

  // Auto-set company for owner/manager
  useEffect(() => {
    if (isScoped && user?.companyId && !clientId) {
      setClientId(user.companyId);
    }
  }, [isScoped, user?.companyId, clientId]);

  useEffect(() => {
    if (isInitialClientChange.current) { isInitialClientChange.current = false; return; }
    setEmployeeId(""); setAccessToken(null); setError(null);
  }, [clientId]);

  // ── Pay period effect (owner/manager) ─────────────────────────
  useEffect(() => {
    if (!isScoped || !user?.companyId) return;
    void (async () => {
      try {
        const r = await fetch(`/api/companies/${encodeURIComponent(user.companyId ?? "")}/pay-period`, { credentials: "include" });
        const d = await r.json() as { from?: string; to?: string; frequency?: string };
        if (d.from && d.to) { setFromDate(d.from); setToDate(d.to); }
        if (d.frequency) setPayFrequency(d.frequency);
      } catch { /* keep default week */ }
    })();
  }, [isScoped, user?.companyId]);

  // ── Employee name + payType lookup (owner/manager) ────────────
  const fetchCompanyEmployees = useCallback(async () => {
    if (!user?.companyId) return;
    try {
      // Fetch store-based names AND DB payTypes in parallel.
      // Names come from company-members (covers seeded + wizard staff).
      // payType comes from the DB employees endpoint (the only source that has it).
      const [namesRes, empRes] = await Promise.all([
        fetch(`/api/easyteam/company-members?companyId=${encodeURIComponent(user.companyId)}`, { credentials: "include" }),
        fetch(`/api/employees?companyId=${encodeURIComponent(user.companyId)}`, { credentials: "include" }),
      ]);
      const namesData = await namesRes.json() as { names?: Record<string, string> };
      const empData   = await empRes.json()   as { employees?: ApiEmployee[] };

      // Build payType map keyed by every ID variant the employee might appear as in timesheet entries
      const ptMap: Record<string, string> = {};
      (empData.employees ?? []).forEach(e => {
        if (e.payType) {
          if (e.id)                ptMap[e.id]                = e.payType;
          if (e.employeeDisplayId) ptMap[e.employeeDisplayId] = e.payType;
        }
      });
      setPayTypeMap(ptMap);

      // Use store names if available (covers seeded staff with friendly names)
      if (namesData.names && Object.keys(namesData.names).length > 0) {
        setEmployeeNames(namesData.names);
        return;
      }
      // Fallback: build names from DB employees (wizard-created companies)
      const names: Record<string, string> = {};
      (empData.employees ?? []).forEach(e => {
        const fullName = e.name ?? [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
        if (e.id)                names[e.id]                = fullName;
        if (e.employeeDisplayId) names[e.employeeDisplayId] = fullName;
      });
      setEmployeeNames(names);
    } catch { /* silent */ }
  }, [user?.companyId]);

  useEffect(() => { if (isScoped) void fetchCompanyEmployees(); }, [isScoped, fetchCompanyEmployees]);

  // ── fetchHours ────────────────────────────────────────────────
  const fetchHours = useCallback(async () => {
    if (!user?.companyId) return;
    setHoursLoading(true);
    try {
      const r = await fetch(
        `/api/easyteam/hours?companyId=${encodeURIComponent(user.companyId)}&from=${fromDate}&to=${toDate}`,
        { credentials: "include" }
      );
      const d = await r.json() as { entries?: TimesheetEntry[] };
      setHours(d.entries ?? []);
    } finally { setHoursLoading(false); }
  }, [user?.companyId, fromDate, toDate]);


  // ── handlePullHours ───────────────────────────────────────────
  const handlePullHours = useCallback(async () => {
    if (!user?.companyId) return;
    setPulling(true); setApprovalDone(false); setApprovalDataSource(null); setSyncWarning(null);
    try {
      const r = await fetch("/api/easyteam/hours/sync", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: user.companyId, from: fromDate, to: toDate }),
      });
      const d = await r.json() as {
        success?: boolean;
        skippedUnknownEmployees?: number;
        skippedUnknownMinutes?: number;
        skippedForeignShifts?: number;
      };
      await fetchHours();
      setLastSyncedAt(new Date());
      // Surface any partial-sync exclusions as a warning toast
      const parts: string[] = [];
      if (d.skippedUnknownEmployees) {
        const hrs = Math.round(((d.skippedUnknownMinutes ?? 0) / 60) * 10) / 10;
        parts.push(`${d.skippedUnknownEmployees} employee(s) could not be matched, ${hrs}h not imported`);
      }
      if (d.skippedForeignShifts) {
        parts.push(`${d.skippedForeignShifts} shift(s) from another location were excluded`);
      }
      if (parts.length > 0) {
        setSyncWarning(`Sync complete — ${parts.join("; ")}. Contact support if this is unexpected.`);
      }
      // Auto-expand the unmatched diagnostic panel when the sync found employees it couldn't match.
      // Most managers will never click the manual "Check for unmatched hours" link,
      // so surface it automatically when there's something to act on.
      if (d.skippedUnknownEmployees && d.skippedUnknownEmployees > 0) {
        void handleCheckUnmatched();
      }
    } finally { setPulling(false); }
  }, [user?.companyId, fromDate, toDate, fetchHours]);

  // ── handleApprove ─────────────────────────────────────────────
  const handleApprove = async () => {
    if (!user?.companyId) return;
    setApproving(true);
    try {
      const overrides = hours.map(e => ({
        employeeId: e.employeeId,
        approvedHours: editedHours[e.employeeId] ?? e.approvedHours,
        note: editNotes[e.employeeId] ?? "",
      }));
      const r = await fetch("/api/easyteam/hours/approve", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: user.companyId, from: fromDate, to: toDate, overrides }),
      });
      const d = await r.json() as { approvedAt?: string; dataSource?: string };
      setApprovedAt(d.approvedAt ?? null);
      setApprovalDataSource(d.dataSource as "easyteam" | "seeded" | null ?? null);
      setApprovalDone(true);
      await fetchHours();
    } finally { setApproving(false); }
  };

  // ── Owner/Manager launch EasyTeam ─────────────────────────────
  const handleLaunchScoped = useCallback(async () => {
    if (!user) return;
    setTokenLoading(true); setTokenError(""); etLaunchedRef.current = false;
    try {
      // Fetch token, employees, and pay period in parallel so launch() always
      // receives the authoritative date range — never stale React state.
      const companyId = encodeURIComponent(user.companyId ?? "");
      const [tokenRes, empRes, ppRes] = await Promise.all([
        fetch("/api/auth/token-by-role", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        }),
        fetch(`/api/easyteam/employees?companyId=${companyId}`, { credentials: "include" }),
        fetch(`/api/companies/${companyId}/pay-period`, { credentials: "include" }),
      ]);

      const tokenData = await tokenRes.json() as { token?: string; error?: string };
      if (!tokenRes.ok || !tokenData.token) { setTokenError(tokenData.error ?? "Token generation failed"); return; }

      const empData = await empRes.json() as { employees?: Array<{ id: string; easyteamUuid?: string; name: string; role: string; wage: number; wageType: string; locationId?: string }> };
      const apiEmployees = (empData.employees ?? []).map(e => ({
        // Use easyteamUuid as the SDK id when available so EasyTeam can match shifts to rows.
        // Employees registered directly in EasyTeam have a UUID that differs from our internal ID;
        // passing our internal ID causes their hours to appear in the Total but not as a named row.
        id: e.easyteamUuid ?? e.id,
        name: e.name,
        role: e.role ?? "Staff",
        timeTrackingEnabled: true,
        wage: e.wage ?? 1500,
        wageType: "hourly" as const,
        locationId: e.locationId ?? undefined,
      }));

      // Use freshly-fetched pay period dates for the iframe URL.
      // Fall back to current state only if the API fails.
      let launchFrom = fromDate;
      let launchTo = toDate;
      try {
        const ppData = await ppRes.json() as { from?: string; to?: string; frequency?: string };
        if (ppData.from && ppData.to) {
          launchFrom = ppData.from;
          launchTo = ppData.to;
          setFromDate(ppData.from);
          setToDate(ppData.to);
        }
        if (ppData.frequency) setPayFrequency(ppData.frequency);
      } catch { /* keep default week on error */ }

      // EasyTeam SDK requires the JWT's employeeId to be present in the employees array.
      // timeTrackingEnabled: false + isVisible: false tells EasyTeam this person is a
      // reviewer, so they don't appear as a row in the timesheet view.
      const selfEntry = user.employeeId ? {
        id: user.employeeId,
        name: user.name,
        role: user.position ?? "Manager",
        timeTrackingEnabled: false,
        isVisible: false,
        wage: user.hourlyWage ?? 2500,
        wageType: "hourly" as const,
      } : null;
      const allEmployees = selfEntry && !apiEmployees.some(e => e.id === selfEntry.id)
        ? [selfEntry, ...apiEmployees]
        : apiEmployees;

      // Phase 3: fetch all active locations for this company from the API.
      // This replaces the hardcoded ALL_STATIC_LOCATIONS approach so multi-location companies
      // get per-location employee maps instead of mapping all employees to all locations.
      const companyIdEnc2 = encodeURIComponent(user.companyId ?? "");
      const locData = await fetch(`/api/locations?companyId=${companyIdEnc2}`, { credentials: "include" })
        .then(r => r.json() as Promise<{ locations?: Array<{ id: string; name: string; latitude: number | null; longitude: number | null; isActive: boolean }> }>)
        .catch(() => ({ locations: [] as Array<{ id: string; name: string; latitude: number | null; longitude: number | null; isActive: boolean }> }));

      const apiLocations2 = (locData.locations ?? [])
        .filter((l) => l.isActive)
        .map((l) => ({ id: l.id, name: l.name, latitude: l.latitude ?? 40.7357, longitude: l.longitude ?? -74.1724 }));

      // Fall back to COMPANY_LOCATIONS (seeded coords) or auth-provided location
      const companyFallbackLocs = COMPANY_LOCATIONS[user.companyId ?? ""] ?? (authLocation
        ? [{ id: authLocation.id, name: authLocation.name, latitude: authLocation.latitude, longitude: authLocation.longitude }]
        : []);
      const locations = apiLocations2.length > 0 ? apiLocations2 : companyFallbackLocs;

      if (locations.length === 0) { setTokenError("No location data available for this company"); return; }

      launch(tokenData.token, {
        page: Pages.TIMESHEET,
        employees: allEmployees,
        organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
        locations,
        fromDate: launchFrom,
        toDate: launchTo,
      });
      etLaunchedRef.current = true;
      setAccessToken(tokenData.token);
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  }, [user, launch, fromDate, toDate, authLocation]);

  // ── Super-admin launch ────────────────────────────────────────
  const handleLaunch = useCallback(async (cId = clientId, eId = employeeId, empList = employees, mode = viewMode) => {
    setError(null);
    if (!cId) return;
    const client = clientsData?.clients.find((c) => c.id === cId);
    const emp = empList.find((e) => e.id === eId) ?? empList[0];
    const page = mode === "employee" ? Pages.EMPLOYEE_TIMESHEET : Pages.TIMESHEET;
    try {
      const data = await generateToken.mutateAsync({
        data: { employee_id: eId || (empList[0]?.id ?? ""), client_id: cId, role_name: emp?.roleName, access_role: emp?.role },
      });
      if (data.success && data.token) {
        if (client) {
          launch(data.token, {
            page,
            organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
            locations: [{ id: client.locationId ?? client.id, name: client.locationName, latitude: client.latitude, longitude: client.longitude }],
            employees: empList.map((e) => ({ id: e.id, name: e.name, role: e.roleName ?? e.role, timeTrackingEnabled: true })),
          });
        }
        setAccessToken(data.token);
      } else {
        setError((data as { error?: string }).error ?? "Token generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [clientId, employeeId, employees, viewMode, clientsData, generateToken, launch]);

  useEffect(() => {
    if (urlClientId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(urlClientId, urlEmployeeId, employeesData.employees ?? []);
    }
  }, [urlClientId, urlEmployeeId, employeesData, handleLaunch]);

  useEffect(() => {
    if (isScoped && clientId && employeesData && !scopedAutoLaunched.current) {
      scopedAutoLaunched.current = true;
      void handleLaunchScoped();
    }
  }, [isScoped, clientId, employeesData, handleLaunchScoped]);

  // ── Owner / Manager view — full Timesheets & Approval panel ──
  if (isScoped) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Timesheets</h1>
          <p className="text-muted-foreground mt-1">Pull hours, review, edit if needed, and approve for payroll.</p>
        </div>

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
              <Button onClick={() => void handleLaunchScoped()} disabled={tokenLoading} size="sm"
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
          <div id={CONTAINER_ID} className={`w-full ${etLaunchedRef.current ? "border-b border-white/10" : ""}`} />

          <div className="px-6 py-5">
            {syncWarning && (
              <div className="mb-4 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-300 text-sm flex-1">{syncWarning}</p>
                <button onClick={() => setSyncWarning(null)} className="text-white/30 hover:text-white/50 text-xs shrink-0">✕</button>
              </div>
            )}
            {/* Salaried employee notice — shown whenever hours are visible (after pull and after approve) */}
            {hours.length > 0 && (() => {
              const salaried = hours.filter(e => payTypeMap[e.employeeId] === "salary");
              if (salaried.length === 0) return null;
              const names = salaried.map(e => employeeNames[e.employeeId] ?? e.employeeId);
              const nameStr = names.length === 1
                ? names[0]!
                : names.length === 2
                ? `${names[0]} and ${names[1]}`
                : `${names[0]} and ${names.length - 1} others`;
              const verb = salaried.length === 1 ? "does" : "do";
              return (
                <div className="mb-4 flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                  <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-blue-300 text-sm">
                    <span className="font-semibold">{nameStr}</span>{" "}
                    {verb} not apply for hourly-based wage — hours worked will not qualify for the payroll you submit.
                  </p>
                </div>
              );
            })()}
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
                                  : <><AlertTriangle className="h-2.5 w-2.5" /> Remove & block from future syncs</>
                                }
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
      </div>
    );
  }

  // ── Super-admin view (unchanged) ──────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Timesheets</h1>
        <p className="text-muted-foreground mt-1">View all staff timesheets or drill into an individual employee.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border p-5 space-y-4" style={PANEL}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Key className="h-4 w-4 text-[#E8622A]" />
                <span className="text-white font-semibold text-base">Configure Session</span>
              </div>
              <p className="text-white/50 text-xs">Select client, view mode and employee context.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">View Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["all", "employee"] as ViewMode[]).map((mode) => (
                  <button key={mode}
                    onClick={() => { setViewMode(mode); setAccessToken(null); }}
                    className="flex items-center justify-center gap-2 p-2 rounded-lg border text-sm font-medium transition-colors"
                    style={viewMode === mode
                      ? { background: "#E8622A", color: "white", borderColor: "#E8622A" }
                      : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", borderColor: "rgba(255,255,255,0.12)" }
                    }
                  >
                    {mode === "all" ? <Users className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    {mode === "all" ? "All Staff" : "Employee"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Daycare Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="border-white/15 text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {(clientsData?.clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">
                Employee {viewMode === "all" && <span className="text-white/35 text-[10px]">(JWT context)</span>}
              </Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={!clientId}>
                <SelectTrigger className="border-white/15 text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <SelectValue placeholder={clientId ? "Select an employee…" : "Select client first"} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} — {e.roleName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedClient && (
              <div className="p-3 rounded-lg text-xs space-y-0.5 border" style={PANEL_INNER}>
                <div className="font-semibold text-white">{selectedEmployee?.name ?? "All Employees"}</div>
                <div className="text-white/50">{selectedEmployee?.roleName ?? "Manager view"} · {selectedClient.name}</div>
              </div>
            )}

            <Button onClick={() => handleLaunch()} disabled={generateToken.isPending || !clientId}
              className="w-full bg-[#E8622A] hover:bg-[#d4571f] text-white border-0">
              {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {generateToken.isPending ? "Generating token…" : accessToken ? "Relaunch" : "Launch Timesheets"}
            </Button>

            {error && <div className="flex items-start gap-2 p-3 rounded-md text-xs text-red-300 border border-red-500/30 bg-red-900/20"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
            {accessToken && !error && (
              <div className="space-y-1">
                <div className="text-xs text-white/50 font-medium">Access Token</div>
                <div className="p-2 rounded text-xs font-mono break-all line-clamp-3 border text-white/60" style={PANEL_INNER}>{accessToken.slice(0, 80)}…</div>
              </div>
            )}
          </div>

          <div className="rounded-xl border" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <Activity className="h-4 w-4 text-[#E8622A]" />
              <span className="text-white font-semibold text-sm">SDK Events</span>
              {events.length > 0 && (
                <span className="ml-auto text-xs bg-[#E8622A] text-white px-2 py-0.5 rounded-full font-bold">{events.length}</span>
              )}
            </div>
            {events.length === 0 ? (
              <div className="px-5 py-6 text-xs text-white/35 text-center">Timesheet events will appear here.</div>
            ) : (
              <ScrollArea className="h-48">
                <div className="px-4 py-3 space-y-2">
                  {events.map((ev, i) => (
                    <div key={i} className="text-xs rounded p-2 font-mono border border-white/10" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="font-semibold text-[#E8622A] truncate">{ev.type ?? "event"}</div>
                      <div className="text-white/40 text-[10px] mt-0.5">{ev._receivedAt}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        {/* Main iframe panel */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border overflow-hidden" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <CalendarDays className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">
                {viewMode === "employee" ? "Employee Timesheet" : "All Timesheets"}
              </span>
              {selectedEmployee && viewMode === "employee" && (
                <span className="text-sm font-normal text-white/40 ml-1">— {selectedEmployee.name}</span>
              )}
            </div>
            {!accessToken && (
              <div className="py-24 flex flex-col items-center justify-center gap-4">
                <TimesheetIllustration />
                <div className="text-center text-white/50 max-w-xs px-6">
                  <p className="text-sm font-medium text-white/70">Select a client and click Launch to load timesheets.</p>
                  <p className="text-xs mt-1 text-white/35">Staff hours and attendance will appear in this panel.</p>
                </div>
              </div>
            )}
            <div id={CONTAINER_ID} className="w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
