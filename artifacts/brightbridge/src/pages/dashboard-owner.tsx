import React, { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Clock, CalendarDays, Calendar,
  Play, Zap, Terminal, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Building2, ShieldCheck, DollarSign,
  Settings, UserPlus, KeyRound, Eye, EyeOff, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
}

interface CompanyAccount {
  id: string; name: string; email: string; role: string;
  position?: string | null; employeeId?: string | null;
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
  const { user, company } = useAuth();
  const qc = useQueryClient();

  // ── EasyTeam launcher ─────────────────────────────────────
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError]     = useState("");
  const [tokenDecoded, setTokenDecoded] = useState<Record<string, unknown> | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState(false);
  const etLaunchedRef = useRef(false);
  const { launch } = useEasyTeamLauncher("et-owner-container", undefined, 520);

  // ── Role management ───────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName,     setCreateName]     = useState("");
  const [createEmail,    setCreateEmail]    = useState("");
  const [createRole,     setCreateRole]     = useState<"owner" | "employee">("employee");
  const [createPosition, setCreatePosition] = useState("");
  const [createLoading,  setCreateLoading]  = useState(false);
  const [createError,    setCreateError]    = useState("");
  const [createdCreds,   setCreatedCreds]   = useState<{ email: string; password: string; role: string } | null>(null);
  const [showPass, setShowPass] = useState(false);

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

      const companyLocations = COMPANY_LOCATIONS[user.companyId ?? ""] ?? [];
      const { from, to } = getCurrentWeek();
      launch(tokenData.token, {
        page: Pages.TIMESHEET,
        employees: allEmployees,
        organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
        locations: companyLocations,
        fromDate: from, toDate: to,
      });
      etLaunchedRef.current = true;
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
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

      {/* ── EasyTeam launcher ─────────────────────────────────── */}
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
            <button onClick={launchET}
              className="w-full flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed border-white/10 hover:border-white/25 transition-colors group">
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
