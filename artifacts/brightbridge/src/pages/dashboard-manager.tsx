import React, { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  Building2, Users, MapPin, Play, Zap,
  Terminal, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Clock, ThumbsUp, Loader2, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const ORANGE = "#E8622A";

interface TokenData { token: string; decoded: Record<string, unknown>; role: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string }
interface TimesheetEntry {
  employeeId: string; companyId: string; periodKey: string;
  hoursWorked: number; breakDeduction: number; approvedHours: number;
  source: string; syncedAt: string; managerApproved?: boolean; approvedAt?: string;
}

function getPeriodDates() {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().split("T")[0]!,
    to: to.toISOString().split("T")[0]!,
    label: `${from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
  };
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

const COMPANY_EMPLOYEES: Record<string, Array<{ id: string; name: string; role: string; timeTrackingEnabled: boolean; wage: number; wageType: "hourly" }>> = {
  "ORG-SUNSHINE": [
    { id: "MGR-SUNSHINE-001", name: "Susan Manager", role: "manager", timeTrackingEnabled: true, wage: 2500, wageType: "hourly" },
    { id: "EMP-SUNSHINE-001", name: "John Smith", role: "employee", timeTrackingEnabled: true, wage: 1800, wageType: "hourly" },
    { id: "EMP-SUNSHINE-002", name: "Mary Johnson", role: "employee", timeTrackingEnabled: true, wage: 1500, wageType: "hourly" },
  ],
  "ORG-RAINBOW": [
    { id: "MGR-RAINBOW-001", name: "Mike Manager", role: "manager", timeTrackingEnabled: true, wage: 2500, wageType: "hourly" },
    { id: "EMP-RAINBOW-001", name: "Tom Wilson", role: "employee", timeTrackingEnabled: true, wage: 1800, wageType: "hourly" },
    { id: "EMP-RAINBOW-002", name: "Ali Husnain", role: "employee", timeTrackingEnabled: true, wage: 1800, wageType: "hourly" },
    { id: "EMP-RAINBOW-003", name: "Lisa Chen", role: "employee", timeTrackingEnabled: true, wage: 1400, wageType: "hourly" },
  ],
};

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW": [{ id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO = ["View own company timesheets", "Edit timesheets", "Manage schedules", "Approve time off", "Clock in/out"];
const CANNOT_DO = ["See other companies", "BrightBridge admin panel", "Super admin features", "View all-company reports"];

const EMPLOYEE_NAMES: Record<string, string> = {
  "EMP-SUNSHINE-001": "John Smith",
  "EMP-SUNSHINE-002": "Mary Johnson",
  "MGR-SUNSHINE-001": "Susan Manager",
  "EMP-RAINBOW-001": "Tom Wilson",
  "MGR-RAINBOW-001": "Mike Manager",
  "EMP-RAINBOW-002": "Ali Husnain",
  "EMP-RAINBOW-003": "Lisa Chen",
};

export default function ManagerDashboard() {
  const { user, company, location } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);

  // Approval state
  const [hours, setHours] = useState<TimesheetEntry[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalDone, setApprovalDone] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [approvalDataSource, setApprovalDataSource] = useState<"easyteam" | "seeded" | null>(null);

  const period = getPeriodDates();

  const companyEmployees = COMPANY_EMPLOYEES[user?.companyId ?? ""] ?? [];
  const companyLocations = COMPANY_LOCATIONS[user?.companyId ?? ""] ?? [];

  const { launch } = useEasyTeamLauncher("mgr-et-container", undefined, 700);

  const fetchHours = useCallback(async () => {
    if (!user?.companyId) return;
    setHoursLoading(true);
    try {
      const d = await fetch(
        `/api/easyteam/hours?from=${period.from}&to=${period.to}&companyId=${user.companyId}`,
        { credentials: "include" }
      ).then(r => r.json()) as { entries: TimesheetEntry[]; synced: boolean };
      setHours(d.entries ?? []);
      const alreadyApproved = (d.entries ?? []).some(e => e.managerApproved);
      if (alreadyApproved) {
        setApprovalDone(true);
        setApprovedAt((d.entries ?? []).find(e => e.approvedAt)?.approvedAt ?? null);
      }
    } catch { /* ignore */ }
    finally { setHoursLoading(false); }
  }, [user?.companyId, period.from, period.to]);

  const handleApprove = async () => {
    if (!user?.companyId) return;
    setApproving(true);
    try {
      const d = await fetch("/api/easyteam/hours/approve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: period.from, to: period.to, companyId: user.companyId }),
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
      await fetch("/api/easyteam/hours/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: period.from, to: period.to, companyId: user.companyId }),
      });
      await fetchHours();
    } catch { /* ignore */ }
    finally { setPulling(false); }
  }, [user?.companyId, period.from, period.to, fetchHours]);

  useEffect(() => {
    fetchEvents();
    const iv = setInterval(fetchEvents, 10000);
    return () => clearInterval(iv);
  }, []);

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
      const res = await fetch("/api/auth/token-by-role", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json() as TokenData;
      if (!res.ok) { setTokenError("Token generation failed"); return; }
      setTokenData(data);

      launch(data.token, {
        page: Pages.TIMESHEET,
        employees: companyEmployees,
        organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
        locations: companyLocations,
      });
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#284362]">{company?.name ?? "Manager"} Dashboard</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#d97706" }}>Manager</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">Welcome, {user?.name}</p>
      </div>
        {/* Company info */}
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
                <span className="text-white/70 font-medium">{company?.name}</span> · Pay period: <span className="text-white/70">{period.label}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
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
                <p>No hours loaded for this period yet.</p>
                <p className="text-white/20 text-xs">Use <span className="text-white/35">Pull Hours</span> or click <span className="text-white/35">Email Report</span> inside EasyTeam above.</p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/30 text-xs uppercase tracking-wide border-b border-white/10">
                      <th className="text-left pb-2 font-medium">Employee</th>
                      <th className="text-right pb-2 font-medium">Hours worked</th>
                      <th className="text-right pb-2 font-medium">Breaks</th>
                      <th className="text-right pb-2 font-medium">Approved hrs</th>
                      <th className="text-right pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {hours.map((e) => (
                      <tr key={e.employeeId}>
                        <td className="py-2.5 text-white/80">{EMPLOYEE_NAMES[e.employeeId] ?? e.employeeId}</td>
                        <td className="py-2.5 text-right text-white/60">{e.hoursWorked}h</td>
                        <td className="py-2.5 text-right text-amber-400/60">−{e.breakDeduction}h</td>
                        <td className="py-2.5 text-right text-white font-semibold">{e.approvedHours}h</td>
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
