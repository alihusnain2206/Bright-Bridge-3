import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  User, Briefcase, Clock, DollarSign, Building2, Zap, LogOut, Play,
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

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW": [{ id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO = ["Clock in and out", "View own timesheet", "View own schedule", "Request time off"];
const CANNOT_DO = ["See other staff data", "Edit timesheets", "Manage schedules", "See company reports"];

export default function EmployeeDashboard() {
  const { user, company, location } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);

  const { launch } = useEasyTeamLauncher("emp-et-container");

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

      const myEmployees = user.employeeId ? [
        { id: user.employeeId, name: user.name, role: user.position.toLowerCase(), timeTrackingEnabled: true, wage: user.hourlyWage ?? 1500, wageType: "hourly" as const }
      ] : [];
      const myLocations = COMPANY_LOCATIONS[user.companyId ?? ""] ?? [];

      launch(data.token, {
        page: Pages.TIME_CLOCK,
        employees: myEmployees,
        organization: company ? { id: company.id, name: company.name } : { id: user.companyId ?? "", name: "" },
        locations: myLocations,
      });
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  };

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
              <h1 className="text-lg font-bold text-[#284362]">Welcome, {user?.name}!</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#16a34a" }}>Employee</span>
            </div>
            <p className="text-sm text-muted-foreground">{company?.name} — {user?.position}</p>
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
        {/* Employee info card */}
        <div className="rounded-2xl bg-white border p-5 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4">Your Details</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><User className="h-3.5 w-3.5" />Name</div>
              <div className="font-semibold text-sm text-foreground">{user?.name}</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Briefcase className="h-3.5 w-3.5" />Position</div>
              <div className="font-semibold text-sm text-foreground">{user?.position}</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 className="h-3.5 w-3.5" />Company</div>
              <div className="font-semibold text-sm text-foreground truncate">{company?.name}</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><DollarSign className="h-3.5 w-3.5" />Hourly Rate</div>
              <div className="font-semibold text-sm text-foreground">
                {user?.hourlyWage ? `$${String(user.hourlyWage).slice(0, -2) || "0"}.${String(user.hourlyWage).slice(-2)}/hr` : "$–/hr"}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Employee ID: <span className="font-mono font-semibold text-foreground">{user?.employeeId}</span>
            <span className="mx-1">·</span>
            Location: <span className="font-semibold text-foreground">{location?.address ?? "—"}</span>
          </div>
        </div>

        {/* EasyTeam Time Clock */}
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-white font-semibold text-base">Your Time Clock</h2>
              <p className="text-white/50 text-sm">Clock in and out for your shift</p>
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
          <div className="relative min-h-[480px]">
            {!tokenData && !tokenLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                <Clock className="h-10 w-10 text-white/20" />
                <p className="text-white/40 text-sm">Click "Generate Token &amp; Launch" to open your time clock.</p>
              </div>
            )}
            <div id="emp-et-container" className="w-full h-full min-h-[480px]" />
          </div>
        </div>

        {/* Access + Token */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl bg-white border p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-foreground">Your Access</h3>
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
                <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300">Employee</span>
              </div>
              <div className="px-5 py-4 overflow-auto">
                <pre className="text-xs text-emerald-300 font-mono leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(decodeJwt(tokenData.token) ?? tokenData.decoded, null, 2)}
                </pre>
                <div className="mt-3 pt-3 border-t border-white/10 text-xs text-white/50 space-y-1">
                  <div>Geolocation: <span className="text-amber-300">enabled</span></div>
                  <div>Wage: <span className="text-white/80">${user?.hourlyWage ?? 0}/hr</span></div>
                </div>
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
            <div className="px-6 py-10 text-center text-white/30 text-sm">
              No events yet. Try clocking in using the time clock above!
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
      </div>
    </div>
  );
}
