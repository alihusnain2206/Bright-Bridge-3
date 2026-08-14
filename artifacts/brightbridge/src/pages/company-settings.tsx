/**
 * Company Settings — landing page
 * Route: /company-settings  (owner + super_admin only)
 *
 * Tabs:
 *  Overview — Company Info, Rollfi Payroll status, Setup Checklist
 *  Settings — Configuration Progress, Settings Categories, Attention Required
 *
 * All settings data comes from GET /api/company-settings/dashboard.
 * Overview data comes from GET /api/companies/:companyId.
 */
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Landmark,
  CheckCircle2,
  XCircle,
  MapPin,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Company {
  id: string; name: string; phone: string; industry: string; package: string;
  status: string; address1: string; city: string; state: string;
  kybStatus: string; bankAccountAdded: boolean; payScheduleAdded: boolean;
  payFrequency?: string; rollfiCompanyId?: string;
  rollfi?: { rollfiCompanyId?: string } | null;
  employeeCount?: number;
}

interface BankStatus {
  verified: boolean;
  status: string | null;
  last4: string | null;
  bankName: string | null;
  accountType: string | null;
  kybStatus: string | null;  // live from Rollfi via getCompanyInfo
}

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
  actionLabel?: string | null;
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
    id: "bank-account",
    title: "Bank Account",
    description: "Link or update the account used to fund payroll — Plaid or manual entry.",
    icon: Landmark,
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
    href: "/bank-account-setup",
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

// ── Owner Overview Tab ─────────────────────────────────────────────────────────

