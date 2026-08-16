import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { resolveEasyTeamOrg } from "@/lib/easyteam-org";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import {
  User, Briefcase, Clock, DollarSign, Building2, Zap, Play,
  Terminal, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const NAVY  = "#284362";
const ORANGE = "#E8622A";
const PANEL  = { background: NAVY, borderColor: "rgba(255,255,255,0.1)" } as const;

interface TokenData { token: string; decoded: Record<string, unknown>; role: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string }

function decodeJwt(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

const COMPANY_LOCATIONS: Record<string, Array<{ id: string; name: string; latitude: number; longitude: number }>> = {
  "ORG-SUNSHINE": [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }],
  "ORG-RAINBOW":  [{ id: "LOC-RAINBOW",  name: "Rainbow Kids Daycare",    latitude: 40.7178, longitude: -74.0431 }],
};

const CAN_DO    = ["Clock in and out", "View own timesheet", "View own schedule", "Request time off"];
const CANNOT_DO = ["See other staff data", "Edit timesheets", "Manage schedules", "See company reports"];

// ── Collapsible section for mobile ───────────────────────────────────────────
function Collapsible({
  title, icon: Icon, defaultOpen = false, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <Icon className="h-4 w-4 text-gray-500 shrink-0" />
        <span className="flex-1 font-semibold text-sm text-gray-800">{title}</span>
        {open
          ? <ChevronUp className="h-4 w-4 text-gray-400" />
          : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function EmployeeDashboard() {
  const { user, company, location } = useAuth();

  const [tokenData,    setTokenData]    = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError,   setTokenError]   = useState("");
  const [events,       setEvents]       = useState<WebhookEvent[]>([]);
  const [windowWidth,  setWindowWidth]  = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  const autoLaunchedRef = useRef(false);

  const isMobile      = windowWidth < 768;
  const iframeHeight  = isMobile ? 440 : 520;

  const { launch } = useEasyTeamLauncher("emp-et-container", undefined, iframeHeight);

  // Track window width
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Poll webhook events
  useEffect(() => {
    void fetchEvents();
    const iv = setInterval(() => void fetchEvents(), 10_000);
    return () => clearInterval(iv);
  }, []);

  const fetchEvents = async () => {
    try {
      const d = await fetch("/api/easyteam/webhooks", { credentials: "include" })
        .then(r => r.json()) as { events: WebhookEvent[] };
      setEvents((d.events ?? []).slice(0, 10));
    } catch { /* ignore */ }
  };

  const generateToken = useCallback(async () => {
    if (!user) return;
    setTokenLoading(true);
    setTokenError("");
    try {
      const companyId = encodeURIComponent(user.companyId ?? "");
      // Fetch token and all company locations in parallel.
      // EasyTeam confirmed: SDK surfaces must receive our own external IDs throughout.
      // We use easyteamExternalKey ?? id as the SDK location id so it matches the JWT
      // locationId (resolveEmployeeLocationId returns the same value for a given location).
      const [res, locsRes] = await Promise.all([
        fetch("/api/auth/token-by-role", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        }),
        fetch(`/api/locations?companyId=${companyId}`, { credentials: "include" }),
      ]);
      const data = await res.json() as TokenData;
      if (!res.ok) { setTokenError("Token generation failed"); return; }
      setTokenData(data);

      // Build locations list from DB — prefer it over COMPANY_LOCATIONS / authLoc so that
      // multi-location companies (wizard-created) pass ALL locations to the SDK.
      // Filtering isActive guards against deleted locations returned by the endpoint.
      type LocRow = { id: string; name: string; latitude: number | null; longitude: number | null; isActive?: boolean | null; easyteamExternalKey?: string | null };
      const locsData = locsRes.ok
        ? await locsRes.json() as { locations?: LocRow[] }
        : { locations: [] as LocRow[] };
      const activeLocs = (locsData.locations ?? []).filter(l => l.isActive !== false);

      const authLoc = location
        ? [{ id: location.id, name: location.name, latitude: location.latitude, longitude: location.longitude }]
        : [{ id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 }];
      const myLocations = activeLocs.length > 0
        ? activeLocs.map(l => ({ id: l.easyteamExternalKey ?? l.id, name: l.name, latitude: l.latitude ?? 0, longitude: l.longitude ?? 0 }))
        : (COMPANY_LOCATIONS[user.companyId ?? ""] ?? authLoc);

      // locationEtId scopes this employee to their own location's dict.
      // Without it the filter `!e.locationEtId` = true, placing them in EVERY location dict.
      // EasyTeam then picks the first match — typically the primary location — and records
      // the clock-in there, causing all secondary-location employees to show 0h.
      // Derive the external key from activeLocs so locationEtId matches locations[].id exactly.
      const myEmployees = user.employeeId ? [{
        id: user.employeeId, name: user.name, role: "employee",
        timeTrackingEnabled: true, wage: user.hourlyWage ?? 1500, wageType: "hourly" as const,
        ...(user.locationId ? {
          locationEtId: activeLocs.find(l => l.id === user.locationId)?.easyteamExternalKey ?? user.locationId,
        } : {}),
      }] : [];

      launch(data.token, {
        page: Pages.TIME_CLOCK,
        employees: myEmployees,
        organization: resolveEasyTeamOrg(user.companyId, company?.name, company?.easyteamOrgId),
        locations: myLocations,
      });
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  }, [user, launch, location]);

  // Auto-launch on mobile as soon as the user object is available
  useEffect(() => {
    if (!user || autoLaunchedRef.current) return;
    if (window.innerWidth < 768) {
      autoLaunchedRef.current = true;
      void generateToken();
    }
  }, [user, generateToken]);

  // ── Shared: Time Clock Panel ─────────────────────────────────────────────
  const timeClock = (
    <div className="rounded-2xl overflow-hidden border" style={PANEL}>
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold text-base">Your Time Clock</h2>
          <p className="text-white/50 text-xs sm:text-sm">Clock in and out for your shift</p>
        </div>
        <Button
          onClick={() => void generateToken()}
          disabled={tokenLoading}
          size="sm"
          className="gap-1.5 text-sm font-semibold text-white border-0 shrink-0"
          style={{ background: ORANGE }}
        >
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{tokenLoading ? "Generating…" : tokenData ? "Refresh Token" : "Launch Clock"}</span>
          <span className="sm:hidden">{tokenLoading ? "…" : tokenData ? "Refresh" : "Launch"}</span>
        </Button>
      </div>

      {tokenError && (
        <div className="mx-4 sm:mx-6 mt-4 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
          <AlertTriangle className="h-4 w-4 shrink-0" />{tokenError}
        </div>
      )}

      {/* Idle state */}
      {!tokenData && !tokenLoading && (
        <div className="py-14 sm:py-20 flex flex-col items-center justify-center gap-4">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <Clock className="h-9 w-9 text-white/30" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-white/70 text-sm font-medium">Ready to clock in?</p>
            <p className="text-white/35 text-xs">Tap "Launch" above to open your time clock</p>
          </div>
          {/* Large mobile-only launch CTA */}
          <button
            onClick={() => void generateToken()}
            disabled={tokenLoading}
            className="mt-2 px-8 py-3.5 rounded-xl text-white font-bold text-base active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: ORANGE, boxShadow: "0 4px 20px rgba(232,98,42,0.4)" }}
          >
            {tokenLoading ? "Opening…" : "Clock In / Out"}
          </button>
        </div>
      )}

      {tokenLoading && !tokenData && (
        <div className="py-14 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-8 w-8 text-white/30 animate-spin" />
          <p className="text-white/40 text-sm">Connecting to time clock…</p>
        </div>
      )}

      <div id="emp-et-container" className="w-full" />
    </div>
  );

  // ── Employee details ──────────────────────────────────────────────────────
  const detailsContent = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: User,      label: "Name",     value: user?.name },
          { icon: Briefcase, label: "Position", value: user?.position },
          { icon: Building2, label: "Company",  value: company?.name },
          { icon: DollarSign, label: "Hourly Rate", value: user?.hourlyWage != null
            ? `$${(user.hourlyWage / 100).toFixed(2)}/hr`
            : "$–/hr" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="h-3 w-3" />{label}
            </div>
            <div className="font-semibold text-sm text-gray-900 truncate">{value}</div>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          <span className="font-mono font-semibold text-gray-900">{user?.employeeId}</span>
        </span>
        {location?.address && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            <span className="text-gray-700">{location.address}</span>
          </span>
        )}
      </div>
    </div>
  );

  // ── Access section ────────────────────────────────────────────────────────
  const accessContent = (
    <div className="space-y-3">
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
  );

  // ── Events section ────────────────────────────────────────────────────────
  const eventsContent = (
    <div>
      {events.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No events yet. Try clocking in above!</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {events.map(ev => (
            <div key={ev.id} className="py-2.5 flex items-center gap-3 text-sm">
              <span className="text-gray-400 text-xs font-mono w-16 shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-[#E8622A]/10 text-[#E8622A]">
                {ev.event}
              </span>
              <span className="text-gray-500 text-xs truncate">{ev.employee_id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── MOBILE LAYOUT ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="space-y-4 -mx-3 -mt-4 px-3 pt-3 pb-6">

        {/* Greeting strip */}
        <div className="px-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold" style={{ color: NAVY }}>
              Hey, {user?.name?.split(" ")[0]}! 👋
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#16a34a" }}>
              Employee
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user?.position && <span>{user.position}</span>}
            {user?.position && company?.name && <span className="mx-1">·</span>}
            {company?.name && <span>{company.name}</span>}
          </p>
        </div>

        {/* ── Time Clock — primary section, full bleed ── */}
        <div className="-mx-3">{/* bleed to screen edges */}
          <div className="overflow-hidden" style={PANEL}>
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-white font-semibold text-sm">Your Time Clock</h2>
                <p className="text-white/50 text-xs">Clock in and out for your shift</p>
              </div>
              <button
                onClick={() => void generateToken()}
                disabled={tokenLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: ORANGE }}
              >
                <RefreshCw className={`h-3 w-3 ${tokenLoading ? "animate-spin" : ""}`} />
                {tokenData ? "Refresh" : "Refresh Token"}
              </button>
            </div>

            {tokenError && (
              <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-red-300 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{tokenError}
              </div>
            )}

            {/* Idle / loading state */}
            {!tokenData && (
              <div className="py-12 flex flex-col items-center justify-center gap-4 px-4">
                {tokenLoading ? (
                  <>
                    <RefreshCw className="h-10 w-10 text-white/30 animate-spin" />
                    <p className="text-white/50 text-sm">Opening time clock…</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <Clock className="h-8 w-8 text-white/30" />
                    </div>
                    <button
                      onClick={() => void generateToken()}
                      className="w-full max-w-xs py-4 rounded-2xl text-white font-bold text-lg active:scale-95 transition-transform"
                      style={{ background: ORANGE, boxShadow: "0 6px 24px rgba(232,98,42,0.45)" }}
                    >
                      Clock In / Out
                    </button>
                    <p className="text-white/30 text-xs text-center">Tap above to open your time clock</p>
                  </>
                )}
              </div>
            )}

            {/* EasyTeam iframe */}
            <div id="emp-et-container" className="w-full" />
          </div>
        </div>

        {/* Secondary sections — collapsible */}
        <Collapsible title="Your Details" icon={User}>
          {detailsContent}
        </Collapsible>

      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Welcome, {user?.name}!</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#16a34a" }}>Employee</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{company?.name} — {user?.position}</p>
      </div>

      {/* Employee details card */}
      <div className="rounded-2xl bg-white border p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Your Details</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: User,      label: "Name",     value: user?.name },
            { icon: Briefcase, label: "Position", value: user?.position },
            { icon: Building2, label: "Company",  value: company?.name },
            { icon: DollarSign, label: "Hourly Rate", value: user?.hourlyWage != null
              ? `$${(user.hourlyWage / 100).toFixed(2)}/hr`
              : "$–/hr" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
              <div className="font-semibold text-sm text-gray-900 truncate">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />Employee ID: <span className="font-mono font-semibold text-gray-900">{user?.employeeId}</span>
          <span className="mx-1">·</span>
          Location: <span className="font-semibold text-gray-900">{location?.address ?? "—"}</span>
        </div>
      </div>

      {/* Time Clock */}
      {timeClock}

      {/* Token */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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

    </div>
  );
}
