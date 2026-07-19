import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, ChevronLeft, Building2, CheckCircle2,
  Clock, AlertTriangle, Users, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Employee {
  id: string; firstName: string; lastName: string;
  department?: string | null; status: string; companyId: string;
  complianceScore?: number | null;
}
interface Company { id: string; name: string; }
interface ComplianceCategory {
  category: string; total: number; completed: number; percentage: number;
}
interface ComplianceItem {
  id: string; type: string; name: string; status: string;
  isRequired: boolean; expiryDate?: string | null; completedAt?: string | null;
}

const CAT_LABELS: Record<string, string> = {
  i9: "I-9 Verification", w4: "W-4 Forms", direct_deposit: "Direct Deposit",
  background_check: "Background Checks", handbook: "Handbook", policy: "Policy",
  fingerprint: "Fingerprint Clearance", certification: "Certifications", training: "Training",
};
const CAT_COLORS: Record<string, string> = {
  i9: "#3B82F6", w4: "#8B5CF6", direct_deposit: "#10B981",
  background_check: "#F59E0B", handbook: "#EC4899", policy: "#6366F1",
  fingerprint: "#14B8A6", certification: "#E8622A", training: "#0EA5C9",
};

function scoreColor(s: number) {
  if (s >= 90) return "#10b981";
  if (s >= 70) return "#0ea5c9";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}

