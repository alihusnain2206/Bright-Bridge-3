import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ClipboardList, ShieldCheck, Users, Calendar, Activity,
  CheckCircle2, Clock, Loader2, Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Employee {
  id: string; firstName: string; lastName: string;
  department?: string | null; status: string; startDate?: string | null;
  complianceScore?: number | null;
}

interface PipelineStage {
  stage: string; totalTasks: number; completed: number; pending: number; percentage: number;
}
interface ComplianceCategory {
  category: string; total: number; completed: number; percentage: number;
}

const STAGE_LABELS: Record<string, string> = {
  preboarding: "Preboarding", documents: "Documents", training: "Training",
  equipment: "Equipment", manager_tasks: "Manager Tasks", compliance: "Compliance",
  daycare_compliance: "Daycare Compliance", ready_to_start: "Ready to Start",
};
const STAGE_ICONS: Record<string, string> = {
  preboarding: "📋", documents: "📄", training: "🎓", equipment: "💻",
  manager_tasks: "👔", compliance: "🛡️", daycare_compliance: "🏫", ready_to_start: "✅",
};
const CAT_LABELS: Record<string, string> = {
  i9: "I-9 Verification", w4: "W-4 Forms", direct_deposit: "Direct Deposit",
  background_check: "Background Checks", handbook: "Policy Acknowledgment",
  policy: "Policy Acknowledgment", fingerprint: "Fingerprint Clearance",
  certification: "Certifications", training: "Training",
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

function relTime(iso: string | number | null | undefined) {
  if (iso == null || iso === "") return "—";
  // Accept both ISO strings and Unix-ms numbers
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Pipeline Widget ────────────────────────────────────────────
function PipelineWidget({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<{ pipeline: PipelineStage[]; totalTasks: number; completedTasks: number }>({
    queryKey: ["pipeline", companyId],
    queryFn: () => fetch(`/api/onboarding-tasks/pipeline?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ pipeline: PipelineStage[]; totalTasks: number; completedTasks: number }>),
    enabled: !!companyId, staleTime: 60_000,
  });

  const activeStages = (data?.pipeline ?? []).filter(s => s.totalTasks > 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" style={{ color: NAVY }} />
          <span className="text-sm font-semibold text-gray-900">Onboarding Pipeline</span>
        </div>
        <Link href="/people/onboarding">
          <span className="text-xs text-[#0EA5C9] hover:underline cursor-pointer">View pipeline →</span>
        </Link>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
      ) : activeStages.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No onboarding tasks yet</p>
      ) : (
        <div className="space-y-3">
          {activeStages.map(s => (
            <div key={s.stage} className="flex items-center gap-2.5">
              <span className="text-sm shrink-0">{STAGE_ICONS[s.stage] ?? "📌"}</span>
              <span className="text-xs text-gray-600 w-28 shrink-0 truncate">{STAGE_LABELS[s.stage] ?? s.stage}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${s.percentage}%`, background: s.percentage === 100 ? "#10b981" : ACCENT }}
                />
              </div>
              <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                {s.completed}/{s.totalTasks}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compliance Overview Widget ─────────────────────────────────
function ComplianceOverviewWidget({ companyId }: { companyId: string }) {
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
  const r = 36; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
          <span className="text-sm font-semibold text-gray-900">Compliance Overview</span>
        </div>
        <Link href="/people/compliance">
          <span className="text-xs text-[#0EA5C9] hover:underline cursor-pointer">View compliance →</span>
        </Link>
      </div>
      {isLoading ? (
        <div className="flex gap-4">
          <Skeleton className="w-[80px] h-[80px] rounded-full" />
          <div className="flex-1 space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          <div className="shrink-0">
            <div className="relative w-[80px] h-[80px]">
              <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
                <circle cx="44" cy="44" r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
                <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="10"
                  strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.6s ease" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-bold leading-none" style={{ color }}>{score}%</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-1 font-medium">
              {score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "At Risk"}
            </p>
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {(data?.overview ?? []).slice(0, 7).map(c => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: CAT_COLORS[c.category] ?? "#9CA3AF" }} />
                <span className="text-[11px] text-gray-600 flex-1 truncate">
                  {CAT_LABELS[c.category] ?? c.category}
                </span>
                <span className="text-[11px] font-semibold shrink-0"
                  style={{ color: scoreColor(c.percentage) }}>
                  {c.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Department Headcount Widget ────────────────────────────────
function HeadcountWidget({ employees }: { employees: Employee[] }) {
  const active = employees.filter(e => e.status !== "terminated");
  const deptMap = active.reduce<Record<string, number>>((acc, e) => {
    const d = e.department ?? "Unassigned";
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});
  const depts = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...depts.map(d => d[1]), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-4 w-4" style={{ color: NAVY }} />
        <span className="text-sm font-semibold text-gray-900">Department Headcount</span>
      </div>
      {depts.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No employee data</p>
      ) : (
        <div className="space-y-2.5">
          {depts.slice(0, 8).map(([dept, count]) => (
            <div key={dept} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-600 w-28 shrink-0 truncate">{dept}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(count / max) * 100}%`, background: NAVY }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-700 w-5 shrink-0 text-right">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Upcoming Dates Widget ──────────────────────────────────────
function UpcomingDatesWidget({ employees }: { employees: Employee[] }) {
  type DateEntry = { date: Date; label: string; color: string; dot: string };
  const entries: DateEntry[] = [];
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const thisYear = now.getFullYear();

  employees.filter(e => e.status === "active" && e.startDate).forEach(e => {
    const start = new Date(e.startDate!);
    const anniversary = new Date(thisYear, start.getMonth(), start.getDate());
    if (anniversary <= now) anniversary.setFullYear(thisYear + 1);
    if (anniversary <= in30) {
      const years = anniversary.getFullYear() - start.getFullYear();
      entries.push({
        date: anniversary,
        label: `${e.firstName} ${e.lastName} — ${years}yr anniversary`,
        color: "#14B8A6",
        dot: "bg-teal-400",
      });
    }
  });

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  const shown = entries.slice(0, 6);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: NAVY }} />
          <span className="text-sm font-semibold text-gray-900">Upcoming Dates</span>
        </div>
        <span className="text-xs text-gray-300 font-medium">30 days</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No upcoming dates in the next 30 days</p>
      ) : (
        <div className="space-y-3">
          {shown.map((e, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${e.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 truncate">{e.label}</p>
              </div>
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
                style={{ background: `${e.color}15`, color: e.color }}>
                {fmtDate(e.date.toISOString())}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recent Activity Widget ─────────────────────────────────────
interface ActivityEntry {
  id: string; action: string; description: string;
  category: string; timestamp: string; employeeId?: string | null;
}

const ACTIVITY_DOT: Record<string, string> = {
  onboarding: "bg-blue-400",
  compliance: "bg-emerald-400",
  document:   "bg-purple-400",
  payroll:    "bg-amber-400",
  status:     "bg-red-400",
};

function ActivityWidget({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<{ entries: ActivityEntry[] }>({
    queryKey: ["activity-log", companyId],
    queryFn: () => fetch(`/api/activity-log?companyId=${companyId}&limit=8`, { credentials: "include" })
      .then(r => r.json() as Promise<{ entries: ActivityEntry[] }>),
    enabled: !!companyId, staleTime: 30_000,
  });

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: NAVY }} />
          <span className="text-sm font-semibold text-gray-900">Recent Activity</span>
        </div>
        <span className="text-xs text-gray-300 font-medium">Coming soon</span>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : (data?.entries ?? []).length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No recent activity</p>
      ) : (
        <div className="space-y-3">
          {(data?.entries ?? []).slice(0, 6).map(e => (
            <div key={e.id} className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${ACTIVITY_DOT[e.category] ?? "bg-gray-400"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 truncate">{e.description}</p>
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{relTime(e.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Workforce Advisor Coming Soon ──────────────────────────────
function WorkforceAdvisorCard() {
  return (
    <div className="bg-gradient-to-br from-[#1B3A6B]/5 to-[#0EA5C9]/5 rounded-xl border border-[#0EA5C9]/20 shadow-sm p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-[#0EA5C9]" />
          <span className="text-sm font-semibold text-gray-900">Workforce Advisor</span>
          <span className="text-[10px] font-semibold bg-[#0EA5C9]/10 text-[#0EA5C9] px-1.5 py-0.5 rounded uppercase tracking-wide">Coming Soon</span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Smart recommendations — compliance reminders, onboarding nudges, and headcount insights — are on the roadmap.
        </p>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────
export default function PeopleWidgets({ companyId, employees }: { companyId: string; employees: Employee[] }) {
  return (
    <div className="space-y-4">
      {/* Row 1: Pipeline + Compliance + Headcount */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PipelineWidget companyId={companyId} />
        <ComplianceOverviewWidget companyId={companyId} />
        <HeadcountWidget employees={employees} />
      </div>
      {/* Row 2: Upcoming Dates + Activity + Advisor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UpcomingDatesWidget employees={employees} />
        <ActivityWidget companyId={companyId} />
        <WorkforceAdvisorCard />
      </div>
    </div>
  );
}
