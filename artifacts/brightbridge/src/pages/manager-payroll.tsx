import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DollarSign, Users, Calendar, Clock, AlertTriangle, CheckCircle2,
  XCircle, Loader2, Play, RefreshCw, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, BarChart3, Activity, FileText,
  Download, Eye, Receipt, Zap, Info, Briefcase,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard";

// ── Types ─────────────────────────────────────────────────────

interface PayPeriod {
  payPeriodId: string; payPeriod: string; payBeginDate: string;
  payEndDate: string; payDate: string; deadLineToRunPayroll: string;
  payPeriodStatus: string; payrollAmount?: number;
}
interface PeriodDetailItem {
  payPeriodId: string; payPeriod?: string; PayPeriodStatus: string;
  total: number; employeeTaxSum: number; employerTaxSum: number;
  isProcessed: boolean; payDate: string; payBeginDate?: string; payEndDate?: string;
  payrollLineItems: Array<{ grossTotal: number; netTotal: number; userId: string; overTimes?: number }>;
}
interface PeriodDetailsResponse { payPeriod: PeriodDetailItem[] }
interface PreviewEmployee {
  name: string; position: string; rollfiUserId: string | null;
  hoursWorked: number; netPayableHours: number; hourlyRate: number; grossPay: number;
  onboardedToRollfi: boolean;
}
interface PayrollPreview {
  period: { from: string; to: string }; employees: PreviewEmployee[];
  totalGrossPay: number; allOnboarded: boolean;
}
interface HistoryPeriod {
  payPeriodId?: string; payPeriod?: string; payBeginDate?: string;
  payEndDate?: string; payDate?: string; payPeriodStatus?: string;
  payrollAmount?: number; total?: number; isProcessed?: boolean;
  [k: string]: unknown;
}
interface EmpStatus { rollfiUserId: string; userStatus: string; kycStatus: string }
interface CompanyTask { task: string; description: string }
interface CompanyTasksData { tasks: CompanyTask[]; kybStatus: string; bankLinked: boolean }
interface ImportResult {
  success: boolean; payPeriodId?: string;
  realTotals?: { grossPay: number; netPay: number; employeeTax: number; employerTax: number; totalDebit: number } | null;
  skippedEmployees?: { rollfiUserId: string; name?: string; reason: string }[];
  error?: string;
}
interface PayrollResult { success: boolean; error?: string }

// ── Helpers ───────────────────────────────────────────────────

