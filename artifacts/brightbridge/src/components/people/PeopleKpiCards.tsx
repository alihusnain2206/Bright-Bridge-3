import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, UserPlus, ClipboardList, ShieldCheck, DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Employee {
  id: string; status: string; startDate?: string | null;
  complianceScore?: number | null; onboardingProgress?: number | null;
  payrollReady?: boolean | null; rollfiUserId?: string | null;
}

interface PipelineData {
  pipeline: { stage: string; totalTasks: number; completed: number; pending: number; percentage: number }[];
  totalTasks: number; completedTasks: number;
}
interface ComplianceOverview {
  overview: { category: string; total: number; completed: number; percentage: number }[];
  overallScore: number; totalItems: number; completedItems: number;
}

function scoreColor(s: number) {
  if (s >= 90) return "#10b981";
  if (s >= 70) return "#0ea5c9";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}
function scoreTier(s: number) {
  if (s >= 90) return "Excellent";
  if (s >= 70) return "Good";
  if (s >= 50) return "Needs Attention";
  return "At Risk";
}

function RingStat({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = 36; const circ = 2 * Math.PI * r;
  return (
    <div className="relative w-[88px] h-[88px] mx-auto">
      <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold text-gray-900 leading-none">{label}</span>
      </div>
    </div>
  );
}

function KpiCard({ icon, iconBg, title, value, sub, subColor, link, linkLabel, onValueClick, loading }: {
  icon: React.ReactNode; iconBg: string; title: string; value: React.ReactNode;
  sub?: React.ReactNode; subColor?: string; link?: string; linkLabel?: string;
  onValueClick?: () => void; loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 min-h-[120px]" style={{ background: "hsl(212 20% 90%)" }}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg shrink-0" style={{ background: iconBg }}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 truncate">{title}</p>
          {loading ? (
            <Skeleton className="h-7 w-16 mt-1" />
          ) : (
            <p
              className={`text-2xl font-bold mt-0.5 leading-none ${onValueClick ? "cursor-pointer hover:text-[#0EA5C9] transition-colors" : ""}`}
              style={{ color: NAVY }}
              onClick={onValueClick}
            >{value}</p>
          )}
          {!loading && sub && (
            <p className="text-xs mt-1" style={{ color: subColor ?? "#6b7280" }}>{sub}</p>
          )}
        </div>
      </div>
      {link && linkLabel && (
        <Link href={link}>
          <span className="text-xs font-medium text-[#0EA5C9] hover:underline cursor-pointer">
            {linkLabel} →
          </span>
        </Link>
      )}
    </div>
  );
}

export default function PeopleKpiCards({
  companyId, employees, onFilterActive, onFilterNewHires,
}: {
  companyId: string;
  employees: Employee[];
  onFilterActive?: () => void;
  onFilterNewHires?: () => void;
}) {
  const { data: pipeline, isLoading: pipeLoading } = useQuery<PipelineData>({
    queryKey: ["pipeline", companyId],
    queryFn: () => fetch(`/api/onboarding-tasks/pipeline?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<PipelineData>),
    enabled: !!companyId, staleTime: 60_000,
  });

  const { data: complianceOverview, isLoading: compLoading } = useQuery<ComplianceOverview>({
    queryKey: ["compliance-overview", companyId],
    queryFn: () => fetch(`/api/compliance/company-overview?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<ComplianceOverview>),
    enabled: !!companyId, staleTime: 60_000,
  });

  // Card 1: Active employees
  const activeEmps = employees.filter(e => e.status === "active");
  const now = Date.now();
  const thisMonthActive = activeEmps.filter(e => e.startDate && now - new Date(e.startDate).getTime() < 30 * 86400000);

  // Card 2: New hires
  const newHires = employees.filter(e => {
    if (e.status === "onboarding" || e.status === "pending") return true;
    if (!e.startDate) return false;
    return now - new Date(e.startDate).getTime() < 30 * 86400000;
  });
  const newHiresOnboarding = newHires.filter(e => e.status === "onboarding" || e.status === "pending");

  // Card 3: Open onboarding tasks
  const totalPending = pipeline?.pipeline.reduce((sum, s) => sum + s.pending, 0) ?? 0;
  const overdueTasks = 0; // No per-task due date from pipeline; kept for future

  // Card 4: Compliance alerts — items not completed
  const alertCount = (complianceOverview?.totalItems ?? 0) - (complianceOverview?.completedItems ?? 0);
  const criticalEmps = employees.filter(e => (e.complianceScore ?? 100) < 70 && e.status === "active").length;

  // Card 5: Avg payroll cost — no endpoint available in sandbox; show placeholder
  const avgPayrollCost = null as number | null;

  // Card 6: Turnover YTD
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const terminatedYtd = employees.filter(e => e.status === "terminated" && e.startDate && new Date(e.startDate).getTime() >= yearStart).length;
  const avgHeadcount = Math.max(employees.filter(e => e.status !== "terminated").length, 1);
  const turnoverRate = ((terminatedYtd / avgHeadcount) * 100).toFixed(1);

  // Workforce Score
  const compScore = complianceOverview?.overallScore ?? 0;
  const avgOnboarding = employees.length > 0
    ? Math.round(employees.filter(e => e.status !== "terminated").reduce((s, e) => s + (e.onboardingProgress ?? 0), 0) / Math.max(employees.filter(e => e.status !== "terminated").length, 1))
    : 0;
  const payrollReadyCount = activeEmps.filter(e => e.payrollReady === true).length;
  const payrollReadyPct = activeEmps.length > 0 ? Math.round((payrollReadyCount / activeEmps.length) * 100) : 0;
  const workforceScore = Math.round(compScore * 0.5 + avgOnboarding * 0.3 + payrollReadyPct * 0.2);
  const wsColor = scoreColor(workforceScore);

  const loading = employees.length === 0;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          icon={<Users className="h-4 w-4 text-white" />}
          iconBg="#3B82F6"
          title="Active Employees"
          value={loading ? "—" : activeEmps.length}
          sub={thisMonthActive.length > 0 ? `+${thisMonthActive.length} this month` : "No new hires this month"}
          subColor={thisMonthActive.length > 0 ? "#10b981" : undefined}
          link="/people/directory"
          linkLabel="View all employees"
          onValueClick={onFilterActive}
          loading={loading}
        />
        <KpiCard
          icon={<UserPlus className="h-4 w-4 text-white" />}
          iconBg="#8B5CF6"
          title="New Hires This Month"
          value={loading ? "—" : newHires.length}
          sub={`${newHiresOnboarding.length} still onboarding`}
          link="/people/new-hires"
          linkLabel="View new hires"
          onValueClick={onFilterNewHires}
          loading={loading}
        />
        <KpiCard
          icon={<ClipboardList className="h-4 w-4 text-white" />}
          iconBg="#E8622A"
          title="Open Onboarding Tasks"
          value={pipeLoading ? "—" : totalPending}
          sub={totalPending > 0 ? `${totalPending} pending across all stages` : "All caught up!"}
          subColor={totalPending > 5 ? "#ef4444" : "#6b7280"}
          link="/people/onboarding"
          linkLabel="View onboarding"
          loading={pipeLoading}
        />
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4 text-white" />}
          iconBg="#10B981"
          title="Compliance Alerts"
          value={compLoading ? "—" : alertCount}
          sub={criticalEmps > 0 ? `${criticalEmps} critical (score < 70%)` : "No critical alerts"}
          subColor={criticalEmps > 0 ? "#ef4444" : "#6b7280"}
          link="/people/compliance"
          linkLabel="View alerts"
          loading={compLoading}
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4 text-white" />}
          iconBg="#F59E0B"
          title="Avg Payroll Cost"
          value={avgPayrollCost != null ? `$${avgPayrollCost.toLocaleString("en-US", { minimumFractionDigits: 0 })}` : "—"}
          sub="After first payroll run"
          link="/payroll"
          linkLabel="View analytics"
        />
        <KpiCard
          icon={terminatedYtd === 0
            ? <TrendingUp className="h-4 w-4 text-white" />
            : <TrendingDown className="h-4 w-4 text-white" />}
          iconBg={terminatedYtd === 0 ? "#10B981" : "#EF4444"}
          title="Turnover Rate (YTD)"
          value={loading ? "—" : `${turnoverRate}%`}
          sub={terminatedYtd === 0 ? "No departures 🎉" : `${terminatedYtd} departure${terminatedYtd !== 1 ? "s" : ""} this year`}
          loading={loading}
        />
      </div>

      {/* Workforce Score card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-6">
        <RingStat value={workforceScore} max={100} label={`${workforceScore}`} color={wsColor} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-gray-900">Workforce Score</p>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: `${wsColor}20`, color: wsColor }}>
              {scoreTier(workforceScore)}
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            {workforceScore >= 70 ? "Your workforce is healthy." : "Some areas need attention."}{" "}
            Compliance {compScore}% · Onboarding {avgOnboarding}% · Payroll Ready {payrollReadyPct}%
          </p>
          <div className="flex gap-4 mt-2.5">
            <div className="text-center">
              <div className="text-xs font-bold" style={{ color: scoreColor(compScore) }}>{compScore}%</div>
              <div className="text-[10px] text-gray-400">Compliance</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold" style={{ color: scoreColor(avgOnboarding) }}>{avgOnboarding}%</div>
              <div className="text-[10px] text-gray-400">Onboarding</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold" style={{ color: scoreColor(payrollReadyPct) }}>{payrollReadyPct}%</div>
              <div className="text-[10px] text-gray-400">Payroll Ready</div>
            </div>
          </div>
        </div>
        <div className="shrink-0 hidden sm:block">
          <Link href="/people/compliance">
            <span className="text-xs font-medium text-[#0EA5C9] hover:underline cursor-pointer">
              View full report →
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
