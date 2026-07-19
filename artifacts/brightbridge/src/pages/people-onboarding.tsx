import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, ChevronLeft, Users, Building2, CheckCircle2,
  Clock, AlertTriangle, ChevronDown, ChevronRight, Eye, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Employee {
  id: string; firstName: string; lastName: string;
  department?: string | null; status: string; startDate?: string | null;
  onboardingProgress?: number | null; companyId: string;
}
interface Company { id: string; name: string; }
interface PipelineStage {
  stage: string; totalTasks: number; completed: number; pending: number;
  inProgress: number; percentage: number;
}
interface OnboardingTask {
  id: string; employeeId: string; stage: string; taskName: string;
  status: string; isRequired: boolean; completedAt?: string | null;
  dueDate?: string | null; taskType?: string | null;
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

function scoreColor(s: number) {
  if (s >= 90) return "#10b981";
  if (s >= 70) return "#0ea5c9";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

// ── Stage Pipeline Summary ─────────────────────────────────────
function PipelineSummary({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<{ pipeline: PipelineStage[]; totalTasks: number; completedTasks: number }>({
    queryKey: ["pipeline", companyId],
    queryFn: () => fetch(`/api/onboarding-tasks/pipeline?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ pipeline: PipelineStage[]; totalTasks: number; completedTasks: number }>),
    enabled: !!companyId, staleTime: 30_000,
  });

  const active = (data?.pipeline ?? []).filter(s => s.totalTasks > 0);
  const overallPct = data && data.totalTasks > 0
    ? Math.round((data.completedTasks / data.totalTasks) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Pipeline Overview</h2>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              {data.completedTasks} of {data.totalTasks} tasks completed — {overallPct}%
            </p>
          )}
        </div>
        <div className="text-2xl font-bold" style={{ color: scoreColor(overallPct) }}>
          {overallPct}%
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-7 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {active.map(s => (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="text-base shrink-0">{STAGE_ICONS[s.stage] ?? "📌"}</span>
              <span className="text-xs text-gray-600 w-32 shrink-0">{STAGE_LABELS[s.stage] ?? s.stage}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${s.percentage}%`,
                    background: s.percentage === 100 ? "#10b981" : s.percentage > 50 ? ACCENT : "#f59e0b",
                  }}
                />
              </div>
              <div className="flex items-center gap-3 shrink-0 w-40">
                <span className="text-xs text-gray-500">{s.completed}/{s.totalTasks}</span>
                {s.pending > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">
                    {s.pending} pending
                  </span>
                )}
                {s.percentage === 100 && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Employee Onboarding Card ───────────────────────────────────
function EmployeeOnboardingCard({ emp }: { emp: Employee }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const { data: tasksData, isLoading } = useQuery<{ tasks: OnboardingTask[] }>({
    queryKey: ["emp-tasks", emp.id],
    queryFn: () => fetch(`/api/onboarding-tasks?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ tasks: OnboardingTask[] }>),
    enabled: expanded, staleTime: 30_000,
  });

  const progress = emp.onboardingProgress ?? 0;
  const color = scoreColor(progress);
  const tasks = tasksData?.tasks ?? [];
  const pending = tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  const completed = tasks.filter(t => t.status === "completed");
  const color2 = avatarColor(`${emp.firstName} ${emp.lastName}`);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-semibold"
          style={{ background: color2 }}>
          {initials(emp.firstName, emp.lastName)}
        </div>
        {/* Name + dept */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {emp.firstName} {emp.lastName}
          </p>
          <p className="text-xs text-gray-400 truncate">{emp.department ?? "Unassigned"}</p>
        </div>
        {/* Status badge */}
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
          emp.status === "onboarding" ? "bg-blue-50 text-blue-600"
          : emp.status === "pending" ? "bg-gray-100 text-gray-500"
          : "bg-emerald-50 text-emerald-600"
        }`}>
          {emp.status === "onboarding" ? "Onboarding" : emp.status === "pending" ? "Pending" : "Active"}
        </span>
        {/* Progress ring */}
        <div className="relative w-9 h-9 shrink-0">
          <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
            <circle cx="22" cy="22" r="17" fill="none" stroke="#f3f4f6" strokeWidth="5" />
            <circle cx="22" cy="22" r="17" fill="none" stroke={color} strokeWidth="5"
              strokeDasharray={`${(progress/100)*(2*Math.PI*17)} ${2*Math.PI*17}`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold" style={{ color }}>{progress}%</span>
          </div>
        </div>
        {/* Hire date */}
        <span className="text-xs text-gray-400 hidden md:block shrink-0 w-24 text-right">
          Hired {fmtDate(emp.startDate)}
        </span>
        {/* Expand icon */}
        <div className="shrink-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-gray-400" />
            : <ChevronRight className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No tasks assigned yet</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {completed.length}/{tasks.length} tasks completed
              </p>
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 py-0.5">
                  {t.status === "completed"
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    : t.status === "in_progress"
                    ? <Clock className="h-3.5 w-3.5 text-[#0EA5C9] shrink-0" />
                    : <Clock className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                  <span className={`text-xs flex-1 truncate ${t.status === "completed" ? "line-through text-gray-400" : "text-gray-700"}`}>
                    {t.taskName}
                  </span>
                  {t.isRequired && t.status !== "completed" && (
                    <span className="text-[9px] text-gray-400 font-medium shrink-0">REQ</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
                    style={{
                      background: t.status === "completed" ? "#d1fae5" : t.status === "in_progress" ? "#e0f2fe" : "#f3f4f6",
                      color: t.status === "completed" ? "#059669" : t.status === "in_progress" ? "#0284c7" : "#6b7280",
                    }}>
                    {t.stage ? (STAGE_LABELS[t.stage] ?? t.stage) : "—"}
                  </span>
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <Link href={`/people/${emp.id}/tasks`}>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    <Eye className="h-3 w-3" /> View Tasks
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function PeopleOnboardingPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

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

  const allEmps = empData?.employees ?? [];
  const onboardingEmps = allEmps.filter(e => e.status === "onboarding" || e.status === "pending");
  const recentActive = allEmps.filter(e => e.status === "active" && e.startDate &&
    Date.now() - new Date(e.startDate).getTime() < 60 * 86400000);
  const shown = [...new Map([...onboardingEmps, ...recentActive].map(e => [e.id, e])).values()];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/people")} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <div className="p-2 rounded-lg" style={{ background: `${NAVY}15` }}>
          <ClipboardList className="h-5 w-5" style={{ color: NAVY }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Onboarding Pipeline</h1>
          <p className="text-sm text-muted-foreground">Track new hire tasks and progress</p>
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

      {/* Empty state */}
      {!companyId && isAdmin && (
        <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
          <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Select a company to view onboarding</p>
        </div>
      )}

      {companyId && (
        <>
          <PipelineSummary companyId={companyId} />

          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-400" />
              Employees in Onboarding
              {shown.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold">
                  {shown.length}
                </span>
              )}
            </h2>
            {empLoading ? (
              <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
            ) : shown.length === 0 ? (
              <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-gray-700 font-semibold">All caught up!</p>
                <p className="text-gray-400 text-sm mt-1">No employees currently in onboarding</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map(emp => (
                  <EmployeeOnboardingCard key={emp.id} emp={emp} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