const api = {
  get: async <T,>(path: string): Promise<T> => {
    const r = await fetch(`/api${path}`, { credentials: "include" });
    if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? r.statusText); }
    return r.json() as Promise<T>;
  },
  post: async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(`/api${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? r.statusText); }
    return r.json() as Promise<T>;
  },
};

function fmtD(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysUntil(s?: string): number {
  if (!s) return 0;
  const d = new Date(s.includes("T") ? s : s + "T12:00:00");
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}
function statusColor(s: string) {
  const v = s.toLowerCase();
  if (v === "new") return { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" };
  if (v === "submitted") return { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" };
  if (v === "inprocess" || v === "processing") return { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" };
  if (v === "processed" || v === "completed") return { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" };
  return { bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };
}
function StatusBadge({ status }: { status: string }) {
  const c = statusColor(status);
  const label = status === "inprocess" ? "Processing" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>{label}</span>;
}

// ── Payroll Health Score ──────────────────────────────────────

function HealthScore({ tasks, empStatuses, detail, preview, hasHistory }: {
  tasks?: CompanyTasksData; empStatuses?: EmpStatus[];
  detail?: PeriodDetailItem; preview?: PayrollPreview; hasHistory: boolean;
}) {
  const checks = [
    { label: "Bank account verified", done: tasks?.bankLinked === true },
    { label: "KYB passed", done: tasks?.kybStatus === "approved" },
    { label: "All employees onboarded", done: empStatuses ? empStatuses.every(e => e.userStatus.toLowerCase() === "active") : false },
    { label: "Payroll calculated", done: !!(detail?.payrollLineItems?.length) },
    { label: "Payroll approved / submitted", done: !!(detail && !["new",""].includes(detail.PayPeriodStatus?.toLowerCase())) },
  ];
  const score = Math.round((checks.filter(c => c.done).length / checks.length) * 100);
  const label = score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs Attention" : "Critical";
  const color = score >= 90 ? "#16a34a" : score >= 70 ? "#284362" : score >= 50 ? "#d97706" : "#dc2626";

  const r = 36, stroke = 8, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <h3 className="font-semibold text-gray-800 text-sm mb-4">Payroll Health Score</h3>
      <div className="flex items-center gap-5">
        <svg width="96" height="96" className="shrink-0">
          <circle cx="48" cy="48" r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
          <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4} strokeLinecap="round" />
          <text x="48" y="48" textAnchor="middle" dy="0.35em" fontSize="16" fontWeight="700" fill={color}>{score}%</text>
        </svg>
        <div className="flex-1">
          <div className="font-bold text-lg" style={{ color }}>{label}</div>
          {hasHistory && <div className="text-xs text-gray-400 mb-3">Based on current period</div>}
          <div className="space-y-1.5">
            {checks.map(c => (
              <div key={c.label} className="flex items-center gap-2 text-xs">
                {c.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                <span className={c.done ? "text-gray-700" : "text-gray-400"}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payroll Timeline ──────────────────────────────────────────

function PayrollTimeline({ payPeriod, detail }: { payPeriod?: PayPeriod; detail?: PeriodDetailItem }) {
  const status = (detail?.PayPeriodStatus ?? payPeriod?.payPeriodStatus ?? "").toLowerCase();
  const steps = [
    { label: "Hours Imported", done: ["submitted","inprocess","processing","processed","completed"].includes(status) || !!(detail?.payrollLineItems?.length) },
    { label: "Payroll Calculated", done: ["submitted","inprocess","processing","processed","completed"].includes(status) },
    { label: "Exceptions Reviewed", done: ["submitted","inprocess","processing","processed","completed"].includes(status) },
    { label: "Payroll Approved", done: ["submitted","inprocess","processing","processed","completed"].includes(status) },
    { label: "Funding Scheduled", done: ["inprocess","processing","processed","completed"].includes(status) },
    { label: "Employees Paid", done: ["processed","completed"].includes(status) },
    { label: "Taxes Filed", done: status === "processed" || status === "completed" },
  ];
  const currentStep = steps.findIndex(s => !s.done);

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <h3 className="font-semibold text-gray-800 text-sm mb-4">Payroll Timeline</h3>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const active = i === currentStep;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${step.done ? "bg-emerald-100 text-emerald-600" : active ? "bg-[#284362] text-white" : "bg-gray-100 text-gray-400"}`}>
                {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`text-xs ${step.done ? "text-gray-700 font-medium" : active ? "text-[#284362] font-semibold" : "text-gray-400"}`}>{step.label}</span>
              {active && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#284362]/10 text-[#284362] font-semibold">Current</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Smart Insights ────────────────────────────────────────────

function SmartInsights({ detail, history, preview }: {
  detail?: PeriodDetailItem; history?: HistoryPeriod[]; preview?: PayrollPreview;
}) {
  const insights: { icon: React.ReactNode; text: string; color: string }[] = [];

  const lastPeriod = history?.[0];
  const lastTotal = (lastPeriod?.total as number | undefined) ?? 0;
  const currentTotal = detail?.total ?? 0;

  if (lastTotal > 0 && currentTotal > 0) {
    const diff = currentTotal - lastTotal;
    const pct = Math.abs((diff / lastTotal) * 100).toFixed(1);
    if (Math.abs(diff) > 50) {
      insights.push({
        icon: diff > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />,
        text: `Cash required ${diff > 0 ? "increased" : "decreased"} by ${fmtD(Math.abs(diff))} (${pct}%)`,
        color: diff > 0 ? "#d97706" : "#16a34a",
      });
    }
  }

  const hasOT = detail?.payrollLineItems?.some(li => (li.overTimes ?? 0) > 0);
  if (hasOT) insights.push({ icon: <AlertTriangle className="h-3.5 w-3.5" />, text: "Overtime detected this period", color: "#d97706" });

  const empCount = detail?.payrollLineItems?.length ?? 0;
  const lastEmpCount = (lastPeriod as { payrollLineItems?: unknown[] } | undefined)?.payrollLineItems?.length ?? 0;
  if (lastEmpCount > 0 && empCount > lastEmpCount) {
    insights.push({ icon: <Users className="h-3.5 w-3.5" />, text: `${empCount - lastEmpCount} new employee(s) added since last payroll`, color: "#284362" });
  }

  if (!preview?.allOnboarded && (preview?.employees?.filter(e => !e.onboardedToRollfi).length ?? 0) > 0) {
    const n = preview!.employees.filter(e => !e.onboardedToRollfi).length;
    insights.push({ icon: <Info className="h-3.5 w-3.5" />, text: `${n} employee(s) not yet onboarded to Rollfi`, color: "#dc2626" });
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <h3 className="font-semibold text-gray-800 text-sm mb-4">Smart Insights</h3>
      {insights.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{history?.length ? "No significant changes from last period." : "Insights available after first completed payroll."}</p>
      ) : (
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: `${ins.color}10` }}>
              <div className="mt-0.5" style={{ color: ins.color }}>{ins.icon}</div>
              <p className="text-xs text-gray-700">{ins.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Run Payroll Panel ─────────────────────────────────────────

function RunPayrollPanel({ companyId, payPeriod, preview, onDone }: {
  companyId: string; payPeriod: PayPeriod;
  preview?: PayrollPreview; onDone: () => void;
}) {
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const qc = useQueryClient();

  const periodSubmittable = ["new", ""].includes((payPeriod.payPeriodStatus ?? "").toLowerCase());

  const importHours = useMutation({
    mutationFn: () => {
      const employeeHours = (preview?.employees ?? [])
        .filter(e => e.rollfiUserId)
        .map(e => ({ rollfiUserId: e.rollfiUserId!, hours: e.netPayableHours }));
      return api.post<ImportResult>("/rollfi/payroll/import", {
        companyId, payPeriodId: payPeriod.payPeriodId,
        payBeginDate: payPeriod.payBeginDate, payEndDate: payPeriod.payEndDate,
        adjustments: [], employeeHours,
      });
    },
    onSuccess: r => setImportResult(r),
  });

  const submitPayroll = useMutation({
    mutationFn: () => api.post<PayrollResult>("/rollfi/payroll/submit", { companyId, payPeriodId: payPeriod.payPeriodId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mgr-payperiod", companyId] });
      void qc.invalidateQueries({ queryKey: ["mgr-history", companyId] });
      setConfirmOpen(false);
      onDone();
    },
  });

  return (
    <div className="bg-[#284362] rounded-xl p-5 space-y-4 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-bold text-base">Run Payroll</h4>
          <p className="text-white/60 text-xs">{fmtDate(payPeriod.payBeginDate)} – {fmtDate(payPeriod.payEndDate)}</p>
        </div>
        <StatusBadge status={payPeriod.payPeriodStatus} />
      </div>

      {!periodSubmittable ? (
        <div className="bg-white/10 rounded-lg px-4 py-3 text-sm text-white/70">This period has already been submitted.</div>
      ) : (
        <>
          {preview && !preview.allOnboarded && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">Some employees are not yet onboarded to Rollfi and will be excluded.</p>
            </div>
          )}

          <Button
            disabled={importHours.isPending || !preview}
            onClick={() => importHours.mutate()}
            className="w-full gap-2 text-white font-semibold"
            style={{ background: importResult?.success ? "rgba(16,185,129,0.3)" : "#E8622A" }}>
            {importHours.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing Hours…</> :
              importResult?.success ? <><CheckCircle2 className="h-4 w-4" /> Hours Imported — Re-import</> :
                <><Play className="h-4 w-4" /> Import Hours to Rollfi</>}
          </Button>

          {importHours.isError && <p className="text-red-400 text-xs">{importHours.error?.message}</p>}

          {importResult?.success && importResult.realTotals && (
            <div className="rounded-lg border border-white/20 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-white/60">Gross Pay</span><span className="font-semibold">{fmtD(importResult.realTotals.grossPay)}</span></div>
              <div className="flex justify-between"><span className="text-white/60">Net Pay</span><span className="font-semibold">{fmtD(importResult.realTotals.netPay)}</span></div>
              <div className="flex justify-between"><span className="text-white/60">Employee Tax</span><span className="text-red-300">−{fmtD(importResult.realTotals.employeeTax)}</span></div>
              <div className="flex justify-between border-t border-white/20 pt-2"><span className="text-amber-300 font-bold">Total Bank Debit</span><span className="text-amber-300 font-bold text-lg">{fmtD(importResult.realTotals.totalDebit)}</span></div>
            </div>
          )}

          {importResult?.success && (
            <>
              {!confirmOpen ? (
                <Button
                  onClick={() => setConfirmOpen(true)}
                  className="w-full gap-2 font-semibold text-white"
                  style={{ background: "#E8622A" }}>
                  <Play className="h-4 w-4" /> Confirm &amp; Submit Payroll
                </Button>
              ) : (
                <div className="border border-amber-500/40 rounded-lg p-4 space-y-3 bg-amber-500/10">
                  <p className="text-amber-300 text-sm font-semibold">⚠ This will submit payroll to Rollfi. Are you sure?</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)} className="flex-1 text-white/70 border border-white/20">Cancel</Button>
                    <Button size="sm" disabled={submitPayroll.isPending} onClick={() => submitPayroll.mutate()} className="flex-1 text-white font-bold" style={{ background: "#E8622A" }}>
                      {submitPayroll.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : "Submit"}
                    </Button>
                  </div>
                  {submitPayroll.isError && <p className="text-red-400 text-xs">{submitPayroll.error?.message}</p>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Payroll Grid ──────────────────────────────────────────────

function PayrollGrid({ companyId, currentPeriod, currentPeriodTotal, history, preview, onViewPaystubs }: {
  companyId: string; currentPeriod?: PayPeriod; currentPeriodTotal?: number;
  history?: HistoryPeriod[]; preview?: PayrollPreview;
  onViewPaystubs: (payPeriodId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  type Row = { id: string; begin: string; end: string; payDate: string; employees: number; status: string; total: number; isCurrent: boolean };
  const rows: Row[] = [];

  if (currentPeriod) {
    rows.push({
      id: currentPeriod.payPeriodId, begin: currentPeriod.payBeginDate,
      end: currentPeriod.payEndDate, payDate: currentPeriod.payDate,
      employees: preview?.employees?.filter(e => e.onboardedToRollfi).length ?? 0,
      status: currentPeriod.payPeriodStatus,
      // Use corrected total (gross + employer taxes) when available; fall back to payrollAmount
      total: currentPeriodTotal ?? currentPeriod.payrollAmount ?? 0,
      isCurrent: true,
    });
  }

  (history ?? []).forEach(h => {
    const id = String(h.payPeriodId ?? h.payBeginDate ?? "");
    if (!id || rows.some(r => r.id === id)) return;
    rows.push({
      id, begin: String(h.payBeginDate ?? ""), end: String(h.payEndDate ?? ""),
      payDate: String(h.payDate ?? ""), employees: 0,
      status: String(h.payPeriodStatus ?? "processed"), total: (h.total as number | undefined) ?? (h.payrollAmount as number | undefined) ?? 0,
      isCurrent: false,
    });
  });

  if (rows.length === 0) return (
    <div className="text-center py-12 text-gray-400 text-sm">No payroll periods found yet.</div>
  );

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Pay Period</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Pay Date</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Employees</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cash Required</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(row => (
            <React.Fragment key={row.id}>
              <tr className={`hover:bg-gray-50 transition-colors ${row.isCurrent ? "bg-blue-50/40" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 text-xs">{fmtDate(row.begin)} – {fmtDate(row.end)}</div>
                  {row.isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#284362]/10 text-[#284362] font-semibold">Current</span>}
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">{fmtDate(row.payDate)}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{row.employees > 0 ? row.employees : "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.total > 0 ? fmtD(row.total) : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1.5">
                    {row.isCurrent && ["new",""].includes(row.status.toLowerCase()) && (
                      <button
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white"
                        style={{ background: "#E8622A" }}>
                        <Play className="h-3 w-3" />Run
                        {expanded === row.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    )}
                    {!["new",""].includes(row.status.toLowerCase()) && (
                      <button
                        onClick={() => onViewPaystubs(row.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[#284362]/10 text-[#284362] hover:bg-[#284362]/20 transition-colors">
                        <Receipt className="h-3 w-3" />Paystubs
                      </button>
                    )}
                    <button
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                      <Eye className="h-3 w-3" />View
                    </button>
                  </div>
                </td>
              </tr>
              {expanded === row.id && (
                <tr>
                  <td colSpan={6} className="px-4 pb-4">
                    {row.isCurrent && currentPeriod ? (
                      <RunPayrollPanel
                        companyId={companyId} payPeriod={currentPeriod}
                        preview={preview} onDone={() => setExpanded(null)}
                      />
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                        <p className="font-semibold text-gray-800 mb-1">{fmtDate(row.begin)} – {fmtDate(row.end)}</p>
                        <p>Status: <StatusBadge status={row.status} /></p>
                        {row.total > 0 && <p className="mt-1">Total Debit: <span className="font-bold text-gray-900">{fmtD(row.total)}</span></p>}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Paystubs Modal ────────────────────────────────────────────


// ── Right Sidebar ─────────────────────────────────────────────

function RightSidebar({ payPeriod }: { payPeriod?: PayPeriod }) {
  const deadline = payPeriod?.deadLineToRunPayroll;
  const payDate = payPeriod?.payDate;
  const daysToDeadline = daysUntil(deadline);
  const daysToPayDate = daysUntil(payDate);
  const cutoffStatus = daysToDeadline > 3 ? "On Track" : daysToDeadline >= 0 ? "Approaching" : "Passed";
  const cutoffColor = daysToDeadline > 3 ? "text-emerald-600" : daysToDeadline >= 0 ? "text-amber-600" : "text-red-600";

  const now = new Date();
  const year = now.getFullYear();
  const q941s = [new Date(`${year}-04-30`), new Date(`${year}-07-31`), new Date(`${year}-10-31`), new Date(`${year + 1}-01-31`)];
  const next941 = q941s.find(d => d > now) ?? q941s[0];
  const days941 = Math.ceil((next941.getTime() - now.getTime()) / 86_400_000);

  function urgency(days: number) {
    if (days > 14) return "text-emerald-600";
    if (days >= 3) return "text-amber-600";
    return "text-red-600";
  }

  const QUICK_ACTIONS = [
    { icon: <Play className="h-3.5 w-3.5" />, label: "Run Payroll Preview", note: null },
    { icon: <RefreshCw className="h-3.5 w-3.5" />, label: "Recalculate Payroll", note: "Coming soon" },
    { icon: <BarChart3 className="h-3.5 w-3.5" />, label: "Payroll Register", note: "Coming soon" },
    { icon: <Activity className="h-3.5 w-3.5" />, label: "View Audit Log", note: "Coming soon" },
    { icon: <Download className="h-3.5 w-3.5" />, label: "Export Summary", note: "Coming soon" },
  ];

  return (
    <div className="space-y-4 w-64 shrink-0">
      {/* Quick Actions */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3">Payroll Actions</h4>
        <div className="space-y-1.5">
          {QUICK_ACTIONS.map(a => (
            <div key={a.label} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${a.note ? "opacity-50 cursor-not-allowed" : "hover:bg-[#284362]/5 cursor-pointer"} text-gray-700`}>
              <div className="text-[#284362]">{a.icon}</div>
              <span className="flex-1">{a.label}</span>
              {a.note && <span className="text-[10px] text-gray-400">{a.note}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Cutoff Times */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3">Payroll Cutoff</h4>
        <div className="space-y-2">
          <div className="text-xs text-gray-500">BiWeekly deadline</div>
          <div className="font-medium text-gray-800 text-xs">{fmtDate(deadline)}</div>
          <div className={`text-xs font-semibold ${cutoffColor}`}>
            {cutoffStatus} {daysToDeadline >= 0 ? `· ${daysToDeadline}d left` : "· Passed"}
          </div>
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3">Upcoming Deadlines</h4>
        <div className="space-y-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-gray-700">Payroll Deadline</div>
              <div className="text-gray-400">{fmtDate(deadline)}</div>
            </div>
            <span className={`font-bold shrink-0 ${urgency(daysToDeadline)}`}>{daysToDeadline >= 0 ? `${daysToDeadline}d` : "Passed"}</span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-gray-700">Pay Date</div>
              <div className="text-gray-400">{fmtDate(payDate)}</div>
            </div>
            <span className={`font-bold shrink-0 ${urgency(daysToPayDate)}`}>{daysToPayDate >= 0 ? `${daysToPayDate}d` : "Passed"}</span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-gray-700">Quarterly 941</div>
              <div className="text-gray-400">{next941.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            </div>
            <span className={`font-bold shrink-0 ${urgency(days941)}`}>{days941}d</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bottom Widgets ────────────────────────────────────────────

interface ActivityFeedEvent {
  id: string; type: string; description: string;
  source: "app" | "rollfi"; actorName?: string; createdAt: string;
}

const TYPE_DOT: Record<string, string> = {
  "payroll.initiated": "text-blue-500", "payroll.submitted": "text-blue-500",
  "payroll.calculated": "text-emerald-500", "payroll.processed": "text-emerald-500",
  "payroll.completed": "text-emerald-500", "payroll.approved": "text-emerald-500",
  "payroll.failed": "text-red-500", "employee.added": "text-violet-500",
  "hours.synced": "text-amber-500",
};

function BottomWidgets({ companyId, detail, history, preview }: {
  companyId: string; detail?: PeriodDetailItem; history?: HistoryPeriod[]; preview?: PayrollPreview;
}) {
  const { data: activityData } = useQuery<{ events: ActivityFeedEvent[] }>({
    queryKey: ["activity-feed", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/activity?companyId=${encodeURIComponent(companyId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ events: ActivityFeedEvent[] }>;
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: !!companyId,
    retry: false,
  });
  const activityEvents = activityData?.events ?? [];

  const lastPeriod = history?.[0];
  const currentTotal = detail?.total ?? 0;
  const lastTotal = (lastPeriod?.total as number | undefined) ?? 0;
  const variance = currentTotal - lastTotal;
  const variancePct = lastTotal > 0 ? ((variance / lastTotal) * 100).toFixed(1) : null;

  const grossTotal = (detail?.payrollLineItems ?? []).reduce((s, li) => s + (li.grossTotal ?? 0), 0);
  const netTotal = (detail?.payrollLineItems ?? []).reduce((s, li) => s + (li.netTotal ?? 0), 0);

  // Funding forecast — use last processed total as projection
  const projBase = lastTotal || currentTotal;
  const lastPayDate = lastPeriod?.payDate ? new Date(String(lastPeriod.payDate) + "T12:00:00") : new Date();
  const forecastDates: Date[] = [];
  const fd = new Date(lastPayDate);
  fd.setDate(fd.getDate() + 14);
  for (let i = 0; i < 3; i++) { forecastDates.push(new Date(fd)); fd.setDate(fd.getDate() + 14); }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* Funding Forecast */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-[#284362]" />Funding Forecast</h4>
        {projBase > 0 ? (
          <div className="space-y-2">
            {forecastDates.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="font-semibold text-gray-800">{fmtD(projBase)} <span className="text-gray-400 font-normal">(proj)</span></span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400 italic">Available after first payroll.</p>}
      </div>

      {/* Payroll Variance */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5 text-[#284362]" />Payroll Variance</h4>
        {variancePct !== null ? (
          <div className="space-y-2">
            <div className={`text-lg font-bold ${variance >= 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {variance >= 0 ? <TrendingUp className="h-4 w-4 inline mr-1" /> : <TrendingDown className="h-4 w-4 inline mr-1" />}
              {Math.abs(Number(variancePct))}% {variance >= 0 ? "Increase" : "Decrease"}
            </div>
            <div className="text-xs text-gray-500">{variance >= 0 ? "+" : ""}{fmtD(variance)} vs last period</div>
            <div className="text-xs text-gray-400">Current: {fmtD(currentTotal)} · Last: {fmtD(lastTotal)}</div>
          </div>
        ) : <p className="text-xs text-gray-400 italic">Variance available after first completed payroll.</p>}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-[#284362]" />Recent Activity
          </h4>
          <div className="flex items-center gap-1">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 font-semibold">App</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">Rollfi</span>
          </div>
        </div>
        <div className="space-y-2 flex-1">
          {activityEvents.length > 0 ? activityEvents.slice(0, 5).map((ev) => {
            const iconCls = TYPE_DOT[ev.type] ?? (ev.source === "app" ? "text-violet-500" : "text-blue-500");
            const badgeCls = ev.source === "app"
              ? "bg-violet-50 text-violet-600 border border-violet-200"
              : "bg-blue-50 text-blue-600 border border-blue-200";
            const timeAgo = (() => {
              const mins = Math.floor((Date.now() - new Date(ev.createdAt).getTime()) / 60000);
              if (mins < 60) return `${mins}m ago`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `${hrs}h ago`;
              return `${Math.floor(hrs / 24)}d ago`;
            })();
            return (
              <div key={ev.id} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className={`h-3 w-3 mt-0.5 shrink-0 ${iconCls}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium text-gray-700 truncate">{ev.description}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-semibold shrink-0 ${badgeCls}`}>
                      {ev.source === "app" ? "App" : "Rollfi"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 mt-0.5">
                    {ev.actorName && <span>by {ev.actorName} ·</span>}
                    <span>{timeAgo}</span>
                  </div>
                </div>
              </div>
            );
          }) : <p className="text-xs text-gray-400 italic">No activity yet. Events will appear as you process payroll or sync hours.</p>}
        </div>
      </div>

      {/* Employee Pay Summary */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h4 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-[#284362]" />Pay Summary</h4>
        {grossTotal > 0 ? (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">Total Gross</span><span className="font-semibold">{fmtD(grossTotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Total Net</span><span className="font-semibold">{fmtD(netTotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Employee Tax</span><span className="font-semibold">{fmtD(detail?.employeeTaxSum ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Employer Tax</span><span className="font-semibold">{fmtD(detail?.employerTaxSum ?? 0)}</span></div>
            {detail?.total != null && <div className="flex justify-between border-t pt-2 font-bold text-gray-800"><span>Total Debit</span><span>{fmtD((detail.total) + (detail.employerTaxSum ?? 0))}</span></div>}
          </div>
        ) : (
          preview ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Estimated Gross</span><span className="font-semibold text-amber-600">{fmtD(preview.totalGrossPay)}</span></div>
              <div className="text-gray-400 text-[11px]">Import hours to get confirmed totals.</div>
            </div>
          ) : <p className="text-xs text-gray-400 italic">No payroll data yet.</p>
        )}
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────

function HistoryTab({ companyId, history, onViewPaystubs }: {
  companyId: string; history?: HistoryPeriod[]; onViewPaystubs: (id: string, payDate?: string, label?: string) => void;
}) {
  if (!history || history.length === 0) return (
    <div className="text-center py-20 text-gray-400 text-sm">No processed payroll periods found yet.</div>
  );
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Pay Period</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Pay Date</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Pay</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Debit</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {history.map((h, i) => {
            const id = String(h.payPeriodId ?? h.payBeginDate ?? i);
            const status = String(h.payPeriodStatus ?? "processed");
            // total = gross pay from Rollfi; debit = gross + employer taxes
            const total = (h.total as number | undefined) ?? (h.payrollAmount as number | undefined) ?? 0;
            const erTax = (h.employerTaxSum as number | undefined) ?? 0;
            const debit = total + erTax;
            return (
              <tr key={id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-xs text-gray-700 font-medium">
                  {fmtDate(String(h.payBeginDate ?? ""))} – {fmtDate(String(h.payEndDate ?? ""))}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{fmtDate(String(h.payDate ?? ""))}</td>
                <td className="px-4 py-3 text-right text-xs font-semibold text-gray-800">{total > 0 ? fmtD(total) : "—"}</td>
                <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900">{debit > 0 ? fmtD(debit) : total > 0 ? fmtD(total) : "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={() => onViewPaystubs(
                        id,
                        String(h.payDate ?? ""),
                        `${fmtDate(String(h.payBeginDate ?? ""))} – ${fmtDate(String(h.payEndDate ?? ""))}`
                      )}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[#284362]/10 text-[#284362] hover:bg-[#284362]/20 transition-colors">
                      <Users className="h-3 w-3" />View Employees
                    </button>
                    <button className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500 cursor-not-allowed opacity-60">
                      <Download className="h-3 w-3" />Export
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

type TabId = "current" | "history" | "offcycle";

export default function ManagerPayroll() {
  const { user, company } = useAuth();
  const companyId = user?.companyId ?? "";
  const search = useSearch();
  const [, setLocation] = useLocation();

  // Derive active tab from URL ?tab= query param
  const tabFromUrl = (new URLSearchParams(search).get("tab") ?? "current") as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(tabFromUrl);

  // Keep local tab state in sync if URL changes (e.g. clicking nav sub-items)
  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setLocation(tab === "current" ? "/manager-payroll" : `/manager-payroll?tab=${tab}`);
  };

  const goToEmployees = (periodId: string, pd?: string, label?: string) => {
    const qs = new URLSearchParams({ periodId });
    if (pd) qs.set("payDate", pd);
    if (label) qs.set("label", label);
    setLocation(`/manager-payroll/employees?${qs.toString()}`);
  };

  // ── Data fetching ─────────────────────────────────────────

  const { data: payPeriod, isLoading: loadingPeriod } = useQuery({
    queryKey: ["mgr-payperiod", companyId],
    queryFn: () => api.get<PayPeriod>(`/rollfi/payperiod?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ["mgr-history", companyId],
    queryFn: () => api.get<{ periods: HistoryPeriod[] }>(`/rollfi/payperiod/history?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const activePeriodId = payPeriod?.payPeriodId;
  const { data: detailData, isLoading: loadingDetail } = useQuery({
    queryKey: ["mgr-detail", companyId, activePeriodId],
    queryFn: () => api.get<PeriodDetailsResponse>(`/rollfi/payperiod/details?companyId=${companyId}&payPeriodId=${encodeURIComponent(activePeriodId!)}`),
    enabled: !!companyId && !!activePeriodId,
    staleTime: 30_000,
  });

  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ["mgr-preview", companyId],
    queryFn: () => api.get<PayrollPreview>(`/rollfi/payroll/preview?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { data: empStatuses } = useQuery({
    queryKey: ["mgr-emp-status", companyId],
    queryFn: () => api.get<{ statuses: EmpStatus[] }>(`/rollfi/employees/status?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 120_000,
  });

  const { data: tasks } = useQuery({
    queryKey: ["mgr-tasks", companyId],
    queryFn: () => api.get<CompanyTasksData>(`/rollfi/company-tasks?companyId=${companyId}`),
    enabled: !!companyId,
    staleTime: 120_000,
  });

  const detail = detailData?.payPeriod?.[0];
  const history = historyData?.periods ?? [];
  const statuses = empStatuses?.statuses ?? [];

  // ── KPI data ──────────────────────────────────────────────

  const payStatus = detail?.PayPeriodStatus ?? payPeriod?.payPeriodStatus ?? "New";
  const daysToPayDate = daysUntil(payPeriod?.payDate);
  const empCount = detail?.payrollLineItems?.length ?? preview?.employees?.filter(e => e.onboardedToRollfi).length ?? 0;
  // Cash Required = gross total + employer taxes (matches Rollfi "Debit amount" / "Total cash required")
  const grossTotal = detail?.total ?? 0;
  const employerTaxes = detail?.employerTaxSum ?? 0;
  const cashRequired = grossTotal + employerTaxes;

  if (!companyId) return null;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[#E8622A]/10">
          <DollarSign className="h-5 w-5 text-[#E8622A]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#284362]">Payroll</h1>
          <p className="text-sm text-muted-foreground">{company?.name} — Payroll Operations</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {([ ["current","Current Payrolls"], ["history","Payroll History"], ["offcycle","Off-Cycle"] ] as [TabId,string][]).map(([id, label]) => (
          <button key={id} onClick={() => handleTabChange(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === id ? "border-[#E8622A] text-[#E8622A]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Off-Cycle Tab ── */}
      {activeTab === "offcycle" && (
        <div className="text-center py-20">
          <Briefcase className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <h3 className="font-semibold text-gray-600 text-lg">Off-Cycle Payrolls</h3>
          <p className="text-gray-400 text-sm mt-1">This feature is coming soon. Off-cycle payroll runs will appear here.</p>
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === "history" && (
        <HistoryTab companyId={companyId} history={history} onViewPaystubs={(id, pd, label) => goToEmployees(id, pd, label)} />
      )}

      {/* ── Current Tab ── */}
      {activeTab === "current" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard
              icon={<Zap className="h-4 w-4" />} label="Payroll Status"
              value={loadingPeriod ? "…" : payStatus || "New"}
              sub1={payPeriod ? `${fmtDate(payPeriod.payBeginDate)} – ${fmtDate(payPeriod.payEndDate)}` : undefined}
              accent={["ready","completed","processed"].some(s => payStatus.toLowerCase().includes(s)) ? "#16a34a" : ["submitted","processing","inprocess"].some(s => payStatus.toLowerCase().includes(s)) ? "#d97706" : "#284362"}
              loading={loadingPeriod}
            />
            <KpiCard
              icon={<Calendar className="h-4 w-4" />} label="Pay Period"
              value={payPeriod ? `${new Date(payPeriod.payBeginDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(payPeriod.payEndDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "—"}
              sub1="BiWeekly"
              sub2={payPeriod?.deadLineToRunPayroll ? `Funding by ${fmtDate(payPeriod.deadLineToRunPayroll)}` : undefined}
              accent="#284362" loading={loadingPeriod}
            />
            <KpiCard
              icon={<Clock className="h-4 w-4" />} label="Pay Date"
              value={fmtDate(payPeriod?.payDate)}
              sub1={daysToPayDate >= 0 ? `in ${daysToPayDate} day${daysToPayDate === 1 ? "" : "s"}` : "Past"}
              accent={daysToPayDate >= 0 && daysToPayDate <= 3 ? "#dc2626" : "#284362"}
              loading={loadingPeriod}
            />
            <KpiCard
              icon={<Users className="h-4 w-4" />} label="Employees to Pay"
              value={loadingPreview || loadingDetail ? "…" : String(empCount || "—")}
              sub1={statuses.filter(e => e.userStatus.toLowerCase() === "active").length > 0 ? `${statuses.filter(e => e.userStatus.toLowerCase() === "active").length} Active` : undefined}
              accent="#284362" loading={loadingPreview && loadingDetail}
              onAction={payPeriod?.payPeriodId ? () => goToEmployees(
                payPeriod.payPeriodId,
                payPeriod.payDate,
                `${fmtDate(payPeriod.payBeginDate)} – ${fmtDate(payPeriod.payEndDate)}`
              ) : undefined}
              actionLabel={payPeriod?.payPeriodId ? "View employees" : undefined}
            />
            <KpiCard
              icon={<DollarSign className="h-4 w-4" />} label="Cash Required"
              value={cashRequired > 0 ? fmtD(cashRequired) : preview?.totalGrossPay ? `~${fmtD(preview.totalGrossPay)}` : "—"}
              sub1={payPeriod?.payDate ? `Debit on ${fmtDate(payPeriod.payDate)}` : undefined}
              sub2={tasks?.bankLinked ? "✓ Funds available" : cashRequired === 0 && !preview?.totalGrossPay ? undefined : "Pending bank setup"}
              accent={tasks?.bankLinked ? "#16a34a" : "#d97706"}
              loading={loadingDetail && loadingPreview}
            />
          </div>

          {/* Health + Timeline + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <HealthScore tasks={tasks} empStatuses={statuses} detail={detail} preview={preview} hasHistory={history.length > 0} />
            <PayrollTimeline payPeriod={payPeriod} detail={detail} />
            <SmartInsights detail={detail} history={history} preview={preview} />
          </div>

          {/* Main content + Sidebar */}
          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0 space-y-4">
              <h3 className="font-semibold text-gray-800">Pay Periods</h3>
              {(loadingPeriod && loadingHistory) ? (
                <div className="bg-white rounded-xl border shadow-sm p-8 text-center text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading pay periods…
                </div>
              ) : (
                <PayrollGrid
                  companyId={companyId} currentPeriod={payPeriod}
                  currentPeriodTotal={cashRequired > 0 ? cashRequired : undefined}
                  history={history.slice(0, 5)}
                  preview={preview} onViewPaystubs={id => goToEmployees(
                    id,
                    payPeriod?.payDate,
                    payPeriod ? `${fmtDate(payPeriod.payBeginDate)} – ${fmtDate(payPeriod.payEndDate)}` : undefined
                  )}
                />
              )}
            </div>
            <RightSidebar payPeriod={payPeriod} />
          </div>

          {/* Bottom widgets */}
          <BottomWidgets companyId={companyId} detail={detail} history={history} preview={preview} />
        </>
      )}

    </div>
  );
}