function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}
const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Company Compliance Summary ─────────────────────────────────
function ComplianceSummary({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<{
    overview: ComplianceCategory[]; overallScore: number; totalItems: number; completedItems: number;
  }>({
    queryKey: ["compliance-overview", companyId],
    queryFn: () => fetch(`/api/compliance/company-overview?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ overview: ComplianceCategory[]; overallScore: number; totalItems: number; completedItems: number }>),
    enabled: !!companyId, staleTime: 60_000,
  });

  const score = data?.overallScore ?? 0;
  const color = scoreColor(score);
  const r = 40; const circ = 2 * Math.PI * r;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Company Compliance Overview</h2>
      {isLoading ? (
        <div className="flex gap-6"><Skeleton className="w-24 h-24 rounded-full" /><div className="flex-1 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div></div>
      ) : (
        <div className="flex gap-6 items-start">
          {/* Ring */}
          <div className="shrink-0 text-center">
            <div className="relative w-24 h-24">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
                  strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.6s ease" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold leading-none" style={{ color }}>{score}%</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1 font-medium">
              {score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "At Risk"}
            </p>
            <p className="text-[11px] text-gray-400">{data?.completedItems ?? 0}/{data?.totalItems ?? 0} required</p>
          </div>
          {/* Category breakdown */}
          <div className="flex-1 grid grid-cols-1 gap-2.5">
            {(data?.overview ?? []).map(c => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLORS[c.category] ?? "#9CA3AF" }} />
                <span className="text-xs text-gray-600 w-36 shrink-0">{CAT_LABELS[c.category] ?? c.category}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${c.percentage}%`, background: scoreColor(c.percentage) }}
                  />
                </div>
                <span className="text-xs font-semibold shrink-0 w-10 text-right" style={{ color: scoreColor(c.percentage) }}>
                  {c.percentage}%
                </span>
                <span className="text-xs text-gray-400 shrink-0 w-14 text-right">
                  {c.completed}/{c.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee Compliance Card ───────────────────────────────────
function EmployeeComplianceCard({ emp }: { emp: Employee }) {
  const { data, isLoading } = useQuery<{ items: ComplianceItem[]; score: number }>({
    queryKey: ["compliance", emp.id],
    queryFn: () => fetch(`/api/compliance?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ items: ComplianceItem[]; score: number }>),
    staleTime: 60_000,
  });

  const score = emp.complianceScore ?? data?.score ?? 0;
  const color = scoreColor(score);
  const items = data?.items ?? [];
  const incomplete = items.filter(i => i.status !== "completed" && i.status !== "waived");
  const color2 = avatarColor(`${emp.firstName} ${emp.lastName}`);

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const expiring = items.filter(i => i.expiryDate && new Date(i.expiryDate) <= in30 && new Date(i.expiryDate) >= now);
  const expired = items.filter(i => i.expiryDate && new Date(i.expiryDate) < now && i.status === "completed");

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-4">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-semibold"
        style={{ background: color2 }}>
        {initials(emp.firstName, emp.lastName)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-900">{emp.firstName} {emp.lastName}</p>
          <span className="text-xs text-gray-400">{emp.department ?? "Unassigned"}</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-4 w-48 mt-1.5" />
        ) : (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {incomplete.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
                {incomplete.length} incomplete
              </span>
            )}
            {expiring.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium">
                {expiring.length} expiring soon
              </span>
            )}
            {expired.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                {expired.length} expired
              </span>
            )}
            {incomplete.length === 0 && expiring.length === 0 && expired.length === 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                All clear
              </span>
            )}
          </div>
        )}
      </div>

      {/* Score ring */}
      <div className="shrink-0 flex items-center gap-3">
        <div className="relative w-10 h-10">
          <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
            <circle cx="22" cy="22" r="17" fill="none" stroke="#f3f4f6" strokeWidth="5" />
            <circle cx="22" cy="22" r="17" fill="none" stroke={color} strokeWidth="5"
              strokeDasharray={`${(score/100)*(2*Math.PI*17)} ${2*Math.PI*17}`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold" style={{ color }}>{score}%</span>
          </div>
        </div>
        <Link href={`/people/${emp.id}/compliance`}>
          <Button size="sm" variant="outline" className="h-7 text-xs">View</Button>
        </Link>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
type FilterType = "all" | "at_risk" | "incomplete" | "active";

export default function PeopleComplianceHubPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const isAdmin = user?.role === "super_admin";
  const companyId = isAdmin ? selectedCompanyId : (user?.companyId ?? "");

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ["companies-list"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then(r => r.json() as Promise<{ companies: Company[] }>),
    enabled: isAdmin,
  });
  const companies = companiesData?.companies ?? [];

  const { data: empData, isLoading: empLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["people-employees", companyId],
    queryFn: () => fetch(`/api/employees?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ employees: Employee[] }>),
    enabled: !!companyId, staleTime: 60_000,
  });

  const all = (empData?.employees ?? []).filter(e => e.status !== "terminated");

  const filtered = all.filter(emp => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q)) return false;
    }
    if (filter === "at_risk") return (emp.complianceScore ?? 100) < 70;
    if (filter === "incomplete") return (emp.complianceScore ?? 100) < 100;
    if (filter === "active") return emp.status === "active";
    return true;
  });

  const atRiskCount = all.filter(e => (e.complianceScore ?? 100) < 70).length;
  const avgScore = all.length > 0
    ? Math.round(all.reduce((s, e) => s + (e.complianceScore ?? 0), 0) / all.length)
    : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/people")} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <div className="p-2 rounded-lg" style={{ background: `${NAVY}15` }}>
          <ShieldCheck className="h-5 w-5" style={{ color: NAVY }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Compliance</h1>
          <p className="text-sm text-muted-foreground">Monitor workforce compliance status</p>
        </div>
      </div>

      {/* Company picker — admin only */}
      {isAdmin && (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-white shadow-sm">
          <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-600 font-medium shrink-0">Company:</span>
          <select
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="flex-1 max-w-xs h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
          >
            <option value="">— Select a company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId && isAdmin && (
        <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
          <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Select a company to view compliance</p>
        </div>
      )}

      {companyId && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: scoreColor(avgScore) }}>{avgScore}%</p>
              <p className="text-xs text-gray-500 mt-1">Avg Employee Score</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{atRiskCount}</p>
              <p className="text-xs text-gray-500 mt-1">At Risk (&lt;70%)</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: NAVY }}>{all.length}</p>
              <p className="text-xs text-gray-500 mt-1">Active Employees</p>
            </div>
          </div>

          <ComplianceSummary companyId={companyId} />

          {/* Employee list */}
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search employees…" className="pl-8 h-8 text-sm" />
              </div>
              {(["all","at_risk","incomplete","active"] as FilterType[]).map(f => (
                <button key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filter === f ? "bg-[#1B3A6B] text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}>
                  {f === "all" ? "All" : f === "at_risk" ? "At Risk" : f === "incomplete" ? "Incomplete" : "Active Only"}
                </button>
              ))}
            </div>

            {empLoading ? (
              <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">No employees match your filters</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(emp => <EmployeeComplianceCard key={emp.id} emp={emp} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
