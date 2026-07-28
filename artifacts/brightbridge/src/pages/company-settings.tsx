/**
 * Company Settings — landing page
 * Route: /company-settings  (owner + super_admin only)
 *
 * Three sections:
 *  1. Configuration Progress  — 8 real steps toward first payroll
 *  2. Settings Categories     — live cards + coming-soon cards
 *  3. Attention Required      — right-hand panel with warnings
 *
 * All data comes from a single GET /api/company-settings/dashboard fetch.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Settings,
  Check,
  ChevronRight,
  AlertTriangle,
  ArrowRight,
  UserCircle,
  Building2,
  FileText,
  DollarSign,
  Clock,
  ShieldCheck,
  FolderOpen,
  Bell,
  Lock,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProgressStep {
  id: string;
  number: number;
  label: string;
  done: boolean;
  missingText: string | null;
  linkTo: string | null;
}

interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  message: string;
  linkTo: string | null;
  category: string;
}

interface DashboardData {
  company: { id: string; name: string };
  progress: { completedCount: number; totalCount: number; steps: ProgressStep[] };
  attention: AttentionItem[];
  registrationCount: number;
}

// ── Settings category definitions ─────────────────────────────────────────────

type CardDef = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  soon: boolean;
  href?: string;
};

const CARDS: CardDef[] = [
  {
    id: "account-settings",
    title: "Account Settings",
    description: "Profile photo, display name, and password.",
    icon: UserCircle,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    href: "/account-settings",
    soon: false,
  },
  {
    id: "company-info",
    title: "Company Information",
    description: "Legal name, address, EIN, and business details.",
    icon: Building2,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    href: "/settings?tab=company-info",
    soon: false,
  },
  {
    id: "state-tax",
    title: "State Tax Information",
    description: "State tax registrations and employer withholding setup.",
    icon: FileText,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    href: "/settings?tab=state-tax",
    soon: false,
  },
  {
    id: "payroll",
    title: "Payroll Settings",
    description: "Pay schedules, pay groups, deductions, and earnings rules.",
    icon: DollarSign,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-500",
    soon: true,
  },
  {
    id: "time-attendance",
    title: "Time & Attendance",
    description: "Work schedules, time tracking, overtime, and breaks.",
    icon: Clock,
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
    soon: true,
  },
  {
    id: "compliance",
    title: "Compliance Settings",
    description: "Policies, training, compliance rules, and certifications.",
    icon: ShieldCheck,
    iconBg: "bg-rose-50",
    iconColor: "text-rose-500",
    soon: true,
  },
  {
    id: "documents",
    title: "Documents",
    description: "Templates, categories, document requirements, and retention.",
    icon: FolderOpen,
    iconBg: "bg-orange-50",
    iconColor: "text-orange-500",
    soon: true,
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Email, SMS, in-app alerts, and workflow reminders.",
    icon: Bell,
    iconBg: "bg-sky-50",
    iconColor: "text-sky-500",
    soon: true,
  },
  {
    id: "security",
    title: "Security",
    description: "Password policies, session settings, and audit controls.",
    icon: Lock,
    iconBg: "bg-slate-50",
    iconColor: "text-slate-500",
    soon: true,
  },
];

// ── Progress ring SVG ──────────────────────────────────────────────────────────

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const r = 38;
  const stroke = 7;
  const norm = r - stroke / 2;
  const circ = 2 * Math.PI * norm;
  const pct = total > 0 ? completed / total : 0;
  const filled = circ * pct;

  return (
    <div className="relative flex-shrink-0">
      <svg width={r * 2} height={r * 2} className="-rotate-90">
        {/* track */}
        <circle
          cx={r} cy={r} r={norm}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={stroke}
        />
        {/* filled arc */}
        <circle
          cx={r} cy={r} r={norm}
          fill="none"
          stroke="#0EA5C9"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circ - filled}`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-gray-900 leading-none">
          {Math.round(pct * 100)}%
        </span>
        <span className="text-[10px] text-gray-400 mt-0.5">done</span>
      </div>
    </div>
  );
}

// ── Step circle ────────────────────────────────────────────────────────────────

function StepCircle({ step, isCurrent }: { step: ProgressStep; isCurrent: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all",
          step.done
            ? "bg-[#0EA5C9] text-white"
            : isCurrent
              ? "bg-[#1B3A6B] text-white ring-4 ring-[#1B3A6B]/15"
              : "bg-gray-100 text-gray-400",
        )}
      >
        {step.done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : step.number}
      </div>
      <span
        className={cn(
          "text-[10px] leading-tight text-center w-14",
          step.done ? "text-[#0EA5C9] font-medium" :
          isCurrent ? "text-[#1B3A6B] font-semibold" :
          "text-gray-400",
        )}
      >
        {step.label}
      </span>
    </div>
  );
}

// ── Configuration Progress card ────────────────────────────────────────────────

function ConfigProgress({ progress }: { progress: DashboardData["progress"] }) {
  const [, navigate] = useLocation();
  const { completedCount, totalCount, steps } = progress;
  const incompleteSteps = steps.filter(s => !s.done);
  const firstIncomplete = incompleteSteps[0] ?? null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Configuration Progress</h2>
          <p className="text-xs text-gray-500 mt-0.5">Steps required before running your first payroll</p>
        </div>
        <span className={cn(
          "text-xs font-semibold px-2.5 py-1 rounded-full",
          completedCount === totalCount
            ? "bg-emerald-50 text-emerald-700"
            : "bg-[#EFF8FF] text-[#0EA5C9]",
        )}>
          {completedCount} of {totalCount} complete
        </span>
      </div>

      {/* Stepper row */}
      <div className="flex items-start justify-between gap-1 mb-6">
        {steps.map((step, i) => (
          <React.Fragment key={step.id}>
            <StepCircle step={step} isCurrent={!step.done && (i === 0 || steps[i - 1].done)} />
            {i < steps.length - 1 && (
              <div className={cn(
                "flex-1 h-px mt-4 transition-colors",
                steps[i + 1].done ? "bg-[#0EA5C9]" : step.done ? "bg-[#0EA5C9]" : "bg-gray-200",
              )} />
            )}
          </React.Fragment>
        ))}
        {/* Progress ring */}
        <div className="ml-4 flex-shrink-0">
          <ProgressRing completed={completedCount} total={totalCount} />
        </div>
      </div>

      {/* Incomplete steps list */}
      {completedCount === totalCount ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-sm font-medium text-emerald-700">
            All steps complete — you're ready to run payroll.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {incompleteSteps.slice(0, 4).map((step, i) => (
            <div
              key={step.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                i === 0 ? "bg-amber-50/60 border-amber-100" : "bg-gray-50 border-gray-100",
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5",
                i === 0 ? "bg-amber-400 text-white" : "bg-gray-200 text-gray-500",
              )}>
                {step.number}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-700">{step.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{step.missingText}</p>
              </div>
              {step.linkTo && (
                <button
                  onClick={() => navigate(step.linkTo!)}
                  className="text-xs text-[#0EA5C9] font-medium hover:underline flex-shrink-0 flex items-center gap-0.5"
                >
                  Fix <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {incompleteSteps.length > 4 && (
            <p className="text-xs text-gray-400 pl-3">
              +{incompleteSteps.length - 4} more steps outstanding
            </p>
          )}
          {firstIncomplete?.linkTo && (
            <button
              onClick={() => navigate(firstIncomplete.linkTo!)}
              className="mt-3 w-full py-2 px-4 rounded-lg bg-[#1B3A6B] text-white text-sm font-semibold
                         hover:bg-[#254d8c] transition-colors flex items-center justify-center gap-2"
            >
              Continue Setup <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Settings category card ─────────────────────────────────────────────────────

function CategoryCard({
  card,
  footer,
  onClick,
}: {
  card: CardDef;
  footer?: React.ReactNode;
  onClick?: () => void;
}) {
  const Icon = card.icon;
  return (
    <div
      onClick={card.soon ? undefined : onClick}
      className={cn(
        "bg-white rounded-xl border p-5 flex flex-col gap-3 transition-all",
        card.soon
          ? "border-gray-100 opacity-70"
          : "border-gray-100 shadow-sm hover:shadow-md hover:border-[#0EA5C9]/30 cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", card.iconBg)}>
          <Icon className={cn("w-5 h-5", card.soon ? "text-gray-300" : card.iconColor)} />
        </div>
        {card.soon ? (
          <span className="text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
            Soon
          </span>
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
        )}
      </div>
      <div className="flex-1">
        <p className={cn("text-sm font-semibold", card.soon ? "text-gray-400" : "text-gray-800")}>
          {card.title}
        </p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{card.description}</p>
      </div>
      {footer && (
        <div className="pt-2 border-t border-gray-50">
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Attention Required panel ───────────────────────────────────────────────────

const SEVERITY_DOT: Record<AttentionItem["severity"], string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-blue-400",
};

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const [, navigate] = useLocation();

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <h2 className="text-sm font-semibold text-gray-900">Attention Required</h2>
        {items.length > 0 && (
          <span className="ml-auto text-xs font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
            <Check className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-gray-600">Nothing needs your attention</p>
          <p className="text-xs text-gray-400 mt-1">You're all caught up.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map(item => (
            <li key={item.id} className="px-5 py-3.5 flex items-start gap-3">
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-1.5", SEVERITY_DOT[item.severity])} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed">{item.message}</p>
                {item.linkTo && (
                  <button
                    onClick={() => navigate(item.linkTo!)}
                    className="mt-1 text-[11px] text-[#0EA5C9] font-medium hover:underline flex items-center gap-0.5"
                  >
                    Resolve <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="max-w-6xl animate-pulse">
      <Skeleton className="h-7 w-52 mb-1" />
      <Skeleton className="h-4 w-80 mb-8" />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-4 w-36 mb-4" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const companyId = user?.companyId;

  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ["company-settings-dashboard", companyId],
    queryFn: async () => {
      const qs = companyId ? `?companyId=${companyId}` : "";
      const r = await fetch(`/api/dashboard${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  if (isLoading) return <PageSkeleton />;

  if (error || !data) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Couldn't load settings</h2>
        <p className="text-sm text-gray-500 mb-4">
          {error instanceof Error ? error.message : "An unexpected error occurred."}
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#254d8c] transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
          <Settings className="w-4 h-4 text-[#1B3A6B]" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Company Settings</h1>
      </div>
      <p className="text-sm text-gray-500 mb-7 ml-11">
        Configure and manage your organization settings for {data.company.name}.
      </p>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Main column */}
        <div className="col-span-2 space-y-7">
          {/* Configuration progress */}
          <ConfigProgress progress={data.progress} />

          {/* Settings categories */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Settings Categories</h2>
            <div className="grid grid-cols-3 gap-4">
              {CARDS.map(card => (
                <CategoryCard
                  key={card.id}
                  card={card}
                  footer={
                    card.id === "state-tax" && data.registrationCount > 0 ? (
                      <p className="text-[11px] text-emerald-600 font-medium">
                        {data.registrationCount} active registration{data.registrationCount !== 1 ? "s" : ""}
                      </p>
                    ) : undefined
                  }
                  onClick={() => card.href && navigate(card.href)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          <AttentionPanel items={data.attention} />

          {/* Quick links */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick access</h3>
            <div className="space-y-1">
              {[
                { label: "Account Settings", href: "/account-settings" },
                { label: "Company Information", href: "/settings?tab=company-info" },
                { label: "State Tax", href: "/settings?tab=state-tax" },
              ].map(link => (
                <button
                  key={link.href}
                  onClick={() => navigate(link.href)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-gray-700
                             hover:bg-gray-50 hover:text-[#1B3A6B] transition-colors"
                >
                  {link.label}
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
