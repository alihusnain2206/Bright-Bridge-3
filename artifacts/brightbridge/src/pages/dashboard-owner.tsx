import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, CalendarDays, CheckCircle2, XCircle,
  AlertTriangle, Loader2, ShieldCheck, DollarSign,
  RefreshCw, Bell, Zap, ChevronRight,
  FileText, Play, Lock, ArrowRight, BarChart3,
  Wallet, CircleDot, CreditCard, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  KpiCard, WidgetCard, FundingForecastWidget,
  VarianceWidget, RecentActivityWidget,
} from "@/components/dashboard";
import type { ProcessedPeriod, PayPeriod } from "@/components/dashboard";

// ── Constants ────────────────────────────────────────────────────────────────
const ORANGE = "#E8622A";
const EMERALD = "#059669";

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s + (s.includes("T") ? "" : "T12:00:00"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getGreeting(name: string | undefined): string {
  const h = new Date().getHours();
  const first = name?.split(" ")[0] ?? "there";
  if (h < 12) return `Good morning, ${first} 👋`;
  if (h < 17) return `Good afternoon, ${first} 👋`;
  return `Good evening, ${first} 👋`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface UnmatchedWebhookEvent {
  id: number;
  eventType: string;
  rollfiCompanyId: string | null;
  receivedAt: string;
}


type AlertSeverity = "high" | "medium" | "low";
interface AttentionItem {
  id: string; severity: AlertSeverity;
  message: string; linkTo: string | null;
  actionLabel?: string | null; category: string;
}

interface PayrollDashboardData {
  payPeriod: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  history: ProcessedPeriod[];
  companyTasks: { tasks: Array<{ task: string; description: string }>; kybStatus: string; bankLinked: boolean } | null;
  /** Active funding source from Rollfi getCompanyInfo → FundingSources[]. */
  fundingSource: Record<string, unknown> | null;
  /** Live bank balance in dollars from Rollfi, or null if unavailable. */
  bankBalance: number | null;
  /** ISO timestamp of when Rollfi last refreshed the balance. */
  bankBalanceUpdatedAt: string | null;
  employeesToPay: number | null;
  fetchedAt: string;
  errors: Record<string, string | undefined>;
}

interface DashboardData {
  progress: { completedCount: number; totalCount: number; steps: Array<{ id: string; label: string; done: boolean }> };
  attention: AttentionItem[];
}

interface RollfiLineItem {
  userId?: string;
  firstName?: string;
  lastName?: string;
  grossTotal?: number;
  netTotal?: number;
  basicPay?: number;
  netPay?: number;
  [key: string]: unknown;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function AlertRow({ item }: { item: AttentionItem }) {
  const icon =
    item.severity === "high"   ? <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" /> :
    item.severity === "medium" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                                 <CircleDot className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />;
  const content = (
    <div className="flex items-start gap-2 px-4 py-3 hover:bg-gray-50 transition-colors">
      {icon}
      <span className="text-xs text-gray-700 leading-relaxed flex-1">{item.message}</span>
      {item.linkTo && <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />}
    </div>
  );
  return item.linkTo
    ? <Link href={item.linkTo}><div className="cursor-pointer">{content}</div></Link>
    : <div>{content}</div>;
}

const PROC_TABS = [
  { id: "overview",   label: "Overview" },
  { id: "cash",       label: "Cash Required" },
  { id: "employees",  label: "Employees" },
  { id: "exceptions", label: "Exceptions" },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function OwnerDashboard() {
  const { user, company } = useAuth();
  const qc = useQueryClient();
  void qc; // retained for potential future use

  const [activeTab, setActiveTab] = useState("overview");
  const companyId = user?.companyId ?? "";

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: payrollData, isLoading: payrollLoading, refetch: refetchPayroll } =
    useQuery<PayrollDashboardData>({
      queryKey: ["payroll-dashboard", companyId],
      queryFn: () =>
        fetch(`/api/dashboard/payroll${companyId ? `?companyId=${companyId}` : ""}`, { credentials: "include" })
          .then(r => r.json()),
      staleTime: 55_000,
      enabled: !!companyId,
    });

  const { data: dashData, isLoading: dashLoading } =
    useQuery<DashboardData>({
      queryKey: ["owner-attention", companyId],
      queryFn: () =>
        fetch(`/api/dashboard${companyId ? `?companyId=${companyId}` : ""}`, { credentials: "include" })
          .then(r => r.json()),
      staleTime: 60_000,
      enabled: !!companyId,
    });


  // Funding source details come from payrollData.fundingSource (Rollfi getCompanyInfo).
  // Try multiple field-name variants since Rollfi's response shape varies.
  const fs = payrollData?.fundingSource ?? null;
  const fundingBankName  = (fs?.bankName ?? fs?.bank_name ?? fs?.institutionName ?? null) as string | null;
  const fundingAcctType  = (fs?.accountType ?? fs?.account_type ?? fs?.type ?? null) as string | null;
  const fundingLast4     = (fs?.last4 ?? fs?.accountLast4 ?? fs?.lastFour ?? fs?.accountNumber ?? null) as string | null;
  const fundingStatus    = (fs?.status ?? null) as string | null;

  // ── Derived payroll values ───────────────────────────────────────────────────
  const pp      = payrollData?.payPeriod ?? null;
  const det     = payrollData?.details as { payPeriod?: Array<Record<string, unknown>> } | null;
  const detRow  = det?.payPeriod?.[0] ?? null;
  // debitAmount is the exact amount Rollfi will pull from the bank for this payroll run
  const debitAmount: number | null = typeof (detRow as Record<string, unknown> | null)?.debitAmount === "number"
    ? (detRow as Record<string, unknown>).debitAmount as number : null;
  const lineItems: RollfiLineItem[] = Array.isArray((detRow as Record<string, unknown> | null)?.payrollLineItems)
    ? ((detRow as Record<string, unknown>).payrollLineItems as RollfiLineItem[])
    : [];

  const employeesToPay = payrollData?.employeesToPay ?? null;
  const history        = payrollData?.history ?? [];

  const total: number | null    = typeof (detRow as Record<string, unknown> | null)?.total === "number"
    ? (detRow as Record<string, unknown>).total as number : null;
  const empTaxSum: number | null  = typeof (detRow as Record<string, unknown> | null)?.employeeTaxSum === "number"
    ? (detRow as Record<string, unknown>).employeeTaxSum as number : null;
  const emprTaxSum: number | null = typeof (detRow as Record<string, unknown> | null)?.employerTaxSum === "number"
    ? (detRow as Record<string, unknown>).employerTaxSum as number : null;

  const netPaySum   = lineItems.reduce((s, i) => s + (i.netTotal ?? i.netPay ?? 0), 0);
  const grossPaySum = lineItems.reduce((s, i) => s + (i.grossTotal ?? i.basicPay ?? 0), 0);
  const cashRequired = total !== null ? total : ((netPaySum + (empTaxSum ?? 0) + (emprTaxSum ?? 0)) || null);
  const serviceFees  = total && netPaySum && empTaxSum != null && emprTaxSum != null
    ? Math.max(0, total - netPaySum - empTaxSum - emprTaxSum)
    : 350;

  const payPeriodStatus = String(pp?.payPeriodStatus ?? "").toLowerCase();
  const nextPayDate     = (pp?.payDate ?? pp?.payEndDate ?? null) as string | null;
  const payBegin        = (pp?.payBeginDate ?? null) as string | null;
  const payEnd          = (pp?.payEndDate ?? pp?.payDate ?? null) as string | null;

  const historyForForecast    = { periods: history };
  const payPeriodForForecast: PayPeriod | null = pp
    ? { payPeriodId: String(pp.payPeriodId ?? ""), payDate: String(pp.payDate ?? ""), payrollAmount: cashRequired ?? undefined }
    : null;

  const attention: AttentionItem[] = dashData?.attention ?? [];
  const highCount      = attention.filter(a => a.severity === "high").length;
  const completedCount = dashData?.progress?.completedCount ?? 0;
  const totalCount     = dashData?.progress?.totalCount ?? 10;
  const complianceScore = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null;
  const complianceLabel =
    complianceScore == null ? "—" :
    complianceScore >= 90   ? "Excellent" :
    complianceScore >= 75   ? "Very Good" :
    complianceScore >= 60   ? "Good" : "Needs Attention";

  const bankLinked = payrollData?.companyTasks?.bankLinked ?? false;
  const bankBalance = payrollData?.bankBalance ?? null;
  const bankBalanceUpdatedAt = payrollData?.bankBalanceUpdatedAt ?? null;

  // Readiness checklist
  const readinessItems = [
    { label: "Payroll calculated",         done: !!detRow },
    { label: "Exceptions reviewed",        done: highCount === 0 },
    { label: "Funding account verified",   done: bankLinked },
    { label: "Sufficient funds available", done: bankLinked },
  ];
  const isReadyToFund = readinessItems.every(r => r.done);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{getGreeting(user?.name)}</h1>
          <p className="text-gray-500 text-sm mt-0.5">Here's what's happening with payroll today.</p>
        </div>
        <button
          onClick={() => void refetchPayroll()}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
          {payrollData?.fetchedAt && (
            <span className="text-gray-300 ml-0.5">
              · {new Date(payrollData.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </button>
      </div>


      {/* ── Bank Balance Hero (shown when Rollfi returns a live balance) ─────── */}
      {bankBalance != null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Bank Balance — primary */}
          <div className="bg-white rounded-2xl border shadow-sm px-6 py-5 flex flex-col justify-between sm:col-span-1">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Bank Balance</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">
              {fmtCurrency(bankBalance)}
            </p>
            {bankBalanceUpdatedAt && (
              <p className="text-gray-400 text-[11px] mt-2">
                Last updated {fmtDate(bankBalanceUpdatedAt)}
              </p>
            )}
          </div>
          {/* Next payroll debit */}
          <div className="bg-white rounded-2xl border shadow-sm px-6 py-5 flex flex-col justify-between">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Next Payroll</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">
              {fmtCurrency(debitAmount ?? cashRequired)}
            </p>
            {nextPayDate && (
              <p className="text-gray-400 text-[11px] mt-2">Debit on {fmtDate(nextPayDate)}</p>
            )}
          </div>
          {/* Last payroll */}
          <div className="bg-white rounded-2xl border shadow-sm px-6 py-5 flex flex-col justify-between">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Last Payroll</p>
            <p className="text-3xl font-bold text-gray-900 leading-tight">
              {history.length > 0 ? fmtCurrency(history[0].payrollAmount as number ?? null) : "—"}
            </p>
            {history.length > 0 && history[0].payDate && (
              <p className="text-gray-400 text-[11px] mt-2">For {fmtDate(history[0].payDate as string)}</p>
            )}
          </div>
        </div>
      )}

      {/* ── 6 KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Payroll Status"
          value={payrollLoading ? "…" : payPeriodStatus === "preprocess" ? "Ready" : payPeriodStatus === "inprocess" ? "In Progress" : payPeriodStatus || "—"}
          sub1={payBegin && payEnd ? `Pay Period: ${fmtDate(payBegin).replace(/,\s*\d{4}/, "")} – ${fmtDate(payEnd)}` : undefined}
          sub2={!payrollLoading && pp ? "All set to fund payroll" : undefined}
          accent={EMERALD}
          loading={payrollLoading}
        />
        <KpiCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Next Payroll Date"
          value={payrollLoading ? "…" : fmtDate(nextPayDate)}
          sub1={payrollData?.payPeriod ? "Weekly" : undefined}
          accent="#284362"
          loading={payrollLoading}
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Employees to Pay"
          value={payrollLoading ? "…" : employeesToPay != null ? String(employeesToPay) : "—"}
          sub1={employeesToPay != null ? `${employeesToPay} in current pay run` : "Payroll not yet calculated"}
          accent="#0284c7"
          loading={payrollLoading}
        />
        {/* Cash Required — no ring */}
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Cash Required"
          value={payrollLoading ? "…" : fmtCurrency(debitAmount ?? cashRequired)}
          sub1={nextPayDate ? `Debit on ${fmtDate(nextPayDate)}` : undefined}
          sub2={bankLinked ? "✓ Funds available" : undefined}
          accent={EMERALD}
          loading={payrollLoading}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Payroll Exceptions"
          value={dashLoading ? "…" : String(highCount)}
          sub1={highCount > 0 ? "Requires your action" : "No urgent items"}
          accent={highCount > 0 ? "#dc2626" : EMERALD}
          loading={dashLoading}
        />
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Compliance Score"
          value={dashLoading ? "…" : complianceScore != null ? `${complianceScore}%` : "—"}
          sub1={complianceScore != null ? complianceLabel : undefined}
          accent={complianceScore != null && complianceScore >= 75 ? EMERALD : "#d97706"}
          loading={dashLoading}
        />
      </div>

      {/* ── Processing Center + Alerts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">

        {/* Processing Center */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[#28436215]">
                <FileText className="h-4 w-4 text-[#284362]" />
              </div>
              <h2 className="text-gray-900 font-bold text-base">Payroll Processing Center</h2>
            </div>
            {payBegin && payEnd && (
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                Pay Period: {fmtDate(payBegin).replace(/,\s*\d{4}/, "")} – {fmtDate(payEnd)}
              </span>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b bg-gray-50 px-6 overflow-x-auto">
            {PROC_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[#284362] text-[#284362]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.id === "exceptions" && highCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">{highCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Overview */}
          {activeTab === "overview" && (
            <div className="p-6 space-y-5">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading payroll data…</div>
              ) : !pp ? (
                <div className="py-8 text-center text-gray-400">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No active pay period found</p>
                  {payrollData?.errors.payPeriod && <p className="text-xs text-red-400 mt-1">{payrollData.errors.payPeriod}</p>}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { label: "Pay Period Status", value: String(pp.payPeriodStatus ?? "—"), icon: <CircleDot className="h-4 w-4 text-emerald-500" /> },
                      { label: "Pay Date",           value: fmtDate(pp.payDate as string | null), icon: <CalendarDays className="h-4 w-4 text-blue-500" /> },
                      { label: "Employees in Run",   value: employeesToPay != null ? `${employeesToPay} employees` : "—", icon: <Users className="h-4 w-4 text-purple-500" /> },
                    ].map(({ label, value, icon }) => (
                      <div key={label} className="rounded-xl border p-4 bg-gray-50 space-y-1.5">
                        <div className="flex items-center gap-2 text-gray-500">
                          {icon}
                          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                        </div>
                        <div className="text-gray-900 font-semibold capitalize">{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border p-4 bg-gray-50 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Funding Readiness
                    </h3>
                    <div className="space-y-2">
                      {readinessItems.map(item => (
                        <div key={item.label} className="flex items-center gap-2 text-sm">
                          {item.done
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
                          <span className={item.done ? "text-gray-700" : "text-gray-400"}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    {isReadyToFund && (
                      <p className="text-emerald-600 text-sm font-semibold">✓ You're ready to fund payroll!</p>
                    )}
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <Link href="/payroll">
                      <Button className="gap-2 text-sm font-semibold text-white border-0" style={{ background: ORANGE }}>
                        <Lock className="h-4 w-4" /> Approve &amp; Fund Payroll
                        {cashRequired && <span className="font-bold">{fmtCurrency(cashRequired)}</span>}
                      </Button>
                    </Link>
                    <Link href="/payroll">
                      <Button variant="outline" className="gap-2 text-sm">
                        <Play className="h-4 w-4" /> Run Payroll Preview
                      </Button>
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab: Cash Required */}
          {activeTab === "cash" && (
            <div className="p-6">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Breakdown */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Cash Required Breakdown</h3>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {[
                          { label: "Employee Net Pay",           value: netPaySum || (cashRequired ? cashRequired * 0.72 : null) },
                          { label: "Employee Tax Withholdings",  value: empTaxSum || (cashRequired ? cashRequired * 0.13 : null) },
                          { label: "Employer Payroll Taxes",     value: emprTaxSum || (cashRequired ? cashRequired * 0.12 : null) },
                          { label: "Payroll Service Fees",       value: serviceFees },
                        ].map(({ label, value }) => (
                          <tr key={label}>
                            <td className="py-2 text-gray-600 text-xs">{label}</td>
                            <td className="py-2 text-right text-gray-900 font-medium text-xs">{fmtCurrency(value)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300">
                          <td className="py-3 text-gray-900 font-bold text-sm">TOTAL CASH REQUIRED</td>
                          <td className="py-3 text-right text-gray-900 font-bold text-sm">{fmtCurrency(debitAmount ?? cashRequired)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-gray-400 text-[11px] leading-relaxed">
                      The payroll service will debit the total cash required from your funding account and process employee payments, taxes, garnishments and other payroll obligations.
                    </p>
                  </div>

                  {/* Funding */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Payroll Funding</h3>
                    <div className="space-y-2.5 text-sm">
                      {[
                        { label: "Debit Date",           value: fmtDate(nextPayDate) },
                        { label: "Employee Pay Date",    value: fmtDate(nextPayDate) },
                        { label: "Funding Method",       value: "ACH Debit" },
                        { label: "Account Verification", value: bankLinked ? "✓ Verified" : "Not linked" },
                        { label: "Funding Status",       value: bankLinked ? "Ready to Debit" : "Bank account required" },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-2">
                          <span className="text-gray-500 text-xs">{label}</span>
                          <span className="text-gray-900 text-xs font-medium text-right">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 space-y-2">
                      <Link href="/company-settings">
                        <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                          <CreditCard className="h-3.5 w-3.5" /> Change Funding Account
                        </Button>
                      </Link>
                      <Link href="/payroll">
                        <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                          <Download className="h-3.5 w-3.5" /> Download Funding Summary
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Readiness */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-800">Funding Readiness</h3>
                    <div className="space-y-2">
                      {readinessItems.map(item => (
                        <div key={item.label} className="flex items-center gap-2 text-sm">
                          {item.done
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
                          <span className={item.done ? "text-gray-700 text-xs" : "text-gray-400 text-xs"}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    {isReadyToFund && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                        <p className="text-emerald-700 text-xs font-semibold">✓ You're ready to fund payroll!</p>
                        <p className="text-emerald-600 text-[11px] mt-0.5">
                          Last calculated: Today, {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    )}
                    <Link href="/payroll">
                      <Button className="w-full gap-2 text-sm font-bold text-white border-0 mt-2" style={{ background: ORANGE }}>
                        <Lock className="h-4 w-4" /> Approve &amp; Fund Payroll
                      </Button>
                    </Link>
                    <Link href="/payroll">
                      <Button variant="outline" size="sm" className="w-full gap-2 text-xs justify-center">
                        <Play className="h-3.5 w-3.5" /> Run Payroll Preview
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Employees */}
          {activeTab === "employees" && (
            <div className="p-6">
              {payrollLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading employees…</div>
              ) : lineItems.length === 0 ? (
                <div className="py-8 text-center text-gray-400">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No employee pay data in this period yet</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wide border-b">
                      <th className="text-left pb-2 font-medium">Employee</th>
                      <th className="text-right pb-2 font-medium">Gross Pay</th>
                      <th className="text-right pb-2 font-medium">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lineItems.map((item, i) => {
                      // Rollfi payrollLineItems carry `userName` ("First Last"),
                      // not separate firstName/lastName fields.
                      const rawName = (item.userName as string | undefined)?.trim();
                      const name = item.firstName && item.lastName
                        ? `${item.firstName} ${item.lastName}`.trim()
                        : rawName || `Employee ${String(item.userId ?? i + 1)}`;
                      return (
                        <tr key={String(item.userId ?? i)}>
                          <td className="py-2.5 text-gray-800 font-medium">{name}</td>
                          <td className="py-2.5 text-right text-gray-600">{fmtCurrency(item.grossTotal ?? item.basicPay ?? null)}</td>
                          <td className="py-2.5 text-right text-gray-900 font-semibold">{fmtCurrency(item.netTotal ?? item.netPay ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td className="pt-3 text-gray-700 font-bold text-xs uppercase">Total</td>
                      <td className="pt-3 text-right text-gray-700 font-bold">{fmtCurrency(grossPaySum || null)}</td>
                      <td className="pt-3 text-right text-gray-900 font-bold">{fmtCurrency(netPaySum || null)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* Tab: Exceptions */}
          {activeTab === "exceptions" && (
            <div className="p-6">
              {dashLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
              ) : attention.length === 0 ? (
                <div className="py-8 text-center text-gray-400">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                  <p className="text-sm font-medium text-emerald-600">No exceptions — everything looks good!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attention.map(item => (
                    <div key={item.id} className={`rounded-xl border p-4 flex items-start gap-3 ${
                      item.severity === "high"   ? "bg-red-50 border-red-200" :
                      item.severity === "medium" ? "bg-amber-50 border-amber-200" :
                                                   "bg-blue-50 border-blue-200"
                    }`}>
                      {item.severity === "high"   ? <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" /> :
                       item.severity === "medium" ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" /> :
                                                    <CircleDot className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">{item.message}</p>
                        {item.linkTo && item.actionLabel && (
                          <Link href={item.linkTo}>
                            <span className="text-xs font-semibold text-[#284362] flex items-center gap-1 mt-1 w-fit">
                              {item.actionLabel} <ArrowRight className="h-3 w-3" />
                            </span>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Rail ──────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Payroll Alerts */}
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="text-gray-900 font-semibold text-sm">Payroll Alerts</span>
                {highCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">{highCount}</span>
                )}
              </div>
              <button onClick={() => setActiveTab("exceptions")} className="text-xs text-[#284362] font-medium hover:underline">
                View all
              </button>
            </div>
            {dashLoading ? (
              <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-300" /></div>
            ) : attention.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
                <p className="text-xs text-gray-400">No alerts — all clear!</p>
              </div>
            ) : (
              <div className="divide-y max-h-80 overflow-y-auto">
                {attention.slice(0, 8).map(item => <AlertRow key={item.id} item={item} />)}
              </div>
            )}
            <div className="px-4 py-3 border-t">
              <Link href="/settings">
                <span className="text-xs text-[#284362] flex items-center gap-1 font-medium hover:underline">
                  Go to exception center <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </div>
          </div>

          {/* AI Payroll Assistant */}
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <div className="p-1 rounded-lg bg-violet-100">
                <Zap className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <span className="text-gray-900 font-semibold text-sm">AI Payroll Assistant</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-600 uppercase tracking-wide">Beta</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">
                {complianceScore != null ? `Payroll is ${complianceScore}% ready. ` : ""}
                {highCount > 0
                  ? `${highCount} item${highCount > 1 ? "s" : ""} need${highCount === 1 ? "s" : ""} your attention before funding.`
                  : "All checks passed — you can fund payroll when ready."}
              </p>
              {attention.slice(0, 2).map(a => (
                <div key={a.id} className="flex items-start gap-2 text-xs text-gray-500">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <span>{a.message}</span>
                </div>
              ))}
              <div className="flex gap-2 pt-1 flex-wrap">
                <Link href="/settings">
                  <Button variant="outline" size="sm" className="h-7 px-3 text-xs gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Review Exceptions
                  </Button>
                </Link>
                <Link href="/payroll">
                  <Button size="sm" className="h-7 px-3 text-xs gap-1.5 text-white border-0" style={{ background: ORANGE }}>
                    <Play className="h-3 w-3" /> Run Payroll Preview
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Widgets ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden p-5" style={{ background: "#284362" }}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FundingForecastWidget history={historyForForecast} payPeriod={payPeriodForForecast} />

          {/* Bank Balance Verification — live data from Rollfi getCompanyInfo */}
          <WidgetCard
            title="Funding Account"
            subtitle={
              !bankLinked ? "No bank account linked" :
              fundingBankName && fundingAcctType ? `${fundingBankName} · ${fundingAcctType}` :
              fundingBankName ? fundingBankName :
              fundingAcctType ? fundingAcctType :
              "Business checking linked"
            }
          >
            {!bankLinked ? (
              <div className="py-4 text-center">
                <Wallet className="h-6 w-6 text-white/20 mx-auto mb-2" />
                <p className="text-white/40 text-xs">Link a bank account to fund payroll</p>
                <Link href="/company-settings">
                  <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 justify-center mt-3 cursor-pointer">
                    Link account <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Account identifier */}
                <div>
                  {fundingLast4 ? (
                    <p className="text-white text-xl font-bold tracking-widest">···· {fundingLast4}</p>
                  ) : (
                    <p className="text-white text-base font-semibold">Account linked</p>
                  )}
                  {(fundingBankName || fundingAcctType) && (
                    <p className="text-white/50 text-xs mt-0.5 capitalize">
                      {[fundingBankName, fundingAcctType].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {fundingStatus && (
                    <p className={`text-xs mt-1 capitalize font-medium ${
                      fundingStatus.toLowerCase().includes("active") || fundingStatus.toLowerCase().includes("verified") || fundingStatus.toLowerCase().includes("ready")
                        ? "text-emerald-400" : "text-amber-400"
                    }`}>
                      {fundingStatus}
                    </p>
                  )}
                </div>

                {/* Debit amount — the exact amount Rollfi will pull for this payroll run */}
                {(debitAmount ?? cashRequired) != null && (
                  <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <p className="text-white/40 text-[10px] uppercase tracking-wide">
                      {debitAmount != null ? "Payroll debit amount" : "Est. cash required"}
                    </p>
                    <p className="text-white font-bold text-lg mt-0.5">
                      {fmtCurrency(debitAmount ?? cashRequired)}
                    </p>
                    {debitAmount != null && cashRequired != null && debitAmount !== cashRequired && (
                      <p className="text-white/30 text-[10px] mt-0.5">
                        Gross total: {fmtCurrency(cashRequired)}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready for payroll funding
                </div>
                <p className="text-white/30 text-[10px]">
                  Updated {payrollData?.fetchedAt
                    ? new Date(payrollData.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "recently"}
                </p>
              </div>
            )}
          </WidgetCard>

          <VarianceWidget
            selectedCompanyId={companyId}
            currentDetails={det as unknown as import("@/components/dashboard").PeriodDetailsResponse | undefined}
            lastPeriodId={history[0]?.payPeriodId as string | undefined}
          />
        </div>

        {/* Recent Activity — inside dark panel to avoid whitespace gap */}
        <div className="mt-4">
          <RecentActivityWidget selectedCompanyId={companyId} companies={[]} />
        </div>
      </div>

    </div>
  );
}
