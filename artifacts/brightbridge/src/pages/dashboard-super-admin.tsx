import React, { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  Building2, Users, MapPin, Shield,
  Terminal, RefreshCw, Play, Clock, CalendarDays, Calendar,
  CheckCircle2, AlertTriangle, Scale, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const ORANGE = "#E8622A";

const PAGE_OPTIONS = [
  { value: Pages.TIME_CLOCK, label: "Time Clock", icon: Clock },
  { value: Pages.TIMESHEET, label: "Timesheets", icon: CalendarDays },
  { value: Pages.EMPLOYEE_TIMESHEET, label: "Employee Timesheet", icon: CalendarDays },
  { value: Pages.WEEKLY_SCHEDULE, label: "Schedule", icon: Calendar },
];

const ALL_EMPLOYEES = [
  { id: "ADMIN-JOANNE", name: "Joanne Indiviglio", role: "admin", timeTrackingEnabled: true, wage: 0, wageType: "hourly" as const },
  { id: "MGR-SUNSHINE-001", name: "Susan Manager", role: "manager", timeTrackingEnabled: true, wage: 2500, wageType: "hourly" as const },
  { id: "MGR-RAINBOW-001", name: "Mike Manager", role: "manager", timeTrackingEnabled: true, wage: 2500, wageType: "hourly" as const },
  { id: "EMP-SUNSHINE-001", name: "John Smith", role: "employee", timeTrackingEnabled: true, wage: 1800, wageType: "hourly" as const },
  { id: "EMP-SUNSHINE-002", name: "Mary Johnson", role: "employee", timeTrackingEnabled: true, wage: 1500, wageType: "hourly" as const },
  { id: "EMP-RAINBOW-001", name: "Tom Wilson", role: "employee", timeTrackingEnabled: true, wage: 1800, wageType: "hourly" as const },
];

const ALL_LOCATIONS = [
  { id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 },
  { id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 },
];

interface TokenData { token: string; decoded: Record<string, unknown>; role: string; exchangeWarning?: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string; data: Record<string, unknown> }

interface Company {
  id: string;
  name: string;
  type: string;
  address?: string;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [selectedPage, setSelectedPage] = useState<Pages>(Pages.TIMESHEET);
  const [launched, setLaunched] = useState(false);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [companies] = useState<Company[]>([
    { id: "ORG-SUNSHINE", name: "Sunshine Daycare Centre", type: "daycare", address: "123 Main St, Newark NJ" },
    { id: "ORG-RAINBOW", name: "Rainbow Kids Daycare", type: "daycare", address: "456 Oak Ave, Jersey City NJ" },
  ]);
  const launched$ = useRef(false);

  useEasyTeamLauncher(
    "admin-et-container",
    launched && tokenData ? tokenData.token : null,
    selectedPage,
    undefined,
    ALL_EMPLOYEES,
    { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
    ALL_LOCATIONS
  );

  useEffect(() => {
    fetchEvents();
    const iv = setInterval(fetchEvents, 10000);
    return () => clearInterval(iv);
  }, []);

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
      if (!launched$.current) { launched$.current = true; setLaunched(true); }
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  const companyStaffCounts: Record<string, number> = { "ORG-SUNSHINE": 3, "ORG-RAINBOW": 2 };

  return (
    <div className="space-y-6">

      {/* Page heading */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#284362]">Super Admin Dashboard</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#dc2626" }}>Super Admin</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Welcome, {user?.name} — full access to all companies and EasyTeam features</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/clients"><Button variant="outline" size="sm" className="gap-1.5 text-xs"><Building2 className="h-3.5 w-3.5" />Manage Clients</Button></Link>
          <Link href="/roles"><Button variant="outline" size="sm" className="gap-1.5 text-xs"><Scale className="h-3.5 w-3.5" />Role Comparison</Button></Link>
        </div>
      </div>

      {/* Status bar */}
      <div className="rounded-2xl p-5 flex flex-wrap items-center gap-4" style={PANEL}>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-white/60" />
          <span className="text-white font-semibold">Full EasyTeam Access</span>
        </div>
        <div className="flex-1 flex flex-wrap gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✓ EasyTeam Connected</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-400/20 text-blue-300 border border-blue-400/30">🧪 Sandbox Mode</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/60 border border-white/20">Org: ORG-BRIGHTBRIDGE</span>
        </div>
      </div>

      {/* Companies */}
      <div>
        <h2 className="text-lg font-bold text-[#284362] mb-3">Partner Companies</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {companies.map((co) => (
            <div key={co.id} className="rounded-2xl bg-white border p-5 space-y-3 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{co.name}</h3>
                  <p className="text-xs text-muted-foreground">Daycare Centre</p>
                </div>
                <Building2 className="h-5 w-5 text-[#E8622A]" />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />{co.address}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />{companyStaffCounts[co.id] ?? 0} staff members
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* EasyTeam section */}
      <div className="rounded-2xl overflow-hidden border" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-white font-semibold text-base">EasyTeam Full Access View</h2>
            <p className="text-white/50 text-sm">All companies · All staff · Full admin control</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {PAGE_OPTIONS.map(({ value, label }) => (
                <button key={String(value)} onClick={() => setSelectedPage(value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${selectedPage === value ? "bg-white text-[#284362]" : "text-white/60 hover:text-white hover:bg-white/10"}`}>
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={generateToken} disabled={tokenLoading} size="sm"
              className="gap-1.5 text-sm font-semibold text-white border-0"
              style={{ background: ORANGE }}>
              <Play className="h-3.5 w-3.5" />
              {tokenLoading ? "Generating…" : tokenData ? "Refresh Token" : "Generate Token & Launch"}
            </Button>
          </div>
        </div>

        {tokenError && (
          <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
            <AlertTriangle className="h-4 w-4" />{tokenError}
          </div>
        )}
        {tokenData?.exchangeWarning && (
          <div className="mx-6 mt-4 flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{tokenData.exchangeWarning}
          </div>
        )}
        {!tokenData && !tokenLoading && (
          <div className="px-6 py-16 text-center">
            <Play className="h-10 w-10 text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">Click "Generate Token & Launch" to open the EasyTeam admin panel.</p>
          </div>
        )}
        {tokenData && <div id="admin-et-container" className="min-h-[520px]" />}
      </div>

      {/* Token decode */}
      {tokenData && (
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-white/50" />
            <span className="text-white font-semibold text-sm">Decoded JWT Payload</span>
            <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-300">Role: super_admin</span>
          </div>
          <div className="px-6 py-4">
            <pre className="text-xs text-emerald-300 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(decodeJwt(tokenData.token) ?? tokenData.decoded, null, 2)}
            </pre>
            <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><div className="text-white/40">Role</div><div className="text-white font-semibold">super_admin / admin</div></div>
              <div><div className="text-white/40">Organization</div><div className="text-white font-semibold">BrightBridge</div></div>
              <div><div className="text-white/40">Algorithm</div><div className="text-white font-semibold">RS256</div></div>
              <div><div className="text-white/40">Permissions</div><div className="text-white font-semibold">9 full admin</div></div>
            </div>
          </div>
        </div>
      )}

      {/* Events log */}
      <div className="rounded-2xl overflow-hidden border" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-white/50" />
            <span className="text-white font-semibold text-sm">Live EasyTeam Events</span>
          </div>
          <button onClick={fetchEvents} className="text-white/40 hover:text-white transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {events.length === 0 ? (
          <div className="px-6 py-10 text-center text-white/30 text-sm">
            No events yet. Try using the EasyTeam panel above to clock in or manage timesheets.
          </div>
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

      <div className="flex items-center gap-4 text-xs text-muted-foreground pb-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        <span>Super Admin sees ALL companies · ALL staff timesheets · FULL EasyTeam control</span>
        <Link href="/roles" className="ml-auto text-[#284362] underline underline-offset-2 hover:no-underline">View Role Comparison →</Link>
      </div>

    </div>
  );
}
