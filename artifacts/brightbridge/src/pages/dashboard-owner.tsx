import React, { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  Users, Clock, CalendarDays, Calendar,
  Play, Zap, Terminal, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Building2, ShieldCheck, DollarSign,
  Webhook, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const OWNER_COLOR = "#7c3aed";

interface EasyTeamEmployee {
  id: string; name: string; role?: string;
  timeTrackingEnabled?: boolean; isVisible?: boolean;
  wage?: number; wageType?: "hourly";
}

interface ApiEmployee {
  employeeId: string; firstName: string; lastName: string;
  position?: string; hourlyWage?: number; status?: string;
  easyTeamEmployeeId?: string;
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

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW":  [{ id: "LOC-RAINBOW",  name: "Rainbow Kids Daycare",    latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO = [
  "Full People hub (hire, onboard, terminate)",
  "Timesheets & schedules for your company",
  "Payroll (company-scoped)",
  "Compliance & documents",
  "Webhooks & config",
  "EasyTeam time tracking",
];
const CANNOT_DO = [
  "Switch to other companies",
  "BrightBridge platform admin",
  "Global payroll reports",
];

export default function OwnerDashboard() {
  const { user, company } = useAuth();
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError]     = useState("");
  const [tokenDecoded, setTokenDecoded] = useState<Record<string, unknown> | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState(false);
  const etLaunchedRef = useRef(false);

  const { launch } = useEasyTeamLauncher("et-owner-container", undefined, 520);

  const launchET = useCallback(async () => {
    if (!user) return;
    setTokenLoading(true);
    setTokenError("");
    setExchangeWarning(false);
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
      if (!tokenRes.ok || !tokenData.token) {
        setTokenError(tokenData.error ?? "Token generation failed");
        return;
      }
      if (tokenData.exchangeWarning) setExchangeWarning(true);
      if (tokenData.decoded) setTokenDecoded(tokenData.decoded);

      const empRes = await fetch(
        `/api/employees?companyId=${encodeURIComponent(user.companyId ?? "")}`,
        { credentials: "include" },
      );
      const empData = await empRes.json() as { employees?: ApiEmployee[] };
      const apiEmployees: EasyTeamEmployee[] = (empData.employees ?? []).map((e) => ({
        id: e.employeeId,
        name: [e.firstName, e.lastName].join(" ").trim(),
        role: e.position ?? "Staff",
        timeTrackingEnabled: true,
        wage: (e.hourlyWage ?? 1500),
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
        ? [ownerSelf, ...apiEmployees]
        : apiEmployees;

      const companyLocations = COMPANY_LOCATIONS[user.companyId ?? ""] ?? [];
      const { from, to } = getCurrentWeek();

      launch(tokenData.token, {
        page: Pages.TIMESHEET,
        employees: allEmployees,
        organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
        locations: companyLocations,
        fromDate: from,
        toDate: to,
      });
      etLaunchedRef.current = true;
    } catch {
      setTokenError("Network error");
    } finally {
      setTokenLoading(false);
    }
  }, [user, launch]);

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
          { icon: <Users className="h-5 w-5" />,      label: "People",      href: "/people" },
          { icon: <Clock className="h-5 w-5" />,       label: "Time Clock",  href: "/timeclock" },
          { icon: <CalendarDays className="h-5 w-5" />,label: "Timesheets",  href: "/timesheets" },
          { icon: <Calendar className="h-5 w-5" />,    label: "Schedule",    href: "/schedule" },
          { icon: <DollarSign className="h-5 w-5" />,  label: "Payroll",     href: "/manager-payroll" },
          { icon: <ShieldCheck className="h-5 w-5" />, label: "Compliance",  href: "/people/compliance" },
          { icon: <Settings className="h-5 w-5" />,    label: "Config",      href: "/config" },
        ].map(({ icon, label, href }) => (
          <Link key={label} href={href}>
            <button className="w-full flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 bg-white hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/5 transition-colors group">
              <span className="text-gray-400 group-hover:text-[#7c3aed] transition-colors">{icon}</span>
              <span className="text-[11px] font-medium text-gray-600 group-hover:text-[#7c3aed]">{label}</span>
            </button>
          </Link>
        ))}
      </div>

      {/* EasyTeam launcher panel */}
      <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" style={{ color: OWNER_COLOR }} />
            <h2 className="text-white font-semibold text-sm">EasyTeam — Company View</h2>
            <span className="text-white/40 text-xs">(scoped to your location)</span>
          </div>
          <Button size="sm" variant="ghost"
            className="text-white/60 hover:text-white hover:bg-white/10 h-7 px-2 gap-1.5"
            onClick={launchET} disabled={tokenLoading}>
            {tokenLoading
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
              : <><Play className="h-3.5 w-3.5" /> Launch</>}
          </Button>
        </div>

        <div className="p-6">
          {!etLaunchedRef.current && !tokenLoading && !tokenError && (
            <button
              onClick={launchET}
              className="w-full flex flex-col items-center justify-center gap-3 py-12 rounded-xl border-2 border-dashed border-white/10 hover:border-white/25 transition-colors group">
              <Play className="h-8 w-8 text-white/20 group-hover:text-[#7c3aed] transition-colors" />
              <span className="text-white/40 text-sm">Click to load EasyTeam for your company</span>
            </button>
          )}

          {tokenLoading && (
            <div className="flex items-center gap-2 text-white/60 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading EasyTeam…
            </div>
          )}

          {tokenError && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-2">
              <XCircle className="h-4 w-4 shrink-0" /> {tokenError}
            </div>
          )}

          {exchangeWarning && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-4"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#fbbf24" }}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Token exchange failed — using raw RS256 JWT. EasyTeam functionality may be limited.
            </div>
          )}

          <div id="et-owner-container" className="rounded-xl overflow-hidden" />

          {tokenDecoded && (
            <details className="mt-4">
              <summary className="flex items-center gap-2 cursor-pointer text-white/30 text-xs font-mono hover:text-white/50">
                <Terminal className="h-3.5 w-3.5" /> JWT payload
              </summary>
              <div className="mt-2 rounded-lg overflow-hidden border border-white/5 bg-black/20 px-4 py-3 font-mono text-xs text-emerald-300/80">
                <pre className="whitespace-pre-wrap break-all">{JSON.stringify(tokenDecoded, null, 2)}</pre>
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Access summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border overflow-hidden shadow-sm" style={PANEL}>
          <div className="px-5 py-4 border-b border-white/10">
            <h3 className="text-white font-semibold text-sm">What you can do</h3>
          </div>
          <ul className="p-5 space-y-2.5">
            {CAN_DO.map(item => (
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
            {CANNOT_DO.map(item => (
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