function OwnerOverviewTab({ company, bankStatus }: { company: Company; bankStatus?: BankStatus | null }) {
  const hasRollfi = !!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId);
  // Prefer live Rollfi KYB status; fall back to DB value
  const liveKybStatus = bankStatus?.kybStatus ?? company.kybStatus;
  const bankVerified  = bankStatus?.verified ?? company.bankAccountAdded;

  const steps = [
    { done: true,                             label: "BrightBridge account created" },
    { done: hasRollfi,                        label: "Rollfi payroll registration" },
    { done: liveKybStatus === "verified",     pending: liveKybStatus === "pending", label: "KYB business verification" },
    { done: bankVerified,                     label: "Company bank account connected" },
    { done: company.payScheduleAdded,         label: `Pay schedule (${company.payFrequency ?? "BiWeekly"})` },
    { done: (company.employeeCount ?? 0) > 0, label: `Employees added (${company.employeeCount ?? 0} so far)` },
  ];

  return (
    <div className="space-y-5">
      {/* Two info cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Company Info */}
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Company Info</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Phone</span>
              <span className="font-medium">{company.phone || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Industry</span>
              <span className="font-medium capitalize">{company.industry}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Package</span>
              <span className="font-medium capitalize">{company.package.replace(/_/g, " ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Address</span>
              <span className="font-medium text-right">{company.address1}, {company.city} {company.state}</span>
            </div>
          </div>
        </div>

        {/* Rollfi Payroll */}
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Rollfi Payroll</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <span className={`font-medium ${hasRollfi ? "text-emerald-600" : "text-amber-600"}`}>
                {hasRollfi ? "Registered" : "Not registered"}
              </span>
            </div>
            {hasRollfi && (
              <div className="flex justify-between">
                <span className="text-gray-500">Company ID</span>
                <span className="font-mono text-xs text-gray-500 truncate max-w-[180px]">
                  {company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">KYB Status</span>
              <span className={`font-medium capitalize ${
                liveKybStatus === "verified" ? "text-emerald-600"
                : liveKybStatus === "pending" ? "text-amber-600"
                : "text-gray-500"
              }`}>
                {liveKybStatus.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pay Schedule</span>
              <span className={`font-medium ${company.payScheduleAdded ? "text-emerald-600" : "text-gray-400"}`}>
                {company.payScheduleAdded ? company.payFrequency : "Not set"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Setup Checklist */}
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <p className="text-sm font-bold text-gray-800 mb-4">Setup Checklist</p>
        <div className="space-y-3">
          {steps.map(({ done, pending, label }) => (
            <div key={label} className="flex items-center gap-3">
              {done
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : pending
                  ? <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
              <span className={`text-sm ${done ? "text-gray-800" : pending ? "text-amber-700" : "text-gray-400"}`}>
                {label}
              </span>
              {pending && (
                <Badge variant="outline" className="ml-auto text-[10px] border-amber-300 text-amber-600">
                  Under review
                </Badge>
              )}
              {!done && !pending && (
                <span className="ml-auto text-[10px] text-red-500 font-medium">Action required</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Owner Payroll Tab ──────────────────────────────────────────────────────────

function OwnerPayrollTab({ company, bankStatus, bankStatusLoading }: {
  company: Company;
  bankStatus?: BankStatus | null;
  bankStatusLoading?: boolean;
}) {
  const hasRollfi    = !!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId);
  const liveKybStatus = bankStatus?.kybStatus ?? company.kybStatus;
  const kybVerified   = liveKybStatus === "verified";
  const kybPending    = liveKybStatus === "pending";
  const bankVerified  = bankStatus?.verified ?? company.bankAccountAdded;

  const bankLabel = (() => {
    if (!bankStatus) return company.bankAccountAdded ? "Connected" : "Action required";
    if (bankStatus.verified) return "Connected";
    if (bankStatus.status)   return bankStatus.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    return "Action required";
  })();

  return (
    <div className="max-w-2xl space-y-4">
      {!hasRollfi && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your company hasn't been registered with Rollfi yet. Contact support to complete payroll setup.
        </div>
      )}

      {/* Payroll Status panel */}
      <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
        <p className="text-sm font-bold text-gray-800">Payroll Status</p>

        {bankStatusLoading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-5 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {/* Rollfi account */}
            <div className="flex items-center gap-3">
              {hasRollfi
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
              <span>Rollfi payroll account: <span className={`font-medium ${hasRollfi ? "text-emerald-600" : "text-gray-400"}`}>{hasRollfi ? "Active" : "Not registered"}</span></span>
            </div>

            {/* KYB */}
            <div className="flex items-center gap-3">
              {kybVerified
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : kybPending
                  ? <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
              <span>Business verification (KYB): <span className={`font-medium capitalize ${kybVerified ? "text-emerald-600" : kybPending ? "text-amber-600" : "text-red-600"}`}>{liveKybStatus.replace(/_/g, " ")}</span></span>
              {kybPending && <Badge variant="outline" className="ml-auto text-[10px] border-amber-300 text-amber-600">Under review</Badge>}
            </div>

            {/* Pay schedule */}
            <div className="flex items-center gap-3">
              {company.payScheduleAdded
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
              <span>Pay schedule: <span className={`font-medium ${company.payScheduleAdded ? "text-emerald-600" : "text-gray-400"}`}>{company.payFrequency ?? "Not set"}</span></span>
            </div>

            {/* Bank account */}
            <div className="flex items-center gap-3">
              {bankVerified
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
              <span>
                Bank account: <span className={`font-medium ${bankVerified ? "text-emerald-600" : "text-amber-600"}`}>{bankLabel}</span>
                {bankStatus?.bankName && bankVerified && (
                  <span className="text-gray-400 ml-1.5 text-xs">{bankStatus.bankName}{bankStatus.last4 ? ` ···· ${bankStatus.last4}` : ""}</span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bank Account management card */}
      <div className="bg-white rounded-xl border p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-teal-600" />
          <p className="text-sm font-bold text-gray-800">Bank Account</p>
        </div>

        {bankStatusLoading ? (
          <div className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        ) : bankVerified ? (
          <>
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-800">Bank account connected</p>
                <p className="text-emerald-700 mt-0.5">
                  {[bankStatus?.bankName, bankStatus?.last4 ? `···· ${bankStatus.last4}` : null, bankStatus?.accountType].filter(Boolean).join(" · ")}
                  {bankStatus?.status && ` — ${bankStatus.status}`}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500">Need to use a different account? You can replace it at any time — changes take effect for the next payroll run.</p>
            <Link href="/bank-account-setup">
              <Button variant="outline" className="gap-1.5">
                <Landmark className="h-4 w-4" />Manage Bank Account →
              </Button>
            </Link>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">No bank account connected</p>
                <p className="text-amber-700 mt-0.5">
                  {bankStatus?.status
                    ? `Status: ${bankStatus.status.replace(/_/g, " ")} — check status or resubmit below.`
                    : "A bank account is required before payroll can run."}
                </p>
              </div>
            </div>
            <Link href="/bank-account-setup">
              <Button className="gap-1.5 text-white border-0" style={{ background: "#284362" }}>
                <Landmark className="h-4 w-4" />Connect Bank Account →
              </Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

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
                    {item.actionLabel ?? "Resolve"} <ArrowRight className="w-3 h-3" />
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

// ── Locations Tab ──────────────────────────────────────────────────────────────

interface LocationRow {
  id: string; companyId: string; code: string; name: string;
  address1?: string|null; address2?: string|null;
  city?: string|null; state?: string|null; zipcode?: string|null;
  rollfiLocationId?: string|null; easyteamLocationId?: string|null;
  /** Mutable EasyTeam external key. NULL = created before the org-registration fix;
   *  may be registered under the wrong EasyTeam org → employees show 0m in All Locations. */
  easyteamExternalKey?: string|null;
  isPrimary?: boolean;
  latitude?: number|null; longitude?: number|null;
  isActive: boolean; createdAt?: string|null;
}

interface LocationFormState {
  code: string; name: string;
  address1: string; address2: string;
  city: string; state: string; zipcode: string;
  latitude: string; longitude: string;
}

function blankForm(): LocationFormState {
  return { code: "", name: "", address1: "", address2: "", city: "", state: "", zipcode: "", latitude: "", longitude: "" };
}

const US_STATES_SHORT = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function LocationFormFields({ form, set }: { form: LocationFormState; set: (k: keyof LocationFormState, v: string) => void }) {
  const inputCls = "w-full h-9 text-sm border border-gray-200 rounded-md px-2.5 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30 bg-white";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">Location Code <span className="text-red-500">*</span></span>
          <input className={inputCls} placeholder="e.g. 100" value={form.code} onChange={e => set("code", e.target.value)} maxLength={20} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">Location Name <span className="text-red-500">*</span></span>
          <input className={inputCls} placeholder="e.g. Main Office" value={form.name} onChange={e => set("name", e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-600">Street Address</span>
        <input className={inputCls} placeholder="123 Main St" value={form.address1} onChange={e => set("address1", e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-gray-600">Suite / Unit <span className="text-gray-400 text-[10px]">optional</span></span>
        <input className={inputCls} placeholder="Suite 200" value={form.address2} onChange={e => set("address2", e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-1 block space-y-1">
          <span className="text-xs font-medium text-gray-600">City</span>
          <input className={inputCls} placeholder="Newark" value={form.city} onChange={e => set("city", e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">State</span>
          <select className={inputCls} value={form.state} onChange={e => set("state", e.target.value)}>
            <option value="">—</option>
            {US_STATES_SHORT.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">Zip</span>
          <input className={inputCls} placeholder="07101" value={form.zipcode} onChange={e => set("zipcode", e.target.value)} maxLength={10} />
        </label>
      </div>
      {/* Coordinates — required to activate a location for EasyTeam geofencing */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">Latitude <span className="text-gray-400 text-[10px]">required to activate</span></span>
          <input className={inputCls} placeholder="e.g. 40.7357" type="number" step="any" value={form.latitude} onChange={e => set("latitude", e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-600">Longitude <span className="text-gray-400 text-[10px]">required to activate</span></span>
          <input className={inputCls} placeholder="e.g. -74.1724" type="number" step="any" value={form.longitude} onChange={e => set("longitude", e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function LocationsTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<LocationRow | null>(null);
  const [addForm, setAddForm]   = useState<LocationFormState>(blankForm);
  const [editForm, setEditForm] = useState<LocationFormState>(blankForm);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [warnings, setWarnings]       = useState<string[] | null>(null);
  const [deactivating, setDeactivating] = useState<LocationRow | null>(null);
  const [activating,   setActivating]   = useState<LocationRow | null>(null);
  const [repairing,  setRepairing]    = useState<LocationRow | null>(null);
  const [repairResult, setRepairResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data, isLoading, refetch } = useQuery<{ locations: LocationRow[] }>({
    queryKey: ["company-settings-locations", companyId],
    queryFn: () => fetch(`/api/locations?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ locations: LocationRow[] }>),
    enabled: !!companyId,
    staleTime: 30_000,
  });
  const locations = data?.locations ?? [];

  function setA(k: keyof LocationFormState, v: string) { setAddForm(f => ({ ...f, [k]: v })); }
  function setE(k: keyof LocationFormState, v: string) { setEditForm(f => ({ ...f, [k]: v })); }

  async function handleAdd() {
    setError(null); setWarnings(null);
    if (!addForm.code.trim()) { setError("Location code is required."); return; }
    if (!addForm.name.trim()) { setError("Location name is required."); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/locations", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...addForm,
          latitude:  addForm.latitude  ? parseFloat(addForm.latitude)  : undefined,
          longitude: addForm.longitude ? parseFloat(addForm.longitude) : undefined,
        }),
      });
      const body = await r.json() as { location?: LocationRow; warnings?: string[]; error?: string };
      if (!r.ok) { setError(body.error ?? `Error ${r.status}`); return; }
      if (body.warnings?.length) setWarnings(body.warnings);
      else { setShowAdd(false); setAddForm(blankForm); }
      void refetch(); void qc.invalidateQueries({ queryKey: ["company-settings-locations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create location");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editing) return;
    setError(null); setWarnings(null);
    if (!editForm.code.trim()) { setError("Location code is required."); return; }
    if (!editForm.name.trim()) { setError("Location name is required."); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/locations/${editing.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          latitude:  editForm.latitude  ? parseFloat(editForm.latitude)  : undefined,
          longitude: editForm.longitude ? parseFloat(editForm.longitude) : undefined,
        }),
      });
      const body = await r.json() as { location?: LocationRow; warnings?: string[]; error?: string };
      if (!r.ok) { setError(body.error ?? `Error ${r.status}`); return; }
      if (body.warnings?.length) setWarnings(body.warnings);
      else setEditing(null);
      void refetch(); void qc.invalidateQueries({ queryKey: ["company-settings-locations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update location");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(loc: LocationRow) {
    if (!editForm.latitude || !editForm.longitude) {
      setError("Enter latitude and longitude above before activating."); return;
    }
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/locations/${loc.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: true,
          latitude:  parseFloat(editForm.latitude),
          longitude: parseFloat(editForm.longitude),
        }),
      });
      const body = await r.json() as { location?: LocationRow; warnings?: string[]; error?: string };
      if (!r.ok) { setError(body.error ?? `Error ${r.status}`); return; }
      if (body.warnings?.length) setWarnings(body.warnings);
      else { setActivating(null); setEditing(null); }
      void refetch(); void qc.invalidateQueries({ queryKey: ["company-settings-locations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate location");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(loc: LocationRow) {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/locations/${loc.id}`, { method: "DELETE", credentials: "include" });
      const body = await r.json() as { success?: boolean; error?: string; assignedCount?: number };
      if (!r.ok) { setError(body.error ?? `Error ${r.status}`); setDeactivating(null); return; }
      setDeactivating(null);
      void refetch(); void qc.invalidateQueries({ queryKey: ["company-settings-locations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate location");
    } finally {
      setSaving(false);
    }
  }

  async function handleRepair(loc: LocationRow) {
    setSaving(true); setError(null); setRepairResult(null);
    try {
      const r = await fetch(`/api/locations/${loc.id}/repair-easyteam`, {
        method: "POST", credentials: "include",
      });
      const body = await r.json() as { ok?: boolean; message?: string; error?: string };
      if (!r.ok) { setError(body.error ?? `Error ${r.status}`); return; }
      setRepairResult({ ok: body.ok ?? false, message: body.message ?? (body.ok ? "Done" : "Repair incomplete") });
      void refetch(); void qc.invalidateQueries({ queryKey: ["company-settings-locations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repair failed");
    } finally {
      setSaving(false);
    }
  }

  const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors";

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#1B3A6B]" /> Locations
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Manage your company's physical locations. Each location syncs with Rollfi payroll and EasyTeam scheduling.</p>
        </div>
        <button
          className={`${btnCls} bg-[#1B3A6B] text-white hover:bg-[#254d8c]`}
          onClick={() => { setShowAdd(true); setAddForm(blankForm); setError(null); setWarnings(null); }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Location
        </button>
      </div>

      {/* Error / warning banners */}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 space-y-1">
          <p className="font-medium">Location saved with provider warnings:</p>
          {warnings.map((w, i) => <p key={i}>• {w}</p>)}
          <button className="text-[#1B3A6B] font-medium underline mt-1" onClick={() => { setWarnings(null); setShowAdd(false); setEditing(null); }}>Dismiss</button>
        </div>
      )}

      {/* Add Location form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">New Location</h3>
          <LocationFormFields form={addForm} set={setA} />
          <div className="flex gap-2 justify-end pt-1">
            <button className={`${btnCls} border border-gray-200 text-gray-700 hover:bg-gray-50`}
              onClick={() => { setShowAdd(false); setError(null); }}>Cancel</button>
            <button className={`${btnCls} bg-[#1B3A6B] text-white hover:bg-[#254d8c]`}
              disabled={saving} onClick={() => void handleAdd()}>
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Create Location"}
            </button>
          </div>
        </div>
      )}

      {/* Locations list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : locations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">
          No locations yet. Add your first location above.
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map(loc => (
            <div key={loc.id}>
              {/* View row */}
              {editing?.id !== loc.id && (
                <div className={`bg-white rounded-xl border ${loc.isActive ? "border-gray-200" : "border-gray-100 opacity-60"} shadow-sm px-4 py-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#1B3A6B]/10 text-[#1B3A6B]">
                          {loc.code}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{loc.name}</span>
                        {!loc.isActive && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">Inactive</span>
                        )}
                      </div>
                      {(loc.address1 || loc.city) && (
                        <p className="text-xs text-gray-400">
                          {[loc.address1, loc.address2, loc.city, loc.state, loc.zipcode].filter(Boolean).join(", ")}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        {loc.rollfiLocationId
                          ? <span className="text-[10px] text-emerald-600">✓ Rollfi synced</span>
                          : <span className="text-[10px] text-amber-500">⚠ Rollfi not synced</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        className={`${btnCls} border border-gray-200 text-gray-600 hover:bg-gray-50`}
                        onClick={() => {
                          setEditing(loc);
                          setEditForm({
                            code: loc.code, name: loc.name,
                            address1: loc.address1 ?? "", address2: loc.address2 ?? "",
                            city: loc.city ?? "", state: loc.state ?? "", zipcode: loc.zipcode ?? "",
                            latitude: loc.latitude?.toString() ?? "",
                            longitude: loc.longitude?.toString() ?? "",
                          });
                          setError(null); setWarnings(null);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {/* Repair button — shown when easyteamExternalKey is null (location was
                          created before the org-registration fix and may be under wrong org) */}
                      {loc.easyteamExternalKey === null && (
                        <button
                          className={`${btnCls} border border-amber-200 text-amber-700 hover:bg-amber-50`}
                          title="This location may be registered under the wrong time-tracking org. Click to re-register it."
                          onClick={() => { setRepairing(loc); setError(null); setRepairResult(null); }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Fix EasyTeam
                        </button>
                      )}
                      {loc.isActive && !loc.isPrimary && (
                        <button
                          className={`${btnCls} border border-red-100 text-red-600 hover:bg-red-50`}
                          onClick={() => { setDeactivating(loc); setError(null); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Deactivate
                        </button>
                      )}
                      {loc.isPrimary && loc.isActive && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Primary</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Edit form inline */}
              {editing?.id === loc.id && (
                <div className="bg-white rounded-xl border border-[#1B3A6B]/20 shadow-sm p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-800">{loc.isActive ? "Edit" : "Edit / Activate"} Location — {loc.code}</h3>
                  <LocationFormFields form={editForm} set={setE} />
                  <div className="flex gap-2 justify-end pt-1 flex-wrap">
                    <button className={`${btnCls} border border-gray-200 text-gray-700 hover:bg-gray-50`}
                      onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
                    {!loc.isActive && (
                      <button className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}
                        disabled={saving} onClick={() => { setActivating(loc); void handleActivate(loc); }}>
                        {saving && activating?.id === loc.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {saving && activating?.id === loc.id ? "Activating…" : "Activate"}
                      </button>
                    )}
                    <button className={`${btnCls} bg-[#1B3A6B] text-white hover:bg-[#254d8c]`}
                      disabled={saving} onClick={() => void handleEdit()}>
                      {saving && activating?.id !== loc.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {saving && activating?.id !== loc.id ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* EasyTeam repair confirmation */}
      {repairing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50">
                <RefreshCw className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Re-register EasyTeam Location?</h2>
                <p className="text-xs text-gray-500">{repairing.code} — {repairing.name}</p>
              </div>
            </div>

            {repairResult ? (
              <>
                <div className={`text-sm px-4 py-3 rounded-lg ${repairResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  {repairResult.message}
                </div>
                <div className="flex justify-end">
                  <button className={`${btnCls} bg-[#1B3A6B] text-white hover:bg-[#254d8c]`}
                    onClick={() => { setRepairing(null); setRepairResult(null); }}>Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-600 space-y-2">
                  <p>
                    This will re-register <strong>{repairing.name}</strong> with the time-tracking system under your company's account,
                    so employees here appear correctly in the <em>All Locations</em> view.
                  </p>
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    ⚠ Clock-in records from <em>before</em> this repair will still appear when you filter by this specific location,
                    but may not show in All Locations until the time-tracking provider migrates them.
                    For test companies this is fine to proceed immediately.
                  </p>
                </div>
                {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <button className={`${btnCls} border border-gray-200 text-gray-700 hover:bg-gray-50`}
                    onClick={() => { setRepairing(null); setError(null); }}>Cancel</button>
                  <button className={`${btnCls} bg-amber-600 text-white hover:bg-amber-700`}
                    disabled={saving} onClick={() => void handleRepair(repairing)}>
                    {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {saving ? "Re-registering…" : "Re-register"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Deactivate confirmation */}
      {deactivating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-50">
                <Trash2 className="h-4.5 w-4.5 text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Deactivate Location?</h2>
                <p className="text-xs text-gray-500">{deactivating.code} — {deactivating.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              This location will be hidden from all dropdowns. Employees assigned here will keep their assignment until manually changed. This cannot be undone from this UI.
            </p>
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button className={`${btnCls} border border-gray-200 text-gray-700 hover:bg-gray-50`}
                onClick={() => { setDeactivating(null); setError(null); }}>Cancel</button>
              <button className={`${btnCls} bg-red-600 text-white hover:bg-red-700`}
                disabled={saving} onClick={() => void handleDeactivate(deactivating)}>
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {saving ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type TabId = "overview" | "payroll" | "settings" | "locations";

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>("overview");

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

  // Company detail for Overview + Payroll tabs
  const { data: company, isLoading: companyLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    queryFn: () =>
      fetch(`/api/companies/${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const hasRollfi = !!(company?.rollfiCompanyId ?? company?.rollfi?.rollfiCompanyId);

  // Live bank + KYB status from Rollfi — feeds both Overview and Payroll tabs
  const { data: bankStatus, isLoading: bankStatusLoading } = useQuery<BankStatus>({
    queryKey: ["bank-status-owner", companyId],
    queryFn: () =>
      fetch(`/api/rollfi/onboard/bank-status?companyId=${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId && hasRollfi,
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
      <p className="text-sm text-gray-500 mb-5 ml-11">
        Configure and manage your organization settings for {data.company.name}.
      </p>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 ml-11">
        {([
          { id: "overview",   label: "Overview" },
          { id: "payroll",    label: "Payroll Settings" },
          { id: "settings",   label: "Settings" },
          { id: "locations",  label: "Locations" },
        ] as { id: TabId; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === id
                ? "border-[#E8622A] text-[#E8622A]"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        companyLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
            <Skeleton className="h-56 rounded-xl" />
          </div>
        ) : company ? (
          <OwnerOverviewTab company={company} bankStatus={bankStatus} />
        ) : (
          <div className="text-sm text-gray-500 py-8 text-center">Company details unavailable.</div>
        )
      )}

      {/* Payroll Settings tab */}
      {tab === "payroll" && (
        companyLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : company ? (
          <OwnerPayrollTab company={company} bankStatus={bankStatus} bankStatusLoading={bankStatusLoading} />
        ) : (
          <div className="text-sm text-gray-500 py-8 text-center">Company details unavailable.</div>
        )
      )}

      {/* Locations tab */}
      {tab === "locations" && companyId && (
        <div className="ml-11">
          <LocationsTab companyId={companyId} />
        </div>
      )}

      {/* Settings tab */}
      {tab === "settings" && (
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
      )}
    </div>
  );
}
