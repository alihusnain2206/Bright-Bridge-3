import React, { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, Loader2, Building2, Users, DollarSign,
  AlertTriangle, ChevronRight, RefreshCw, Play, Clock, Zap,
  ArrowRight, Activity, History, SkipForward,
  SlidersHorizontal, ClipboardList, Receipt, Trash2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────

interface RollfiCompanyRecord { rollfiCompanyId: string; rollfiLocationId: string; onboardedAt: string; }
interface RollfiEmployeeRecord { rollfiUserId: string; rollfiWageId?: string; onboardedAt: string; }
interface CompanyState { id: string; name: string; address?: string; rollfi: RollfiCompanyRecord | null; }
interface EmployeeState {
  userId: string; employeeId: string | null; name: string; position: string; companyId: string;
  hourlyWage: number; rollfi: RollfiEmployeeRecord | null;
}
interface RollfiState { companies: CompanyState[]; employees: EmployeeState[]; }
interface PreviewEmployee {
  employeeId: string | null; name: string; position: string; companyId: string;
  hoursWorked: number; breakDeduction: number; unapprovedHours: number;
  netPayableHours: number; hourlyRate: number; grossPay: number;
  hoursSource?: "easyteam" | "seeded" | "estimated" | "easyteam_sync" | "manager_edit" | "pending_approval";
  onboardedToRollfi: boolean; rollfiUserId: string | null;
}
interface PayrollPreview {
  period: { from: string; to: string; workdays: number };
  employees: PreviewEmployee[];
  totalGrossPay: number;
  allOnboarded: boolean;
}
interface PayPeriod {
  payPeriodId: string; payPeriod: string; payBeginDate: string;
  payEndDate: string; payDate: string; deadLineToRunPayroll: string;
  payPeriodStatus: string; payrollAmount?: number;
}
interface PayrollResult {
  success: boolean;
  importResult?: { importRegularPayrollLData?: { status: string; message: string } };
  payPeriod?: { payPeriodId: string; status: string; message: string };
  error?: string;
  skippedEmployees?: { rollfiUserId: string; reason: string }[];
}
interface EmpRollfiStatus { rollfiUserId: string; userStatus: string; kycStatus: string; }
interface CompanyOverview {
  companyId: string; companyName: string; rollfiCompanyId: string;
  payPeriod: PayPeriod | null; error?: string;
}
interface RunAllResult {
  companyId: string; companyName: string;
  success?: boolean; skipped?: boolean; reason?: string;
  payPeriodId?: string; error?: string;
}
interface ProcessedPeriod {
  payPeriodId?: string; payPeriod?: string; payBeginDate?: string;
  payEndDate?: string; payDate?: string; payPeriodStatus?: string;
  payrollAmount?: number; [key: string]: unknown;
}
interface CompanyTask { task: string; description: string; }
interface CompanyTasksData { tasks: CompanyTask[]; kybStatus: string; bankLinked: boolean; }
interface PayStub {
  employeeId: string | null; rollfiUserId: string | null;
  name: string; position: string; hourlyRate: number; hoursWorked: number;
  grossPay: number; federalTax: number; stateTax: number; fica: number;
  deductions: number; netPay: number; ytdGross: number; fromRollfi: boolean;
}
interface PayStubsData { payPeriodId: string | null; companyId: string; stubs: PayStub[]; }
interface RollfiPeriodDetailsResponse {
  payPeriod: Array<{
    payPeriodId: string; payPeriod: string; PayPeriodStatus: string;
    total: number; employeeTaxSum: number; employerTaxSum: number;
    isProcessed: boolean; payDate: string;
    payrollLineItems: Array<{ grossTotal: number; netTotal: number; userId: string }>;
  }>;
}
type AdjMap = Record<string, { bonusPay: number; overtimePay: number }>;

// ── API helpers ──────────────────────────────────────────────

const api = {
  get: async <T,>(path: string) => {
    const r = await fetch(`/api${path}`, { credentials: "include" });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
    return r.json() as Promise<T>;
  },
  post: async <T,>(path: string, body: unknown) => {
    const r = await fetch(`/api${path}`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(e.error ?? r.statusText);
    }
    return r.json() as Promise<T>;
  },
  delete: async (path: string) => {
    const r = await fetch(`/api${path}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? r.statusText); }
    return r.json();
  },
};

// ── Tax helpers ───────────────────────────────────────────────

function r2(n: number) { return Math.round(n * 100) / 100; }
function fmtD(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function calcEmpTax(gross: number) {
  const federal  = r2(gross * 0.12);
  const state    = r2(gross * 0.05);
  const ss       = r2(gross * 0.062);
  const medicare = r2(gross * 0.0145);
  const total    = r2(federal + state + ss + medicare);
  return { federal, state, ss, medicare, total, net: r2(gross - total) };
}

function calcErTax(gross: number) {
  const ss       = r2(gross * 0.062);
  const medicare = r2(gross * 0.0145);
  const futa     = r2(gross * 0.006);
  const njSui    = r2(gross * 0.005);
  return { ss, medicare, futa, njSui, total: r2(ss + medicare + futa + njSui) };
}

// ── Colours ──────────────────────────────────────────────────

const NAVY = "#284362";
const ORANGE = "#E8622A";

// ── Step indicator ───────────────────────────────────────────

function Steps({ current }: { current: number }) {
  const steps = ["Companies", "Employees", "Run Payroll"];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            <button
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                active ? "text-white shadow" : done ? "text-white/90" : "text-white/50"
              }`}
              style={{ background: active ? ORANGE : done ? "rgba(232,98,42,0.5)" : "rgba(255,255,255,0.08)" }}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center text-[10px]">{i + 1}</span>}
              {label}
            </button>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-white/30 mx-1" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Onboard status badge ─────────────────────────────────────

function StatusBadge({ onboarded }: { onboarded: boolean }) {
  return onboarded
    ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Onboarded</Badge>
    : <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs gap-1"><XCircle className="h-3 w-3" />Not onboarded</Badge>;
}

// ── Rollfi user activation badge ─────────────────────────────

function UserStatusBadge({ userStatus, kycStatus }: { userStatus: string; kycStatus: string }) {
  const s = userStatus.toLowerCase().replace(/\s+/g, "");
  if (s === "active")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><CheckCircle2 className="h-3 w-3" />Active</span>;
  if (s === "invitesent" && kycStatus === "passed")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30"><Activity className="h-3 w-3" />KYC ✓</span>;
  if (s === "invitesent")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30"><Clock className="h-3 w-3" />Pending</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-white/10 text-white/50 border border-white/20">{userStatus}</span>;
}

// ── Pay period status badge ───────────────────────────────────

function PayPeriodStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const configs: Record<string, { bg: string; text: string; border: string; label: string }> = {
    new:       { bg: "bg-blue-500/20",    text: "text-blue-300",    border: "border-blue-500/30",    label: "New" },
    submitted: { bg: "bg-amber-500/20",   text: "text-amber-300",   border: "border-amber-500/30",   label: "Submitted" },
    inprocess: { bg: "bg-orange-500/20",  text: "text-orange-300",  border: "border-orange-500/30",  label: "Processing" },
    processed: { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/30", label: "Processed ✓" },
    failed:    { bg: "bg-red-500/20",     text: "text-red-300",     border: "border-red-500/30",     label: "Failed" },
    cancelled: { bg: "bg-gray-500/20",    text: "text-gray-300",    border: "border-gray-500/30",    label: "Cancelled" },
    skipped:   { bg: "bg-gray-500/20",    text: "text-gray-300",    border: "border-gray-500/30",    label: "Skipped" },
  };
  const cfg = configs[s] ?? { bg: "bg-white/10", text: "text-white/50", border: "border-white/20", label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

// ── Payroll result card ───────────────────────────────────────

function PayrollResultCard({ result, onReset, onVerifyBank, verifyBankPending }: { result: PayrollResult; onReset: () => void; onVerifyBank?: () => void; verifyBankPending?: boolean }) {
  if (!result.success) {
    const isBankPending = result.error?.toLowerCase().includes("microdeposit") || result.error?.toLowerCase().includes("funding source") || result.error?.toLowerCase().includes("not ready");
    return (
      <div className="mt-4 p-5 rounded-xl bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-red-300 font-semibold">Payroll submission failed</p>
        </div>
        <p className="text-red-300/70 text-sm ml-7">{result.error}</p>
        {isBankPending && onVerifyBank && (
          <div className="mt-3 ml-7 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-300/80 text-xs mb-2">The company bank account needs micro-deposit verification before payroll can be submitted.</p>
            <button
              onClick={onVerifyBank}
              disabled={verifyBankPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/30 hover:bg-amber-500/50 text-amber-200 border border-amber-500/30 disabled:opacity-50 transition-colors"
            >
              {verifyBankPending ? <><Loader2 className="h-3 w-3 animate-spin" />Verifying…</> : <><CheckCircle2 className="h-3 w-3" />Verify Bank Account Now</>}
            </button>
          </div>
        )}
        <button onClick={onReset} className="mt-3 ml-7 text-xs text-red-400/70 hover:text-red-300 underline">Dismiss</button>
      </div>
    );
  }
  const steps = [
    { label: "Hours Imported", detail: result.importResult?.importRegularPayrollLData?.message ?? "Payroll data imported successfully", done: true },
    { label: "Payroll Initiated", detail: result.payPeriod?.message ?? "Pay period initiated successfully", done: result.payPeriod?.status === "Success" },
  ];
  return (
    <div className="mt-4 p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-emerald-500/30 flex items-center justify-center"><Zap className="h-4 w-4 text-emerald-400" /></div>
        <div>
          <p className="text-emerald-300 font-semibold">Payroll submitted to Rollfi</p>
          <p className="text-emerald-400/60 text-xs">Funds will be disbursed on the scheduled pay date</p>
        </div>
      </div>
      {result.skippedEmployees && result.skippedEmployees.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 text-sm font-semibold">Some employees were excluded from this payroll run</p>
            <p className="text-amber-400/70 text-xs mt-0.5">Rollfi rejected them due to incomplete onboarding (KYC not passed or missing bank account).</p>
            <ul className="mt-1.5 space-y-0.5">
              {result.skippedEmployees.map((e) => (
                <li key={e.rollfiUserId} className="text-amber-400/60 text-[11px] font-mono">{e.rollfiUserId}</li>
              ))}
            </ul>
            <p className="text-amber-400/50 text-[11px] mt-1.5">Complete their Rollfi onboarding in Step 2 to include them in future payroll runs.</p>
          </div>
        </div>
      )}
      <div className="space-y-2 mb-4">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${step.done ? "bg-emerald-500/40" : "bg-white/10"}`}>
              {step.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <Clock className="h-3.5 w-3.5 text-white/40" />}
            </div>
            <div>
              <p className={`text-sm font-semibold ${step.done ? "text-emerald-300" : "text-white/40"}`}>{step.label}</p>
              <p className="text-white/40 text-xs">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {result.payPeriod?.payPeriodId && (
        <div className="flex items-center gap-2 pt-3 border-t border-emerald-500/20">
          <span className="text-white/30 text-xs">Pay Period ID</span>
          <span className="text-white/50 text-xs font-mono">{result.payPeriod.payPeriodId.slice(0, 8)}…</span>
          <button onClick={onReset} className="ml-auto text-xs text-emerald-400/50 hover:text-emerald-300">Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ── Payroll overview panel ────────────────────────────────────

function PayrollOverviewPanel({
  overview, loading, onSelectCompany, runAll, runAllResults, onDismissRunAll,
}: {
  overview: { companies: CompanyOverview[] } | undefined;
  loading: boolean;
  onSelectCompany: (id: string) => void;
  runAll: { mutate: () => void; isPending: boolean };
  runAllResults: RunAllResult[] | null;
  onDismissRunAll: () => void;
}) {
  const companies = overview?.companies ?? [];
  const submittable = companies.filter(
    (c) => c.payPeriod && ["new", "failed", "cancelled", ""].includes((c.payPeriod.payPeriodStatus ?? "").toLowerCase())
  );

  return (
    <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-orange-400" />
          <span className="text-white font-semibold">Payroll Overview</span>
          {loading && <Loader2 className="h-3.5 w-3.5 text-white/30 animate-spin" />}
        </div>
        {submittable.length > 1 && (
          <Button
            size="sm"
            disabled={runAll.isPending}
            onClick={() => runAll.mutate()}
            className="gap-2 text-white font-semibold text-xs"
            style={{ background: runAll.isPending ? "rgba(255,255,255,0.1)" : ORANGE }}
          >
            {runAll.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</> : <><Play className="h-3.5 w-3.5" /> Run All Payroll</>}
          </Button>
        )}
      </div>

      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading && !overview && (
          <div className="col-span-2 flex justify-center py-6"><Loader2 className="h-5 w-5 text-white/30 animate-spin" /></div>
        )}
        {companies.map((co) => {
          const pp = co.payPeriod;
          const status = pp?.payPeriodStatus ?? "";
          const isSubmittable = ["new", "failed", "cancelled", ""].includes(status.toLowerCase());
          return (
            <div key={co.companyId} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Building2 className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                    <span className="text-white font-semibold text-sm">{co.companyName}</span>
                  </div>
                  <p className="text-white/30 text-xs font-mono pl-5">{co.rollfiCompanyId.slice(0, 8)}…</p>
                </div>
                {pp && <PayPeriodStatusBadge status={status} />}
              </div>

              {pp ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <p className="text-white/35 uppercase tracking-wide text-[10px] font-semibold">Period</p>
                    <p className="text-white/70">{pp.payPeriod ?? `${pp.payBeginDate} – ${pp.payEndDate}`}</p>
                  </div>
                  <div>
                    <p className="text-white/35 uppercase tracking-wide text-[10px] font-semibold">Pay Date</p>
                    <p className="text-white/70">{pp.payDate}</p>
                  </div>
                  <div>
                    <p className="text-white/35 uppercase tracking-wide text-[10px] font-semibold">Deadline</p>
                    <p className="text-white/70">{pp.deadLineToRunPayroll}</p>
                  </div>
                </div>
              ) : (
                <p className="text-white/30 text-xs italic">{co.error ? "Could not fetch pay period" : "No unprocessed period"}</p>
              )}

              <button
                onClick={() => onSelectCompany(co.companyId)}
                className="mt-auto flex items-center gap-1.5 text-xs font-semibold transition-colors"
                style={{ color: isSubmittable ? ORANGE : "rgba(255,255,255,0.3)" }}
              >
                {isSubmittable ? "Run payroll" : "View details"}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Run All results */}
      {runAllResults && (
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
              <span className="text-white/60 text-xs font-semibold">Run All Results</span>
              <button onClick={onDismissRunAll} className="text-white/30 hover:text-white/60 text-xs">Dismiss</button>
            </div>
            <div className="divide-y divide-white/5">
              {runAllResults.map((r) => (
                <div key={r.companyId} className="px-4 py-3 flex items-center gap-3">
                  {r.success ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : r.skipped ? (
                    <SkipForward className="h-4 w-4 text-white/30 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-white text-sm font-medium">{r.companyName}</span>
                    {r.reason && <span className="text-white/40 text-xs ml-2">{r.reason}</span>}
                    {r.error && <span className="text-red-300/70 text-xs ml-2">{r.error}</span>}
                  </div>
                  {r.success && <span className="text-emerald-400 text-xs font-semibold">Submitted ✓</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pay period history section ────────────────────────────────

function HistorySection({ periods, companyName, companyId, onViewStubs }: {
  periods: ProcessedPeriod[];
  companyName: string;
  companyId: string;
  onViewStubs: (p: ProcessedPeriod) => void;
}) {
  if (periods.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-white/40" />
        <h3 className="text-white/60 text-sm font-semibold">Recent Payroll History — {companyName}</h3>
      </div>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              {["Period", "Pay Date", "Status", "Gross Pay", "Est. Taxes", "Est. Net", "Debit", ""].map((h, i) => (
                <th key={i} className="text-left px-4 py-2.5 text-white/40 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {periods.map((p, i) => {
              const gross    = p.payrollAmount != null ? Number(p.payrollAmount) : null;
              const empTax   = gross != null ? r2(gross * 0.2465) : null;
              const net      = gross != null && empTax != null ? r2(gross - empTax) : null;
              const erTax    = gross != null ? r2(gross * 0.0875) : null;
              const debit    = gross != null && erTax != null ? r2(gross + erTax) : null;
              return (
                <tr key={p.payPeriodId ?? i} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white/70">
                    {p.payPeriod ?? (p.payBeginDate && p.payEndDate ? `${p.payBeginDate} – ${p.payEndDate}` : "—")}
                  </td>
                  <td className="px-4 py-3 text-white/50 whitespace-nowrap">{p.payDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.payPeriodStatus ? <PayPeriodStatusBadge status={p.payPeriodStatus} /> : <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">
                    {gross != null ? fmtD(gross) : "—"}
                  </td>
                  <td className="px-4 py-3 text-red-300/80">
                    {empTax != null ? `~${fmtD(empTax)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-white/70 font-semibold">
                    {net != null ? `~${fmtD(net)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-amber-300 font-semibold">
                    {debit != null ? `~${fmtD(debit)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onViewStubs(p)}
                      className="flex items-center gap-1 text-white/40 hover:text-orange-400 transition-colors text-xs font-medium whitespace-nowrap"
                    >
                      <Receipt className="h-3 w-3" />Pay Stubs
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 border-t border-white/5 text-[10px] text-white/20">
          Taxes and debit amounts are estimates based on standard NJ rates. Exact figures confirmed by Rollfi after processing.
        </p>
      </div>
    </div>
  );
}

// ── Company tasks panel (setup checklist per company) ─────────

function CompanyTasksPanel({ companyId, rollfiCompanyId }: { companyId: string; rollfiCompanyId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery<CompanyTasksData>({
    queryKey: ["rollfi-tasks", companyId],
    queryFn: () => api.get(`/rollfi/company-tasks?companyId=${companyId}`),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const retryKyb = useMutation({
    mutationFn: () => api.post("/rollfi/retry-kyb", { companyId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rollfi-tasks", companyId] });
    },
  });

  const retryBank = useMutation({
    mutationFn: () => api.post("/rollfi/onboard/verify-bank", { companyId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rollfi-tasks", companyId] });
    },
  });

  const tasks = data?.tasks ?? [];
  const hasKybFailure = tasks.some(t => t.description.toLowerCase().includes("kyb") && (t.description.toLowerCase().includes("failed") || t.description.toLowerCase().includes("failure")));
  const hasBankPending = tasks.some(t => t.task?.toLowerCase().includes("bank") || t.description.toLowerCase().includes("microdeposit") || t.description.toLowerCase().includes("micro deposit") || t.description.toLowerCase().includes("funding source"));

  return (
    <div className="border-t border-white/5">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) void refetch(); }}
        className="w-full px-5 py-2.5 flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />}
        <span className="font-semibold">Setup Checklist</span>
        {data && tasks.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300">{tasks.length}</span>
        )}
        {data && tasks.length === 0 && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
        <ChevronRight className={`h-3 w-3 ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-white/30 text-xs py-1"><Loader2 className="h-3 w-3 animate-spin" />Loading…</div>
          )}
          {data && tasks.length === 0 && (
            <div className="flex items-center gap-2 text-emerald-400/80 text-xs py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />All setup tasks completed — payroll is fully configured
            </div>
          )}
          <div className="space-y-1">
            {tasks.map((task, i) => {
              const isFailed  = task.description.toLowerCase().includes("failed") || task.description.toLowerCase().includes("error");
              const isPending = task.description.toLowerCase().includes("pending") || task.description.toLowerCase().includes("waiting");
              return (
                <div key={i} className="flex items-start gap-2.5 py-1.5 border-t border-white/5 first:border-t-0">
                  {isFailed
                    ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                    : isPending
                    ? <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-amber-400/80 shrink-0 mt-0.5" />}
                  <div>
                    <p className="text-white/80 text-xs font-semibold">{task.task}</p>
                    <p className="text-white/40 text-xs">{task.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {hasKybFailure && (
            <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
              <p className="text-[10px] text-amber-300/70">
                KYB failed because Rollfi rejects EINs already in their system. Click below to re-submit with a fresh random EIN — this usually resolves it automatically.
              </p>
              <Button
                size="sm"
                disabled={retryKyb.isPending}
                onClick={() => retryKyb.mutate()}
                className="h-6 px-2.5 text-[11px] font-medium"
                style={{ background: "rgba(245,158,11,0.7)" }}
              >
                {retryKyb.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Re-submitting KYB…</> : <><RefreshCw className="h-3 w-3 mr-1" />Retry KYB with new EIN</>}
              </Button>
              {retryKyb.isSuccess && (
                <p className="text-emerald-400/70 text-[10px] flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> KYB re-submitted — refresh checklist in ~60s to confirm
                </p>
              )}
              {retryKyb.isError && (
                <p className="text-red-400/70 text-[10px]">{(retryKyb.error as Error)?.message ?? "Retry failed"}</p>
              )}
            </div>
          )}

          {hasBankPending && (
            <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
              <p className="text-[10px] text-amber-300/70">
                Bank account is pending micro-deposit verification. Click below to attempt verification — Rollfi sandbox accepts any amounts so this should resolve it without support.
              </p>
              <Button
                size="sm"
                disabled={retryBank.isPending}
                onClick={() => retryBank.mutate()}
                className="h-6 px-2.5 text-[11px] font-medium"
                style={{ background: "rgba(59,130,246,0.6)" }}
              >
                {retryBank.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Verifying…</> : <><CheckCircle2 className="h-3 w-3 mr-1" />Verify Funding Source</>}
              </Button>
              {retryBank.isSuccess && (
                <p className="text-emerald-400/70 text-[10px] flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Verification submitted — refresh checklist in ~30s
                </p>
              )}
              {retryBank.isError && (
                <p className="text-red-400/70 text-[10px]">{(retryBank.error as Error)?.message ?? "Verification failed"}</p>
              )}
            </div>
          )}

          <p className="mt-2 pt-2 border-t border-white/5 text-[10px] text-white/20 font-mono">{rollfiCompanyId}</p>
        </div>
      )}
    </div>
  );
}

// ── Pay stubs drawer (per-employee breakdown for a period) ────

function PayStubsDrawer({ companyId, period, onClose }: {
  companyId: string;
  period: ProcessedPeriod;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery<PayStubsData>({
    queryKey: ["rollfi-stubs", companyId, period.payPeriodId],
    queryFn: () => api.get(`/rollfi/paystubs?companyId=${companyId}&payPeriodId=${period.payPeriodId ?? ""}&payBeginDate=${period.payBeginDate ?? ""}&payEndDate=${period.payEndDate ?? ""}`),
    staleTime: 120_000,
    retry: false,
  });

  const stubs = data?.stubs ?? [];
  const totalGross = stubs.reduce((s, e) => s + e.grossPay, 0);
  const totalNet   = stubs.reduce((s, e) => s + e.netPay, 0);
  const liveData   = stubs.some((s) => s.fromRollfi);

  return (
    <div className="mt-4 rounded-xl border border-orange-400/20 overflow-hidden" style={{ background: "rgba(40,67,98,0.5)" }}>
      <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-2.5">
          <Receipt className="h-4 w-4 text-orange-400" />
          <span className="text-white font-semibold text-sm">
            Pay Stubs — {period.payPeriod ?? (period.payBeginDate ? `${period.payBeginDate} – ${period.payEndDate}` : "Selected Period")}
          </span>
          {liveData && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Live from Rollfi</span>
          )}
          {!liveData && !isLoading && (
            <span className="text-[10px] text-amber-400/60 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Estimated</span>
          )}
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 text-xs">✕ Close</button>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 text-white/30 animate-spin" /></div>}
      {error && <div className="px-5 py-4 text-red-300 text-sm">{(error as Error).message}</div>}

      {!isLoading && stubs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                {["Employee", "Hours", "Gross Pay", "Fed Tax", "State Tax", "FICA", "Total Ded.", "Net Pay", "YTD Gross", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-white/40 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {stubs.map((stub) => {
                const empId = stub.employeeId ?? stub.rollfiUserId ?? "emp";
                const periodId = period.payPeriodId ?? "";
                const qp = new URLSearchParams({ period: period.payPeriod ?? "", payDate: period.payDate ?? "" }).toString();
                const paystubHref = `/paystub/${companyId}/${empId}/${periodId}?${qp}`;
                return (
                <tr key={stub.employeeId} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{stub.name}</div>
                    <div className="text-white/40 text-[11px]">{stub.position}</div>
                  </td>
                  <td className="px-4 py-3 text-white/70">{stub.hoursWorked}h</td>
                  <td className="px-4 py-3 text-emerald-400 font-bold">${stub.grossPay.toLocaleString()}</td>
                  <td className="px-4 py-3 text-red-300/80">${stub.federalTax.toLocaleString()}</td>
                  <td className="px-4 py-3 text-red-300/80">${stub.stateTax.toLocaleString()}</td>
                  <td className="px-4 py-3 text-red-300/80">${stub.fica.toLocaleString()}</td>
                  <td className="px-4 py-3 text-red-400 font-semibold">−${stub.deductions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-white font-bold">${stub.netPay.toLocaleString()}</td>
                  <td className="px-4 py-3 text-white/40">${stub.ytdGross.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <a
                      href={paystubHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-white/30 hover:text-orange-400 transition-colors whitespace-nowrap text-[11px]"
                    >
                      <Receipt className="h-3 w-3" /> Paystub
                    </a>
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <td className="px-4 py-3 text-white font-semibold" colSpan={2}>Totals</td>
                <td className="px-4 py-3 text-emerald-400 font-bold">${totalGross.toLocaleString()}</td>
                <td colSpan={4} />
                <td className="px-4 py-3 text-white font-bold">${totalNet.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {!liveData && (
            <p className="px-5 py-2.5 border-t border-white/5 text-[11px] text-white/30">
              Estimated figures based on hours × rate. Rollfi detailed stub data requires a fully processed pay period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function Payroll() {
  const [tab, setTab] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [payPeriod, setPayPeriod] = useState<PayPeriod | null>(null);
  const [payPeriodFetchFailed, setPayPeriodFetchFailed] = useState(false);
  const [payPeriodFetching, setPayPeriodFetching] = useState(false);
  const [payPeriodCompanyId, setPayPeriodCompanyId] = useState<string>("");
  const [payrollResult, setPayrollResult] = useState<PayrollResult | null>(null);
  const [empStatuses, setEmpStatuses] = useState<Record<string, EmpRollfiStatus[]>>({});
  const [empStatusLoading, setEmpStatusLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [runAllResults, setRunAllResults] = useState<RunAllResult[] | null>(null);
  const [adjustments, setAdjustments] = useState<AdjMap>({});
  const [adjOpen, setAdjOpen] = useState(false);
  const [stubsPeriod, setStubsPeriod] = useState<ProcessedPeriod | null>(null);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [singleEmpStatus, setSingleEmpStatus] = useState<Record<string, EmpRollfiStatus & { loading?: boolean }>>({});
  const [selectedHistoryPeriodId, setSelectedHistoryPeriodId] = useState<string | null>(null);
  const autoFetchedRef = useRef<string>("");
  const qc = useQueryClient();

  const { data: state, isLoading: stateLoading, refetch: refetchState } = useQuery<RollfiState>({
    queryKey: ["rollfi-state"],
    queryFn: () => api.get("/rollfi/state"),
    refetchInterval: false,
  });

  const companies = state?.companies ?? [];
  const employees = state?.employees ?? [];
  const allCompaniesOnboarded = companies.length > 0 && companies.every((c) => c.rollfi);
  const anyCompanyOnboarded   = companies.some((c) => c.rollfi);

  const retryKyc = useMutation({
    mutationFn: ({ rollfiUserId, companyId }: { rollfiUserId: string; companyId: string }) =>
      api.post(`/rollfi/employees/${rollfiUserId}/retry-kyc`, { companyId }),
    onSuccess: (_data, vars) => {
      void checkSingleEmpStatus(vars.rollfiUserId, vars.companyId);
    },
  });

  const fixWage = useMutation({
    mutationFn: ({ rollfiUserId, companyId }: { rollfiUserId: string; companyId: string }) =>
      api.post(`/rollfi/employees/${rollfiUserId}/fix-wage`, { companyId }),
  });

  const checkSingleEmpStatus = useCallback(async (rollfiUserId: string, companyId: string) => {
    setSingleEmpStatus((prev) => ({ ...prev, [rollfiUserId]: { ...prev[rollfiUserId], rollfiUserId, userStatus: "", kycStatus: "", loading: true } }));
    try {
      const d = await api.get<{ employees: EmpRollfiStatus[] }>(`/rollfi/employees/status?companyId=${companyId}`);
      const found = d.employees.find((e) => e.rollfiUserId === rollfiUserId);
      if (found) setSingleEmpStatus((prev) => ({ ...prev, [rollfiUserId]: { ...found, loading: false } }));
      else setSingleEmpStatus((prev) => ({ ...prev, [rollfiUserId]: { rollfiUserId, userStatus: "Unknown", kycStatus: "Unknown", loading: false } }));
    } catch {
      setSingleEmpStatus((prev) => ({ ...prev, [rollfiUserId]: { rollfiUserId, userStatus: "Error", kycStatus: "Error", loading: false } }));
    }
  }, []);
  const employeesForCompany = (cId: string) => employees.filter((e) => e.companyId === cId);

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<{ companies: CompanyOverview[] }>({
    queryKey: ["rollfi-overview"],
    queryFn: () => api.get("/rollfi/payroll/overview"),
    enabled: allCompaniesOnboarded,
    staleTime: 30_000,
  });

  const { data: preview, isLoading: previewLoading, refetch: refetchPreview } = useQuery<PayrollPreview>({
    queryKey: ["rollfi-preview", selectedCompanyId],
    queryFn: () => api.get(`/rollfi/payroll/preview${selectedCompanyId !== "all" ? `?companyId=${selectedCompanyId}` : ""}`),
    enabled: tab === 2,
  });

  const { data: history } = useQuery<{ periods: ProcessedPeriod[] }>({
    queryKey: ["rollfi-history", selectedCompanyId],
    queryFn: () => api.get(`/rollfi/payperiod/history?companyId=${selectedCompanyId}`),
    enabled: tab === 2 && selectedCompanyId !== "all" && !!companies.find((c) => c.id === selectedCompanyId)?.rollfi,
    staleTime: 60_000,
    retry: false,
  });

  const activePeriodId = selectedHistoryPeriodId ?? payPeriod?.payPeriodId;
  const { data: payPeriodDetails } = useQuery<RollfiPeriodDetailsResponse>({
    queryKey: ["rollfi-period-details", selectedCompanyId, activePeriodId],
    queryFn: () => api.get(`/rollfi/payperiod/details?companyId=${selectedCompanyId}&payPeriodId=${encodeURIComponent(activePeriodId!)}`),
    enabled: !!activePeriodId && selectedCompanyId !== "all" && tab === 2,
    retry: false,
    staleTime: 60_000,
  });

  const onboardCompany = useMutation({
    mutationFn: (companyId: string) => api.post("/rollfi/onboard/company", { companyId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["rollfi-state"] }); },
  });

  const onboardEmployee = useMutation({
    mutationFn: ({ employeeId, companyId }: { employeeId: string; companyId: string }) =>
      api.post("/rollfi/onboard/employee", { employeeId, companyId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rollfi-state"] });
      void qc.invalidateQueries({ queryKey: ["rollfi-preview"] });
    },
  });

  const fetchPayPeriod = useCallback(async (companyId: string) => {
    setPayPeriodCompanyId(companyId);
    setPayPeriodFetching(true);
    setPayPeriodFetchFailed(false);
    try {
      const data = await api.get<PayPeriod>(`/rollfi/payperiod?companyId=${companyId}`);
      setPayPeriod(data);
      setPayPeriodFetchFailed(false);
    } catch (e) {
      setPayPeriod(null);
      setPayPeriodFetchFailed(true);
      console.warn("Failed to get pay period:", (e as Error).message);
    } finally {
      setPayPeriodFetching(false);
    }
  }, []);

  const fetchEmpStatuses = useCallback(async (cos: CompanyState[]) => {
    const rollfiCos = cos.filter((c) => c.rollfi);
    if (rollfiCos.length === 0) return;
    setEmpStatusLoading(true);
    try {
      const results = await Promise.all(
        rollfiCos.map((c) =>
          api.get<{ employees: EmpRollfiStatus[] }>(`/rollfi/employees/status?companyId=${c.id}`)
            .then((d) => [c.id, d.employees] as [string, EmpRollfiStatus[]])
            .catch(() => [c.id, []] as [string, EmpRollfiStatus[]])
        )
      );
      setEmpStatuses(Object.fromEntries(results));
    } finally {
      setEmpStatusLoading(false);
    }
  }, []);

  const runAll = useMutation({
    mutationFn: () => api.post<{ results: RunAllResult[] }>("/rollfi/payroll/run-all", {}),
    onSuccess: (data) => {
      setRunAllResults(data.results);
      void refetchOverview();
    },
  });

  const submitPayroll = useMutation({
    mutationFn: ({ companyId, payPeriodId, payBeginDate, payEndDate, adjs, employeeHours }: { companyId: string; payPeriodId: string; payBeginDate?: string; payEndDate?: string; adjs?: { rollfiUserId: string; bonusPay?: number; overtimePay?: number }[]; employeeHours?: { rollfiUserId: string; hours: number }[] }) =>
      api.post<PayrollResult>("/rollfi/payroll/initiate", { companyId, payPeriodId, payBeginDate, payEndDate, adjustments: adjs, employeeHours }),
    onSuccess: (data) => {
      setPayrollResult(data);
      setIsPolling(true);
      setTimeout(() => { void fetchPayPeriod(selectedCompanyId); }, 1500);
      void refetchOverview();
    },
    onError: (e) => { setPayrollResult({ success: false, error: (e as Error).message }); },
  });

  const verifyBank = useMutation({
    mutationFn: (companyId: string) => api.post("/rollfi/onboard/verify-bank", { companyId }),
    onSuccess: () => {
      setPayrollResult(null);
      void qc.invalidateQueries({ queryKey: ["rollfi-tasks"] });
      setTimeout(() => { void fetchPayPeriod(selectedCompanyId); }, 1000);
    },
  });

  // Auto-fetch employee statuses when entering tab 1
  useEffect(() => {
    if (tab === 1 && companies.length > 0) void fetchEmpStatuses(companies);
  }, [tab, companies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch pay period when entering tab 2
  useEffect(() => {
    if (tab !== 2) return;
    const compId = selectedCompanyId !== "all" ? selectedCompanyId : companies.find((c) => c.rollfi)?.id;
    if (!compId || autoFetchedRef.current === compId) return;
    const comp = companies.find((c) => c.id === compId);
    if (!comp?.rollfi) return;
    autoFetchedRef.current = compId;
    if (selectedCompanyId === "all") setSelectedCompanyId(compId);
    void fetchPayPeriod(compId);
  }, [tab, selectedCompanyId, companies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch pay period on company change in tab 2
  useEffect(() => {
    if (tab !== 2 || selectedCompanyId === "all") return;
    const comp = companies.find((c) => c.id === selectedCompanyId);
    if (!comp?.rollfi) return;
    void fetchPayPeriod(selectedCompanyId);
  }, [selectedCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll pay period status after submission
  useEffect(() => {
    if (!isPolling || !payPeriodCompanyId) return;
    const timer = setInterval(async () => {
      try {
        const data = await api.get<PayPeriod>(`/rollfi/payperiod?companyId=${payPeriodCompanyId}`);
        setPayPeriod(data);
        if (["processed", "failed", "returned", "skipped"].includes(data.payPeriodStatus.toLowerCase())) setIsPolling(false);
      } catch { setIsPolling(false); }
    }, 4000);
    return () => clearInterval(timer);
  }, [isPolling, payPeriodCompanyId]);

  // Rollfi statuses that mean "this period is ready to run". Anything not in
  // this list (submitted, processed, returned, skipped) means it's already done.
  const submittableStatuses = ["new", "preprocess", "inprocess", "cancelled", "failed"];
  const periodSubmittable = !payPeriod || submittableStatuses.includes(payPeriod.payPeriodStatus.toLowerCase());
  const getRollfiStatus = (companyId: string, rollfiUserId: string | undefined) =>
    rollfiUserId ? (empStatuses[companyId]?.find((s) => s.rollfiUserId.toUpperCase() === rollfiUserId.toUpperCase()) ?? null) : null;

  const selectedCompanyName = companies.find((c) => c.id === selectedCompanyId)?.name ?? "";
  const activeHistoryPeriod = selectedHistoryPeriodId
    ? (history?.periods.find((p) => p.payPeriodId === selectedHistoryPeriodId) ?? null)
    : null;

  return (
    <div className="min-h-screen" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, #1a2e45 100%)` }}>
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: ORANGE }}>
                <DollarSign className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Payroll</h1>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-white/70 border border-white/20">Powered by Rollfi</span>
            </div>
            <p className="text-white/50 text-sm ml-12">Bi-weekly payroll processing for daycare staff</p>
          </div>
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5" onClick={() => { void refetchState(); void refetchOverview(); }}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Payroll overview — shown when all companies are onboarded */}
        {allCompaniesOnboarded && (
          <PayrollOverviewPanel
            overview={overview}
            loading={overviewLoading}
            onSelectCompany={(id) => { setSelectedCompanyId(id); autoFetchedRef.current = ""; setTab(2); void refetchPreview(); }}
            runAll={{ mutate: () => runAll.mutate(), isPending: runAll.isPending }}
            runAllResults={runAllResults}
            onDismissRunAll={() => setRunAllResults(null)}
          />
        )}

        <Steps current={tab} />

        {/* ── Tab 0: Companies ───────────────────────────── */}
        {tab === 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-orange-400" />Daycare Companies</h2>
              <p className="text-white/40 text-xs">Register each company with Rollfi to enable payroll</p>
            </div>

            {stateLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>}

            <div className="grid gap-4">
              {companies.map((company) => (
                <div key={company.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{company.name}</span>
                        <StatusBadge onboarded={!!company.rollfi} />
                      </div>
                      {company.address && <p className="text-white/40 text-xs">{company.address}</p>}
                      {company.rollfi && <p className="text-white/30 text-xs mt-1 font-mono">Rollfi ID: {company.rollfi.rollfiCompanyId}</p>}
                    </div>
                    <Button size="sm" disabled={!!company.rollfi || onboardCompany.isPending} onClick={() => onboardCompany.mutate(company.id)}
                      className="shrink-0 text-white font-semibold"
                      style={{ background: company.rollfi ? "rgba(255,255,255,0.1)" : ORANGE, opacity: company.rollfi ? 0.6 : 1 }}>
                      {onboardCompany.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : company.rollfi ? "Registered ✓" : "Register with Rollfi"}
                    </Button>
                  </div>
                  {company.rollfi && (
                    <CompanyTasksPanel companyId={company.id} rollfiCompanyId={company.rollfi.rollfiCompanyId} />
                  )}
                </div>
              ))}
            </div>

            {onboardCompany.isError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{onboardCompany.error?.message}</div>
            )}

            <div className="mt-6 flex justify-end items-center gap-3">
              {!allCompaniesOnboarded && anyCompanyOnboarded && (
                <p className="text-white/30 text-xs">Some companies not yet registered — you can still proceed with registered ones</p>
              )}
              <Button disabled={!anyCompanyOnboarded} onClick={() => setTab(1)} className="gap-2 text-white font-semibold"
                style={{ background: anyCompanyOnboarded ? ORANGE : "rgba(255,255,255,0.1)" }}>
                Next: Add Employees <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab 1: Employees ───────────────────────────── */}
        {tab === 1 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-orange-400" />Staff Employees</h2>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-white/40 hover:text-white/70 gap-1.5 h-7 text-xs"
                  disabled={empStatusLoading} onClick={() => void fetchEmpStatuses(companies)}>
                  {empStatusLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Sync Rollfi Status
                </Button>
                <Button variant="ghost" size="sm" className="text-white/50 hover:text-white gap-1" onClick={() => setTab(0)}>← Back</Button>
              </div>
            </div>

            {!allCompaniesOnboarded && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-amber-300 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Register all companies first before adding employees.
              </div>
            )}
            {stateLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>}

            <div className="grid gap-6">
              {companies.map((company) => {
                const compEmployees = employeesForCompany(company.id);
                const allEmpOnboarded = compEmployees.length > 0 && compEmployees.every((e) => e.rollfi);
                const statusList = empStatuses[company.id] ?? [];
                const activeCount = statusList.filter((s) => s.userStatus.toLowerCase() === "active").length;
                return (
                  <div key={company.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="h-4 w-4 text-orange-400" />
                        <span className="text-white font-semibold text-sm">{company.name}</span>
                        <span className="text-white/30 text-xs">({compEmployees.length} staff)</span>
                        {statusList.length > 0 && <span className="text-emerald-400/60 text-xs">· {activeCount}/{statusList.length} active in Rollfi</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {company.rollfi && !allEmpOnboarded && (
                          <Button size="sm" variant="ghost" className="text-xs text-orange-400 hover:text-orange-300 hover:bg-orange-400/10 h-7"
                            disabled={onboardEmployee.isPending}
                            onClick={async () => {
                              for (const emp of compEmployees.filter((e) => !e.rollfi && e.employeeId))
                                await onboardEmployee.mutateAsync({ employeeId: emp.employeeId!, companyId: company.id });
                            }}>Add All to Rollfi</Button>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-white/5">
                      {compEmployees.map((emp) => {
                        const rowKey = emp.employeeId ?? emp.userId;
                        const isExpanded = expandedEmpId === rowKey;
                        const rollfiStatus = emp.rollfi?.rollfiUserId
                          ? (singleEmpStatus[emp.rollfi.rollfiUserId] ?? getRollfiStatus(company.id, emp.rollfi.rollfiUserId))
                          : null;
                        return (
                          <React.Fragment key={rowKey}>
                            {/* Clickable summary row */}
                            <div
                              className="px-5 py-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/5 transition-colors select-none"
                              onClick={() => setExpandedEmpId(isExpanded ? null : rowKey)}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-white/30 text-[10px] w-3 shrink-0">{isExpanded ? "▲" : "▼"}</span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-white text-sm font-medium">{emp.name}</span>
                                    <StatusBadge onboarded={!!emp.rollfi} />
                                    {rollfiStatus && !rollfiStatus.loading && <UserStatusBadge userStatus={rollfiStatus.userStatus} kycStatus={rollfiStatus.kycStatus} />}
                                    {rollfiStatus?.loading && <Loader2 className="h-3 w-3 text-white/30 animate-spin" />}
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-white/40 text-xs">{emp.position}</span>
                                    <span className="text-white/30 text-xs">·</span>
                                    <span className="text-white/40 text-xs">${(emp.hourlyWage / 100).toFixed(2)}/hr</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {!emp.rollfi && (
                                  <Button size="sm"
                                    disabled={!company.rollfi || onboardEmployee.isPending || !emp.employeeId}
                                    onClick={() => emp.employeeId && onboardEmployee.mutate({ employeeId: emp.employeeId, companyId: company.id })}
                                    className="text-white text-xs"
                                    style={{ background: company.rollfi ? ORANGE : "rgba(255,255,255,0.08)", opacity: !company.rollfi ? 0.5 : 1 }}>
                                    {onboardEmployee.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : !company.rollfi ? "Register company first" : "Add to Rollfi"}
                                  </Button>
                                )}
                                {emp.rollfi && (
                                  <span className="text-emerald-400/70 text-xs flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Added
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Expanded detail panel */}
                            {isExpanded && (
                              <div className="px-5 py-4 border-t border-white/5" style={{ background: "rgba(20,40,65,0.6)" }}>
                                <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                                  <div>
                                    <p className="text-white/35 uppercase tracking-wide text-[10px] font-semibold mb-1">Rollfi Status</p>
                                    {emp.rollfi ? (
                                      rollfiStatus ? (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="text-white/50 w-20">Account</span>
                                            {rollfiStatus.loading
                                              ? <Loader2 className="h-3 w-3 text-white/30 animate-spin" />
                                              : <UserStatusBadge userStatus={rollfiStatus.userStatus} kycStatus={rollfiStatus.kycStatus} />}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-white/50 w-20">KYC</span>
                                            <span className={`text-xs font-semibold ${rollfiStatus.kycStatus?.toLowerCase() === "passed" ? "text-emerald-400" : rollfiStatus.kycStatus?.toLowerCase() === "failed" ? "text-red-400" : "text-amber-400"}`}>
                                              {rollfiStatus.kycStatus || "—"}
                                            </span>
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-white/30 text-xs italic">Not checked yet</span>
                                      )
                                    ) : (
                                      <span className="text-white/30 text-xs italic">Not onboarded</span>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-white/35 uppercase tracking-wide text-[10px] font-semibold mb-1">Rollfi ID</p>
                                    {emp.rollfi ? (
                                      <span className="text-white/50 font-mono text-[11px] break-all">{emp.rollfi.rollfiUserId}</span>
                                    ) : (
                                      <span className="text-white/20 text-xs italic">—</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {emp.rollfi?.rollfiUserId && (
                                    <Button size="sm" variant="ghost"
                                      className="text-xs text-white/60 hover:text-white border border-white/10 h-7 gap-1.5"
                                      disabled={!!rollfiStatus?.loading}
                                      onClick={() => void checkSingleEmpStatus(emp.rollfi!.rollfiUserId, company.id)}>
                                      {rollfiStatus?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                      Check Rollfi Status
                                    </Button>
                                  )}
                                  {emp.rollfi?.rollfiUserId && (
                                    <Button size="sm" variant="ghost"
                                      className="text-xs text-white/60 hover:text-white border border-white/10 h-7 gap-1.5"
                                      disabled={fixWage.isPending && fixWage.variables?.rollfiUserId === emp.rollfi.rollfiUserId}
                                      title={`Correct wage to $${(emp.hourlyWage / 100).toFixed(2)}/hr in Rollfi`}
                                      onClick={() => fixWage.mutate({ rollfiUserId: emp.rollfi!.rollfiUserId, companyId: company.id })}>
                                      {fixWage.isPending && fixWage.variables?.rollfiUserId === emp.rollfi.rollfiUserId
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <DollarSign className="h-3 w-3" />}
                                      Fix Wage
                                    </Button>
                                  )}
                                  {fixWage.isSuccess && fixWage.variables?.rollfiUserId === emp.rollfi?.rollfiUserId && (
                                    <span className="text-emerald-400/70 text-xs flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> Wage corrected to ${(emp.hourlyWage / 100).toFixed(2)}/hr
                                    </span>
                                  )}
                                  {fixWage.isError && fixWage.variables?.rollfiUserId === emp.rollfi?.rollfiUserId && (
                                    <span className="text-red-400/70 text-xs">{(fixWage.error as Error)?.message ?? "Wage fix failed"}</span>
                                  )}
                                  {emp.rollfi?.rollfiUserId && rollfiStatus && !rollfiStatus.loading && (rollfiStatus.kycStatus?.toLowerCase() === "new" || rollfiStatus.userStatus?.toLowerCase() === "pending") && (
                                    <Button size="sm"
                                      disabled={retryKyc.isPending}
                                      onClick={() => retryKyc.mutate({ rollfiUserId: emp.rollfi!.rollfiUserId, companyId: company.id })}
                                      className="text-white text-xs h-7 gap-1.5"
                                      style={{ background: "rgba(245,158,11,0.7)" }}>
                                      {retryKyc.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Zap className="h-3 w-3" /> Complete KYC</>}
                                    </Button>
                                  )}
                                  {retryKyc.isSuccess && retryKyc.variables?.rollfiUserId === emp.rollfi?.rollfiUserId && (
                                    <span className="text-emerald-400/70 text-xs flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> KYC initiated</span>
                                  )}
                                  {retryKyc.isError && retryKyc.variables?.rollfiUserId === emp.rollfi?.rollfiUserId && (() => {
                                    const msg = (retryKyc.error as Error)?.message ?? "KYC retry failed";
                                    const isKybBlocked = msg.toLowerCase().includes("kyb");
                                    return isKybBlocked ? (
                                      <div className="flex items-start gap-1.5 text-amber-400/80 text-xs max-w-xs">
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                        <span>KYC blocked — company KYB must pass first. The company&apos;s business verification failed in Rollfi (sandbox limitation with test data).</span>
                                      </div>
                                    ) : (
                                      <span className="text-red-400/70 text-xs">{msg}</span>
                                    );
                                  })()}
                                  {!emp.rollfi && company.rollfi && emp.employeeId && (
                                    <Button size="sm"
                                      disabled={onboardEmployee.isPending}
                                      onClick={() => onboardEmployee.mutate({ employeeId: emp.employeeId!, companyId: company.id })}
                                      className="text-white text-xs h-7 gap-1.5"
                                      style={{ background: ORANGE }}>
                                      {onboardEmployee.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Users className="h-3 w-3" /> Onboard to Rollfi</>}
                                    </Button>
                                  )}
                                  {!emp.rollfi && !company.rollfi && (
                                    <p className="text-amber-400/60 text-xs flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Register the company first to onboard this employee</p>
                                  )}
                                  {!emp.rollfi && (
                                    <button
                                      className="text-white/20 hover:text-red-400 transition-colors text-xs flex items-center gap-1 ml-auto"
                                      title="Remove employee"
                                      onClick={async () => {
                                        if (!confirm(`Remove ${emp.name}?`)) return;
                                        await api.delete(`/rollfi/employees/${emp.userId}`);
                                        void refetchState();
                                      }}>
                                      <Trash2 className="h-3 w-3" /> Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {onboardEmployee.isError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{onboardEmployee.error?.message}</div>
            )}
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => setTab(0)} className="text-white/60 hover:text-white">← Back</Button>
              <Button onClick={() => { setTab(2); void refetchPreview(); }} className="gap-2 text-white font-semibold" style={{ background: ORANGE }}>
                Next: Run Payroll <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab 2: Run Payroll ─────────────────────────── */}
        {tab === 2 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4 text-orange-400" />Payroll Preview</h2>
              <Button variant="ghost" size="sm" className="text-white/50 hover:text-white gap-1" onClick={() => setTab(1)}>← Back</Button>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-white/40 text-xs">Company</span>
                <select value={selectedCompanyId}
                  onChange={(e) => { setSelectedCompanyId(e.target.value); setPayrollResult(null); autoFetchedRef.current = ""; setSelectedHistoryPeriodId(null); }}
                  className="bg-transparent text-white text-sm outline-none">
                  <option value="all">All Companies</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Button variant="ghost" size="sm" className="text-white/60 hover:text-white gap-1.5 border border-white/10" onClick={() => void refetchPreview()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              {selectedCompanyId !== "all" && companies.find((c) => c.id === selectedCompanyId)?.rollfi && (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <Clock className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  <select
                    value={selectedHistoryPeriodId ?? ""}
                    onChange={(e) => setSelectedHistoryPeriodId(e.target.value || null)}
                    className="bg-transparent text-white/80 text-sm outline-none cursor-pointer"
                  >
                    {payPeriodFetching
                      ? <option value="">Fetching current period…</option>
                      : payPeriod
                        ? <option value="">{payPeriod.payBeginDate} → {payPeriod.payEndDate} ({payPeriod.payPeriodStatus})</option>
                        : <option value="">No current period</option>
                    }
                    {history?.periods.map((p) => (
                      <option key={p.payPeriodId ?? p.payBeginDate} value={p.payPeriodId ?? ""}>
                        {p.payBeginDate} → {p.payEndDate} ({p.payPeriodStatus ?? "Processed"}) ✓
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Pay period card */}
            {activeHistoryPeriod ? (
              <div className="mb-4 p-4 rounded-xl border border-green-500/20 bg-green-500/5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Period</p><p className="text-white text-sm font-medium">{activeHistoryPeriod.payPeriod ?? `${activeHistoryPeriod.payBeginDate} – ${activeHistoryPeriod.payEndDate}`}</p></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Date</p><p className="text-white text-sm">{activeHistoryPeriod.payDate ?? "—"}</p></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Status</p><PayPeriodStatusBadge status={String(activeHistoryPeriod.payPeriodStatus ?? "Processed")} /></div>
                  <div className="ml-auto"><span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-400 font-semibold">✅ Confirmed by Rollfi</span></div>
                </div>
              </div>
            ) : payPeriod ? (
              <div className="mb-4 p-4 rounded-xl border border-white/10 bg-white/5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Period</p><p className="text-white text-sm font-medium">{payPeriod.payPeriod}</p></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Date</p><p className="text-white text-sm">{payPeriod.payDate}</p></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Status</p><PayPeriodStatusBadge status={payPeriod.payPeriodStatus} /></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Deadline</p><p className="text-white text-sm">{payPeriod.deadLineToRunPayroll}</p></div>
                  <div><p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Period ID</p><p className="text-white/40 text-xs font-mono">{payPeriod.payPeriodId.slice(0, 8)}…</p></div>
                  {isPolling && <div className="ml-auto flex items-center gap-1.5 text-orange-300/70 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Watching for updates…</div>}
                </div>
              </div>
            ) : null}

            {selectedHistoryPeriodId && activeHistoryPeriod ? (
              <div className="space-y-4">
                {!payPeriodDetails ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/30 animate-spin" /></div>
                ) : (() => {
                  const rollfiPd = payPeriodDetails.payPeriod?.[0];
                  if (!rollfiPd) return <p className="text-white/30 text-sm text-center py-8">No payroll details available for this period.</p>;
                  const histGross  = r2(rollfiPd.payrollLineItems.reduce((s, e) => s + (e.grossTotal ?? 0), 0));
                  const histNet    = r2(rollfiPd.payrollLineItems.reduce((s, e) => s + (e.netTotal ?? 0), 0));
                  const histEmpTax = r2(rollfiPd.employeeTaxSum);
                  const histErTax  = r2(rollfiPd.employerTaxSum);
                  const histDebit  = r2(rollfiPd.total);
                  return (
                    <div className="rounded-xl border border-white/10 overflow-hidden">
                      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <p className="text-white font-semibold text-sm">Confirmed Payroll Totals</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-400 font-semibold">✅ Confirmed by Rollfi</span>
                      </div>
                      <div className="px-5 py-4 grid grid-cols-2 gap-6 text-xs border-b border-white/5">
                        <div>
                          <p className="text-white/40 font-bold uppercase tracking-wide text-[10px] mb-2">Employee Payments</p>
                          <div className="flex justify-between py-1"><span className="text-white/60">Total Gross Pay</span><span className="text-emerald-400 font-semibold">{fmtD(histGross)}</span></div>
                          <div className="flex justify-between py-1"><span className="text-white/60">Total Employee Taxes</span><span className="text-red-300">−{fmtD(histEmpTax)}</span></div>
                          <div className="flex justify-between py-1 border-t border-white/10 mt-1 pt-2 font-semibold"><span className="text-white/80">Total Net Pay to Staff</span><span className="text-white">{fmtD(histNet)}</span></div>
                        </div>
                        <div>
                          <p className="text-white/40 font-bold uppercase tracking-wide text-[10px] mb-2">Employer Costs</p>
                          <div className="flex justify-between py-1 font-semibold"><span className="text-white/60">Total Employer Taxes</span><span className="text-amber-300">+{fmtD(histErTax)}</span></div>
                        </div>
                      </div>
                      <div className="px-5 py-4 flex items-center justify-between border-t border-amber-500/30" style={{ background: "rgba(232,98,42,0.08)" }}>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                          <div>
                            <p className="text-amber-300 font-bold text-sm">Total Bank Debit</p>
                            <p className="text-green-400/70 text-[11px]">✅ Confirmed by Rollfi{activeHistoryPeriod.payDate ? ` · Debited on ${activeHistoryPeriod.payDate}` : ""}</p>
                          </div>
                        </div>
                        <p className="text-amber-300 font-bold text-2xl">{fmtD(histDebit)}</p>
                      </div>
                    </div>
                  );
                })()}
                <PayStubsDrawer
                  companyId={selectedCompanyId}
                  period={activeHistoryPeriod}
                  onClose={() => setSelectedHistoryPeriodId(null)}
                />
              </div>
            ) : (
              <>
                {previewLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>}

                {preview && !previewLoading && (
                  <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-white/40 text-xs">Period: {preview.period.from} → {preview.period.to} ({preview.period.workdays} workdays)</p>
                  {!preview.allOnboarded && (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs"><AlertTriangle className="h-3.5 w-3.5" />Some employees not yet onboarded</div>
                  )}
                </div>

                {/* Tax status indicator — Change 7 */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[11px] font-semibold">
                    <Clock className="h-3 w-3" /> Estimated Taxes
                  </span>
                  <span className="text-white/30 text-[11px]">Exact amounts confirmed after Rollfi processes payroll</span>
                </div>

                {/* Preview table — Change 1 & 2 */}
                <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.06)" }}>
                        {["Employee", "Worked", "Net Hrs", "Rate", "Gross Pay", "Est. Tax", "~Net Pay", "Rollfi"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-white/50 font-semibold text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {preview.employees.map((emp) => {
                        const tax = calcEmpTax(emp.grossPay);
                        const er  = calcErTax(emp.grossPay);
                        const key = emp.employeeId ?? emp.name;
                        const isExpanded = expandedEmp === key;
                        return (
                          <React.Fragment key={key}>
                            <tr
                              className="hover:bg-white/5 transition-colors cursor-pointer select-none"
                              onClick={() => setExpandedEmp(isExpanded ? null : key)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-white/30 text-[10px] w-3">{isExpanded ? "▲" : "▼"}</span>
                                  <div>
                                    <div className="text-white font-medium">{emp.name}</div>
                                    <div className="text-white/40 text-xs">{emp.position}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white/70">{emp.hoursWorked}h</span>
                                  {(emp.hoursSource === "easyteam_sync") && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Approved</span>}
                                  {(emp.hoursSource === "manager_edit") && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/20">Mgr Edited</span>}
                                  {(emp.hoursSource === "easyteam") && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Approved</span>}
                                  {(emp.hoursSource === "seeded") && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Approved</span>}
                                  {(emp.hoursSource === "pending_approval") && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/20">Pending Approval</span>}
                                  {(!emp.hoursSource || emp.hoursSource === "estimated") && <span className="text-[10px] px-1 py-0.5 rounded text-white/20">est.</span>}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-white font-semibold">{emp.netPayableHours}h</td>
                              <td className="px-4 py-3 text-white/70">${emp.hourlyRate.toFixed(2)}/hr</td>
                              <td className="px-4 py-3 text-emerald-400 font-bold">{fmtD(emp.grossPay)}</td>
                              <td className="px-4 py-3 text-red-300/80 text-xs">~{fmtD(tax.total)}</td>
                              <td className="px-4 py-3 text-white font-semibold text-xs">~{fmtD(tax.net)}</td>
                              <td className="px-4 py-3">{emp.onboardedToRollfi ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-white/20" />}</td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${key}-exp`}>
                                <td colSpan={8} className="px-4 py-0">
                                  <div className="my-3 rounded-lg border border-white/10 overflow-hidden text-xs" style={{ background: "rgba(20,40,65,0.7)" }}>
                                    <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
                                      <span className="font-semibold text-white/80">{emp.name} — Full Pay Breakdown</span>
                                      <span className="text-white/30 text-[10px]">{emp.position}</span>
                                    </div>
                                    <div className="px-4 py-3 grid grid-cols-2 gap-6">
                                      <div className="space-y-0.5">
                                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-2">Earnings</p>
                                        <div className="flex justify-between py-1"><span className="text-white/50">Regular: {emp.netPayableHours}h × ${emp.hourlyRate.toFixed(2)}</span><span className="text-emerald-400">{fmtD(emp.grossPay)}</span></div>
                                        <div className="flex justify-between py-1 border-t border-white/10 font-semibold"><span className="text-white/70">Gross Pay</span><span className="text-emerald-400">{fmtD(emp.grossPay)}</span></div>
                                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mt-3 mb-2">Employee Deductions (estimated)</p>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Federal Income Tax (12%)</span><span className="text-red-300">−{fmtD(tax.federal)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">NJ State Tax (5%)</span><span className="text-red-300">−{fmtD(tax.state)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Social Security (6.2%)</span><span className="text-red-300">−{fmtD(tax.ss)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Medicare (1.45%)</span><span className="text-red-300">−{fmtD(tax.medicare)}</span></div>
                                        <div className="flex justify-between py-1 border-t border-white/10 font-semibold"><span className="text-white/70">Total Deductions</span><span className="text-red-400">−{fmtD(tax.total)}</span></div>
                                        <div className="flex justify-between py-1 border-t border-white/10 font-bold"><span className="text-white">Net Pay (estimated)</span><span className="text-white">{fmtD(tax.net)}</span></div>
                                      </div>
                                      <div className="space-y-0.5">
                                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-2">Employer Costs</p>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Employer SS (6.2%)</span><span className="text-amber-300">+{fmtD(er.ss)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Employer Medicare (1.45%)</span><span className="text-amber-300">+{fmtD(er.medicare)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">Federal Unemployment (0.6%)</span><span className="text-amber-300">+{fmtD(er.futa)}</span></div>
                                        <div className="flex justify-between py-0.5"><span className="text-white/50">NJ State Unemployment (0.5%)</span><span className="text-amber-300">+{fmtD(er.njSui)}</span></div>
                                        <div className="flex justify-between py-1 border-t border-white/10 font-semibold"><span className="text-white/70">Total Employer Burden</span><span className="text-amber-300">+{fmtD(er.total)}</span></div>
                                        <div className="mt-3 pt-3 border-t border-white/10">
                                          <div className="flex justify-between font-bold"><span className="text-white">Total Cost (This Employee)</span><span className="text-white">{fmtD(r2(emp.grossPay + er.total))}</span></div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                        <td className="px-4 py-3 text-white font-semibold" colSpan={4}>Total Gross Pay</td>
                        <td className="px-4 py-3 text-emerald-400 font-bold text-base">{fmtD(preview.totalGrossPay)}</td>
                        <td className="px-4 py-3 text-red-300/80 text-xs font-semibold">~{fmtD(r2(preview.totalGrossPay * 0.2465))}</td>
                        <td className="px-4 py-3 text-white font-bold text-xs">~{fmtD(r2(preview.totalGrossPay * 0.7535))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Totals summary — Change 3 & 9 */}
                {(() => {
                  const rollfiPd   = payPeriodDetails?.payPeriod?.[0];
                  const confirmed  = rollfiPd?.isProcessed === true;

                  // Use Rollfi confirmed totals when processed, else estimate
                  const totalGross  = confirmed && rollfiPd
                    ? r2(rollfiPd.payrollLineItems.reduce((s, e) => s + (e.grossTotal ?? 0), 0))
                    : preview.totalGrossPay;
                  const totalEmpTax = confirmed && rollfiPd
                    ? r2(rollfiPd.employeeTaxSum)
                    : r2(preview.employees.reduce((s, e) => s + calcEmpTax(e.grossPay).total, 0));
                  const totalNet    = confirmed && rollfiPd
                    ? r2(rollfiPd.payrollLineItems.reduce((s, e) => s + (e.netTotal ?? 0), 0))
                    : r2(totalGross - totalEmpTax);
                  const totalErTax  = confirmed && rollfiPd
                    ? r2(rollfiPd.employerTaxSum)
                    : r2(preview.employees.reduce((s, e) => s + calcErTax(e.grossPay).total, 0));
                  const totalDebit  = confirmed && rollfiPd
                    ? r2(rollfiPd.total)
                    : r2(totalGross + totalErTax);
                  const erByComp    = preview.employees.reduce((s, e) => { const t = calcErTax(e.grossPay); return { ss: s.ss + t.ss, med: s.med + t.medicare, futa: s.futa + t.futa, nj: s.nj + t.njSui }; }, { ss: 0, med: 0, futa: 0, nj: 0 });
                  return (
                    <div className="mb-4 space-y-3">
                      <div className="rounded-xl border border-white/10 overflow-hidden">
                        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div>
                            <p className="text-white font-semibold text-sm">Payroll Totals Summary</p>
                            <p className="text-white/40 text-xs">{selectedCompanyName} · {preview.period.from} – {preview.period.to}</p>
                          </div>
                          {confirmed && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-400 font-semibold">✅ Confirmed by Rollfi</span>}
                        </div>
                        <div className="px-5 py-4 grid grid-cols-2 gap-6 text-xs border-b border-white/5">
                          <div>
                            <p className="text-white/40 font-bold uppercase tracking-wide text-[10px] mb-2">Employee Payments</p>
                            <div className="flex justify-between py-1"><span className="text-white/60">Total Gross Pay</span><span className="text-emerald-400 font-semibold">{confirmed ? "" : "~"}{fmtD(totalGross)}</span></div>
                            <div className="flex justify-between py-1"><span className="text-white/60">Total Employee Taxes{confirmed ? "" : " (est.)"}</span><span className="text-red-300">−{confirmed ? "" : "~"}{fmtD(totalEmpTax)}</span></div>
                            <div className="flex justify-between py-1 border-t border-white/10 mt-1 pt-2 font-semibold"><span className="text-white/80">Total Net Pay to Staff</span><span className="text-white">{confirmed ? "" : "~"}{fmtD(totalNet)}</span></div>
                          </div>
                          <div>
                            <p className="text-white/40 font-bold uppercase tracking-wide text-[10px] mb-2">Employer Tax Obligations</p>
                            {confirmed
                              ? <div className="flex justify-between py-1 font-semibold"><span className="text-white/60">Total Employer Taxes</span><span className="text-amber-300">+{fmtD(totalErTax)}</span></div>
                              : <>
                                  <div className="flex justify-between py-1"><span className="text-white/60">Employer SS (6.2%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.ss))}</span></div>
                                  <div className="flex justify-between py-1"><span className="text-white/60">Employer Medicare (1.45%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.med))}</span></div>
                                  <div className="flex justify-between py-1"><span className="text-white/60">Federal Unemployment (0.6%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.futa))}</span></div>
                                  <div className="flex justify-between py-1"><span className="text-white/60">NJ State Unemployment (0.5%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.nj))}</span></div>
                                  <div className="flex justify-between py-1 border-t border-white/10 mt-1 pt-2 font-semibold"><span className="text-white/80">Total Employer Taxes</span><span className="text-amber-300">+~{fmtD(totalErTax)}</span></div>
                                </>
                            }
                          </div>
                        </div>
                        <div className="px-5 py-4 flex items-center justify-between border-t border-amber-500/30" style={{ background: "rgba(232,98,42,0.08)" }}>
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-400" />
                            <div>
                              <p className="text-amber-300 font-bold text-sm">{confirmed ? "Total Bank Debit" : "Estimated Total Bank Debit"}</p>
                              {confirmed
                                ? <p className="text-green-400/70 text-[11px]">✅ Confirmed by Rollfi{payPeriod?.payDate ? ` · Debited on ${payPeriod.payDate}` : ""}</p>
                                : payPeriod?.payDate && <p className="text-amber-400/60 text-[11px]">Debited on {payPeriod.payDate}</p>
                              }
                            </div>
                          </div>
                          <p className="text-amber-300 font-bold text-2xl">{confirmed ? "" : "~"}{fmtD(totalDebit)}</p>
                        </div>
                      </div>
                      <p className="text-white/20 text-[10px] px-1">
                        {confirmed
                          ? "✅ All amounts confirmed by Rollfi after payroll processing."
                          : "* Tax amounts are estimates. Exact amounts confirmed after Rollfi processes payroll."}
                      </p>
                    </div>
                  );
                })()}

                {/* Adjustments */}
                <div className="mb-4">
                  <button
                    onClick={() => setAdjOpen((o) => !o)}
                    className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-2"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="font-semibold">Payroll Adjustments</span>
                    {Object.values(adjustments).some((a) => a.bonusPay > 0 || a.overtimePay > 0) && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/20">Active</span>
                    )}
                    <ChevronRight className={`h-3.5 w-3.5 ml-1 transition-transform duration-200 ${adjOpen ? "rotate-90" : ""}`} />
                  </button>
                  {adjOpen && (
                    <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                      <div className="px-5 py-3 border-b border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <p className="text-white/40 text-xs">Add one-time bonuses or overtime hours for this pay run. These are sent to Rollfi when you submit.</p>
                      </div>
                      <div className="divide-y divide-white/5">
                        {preview.employees.filter((e) => e.onboardedToRollfi && e.rollfiUserId).map((emp) => {
                          const key = emp.rollfiUserId!;
                          const adj = adjustments[key] ?? { bonusPay: 0, overtimePay: 0 };
                          const hasAdj = adj.bonusPay > 0 || adj.overtimePay > 0;
                          return (
                            <div key={emp.employeeId} className="px-5 py-3 flex items-center gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-white text-sm font-medium">{emp.name}</div>
                                <div className="text-white/40 text-xs">{emp.position} · ${emp.hourlyRate.toFixed(2)}/hr</div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <label className="flex items-center gap-1.5">
                                  <span className="text-white/40 text-xs whitespace-nowrap">Bonus $</span>
                                  <input
                                    type="number" min="0" step="50"
                                    value={adj.bonusPay || ""}
                                    placeholder="0"
                                    onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, bonusPay: Number(e.target.value) || 0 } }))}
                                    className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-right outline-none focus:border-orange-400/50 transition-colors"
                                  />
                                </label>
                                <label className="flex items-center gap-1.5">
                                  <span className="text-white/40 text-xs whitespace-nowrap">OT hrs</span>
                                  <input
                                    type="number" min="0" step="0.5"
                                    value={adj.overtimePay || ""}
                                    placeholder="0"
                                    onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, overtimePay: Number(e.target.value) || 0 } }))}
                                    className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-right outline-none focus:border-orange-400/50 transition-colors"
                                  />
                                </label>
                                {hasAdj && (
                                  <button
                                    onClick={() => setAdjustments((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                                    className="text-white/20 hover:text-white/50 text-xs px-1"
                                  >✕</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {Object.values(adjustments).some((a) => a.bonusPay > 0 || a.overtimePay > 0) && (
                        <div className="px-5 py-2.5 border-t border-white/10 flex items-center justify-between text-xs" style={{ background: "rgba(255,255,255,0.02)" }}>
                          <span className="text-white/40">
                            Bonus total: <span className="text-orange-400 font-semibold">${Object.values(adjustments).reduce((s, a) => s + (a.bonusPay || 0), 0).toLocaleString()}</span>
                            <span className="mx-2 text-white/20">·</span>
                            OT hours: <span className="text-orange-400 font-semibold">{Object.values(adjustments).reduce((s, a) => s + (a.overtimePay || 0), 0)}h</span>
                          </span>
                          <button onClick={() => setAdjustments({})} className="text-white/30 hover:text-white/60 transition-colors">Clear all</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Submit area — Change 5 (opens confirm dialog) */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={!payPeriod || !preview.allOnboarded || submitPayroll.isPending || selectedCompanyId === "all" || !periodSubmittable}
                    onClick={() => {
                      if (payPeriod && selectedCompanyId !== "all" && preview.allOnboarded && periodSubmittable) {
                        setConfirmOpen(true);
                      }
                    }}
                    className="gap-2 text-white font-semibold"
                    style={{ background: (!payPeriod || !preview.allOnboarded || selectedCompanyId === "all" || !periodSubmittable) ? "rgba(255,255,255,0.1)" : ORANGE }}>
                    {submitPayroll.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Play className="h-4 w-4" /> Review & Submit Payroll</>}
                  </Button>
                  {!payPeriod && payPeriodFetching && <p className="text-white/30 text-xs">Fetching pay period…</p>}
                  {!payPeriod && !payPeriodFetching && payPeriodFetchFailed && (
                    <p className="text-amber-400/70 text-xs">No pay period found — <button className="underline" onClick={() => void fetchPayPeriod(selectedCompanyId)}>retry</button></p>
                  )}
                  {!payPeriod && !payPeriodFetching && !payPeriodFetchFailed && <p className="text-white/30 text-xs">Fetching pay period…</p>}
                  {payPeriod && !periodSubmittable && (
                    <div className="flex items-center gap-1.5"><PayPeriodStatusBadge status={payPeriod.payPeriodStatus} /><p className="text-white/30 text-xs">— already submitted</p></div>
                  )}
                  {payPeriod && periodSubmittable && !preview.allOnboarded && <p className="text-white/30 text-xs">All employees must be onboarded first</p>}
                  {selectedCompanyId === "all" && <p className="text-white/30 text-xs">Select a specific company to submit</p>}
                </div>

                {payrollResult && (
                  <PayrollResultCard
                    result={payrollResult}
                    onReset={() => setPayrollResult(null)}
                    onVerifyBank={selectedCompanyId !== "all" ? () => verifyBank.mutate(selectedCompanyId) : undefined}
                    verifyBankPending={verifyBank.isPending}
                  />
                )}

                {payPeriod && !periodSubmittable && (
                  <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
                    <ArrowRight className="h-4 w-4 text-white/30 shrink-0" />
                    <p className="text-white/40 text-xs">
                      This period is <strong className="text-white/60">{payPeriod.payPeriodStatus}</strong>. Once processed, a new period will appear automatically.
                    </p>
                  </div>
                )}

                {/* History */}
                {history && history.periods.length > 0 && (
                  <>
                    <HistorySection
                      periods={history.periods}
                      companyName={selectedCompanyName}
                      companyId={selectedCompanyId}
                      onViewStubs={(p) => setStubsPeriod((prev) => prev?.payPeriodId === p.payPeriodId ? null : p)}
                    />
                    {stubsPeriod && (
                      <PayStubsDrawer
                        companyId={selectedCompanyId}
                        period={stubsPeriod}
                        onClose={() => setStubsPeriod(null)}
                      />
                    )}
                  </>
                )}
              </>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirm dialog — Change 5 */}
      {confirmOpen && preview && payPeriod && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}
        >
          <div className="w-full max-w-md mx-4 rounded-2xl border border-white/10 overflow-hidden shadow-2xl" style={{ background: "#1a2f4a" }}>
            <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.05)" }}>
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
              <div>
                <p className="text-white font-bold">Confirm Payroll Submission</p>
                <p className="text-white/40 text-xs">{selectedCompanyName} · {payPeriod.payPeriod}</p>
              </div>
            </div>

            <div className="px-6 py-4 border-b border-white/10">
              <p className="text-white/40 text-xs font-bold uppercase tracking-wide mb-3">Employee Summary</p>
              <div className="space-y-1">
                {preview.employees.map((emp) => {
                  const t = calcEmpTax(emp.grossPay);
                  return (
                    <div key={emp.employeeId} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-white/70">{emp.name}</span>
                      <div className="text-right">
                        <span className="text-emerald-400 font-semibold">{fmtD(emp.grossPay)}</span>
                        <span className="text-white/30 text-xs ml-2">→ ~{fmtD(t.net)} net</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {(() => {
              const totalGross  = preview.totalGrossPay;
              const totalEmpTax = r2(preview.employees.reduce((s, e) => s + calcEmpTax(e.grossPay).total, 0));
              const totalNet    = r2(totalGross - totalEmpTax);
              const erByComp    = preview.employees.reduce((s, e) => { const t = calcErTax(e.grossPay); return { ss: s.ss + t.ss, med: s.med + t.medicare, futa: s.futa + t.futa, nj: s.nj + t.njSui }; }, { ss: 0, med: 0, futa: 0, nj: 0 });
              const totalErTax  = r2(erByComp.ss + erByComp.med + erByComp.futa + erByComp.nj);
              const totalDebit  = r2(totalGross + totalErTax);
              return (
                <div className="px-6 py-4 border-b border-white/10 space-y-3 text-sm">
                  <div>
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-1.5">Employee Payments</p>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">Total Gross Pay</span><span className="text-emerald-400 font-semibold">{fmtD(totalGross)}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">Total Employee Taxes (est.)</span><span className="text-red-300">−{fmtD(totalEmpTax)}</span></div>
                    <div className="flex justify-between py-0.5 font-semibold"><span className="text-white/70">Total Net to Employees</span><span className="text-white">~{fmtD(totalNet)}</span></div>
                  </div>
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-white/40 text-[10px] font-bold uppercase tracking-wide mb-1.5">Employer Costs</p>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">Employer SS (6.2%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.ss))}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">Employer Medicare (1.45%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.med))}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">Federal Unemployment (0.6%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.futa))}</span></div>
                    <div className="flex justify-between py-0.5"><span className="text-white/50">NJ State Unemployment (0.5%)</span><span className="text-amber-300">+{fmtD(r2(erByComp.nj))}</span></div>
                  </div>
                  <div className="rounded-lg border border-amber-500/40 overflow-hidden" style={{ background: "rgba(232,98,42,0.12)" }}>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        <div>
                          <p className="text-amber-300 font-bold text-sm">Total Bank Debit</p>
                          <p className="text-amber-400/60 text-[10px]">This amount will be debited from your connected bank account</p>
                        </div>
                      </div>
                      <span className="text-amber-300 font-bold text-xl">~{fmtD(totalDebit)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="px-6 py-4">
              {preview.employees.some((e) => e.hoursSource === "pending_approval") && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 mb-4" style={{ background: "rgba(232,98,42,0.10)" }}>
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 text-xs font-semibold">Some employees have not been approved yet</p>
                    <p className="text-amber-300/60 text-xs mt-0.5">The manager for each daycare must pull hours and click <span className="font-semibold">Approve Hours</span> in their dashboard before payroll can be submitted for those employees.</p>
                  </div>
                </div>
              )}
              <p className="text-white/30 text-xs mb-4">
                ⚠️ If any amounts seem wrong, click Cancel and review before submitting.
                Tax figures are estimates — exact amounts confirmed by Rollfi after processing.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white/80 hover:border-white/20 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmOpen(false);
                    setPayrollResult(null);
                    const adjs = Object.entries(adjustments)
                      .filter(([, a]) => a.bonusPay > 0 || a.overtimePay > 0)
                      .map(([rollfiUserId, a]) => ({ rollfiUserId, bonusPay: a.bonusPay || undefined, overtimePay: a.overtimePay || undefined }));
                    // Pass hours the UI is displaying so backend can use them even if store has no entry
                    const companyPreview = preview?.companies?.find((c: { id: string }) => c.id === selectedCompanyId);
                    const employeeHours = (companyPreview?.employees ?? preview?.employees ?? [])
                      .filter((e: { rollfiUserId: string | null; netPayableHours: number }) => e.rollfiUserId && e.netPayableHours > 0)
                      .map((e: { rollfiUserId: string | null; netPayableHours: number }) => ({ rollfiUserId: e.rollfiUserId!, hours: e.netPayableHours }));
                    submitPayroll.mutate({ companyId: selectedCompanyId, payPeriodId: payPeriod.payPeriodId, payBeginDate: payPeriod.payBeginDate, payEndDate: payPeriod.payEndDate, adjs, employeeHours });
                  }}
                  className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                  style={{ background: ORANGE }}
                >
                  <Play className="h-4 w-4" /> Yes, Submit Payroll
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
