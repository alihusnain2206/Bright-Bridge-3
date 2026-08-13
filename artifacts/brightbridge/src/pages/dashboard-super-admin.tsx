import React, { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { resolveEasyTeamOrg } from "@/lib/easyteam-org";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Building2, Users, MapPin, Shield,
  Terminal, RefreshCw, Play, Clock, CalendarDays, Calendar,
  CheckCircle2, AlertTriangle, Scale, Zap, UserPlus, X, Loader2,
  ShieldCheck, Copy, Eye, EyeOff, Upload, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const ORANGE = "#E8622A";

const PAGE_OPTIONS = [
  { value: Pages.TIME_CLOCK, label: "Time Clock", icon: Clock },
  { value: Pages.TIMESHEET, label: "Timesheets", icon: CalendarDays },
  { value: Pages.EMPLOYEE_TIMESHEET, label: "Employee Timesheet", icon: CalendarDays },
  { value: Pages.WEEKLY_SCHEDULE, label: "Schedule", icon: Calendar },
];

const ALL_LOCATIONS = [
  { id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", latitude: 40.7357, longitude: -74.1724 },
  { id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", latitude: 40.7178, longitude: -74.0431 },
];


interface TokenData { token: string; decoded: Record<string, unknown>; role: string }
interface WebhookEvent { id: string; event: string; employee_id: string; timestamp: string; data: Record<string, unknown> }
interface EasyTeamEmployee { id: string; name: string; role: string; companyId: string; timeTrackingEnabled: boolean; wage: number; wageType: "hourly"; status?: string; }
interface Company { id: string; name: string; locationName?: string | null; address1?: string | null; city?: string | null; state?: string | null; status: string }
interface CreatedManager { id: string; name: string; email: string; companyId: string; role: string; password: string; loginEmail: string; position: string }

function decodeJwt(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

// ── Stale Form 8655 Uploads Panel ─────────────────────────────

interface StaleUpload {
  companyId:         string;
  companyName:       string;
  signerName:        string;
  uploadAttemptedAt: string | null;
  staleForMs:        number;
}

interface StaleUploadsResp {
  staleUploads: StaleUpload[];
  thresholdMs:  number;
}

function formatStaleDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function StaleUploadsPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<StaleUploadsResp>({
    queryKey: ["admin", "stale-8655-uploads"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stale-8655-uploads", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<StaleUploadsResp>;
    },
    refetchInterval: 60_000, // refresh every minute
  });

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryResults, setRetryResults] = useState<Record<string, "ok" | "error">>({});

  const handleRetry = async (companyId: string) => {
    setRetryingId(companyId);
    try {
      const res = await fetch(`/api/rollfi/companies/${companyId}/retry-8655-upload`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRetryResults(prev => ({ ...prev, [companyId]: "ok" }));
      // Refetch after a short delay so the row may have cleared
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["admin", "stale-8655-uploads"] });
      }, 3000);
    } catch {
      setRetryResults(prev => ({ ...prev, [companyId]: "error" }));
    } finally {
      setRetryingId(null);
    }
  };

  const staleUploads = data?.staleUploads ?? [];

  return (
    <div className="rounded-2xl border border-red-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-4 w-4 text-red-500" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-sm">Stuck Form 8655 Uploads</h2>
            <p className="text-[11px] text-gray-500">
              {isLoading ? "Loading…" : `${staleUploads.length} compan${staleUploads.length === 1 ? "y" : "ies"} with pending uploads older than ${data ? Math.round(data.thresholdMs / 60_000) : 15} minutes`}
            </p>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="text-gray-400 hover:text-gray-700 transition-colors p-1.5 rounded hover:bg-red-100"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Body */}
      {isError && (
        <div className="px-5 py-4 text-sm text-red-600 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load stale uploads. Check your connection and try refreshing.
        </div>
      )}

      {!isLoading && !isError && staleUploads.length === 0 && (
        <div className="px-5 py-8 flex flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-sm font-medium text-gray-700">All clear</p>
          <p className="text-xs text-gray-400">No stuck Form 8655 uploads at this time.</p>
        </div>
      )}

      {staleUploads.length > 0 && (
        <div className="divide-y divide-gray-100">
          {staleUploads.map((row) => {
            const retryResult = retryResults[row.companyId];
            const isRetrying  = retryingId === row.companyId;
            return (
              <div key={row.companyId} className="px-5 py-3.5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{row.companyName}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Signed by <span className="text-gray-600">{row.signerName}</span>
                    {row.uploadAttemptedAt && (
                      <> · attempted {new Date(row.uploadAttemptedAt).toLocaleString()}</>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  Stuck {formatStaleDuration(row.staleForMs)}
                </span>
                {retryResult === "ok" ? (
                  <span className="shrink-0 text-[11px] text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />Retried
                  </span>
                ) : retryResult === "error" ? (
                  <span className="shrink-0 text-[11px] text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />Failed
                  </span>
                ) : (
                  <Button
                    size="sm"
                    disabled={isRetrying}
                    onClick={() => void handleRetry(row.companyId)}
                    className="shrink-0 h-7 px-3 text-xs text-white gap-1.5 bg-red-600 hover:bg-red-700 border-0"
                  >
                    {isRetrying
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Upload className="w-3 h-3" />}
                    Retry
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Create Manager Modal ──────────────────────────────────────

interface CreateManagerModalProps {
  companies: Company[];
  onClose: () => void;
  onSuccess: () => void;
}

function CreateManagerModal({ companies, onClose, onSuccess }: CreateManagerModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [position, setPosition] = useState("Daycare Manager");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedManager | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<"email" | "password" | null>(null);

  const companiesWithId = companies;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !companyId) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/create-manager", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, companyId, position }),
      });
      const data = await res.json() as CreatedManager & { error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to create manager"); return; }
      setCreated(data);
      onSuccess();
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  const copyToClipboard = async (value: string, field: "email" | "password") => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#284362" }}>
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-[#284362] text-base">Create Manager</h2>
              <p className="text-xs text-muted-foreground">Grant manager access to a daycare center</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-gray-900 transition-colors rounded-lg p-1 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {created ? (
          <div className="px-6 py-6 space-y-4">
            <div className="text-center space-y-1">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-semibold text-gray-900 mt-2">{created.name} — Manager Created!</p>
              <p className="text-sm text-muted-foreground">{created.position} · {companies.find((c) => c.id === created.companyId)?.name ?? created.companyId}</p>
            </div>

            <div className="rounded-xl border border-[#284362]/20 bg-[#284362]/5 px-4 py-3 space-y-3">
              <p className="text-xs font-semibold text-[#284362] uppercase tracking-wide">Login Credentials</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Email</p>
                    <p className="text-sm font-mono font-semibold text-gray-800">{created.loginEmail}</p>
                  </div>
                  <button onClick={() => copyToClipboard(created.loginEmail, "email")} className="p-1.5 rounded hover:bg-[#284362]/10 text-[#284362]/60 hover:text-[#284362] transition-colors">
                    {copied === "email" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Password</p>
                    <p className="text-sm font-mono font-semibold text-gray-800">{showPassword ? created.password : "••••••••••"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowPassword((v) => !v)} className="p-1.5 rounded hover:bg-[#284362]/10 text-[#284362]/60 hover:text-[#284362] transition-colors">
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => copyToClipboard(created.password, "password")} className="p-1.5 rounded hover:bg-[#284362]/10 text-[#284362]/60 hover:text-[#284362] transition-colors">
                      {copied === "password" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#284362]/60 border-t border-[#284362]/10 pt-2">Share these credentials with the manager. They will land on the Manager Dashboard when they log in.</p>
            </div>

            <Button onClick={onClose} className="w-full text-white border-0" style={{ background: ORANGE }}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Full Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Email *</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@daycare.com" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Daycare Center *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a daycare center" />
                </SelectTrigger>
                <SelectContent>
                  {companiesWithId.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Position Title</Label>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Daycare Manager" />
              <p className="text-[11px] text-muted-foreground">Defaults to "Daycare Manager" if left unchanged</p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">This creates a <strong>manager-level</strong> login — they'll see the Manager Dashboard with time approvals and staff oversight for their center only.</p>
            </div>

            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={!name || !email || !companyId || submitting} className="flex-1 text-white border-0" style={{ background: ORANGE }}>
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Creating…</> : <><ShieldCheck className="h-4 w-4 mr-1.5" />Create Manager</>}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [selectedPage, setSelectedPage] = useState<Pages>(Pages.TIMESHEET);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [allEmployees, setAllEmployees] = useState<EasyTeamEmployee[]>([]);
  const [dbCompanies, setDbCompanies] = useState<Company[]>([]);
  const [creatingManager, setCreatingManager] = useState(false);

  const { launch } = useEasyTeamLauncher("admin-et-container", undefined, 700);

  const fetchEmployees = useCallback(async () => {
    const d = await fetch("/api/easyteam/employees", { credentials: "include" }).then(r => r.json()) as { employees: EasyTeamEmployee[] };
    setAllEmployees(d.employees ?? []);
    return d.employees ?? [];
  }, []);

  const fetchCompanies = useCallback(async () => {
    const d = await fetch("/api/companies", { credentials: "include" }).then(r => r.json()) as { companies: Company[] };
    setDbCompanies(d.companies ?? []);
  }, []);

  useEffect(() => {
    void fetchEmployees();
    void fetchCompanies();
    fetchEvents();
    const iv = setInterval(fetchEvents, 10000);
    return () => clearInterval(iv);
  }, [fetchEmployees, fetchCompanies]);

  const fetchEvents = async () => {
    try {
      const d = await fetch("/api/easyteam/webhooks", { credentials: "include" }).then(r => r.json()) as { events: WebhookEvent[] };
      setEvents((d.events ?? []).slice(0, 10));
    } catch { /* ignore */ }
  };

  const handlePageChange = (newPage: Pages) => {
    setSelectedPage(newPage);
    if (tokenData) {
      const org = resolveEasyTeamOrg(user?.companyId, dbCompanies.find(c => c.id === user?.companyId)?.name);
      launch(tokenData.token, { page: newPage, employees: allEmployees, organization: org, locations: ALL_LOCATIONS });
    }
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
      const org = resolveEasyTeamOrg(user?.companyId, dbCompanies.find(c => c.id === user?.companyId)?.name);
      launch(data.token, { page: selectedPage, employees: allEmployees, organization: org, locations: ALL_LOCATIONS });
    } catch { setTokenError("Network error"); }
    finally { setTokenLoading(false); }
  };

  const staffCountForCompany = (companyId: string) =>
    allEmployees.filter((e) => e.companyId === companyId).length;

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
          <Button
            onClick={() => setCreatingManager(true)}
            size="sm"
            className="gap-1.5 text-xs text-white border-0"
            style={{ background: "#284362" }}
          >
            <ShieldCheck className="h-3.5 w-3.5" />Create Manager
          </Button>
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
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/60 border border-white/20">Org: ORG-BRIGHTBRIDGE</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/60 border border-white/20">{allEmployees.length} total staff</span>
        </div>
      </div>

      {/* Partner Companies */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-[#284362]">Partner Companies</h2>
          <button
            onClick={() => setCreatingManager(true)}
            className="text-xs text-[#284362] hover:underline flex items-center gap-1 font-medium"
          >
            <ShieldCheck className="h-3.5 w-3.5" />Add manager to a center
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {dbCompanies.map((company) => (
            <div key={company.id} className="rounded-2xl bg-white border p-5 space-y-3 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{company.name}</h3>
                  <p className="text-xs text-muted-foreground">Daycare Centre</p>
                </div>
                <Building2 className="h-5 w-5 text-[#E8622A]" />
              </div>
              {(company.address1 || company.city) && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />{[company.address1, company.city, company.state].filter(Boolean).join(", ")}
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />{staffCountForCompany(company.id)} staff members
                </div>
                <Link href={`/clients/${company.id}/employees/new`}>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 text-white border-0"
                    style={{ background: ORANGE }}
                  >
                    <UserPlus className="h-3 w-3" />Add Employee
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stale 8655 Uploads */}
      <StaleUploadsPanel />

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
                <button key={String(value)} onClick={() => handlePageChange(value)}
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
        {!tokenData && !tokenLoading && (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Play className="h-10 w-10 text-white/20" />
            <p className="text-white/40 text-sm">Click "Generate Token &amp; Launch" to open the EasyTeam admin panel.</p>
          </div>
        )}
        <div id="admin-et-container" className="w-full" />
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

      {/* Create Manager Modal */}
      {creatingManager && (
        <CreateManagerModal
          companies={dbCompanies}
          onClose={() => setCreatingManager(false)}
          onSuccess={() => { /* manager created, modal stays open to show credentials */ }}
        />
      )}
    </div>
  );
}
