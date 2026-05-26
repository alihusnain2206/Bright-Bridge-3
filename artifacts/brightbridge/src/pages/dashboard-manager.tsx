import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  Building2, Users, MapPin, Zap, LogOut, Play,
  Terminal, RefreshCw, CheckCircle2, XCircle, Scale, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const ORANGE = "#E8622A";

interface TokenData { token: string; decoded: Record<string, unknown>; role: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string }

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
  ],
};

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW": [{ id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO = ["View own company timesheets", "Edit timesheets", "Manage schedules", "Approve time off", "Clock in/out"];
const CANNOT_DO = ["See other companies", "BrightBridge admin panel", "Super admin features", "View all-company reports"];

export default function ManagerDashboard() {
  const { user, company, location, logout } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);

  const companyEmployees = COMPANY_EMPLOYEES[user?.companyId ?? ""] ?? [];
  const companyLocations = COMPANY_LOCATIONS[user?.companyId ?? ""] ?? [];

  const { launch } = useEasyTeamLauncher("mgr-et-container");

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

      launch(data.token, {
        page: Pages.TIMESHEET,
        employees: companyEmployees,
        organization: company ? { id: company.id, name: company.name } : { id: user.companyId ?? "", name: "" },
        locations: companyLocations,
      });
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  const handleLogout = async () => { await logout(); window.location.href = "/login"; };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold text-white"
        style={{ background: "linear-gradient(90deg, #284362 0%, #325278 100%)" }}>
        <Zap className="h-3.5 w-3.5 opacity-70" /><span className="opacity-80">SANDBOX</span>
        <span className="opacity-40 mx-1">·</span><span className="opacity-70 font-normal">TEST ENVIRONMENT</span>
      </div>

      <header className="bg-white border-b px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-9 object-contain" />
          <div className="w-px h-8 bg-gray-100" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-[#284362]">{company?.name ?? "Manager"} Dashboard</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#d97706" }}>Manager</span>
            </div>
            <p className="text-sm text-muted-foreground">Welcome, {user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/roles"><Button variant="outline" size="sm" className="gap-1.5 text-xs"><Scale className="h-3.5 w-3.5" />Roles</Button></Link>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs text-red-500 hover:bg-red-50 gap-1.5">
            <LogOut className="h-3.5 w-3.5" />Logout
          </Button>
        </div>
      </header>

      <div className="px-6 py-6 max-w-6xl mx-auto space-y-6">
        {/* Company info */}
        <div className="rounded-2xl bg-white border p-5 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg text-foreground">{company?.name}</h2>
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

        {/* EasyTeam section */}
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-white font-semibold text-base">EasyTeam Manager View</h2>
              <p className="text-white/50 text-sm">You can see only <span className="text-white/80 font-semibold">{company?.name}</span> staff</p>
            </div>
            <Button onClick={generateToken} disabled={tokenLoading} size="sm"
              className="gap-1.5 text-sm font-semibold text-white border-0" style={{ background: ORANGE }}>
              <Play className="h-3.5 w-3.5" />
              {tokenLoading ? "Generating…" : tokenData ? "Refresh Token" : "Generate Token & Launch"}
            </Button>
          </div>

          {tokenError && (
            <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
              <AlertTriangle className="h-4 w-4" />{tokenError}
            </div>
          )}
          {!tokenData && !tokenLoading && (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <Play className="h-10 w-10 text-white/20" />
              <p className="text-white/40 text-sm">Click "Generate Token &amp; Launch" to open your manager panel.</p>
            </div>
          )}
          <div id="mgr-et-container" className="w-full" />
        </div>

        {/* Access comparison + Token side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl bg-white border p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground">Access for Managers</h3>
            <div>
              <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">You can</div>
              {CAN_DO.map(item => (
                <div key={item} className="flex items-center gap-2 py-1.5 text-sm text-foreground">
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
    </div>
  );
}
