import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DollarSign, AlertTriangle, CheckCircle2, XCircle, Loader2,
  Play, RefreshCw, Clock, Zap, ArrowLeft, ChevronLeft,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface PayPeriod {
  payPeriodId: string; payPeriod: string; payBeginDate: string;
  payEndDate: string; payDate: string; deadLineToRunPayroll: string;
  payPeriodStatus: string; payrollAmount?: number;
}
interface PreviewEmployee {
  employeeId?: string | null; name: string; position: string;
  rollfiUserId: string | null; hoursWorked: number; netPayableHours: number;
  hourlyRate: number; grossPay: number; onboardedToRollfi: boolean;
  hoursSource?: "easyteam" | "seeded" | "estimated" | "easyteam_sync" | "manager_edit" | "pending_approval";
  /** 'hourly' | 'salary' — from DB pay_type column */
  payType?: string | null;
  /** Annual salary in cents (DB annual_salary) — only meaningful when payType = 'salary' */
  annualSalaryCents?: number | null;
}
interface PayrollPreview {
  period: { from: string; to: string; workdays?: number };
  employees: PreviewEmployee[];
  totalGrossPay: number;
  allOnboarded: boolean;
}
interface ImportResult {
  success: boolean; payPeriodId?: string;
  realTotals?: { grossPay: number; netPay: number; employeeTax: number; employerTax: number; totalDebit: number } | null;
  lineItems?: Record<string, unknown>[];
  skippedEmployees?: { rollfiUserId: string; name?: string; type?: string; reason: string }[];
  error?: string;
}
interface PayrollResult {
  success: boolean;
  importResult?: { importRegularPayrollLData?: { status: string; message: string } };
  payPeriod?: { payPeriodId: string; status: string; message: string };
  error?: string;
  skippedEmployees?: { rollfiUserId: string; name?: string; type?: "zero_hours" | "onboarding"; reason: string }[];
}
type AdjMap = Record<string, {
  compDescription: string; compAmount: number;
  otType: string; otHours: number; otMultiplier: number;
}>;

// ── Helpers ────────────────────────────────────────────────────

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

function r2(n: number) { return Math.round(n * 100) / 100; }
function fmtD(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Returns a rate string appropriate for the employee's pay type.
 *  Salaried employees show their annual salary (or "Salaried"), never an hourly rate.
 *  Use this everywhere a rate label is rendered so the fix stays in one place. */
function formatEmployeeRate(emp: { hourlyRate: number; payType?: string | null; annualSalaryCents?: number | null }): string {
  // annualSalaryCents is a fallback ONLY when payType is absent (e.g. stale cached response).
  // An explicit payType="hourly" must never be overridden by a leftover annual_salary value.
  const isSalary = emp.payType === "salary" || (emp.payType?.startsWith("salary_") ?? false)
    || (!emp.payType && !!emp.annualSalaryCents && emp.annualSalaryCents > 0);
  if (isSalary) {
    return emp.annualSalaryCents && emp.annualSalaryCents > 0
      ? `${fmtD(emp.annualSalaryCents / 100)} / year`
      : "Salaried";
  }
  return `$${emp.hourlyRate.toFixed(2)}/hr`;
}

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

const NAVY   = "#284362";
const ORANGE = "#E8622A";

function ImportStatCard({ label, value, accent = "#2C4562" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-1">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-xl font-bold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

// ── Pay period status badge ────────────────────────────────────

function PayPeriodStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const configs: Record<string, { bg: string; text: string; border: string; label: string }> = {
    new:       { bg: "bg-blue-500/20",    text: "text-blue-300",    border: "border-blue-500/30",    label: "New" },
    submitted: { bg: "bg-amber-500/20",   text: "text-amber-300",   border: "border-amber-500/30",   label: "Submitted" },
    inprocess: { bg: "bg-orange-500/20",  text: "text-orange-300",  border: "border-orange-500/30",  label: "Processing" },
    processed: { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/30", label: "Processed ✓" },
    failed:    { bg: "bg-red-500/20",     text: "text-red-300",     border: "border-red-500/30",     label: "Failed" },
    cancelled: { bg: "bg-gray-500/20",    text: "text-gray-300",    border: "border-gray-500/30",    label: "Cancelled" },
  };
  const cfg = configs[s] ?? { bg: "bg-white/10", text: "text-white/50", border: "border-white/20", label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

// ── Payroll result card ────────────────────────────────────────

function PayrollResultCard({ result, onReset }: { result: PayrollResult; onReset: () => void }) {
  if (!result.success) {
    return (
      <div className="mt-4 p-5 rounded-xl bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-red-300 font-semibold">Payroll submission failed</p>
        </div>
        <p className="text-red-300/70 text-sm ml-7">{result.error}</p>
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
        <div className="w-8 h-8 rounded-full bg-emerald-500/30 flex items-center justify-center">
          <Zap className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-emerald-300 font-semibold">Payroll submitted to Rollfi</p>
          <p className="text-emerald-400/60 text-xs">Funds will be disbursed on the scheduled pay date</p>
        </div>
      </div>

      {result.skippedEmployees && result.skippedEmployees.length > 0 && (() => {
        const zeroHours  = result.skippedEmployees!.filter((e) => e.type === "zero_hours");
        const onboarding = result.skippedEmployees!.filter((e) => e.type !== "zero_hours");
        return (
          <>
            {zeroHours.length > 0 && (
              <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-300 text-sm font-semibold">
                    {zeroHours.length === 1 ? "1 employee" : `${zeroHours.length} employees`} excluded — no hours this period
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {zeroHours.map((e) => (
                      <li key={e.rollfiUserId} className="text-amber-400/70 text-xs">
                        {e.name ?? e.rollfiUserId} — removed from pay period via Rollfi API
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {onboarding.length > 0 && (
              <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-300 text-sm font-semibold">
                    {onboarding.length === 1 ? "1 employee" : `${onboarding.length} employees`} excluded — incomplete Rollfi onboarding
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {onboarding.map((e) => (
                      <li key={e.rollfiUserId} className="text-red-400/70 text-xs">{e.name ?? e.rollfiUserId}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        );
      })()}

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

// ── Main Page ──────────────────────────────────────────────────

export default function ManagerPayrollSubmit() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const companyId = user?.companyId ?? "";

  const [expandedEmp, setExpandedEmp]     = useState<string | null>(null);
  const [adjustments, setAdjustments]     = useState<AdjMap>({});
  const [adjOpen, setAdjOpen]             = useState(false);
  const [importResult, setImportResult]   = useState<ImportResult | null>(null);
  const [payrollResult, setPayrollResult] = useState<PayrollResult | null>(null);
  const [confirmOpen, setConfirmOpen]     = useState(false);
  const [selectedImportEmp, setSelectedImportEmp] = useState<{ lineItem: Record<string, unknown>; previewEmp?: PreviewEmployee; name: string; position: string } | null>(null);

  const { data: payPeriod, isLoading: periodLoading, refetch: refetchPeriod } =
    useQuery<PayPeriod>({
      queryKey: ["submit-payperiod", companyId],
      queryFn: () => api.get(`/rollfi/payperiod?companyId=${companyId}`),
      enabled: !!companyId,
      retry: false,
    });

  // State-registration gap detection — warning only, never a block
  const { data: gapsData } = useQuery<{ gaps: Array<{ state: string; employees: { id: string; name: string }[] }> }>({
    queryKey: ["state-registration-gaps", companyId],
    queryFn: () =>
      fetch("/api/state-registrations/gaps", { credentials: "include" })
        .then(r => r.json() as Promise<{ gaps: Array<{ state: string; employees: { id: string; name: string }[] }> }>),
    staleTime: 120_000,
    enabled: !!companyId && (user?.role === "owner" || user?.role === "super_admin"),
  });

  // Adjustments are per-period overrides only — clear them whenever the active pay period rolls
  // over so they never bleed into a different period (stale-comp guard, mirrors STEP 5).
  useEffect(() => {
    if (payPeriod?.payPeriodId) {
      setAdjustments({});
      setSelectedImportEmp(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payPeriod?.payPeriodId]);

  const { data: preview, isLoading: previewLoading, refetch: refetchPreview } =
    useQuery<PayrollPreview>({
      queryKey: ["submit-preview", companyId],
      queryFn: () => api.get(`/rollfi/payroll/preview?companyId=${companyId}`),
      enabled: !!companyId,
      refetchOnMount: "always",
      staleTime: 0,
    });

  const { data: otTypesRaw, isLoading: otLoading, isError: otError } = useQuery<Record<string, unknown>>({
    queryKey: ["rollfi-ot-types", companyId],
    queryFn: () => api.get<Record<string, unknown>>(`/rollfi/overtime-types?companyId=${companyId}`),
    enabled: !!companyId && adjOpen,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const { data: compTypesRaw, isLoading: compLoading, isError: compError } = useQuery<Record<string, unknown>>({
    queryKey: ["rollfi-comp-types", companyId],
    queryFn: () => api.get<Record<string, unknown>>(`/rollfi/compensation-types?companyId=${companyId}`),
    enabled: !!companyId && adjOpen,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const otTypes: string[] = Array.isArray((otTypesRaw as Record<string, unknown> | undefined)?.overTimeTypes)
    ? (otTypesRaw as Record<string, string[]>).overTimeTypes
    : [];
  const compDescriptions: string[] = Array.isArray((compTypesRaw as Record<string, unknown> | undefined)?.additionalCompensationDescription)
    ? (compTypesRaw as Record<string, string[]>).additionalCompensationDescription
    : [];

  const submittableStatuses = ["new", "preprocess", "inprocess", "cancelled", "failed"];
  const periodSubmittable = !payPeriod || submittableStatuses.includes(payPeriod.payPeriodStatus.toLowerCase());

  const importHours = useMutation({
    mutationFn: () => {
      if (!payPeriod || !preview) throw new Error("No period or preview");
      const employeeHours = preview.employees
        .filter((e) => e.rollfiUserId)
        .map((e) => ({ rollfiUserId: e.rollfiUserId!, hours: e.netPayableHours }));
      const adjs = Object.entries(adjustments)
        .filter(([, a]) => a.compAmount > 0 || a.otHours > 0)
        .map(([rollfiUserId, a]) => ({
          rollfiUserId,
          additionalCompensation: a.compDescription && a.compAmount > 0
            ? [{ description: a.compDescription, amount: a.compAmount }]
            : undefined,
          overTime: a.otType && a.otHours > 0
            ? [{ type: a.otType, noOfHours: a.otHours, multiplier: a.otMultiplier }]
            : undefined,
        }));
      return api.post<ImportResult>("/rollfi/payroll/import", {
        companyId, payPeriodId: payPeriod.payPeriodId,
        payBeginDate: payPeriod.payBeginDate, payEndDate: payPeriod.payEndDate,
        adjustments: adjs, employeeHours,
      });
    },
    onSuccess: (r) => { setImportResult(r); setPayrollResult(null); setAdjustments({}); },
    onError:   (e) => { setImportResult({ success: false, payPeriodId: "", error: (e as Error).message }); },
  });

  const submitPayroll = useMutation({
    mutationFn: () => {
      if (!payPeriod) throw new Error("No pay period");
      return api.post<PayrollResult>("/rollfi/payroll/submit", { companyId, payPeriodId: payPeriod.payPeriodId });
    },
    onSuccess: (r) => {
      setPayrollResult(r);
      setImportResult(null);
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ["mgr-payperiod", companyId] });
      void qc.invalidateQueries({ queryKey: ["mgr-history", companyId] });
      void refetchPeriod();
    },
    onError: (e) => { setPayrollResult({ success: false, error: (e as Error).message }); setConfirmOpen(false); },
  });

  function handleRefresh() {
    void refetchPeriod();
    void refetchPreview();
    setImportResult(null);
    setPayrollResult(null);
  }

  // ── Derived totals ──────────────────────────────────────────


  return (
    <div className="min-h-screen" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, #1a2e45 100%)` }}>
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <button
              onClick={() => navigate("/manager-payroll")}
              className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mb-3 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Payroll
            </button>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: ORANGE }}>
                <DollarSign className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Submit Payroll</h1>
            </div>
            <p className="text-white/50 text-sm ml-12">Review employee hours and submit payroll to Rollfi</p>
          </div>
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {/* Pay period info card */}
        {periodLoading && (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>
        )}
        {payPeriod && (
          <div className="mb-5 p-4 rounded-xl border border-white/10 bg-white/5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Period</p>
                <p className="text-white text-sm font-medium">{payPeriod.payPeriod}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Period Dates</p>
                <p className="text-white text-sm">{fmtDate(payPeriod.payBeginDate)} – {fmtDate(payPeriod.payEndDate)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Date</p>
                <p className="text-white text-sm">{fmtDate(payPeriod.payDate)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Deadline</p>
                <p className="text-white text-sm">{fmtDate(payPeriod.deadLineToRunPayroll)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Status</p>
                <PayPeriodStatusBadge status={payPeriod.payPeriodStatus} />
              </div>
            </div>
          </div>
        )}

        {/* Already submitted notice */}
        {payPeriod && !periodSubmittable && (
          <div className="mb-5 p-4 rounded-xl border border-white/10 bg-white/5 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">This period has already been submitted</p>
              <p className="text-white/40 text-xs mt-0.5">
                Status: <strong className="text-white/60">{payPeriod.payPeriodStatus}</strong>.
                Once processed, a new period will appear automatically.
              </p>
            </div>
          </div>
        )}

        {/* Employee breakdown table */}
        {previewLoading && (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>
        )}

        {preview && !previewLoading && (
          <>
            {/* State registration gap warning — shown above the employee table; never blocks submission */}
            {(gapsData?.gaps ?? []).length > 0 && (
              <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 text-sm font-semibold mb-1">
                      Missing state tax registration{(gapsData?.gaps ?? []).length > 1 ? "s" : ""}
                    </p>
                    <ul className="space-y-0.5">
                      {(gapsData?.gaps ?? []).map(gap => (
                        <li key={gap.state} className="text-amber-400/80 text-xs">
                          <span className="font-semibold">{gap.state}</span>
                          {" "}— {gap.employees.length === 1
                            ? `${gap.employees[0]?.name} has no state withholding`
                            : `${gap.employees.length} employees have no state withholding`}
                        </li>
                      ))}
                    </ul>
                    <p className="text-amber-500/70 text-[11px] mt-1.5">
                      Payroll will proceed, but state taxes won't be withheld for these employees.
                      Fix in{" "}
                      <a href="/settings/state-tax" className="underline hover:text-amber-300">
                        Company Settings → State Tax Information
                      </a>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between">
              {!preview.allOnboarded && (
                <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5" /> Some employees not yet onboarded
                </div>
              )}
            </div>


            {/* Employee tables — hourly first, salaried below */}
            {(() => {
              const isSalariedEmp = (e: PreviewEmployee) =>
                e.payType === "salary" || (e.payType?.startsWith("salary_") ?? false)
                || (!e.payType && !!e.annualSalaryCents && e.annualSalaryCents > 0);
              const hourlyEmps   = preview.employees.filter((e) => !isSalariedEmp(e));
              const salariedEmps = preview.employees.filter(isSalariedEmp);
              return (
                <>
                  {hourlyEmps.length > 0 && (
                    <>
                      {salariedEmps.length > 0 && (
                        <p className="text-white/30 text-[10px] font-bold uppercase tracking-wide mb-1.5 mt-1">Hourly Employees</p>
                      )}
                      <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ background: "rgba(255,255,255,0.06)" }}>
                              {["Employee", "Worked", "Net Hrs", "Rate"].map((h) => (
                                <th key={h} className="text-left px-4 py-3 text-white/50 font-semibold text-xs">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {hourlyEmps.map((emp) => {
                              const tax = calcEmpTax(emp.grossPay);
                              const er  = calcErTax(emp.grossPay);
                              const key = emp.employeeId ?? emp.name;
                              const isExpanded  = expandedEmp === key;
                              const isZeroHours = emp.hoursWorked === 0 && emp.grossPay === 0;
                              return (
                                <React.Fragment key={key}>
                                  <tr
                                    className={`hover:bg-white/5 transition-colors cursor-pointer select-none ${isZeroHours ? "opacity-45" : ""}`}
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
                                        {isZeroHours
                                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/25">⚠ Excluded</span>
                                          : <>
                                              {(emp.hoursSource === "easyteam_sync" || emp.hoursSource === "easyteam") && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Approved</span>}
                                              {emp.hoursSource === "manager_edit" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/20">Mgr Edited</span>}
                                              {emp.hoursSource === "seeded" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">Approved</span>}
                                              {emp.hoursSource === "pending_approval" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/20">Pending</span>}
                                              {(!emp.hoursSource || emp.hoursSource === "estimated") && <span className="text-[10px] px-1 py-0.5 rounded text-white/20">est.</span>}
                                            </>
                                        }
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-white font-semibold">{emp.netPayableHours}h</td>
                                    <td className="px-4 py-3 text-white/70">{formatEmployeeRate(emp)}</td>
                                  </tr>

                                  {isExpanded && (
                                    <tr key={`${key}-exp`}>
                                      <td colSpan={4} className="px-4 py-0">
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
                        </table>
                      </div>
                    </>
                  )}

                  {salariedEmps.length > 0 && (
                    <>
                      <p className="text-white/30 text-[10px] font-bold uppercase tracking-wide mb-1.5 mt-1">Salaried Employees</p>
                      <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ background: "rgba(255,255,255,0.06)" }}>
                              {["Employee", "Annual Salary"].map((h) => (
                                <th key={h} className="text-left px-4 py-3 text-white/50 font-semibold text-xs">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {salariedEmps.map((emp) => {
                              const key = emp.employeeId ?? emp.name;
                              return (
                                <tr key={key} className="hover:bg-white/5 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="text-white font-medium">{emp.name}</div>
                                    <div className="text-white/40 text-xs">{emp.position}</div>
                                  </td>
                                  <td className="px-4 py-3 text-emerald-400 font-semibold">
                                    {emp.annualSalaryCents && emp.annualSalaryCents > 0
                                      ? `${fmtD(emp.annualSalaryCents / 100)} / year`
                                      : <span className="text-white/40 italic text-xs">Salaried</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/30 italic">
                          Salaried pay is calculated automatically and prorated by start date.
                        </div>
                      </div>
                    </>
                  )}
                </>
              );
            })()}



            {/* Adjustments */}
            {periodSubmittable && (
              <div className="mb-4">
                <button
                  onClick={() => setAdjOpen((o) => !o)}
                  className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-2"
                >
                  <span className="font-semibold">Payroll Adjustments</span>
                  {Object.values(adjustments).some((a) => a.compAmount > 0 || a.otHours > 0) && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/20">Active</span>
                  )}
                  <span className={`text-[10px] transition-transform duration-200 inline-block ${adjOpen ? "rotate-90" : ""}`}>▶</span>
                </button>
                {adjOpen && (
                  <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                    <div className="px-5 py-3 border-b border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <p className="text-white/40 text-xs">Add one-time compensation or overtime for this pay run. Types are pulled from Rollfi and carry specific tax rules.</p>
                    </div>
                    <div className="divide-y divide-white/5">
                      {preview.employees.filter((e) => e.onboardedToRollfi && e.rollfiUserId).map((emp) => {
                        const key = emp.rollfiUserId!;
                        const adj = adjustments[key] ?? { compDescription: "", compAmount: 0, otType: "", otHours: 0, otMultiplier: 1.5 };
                        const hasAdj = adj.compAmount > 0 || adj.otHours > 0;
                        return (
                          <div key={key} className="px-5 py-4 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-white text-sm font-medium">{emp.name}</div>
                                <div className="text-white/40 text-xs">{emp.position} · {formatEmployeeRate(emp)}</div>
                              </div>
                              {hasAdj && (
                                <button
                                  onClick={() => setAdjustments((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                                  className="text-white/20 hover:text-white/50 text-xs"
                                >Clear ✕</button>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-white/40 w-20 shrink-0">Comp type</span>
                              <select
                                value={adj.compDescription}
                                onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, compDescription: e.target.value, compAmount: e.target.value ? adj.compAmount : 0 } }))}
                                className="flex-1 bg-gray-800 border border-white/10 rounded px-2 py-1 text-white text-xs outline-none focus:border-orange-400/50 min-w-0"
                                style={{ colorScheme: 'dark' }}
                              >
                                <option value="">— none —</option>
                                {compLoading && <option disabled>Loading…</option>}
                                {compError && <option disabled>Unavailable — check Rollfi</option>}
                                {compDescriptions.map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                              <input
                                type="number" min="0" step="50"
                                value={adj.compAmount || ""}
                                placeholder="$0"
                                disabled={!adj.compDescription}
                                onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, compAmount: Number(e.target.value) || 0 } }))}
                                className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-right outline-none focus:border-orange-400/50 disabled:opacity-40 transition-colors shrink-0"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-white/40 w-20 shrink-0">OT type</span>
                              <select
                                value={adj.otType}
                                onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, otType: e.target.value, otHours: e.target.value ? adj.otHours : 0 } }))}
                                className="flex-1 bg-gray-800 border border-white/10 rounded px-2 py-1 text-white text-xs outline-none focus:border-orange-400/50 min-w-0"
                                style={{ colorScheme: 'dark' }}
                              >
                                <option value="">— none —</option>
                                {otLoading && <option disabled>Loading…</option>}
                                {otError && <option disabled>Unavailable — check Rollfi</option>}
                                {otTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input
                                type="number" min="0" step="0.5"
                                value={adj.otHours || ""}
                                placeholder="0 hrs"
                                disabled={!adj.otType}
                                onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, otHours: Number(e.target.value) || 0 } }))}
                                className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-right outline-none focus:border-orange-400/50 disabled:opacity-40 transition-colors shrink-0"
                              />
                              <span className="text-white/30 text-xs shrink-0">×</span>
                              <input
                                type="number" min="0.5" step="0.5"
                                value={adj.otMultiplier}
                                disabled={!adj.otType}
                                onChange={(e) => setAdjustments((prev) => ({ ...prev, [key]: { ...adj, otMultiplier: Number(e.target.value) || 1.5 } }))}
                                className="w-14 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs text-right outline-none focus:border-orange-400/50 disabled:opacity-40 transition-colors shrink-0"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Import button */}
            {periodSubmittable && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Button
                  disabled={!payPeriod || importHours.isPending}
                  onClick={() => { setImportResult(null); importHours.mutate(); }}
                  className="gap-2 text-white font-semibold"
                  style={{ background: !payPeriod ? "rgba(255,255,255,0.1)" : ORANGE }}
                >
                  {importHours.isPending
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending to Rollfi…</>
                    : importResult?.success
                      ? <><Play className="h-4 w-4" /> Re-import Hours</>
                      : <><Play className="h-4 w-4" /> Import Hours to Rollfi</>
                  }
                </Button>
                {!payPeriod && !periodLoading && (
                  <p className="text-amber-400/70 text-xs">No pay period found — <button className="underline" onClick={() => void refetchPeriod()}>retry</button></p>
                )}
              </div>
            )}

            {/* Import result */}
            {importResult && (
              <div className={`rounded-xl border overflow-hidden mb-4 ${importResult.success ? "border-emerald-500/30" : "border-red-500/30"}`}
                style={{ background: importResult.success ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)" }}>
                <div className="px-5 py-3 border-b flex items-center justify-between"
                  style={{ borderColor: importResult.success ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)", background: importResult.success ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
                  <div className="flex items-center gap-2">
                    {importResult.success
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      : <XCircle className="h-4 w-4 text-red-400" />}
                    <p className="text-white font-semibold text-sm">
                      {importResult.success ? "Hours Imported — Rollfi Computed Totals" : "Import Failed"}
                    </p>
                  </div>
                  {importResult.success && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-semibold">✅ Real numbers from Rollfi</span>
                  )}
                </div>

                {importResult.error && <p className="px-5 py-4 text-red-300 text-sm">{importResult.error}</p>}

                {importResult.success && importResult.realTotals && (() => {
                  const t = importResult.realTotals!;

                  if (selectedImportEmp) {
                    const item = selectedImportEmp.lineItem;
                    const selName = selectedImportEmp.name;
                    const selPos = selectedImportEmp.position;
                    const selPrev = selectedImportEmp.previewEmp;
                    const grossTotal   = Number(item.grossTotal ?? 0);
                    const netPay       = Number(item.netTotal ?? 0);
                    const addCompArr    = (item.additionalCompensations ?? item.additionalCompensation ?? []) as Array<Record<string, unknown>>;
                    const addComp      = Array.isArray(addCompArr)
                      ? Math.round(addCompArr.reduce((s, c) => s + Number(c.amount ?? c.value ?? 0), 0) * 100) / 100
                      : Number(item.additionalCompensationTotal ?? 0);
                    // basePay = base wages only; grossTotal already includes additional comp
                    const basePay      = Number(item.baseTotal ?? item.base ?? (grossTotal - addComp));
                    const hours        = selPrev?.netPayableHours ?? selPrev?.hoursWorked ?? 0;
                    const empTaxes     = (item.employeeTaxDetails ?? item.employeeTaxes ?? item.taxBreakdown ?? []) as Array<Record<string, unknown>>;
                    const erTaxes      = (item.employerTaxDetails ?? item.employerTaxes ?? item.employerTaxBreakdown ?? []) as Array<Record<string, unknown>>;
                    const empTaxesSum  = empTaxes.reduce((s, t) => s + Number(t.amount ?? t.value ?? t.taxAmount ?? 0), 0);
                    const erTaxesSum   = erTaxes.reduce((s, t) => s + Number(t.amount ?? t.value ?? t.taxAmount ?? 0), 0);
                    const empDed       = Number(item.employeeTaxTotal ?? item.deductions ?? 0) || empTaxesSum;
                    const erTaxTotal   = Number(item.employerTaxTotal ?? item.employerTax ?? 0) || erTaxesSum;
                    return (
                      <div className="px-5 py-4 space-y-4">
                        {/* KPI cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <ImportStatCard label="Total Employer Taxes" value={fmtD(t.employerTax)} accent="#2C4562" />
                          <ImportStatCard label="Total Employee Deductions" value={fmtD(t.employeeTax)} accent="#6b7280" />
                          <ImportStatCard label="Total Gross Pay" value={fmtD(t.grossPay)} accent="#2C4562" />
                          <ImportStatCard label="Total Debit Amount" value={fmtD(t.totalDebit)} accent="#E8622A" />
                        </div>
                        {/* Back */}
                        <button
                          onClick={() => setSelectedImportEmp(null)}
                          className="flex items-center gap-1.5 text-sm font-medium text-blue-300 hover:text-blue-200 transition-colors">
                          ← Back to all employees
                        </button>
                        {/* Employee header */}
                        <div className="bg-white rounded-xl border shadow-sm p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h2 className="text-xl font-bold text-gray-900">{selName}</h2>
                              {selPos && <p className="text-sm text-gray-500 mt-0.5">{selPos}</p>}
                            </div>
                            {payPeriod && (
                              <div className="text-right">
                                <div className="text-xs text-gray-400">Pay Date</div>
                                <div className="text-sm font-semibold text-gray-700">{fmtDate(payPeriod.payDate)}</div>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-4 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3">
                              <div className="text-xs text-gray-500 mb-0.5">Base Earnings</div>
                              <div className="text-xl font-bold text-gray-900">{fmtD(basePay)}</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <div className="text-xs text-gray-500 mb-0.5">Gross Earnings</div>
                              <div className="text-xl font-bold text-gray-900">{fmtD(grossTotal)}</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <div className="text-xs text-gray-500 mb-0.5">Net Earnings</div>
                              <div className="text-xl font-bold text-emerald-600">{fmtD(netPay)}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div><span className="text-gray-400">Regular Hours</span><br /><span className="font-semibold text-gray-800">{hours}</span></div>
                            <div><span className="text-gray-400">Total Hours</span><br /><span className="font-semibold text-gray-800">{hours}</span></div>
                            <div><span className="text-gray-400">Pay Date</span><br /><span className="font-semibold text-gray-800">{fmtDate(payPeriod?.payDate)}</span></div>
                          </div>
                        </div>
                        {/* Tax tables */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                              <span className="font-semibold text-gray-800">Employee Taxes</span>
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                            </div>
                            {empTaxes.length > 0 ? (
                              <>
                                {empTaxes.map((tax, i) => (
                                  <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                                    <span className="text-gray-700">{String(tax.name ?? tax.description ?? tax.taxName ?? `Tax ${i + 1}`)}</span>
                                    <span className="font-medium text-gray-900">{fmtD(Number(tax.amount ?? tax.value ?? tax.taxAmount ?? 0))}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                                  <span>Total</span><span>{fmtD(empDed)}</span>
                                </div>
                              </>
                            ) : (
                              <div className="px-5 py-4 text-sm text-gray-400">No employee tax details available.</div>
                            )}
                          </div>
                          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                              <span className="font-semibold text-gray-800">Employer Taxes</span>
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                            </div>
                            {erTaxes.length > 0 ? (
                              <>
                                {erTaxes.map((tax, i) => (
                                  <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                                    <span className="text-gray-700">{String(tax.name ?? tax.description ?? tax.taxName ?? `Tax ${i + 1}`)}</span>
                                    <span className="font-medium text-gray-900">{fmtD(Number(tax.amount ?? tax.value ?? tax.taxAmount ?? 0))}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                                  <span>Total</span><span>{fmtD(erTaxTotal)}</span>
                                </div>
                              </>
                            ) : (
                              <div className="px-5 py-4 text-sm text-gray-400">No employer tax details available.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="px-5 py-4 space-y-4">
                      {/* 4 KPI cards */}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <ImportStatCard label="Total Employer Taxes" value={fmtD(t.employerTax)} accent="#2C4562" />
                        <ImportStatCard label="Total Employee Deductions" value={fmtD(t.employeeTax)} accent="#6b7280" />
                        <ImportStatCard label="Total Gross Pay" value={fmtD(t.grossPay)} accent="#2C4562" />
                        <ImportStatCard label="Total Debit Amount" value={fmtD(t.totalDebit)} accent="#E8622A" />
                      </div>
                      {importResult.skippedEmployees && importResult.skippedEmployees.length > 0 && (
                        <p className="text-amber-400/70 text-xs">⚠ Excluded: {importResult.skippedEmployees.map((e) => e.name ?? e.rollfiUserId).join(", ")}</p>
                      )}
                      {importResult.lineItems && importResult.lineItems.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <p className="text-white/50 text-xs font-semibold uppercase tracking-wide">
                              {importResult.lineItems.length} Employee{importResult.lineItems.length !== 1 ? "s" : ""}
                            </p>
                            <span className="text-white/20 text-[10px]">· Click a row to view tax breakdown</span>
                          </div>
                          <div className="rounded-xl border border-white/10 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ background: "rgba(255,255,255,0.06)" }}>
                                  {["Employee", "Base Pay", "Additional Comp", "Deductions", "Subtotal"].map((h) => (
                                    <th key={h} className="text-left px-4 py-2.5 text-white/40 font-semibold text-[10px] uppercase tracking-wide">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {importResult.lineItems.map((item, idx) => {
                                  const uid = (item.userId ?? item.userID ?? item.employeeId ?? item.id) as string | undefined;
                                  const pe = preview?.employees.find((e) => e.rollfiUserId?.toUpperCase() === uid?.toUpperCase());
                                  const empName = pe?.name ?? (item.userName as string | undefined) ?? uid ?? `Employee ${idx + 1}`;
                                  const empPos  = pe?.position ?? "";
                                  const grossTotal  = Number(item.grossTotal ?? 0);
                                  const netPay      = Number(item.netTotal ?? 0);
                                  const erTax       = Number(item.employerTaxTotal ?? item.employerTax ?? 0);
                                  const addCompArr2  = (item.additionalCompensations ?? item.additionalCompensation ?? []) as Array<Record<string, unknown>>;
                                  const addComp     = Array.isArray(addCompArr2)
                                    ? Math.round(addCompArr2.reduce((s, c) => s + Number(c.amount ?? c.value ?? 0), 0) * 100) / 100
                                    : Number(item.additionalCompensationTotal ?? 0);
                                  // basePay = base wages only; Rollfi's grossTotal already includes addComp
                                  const basePay     = Number(item.baseTotal ?? item.base ?? (grossTotal - addComp));
                                  const empDed      = Number(item.employeeTaxTotal ?? item.deductions ?? 0);
                                  // subtotal = total gross (base + comp), same as Rollfi's grossTotal
                                  const subtotal    = grossTotal;
                                  return (
                                    <tr
                                      key={uid ?? idx}
                                      className="hover:bg-white/5 transition-colors cursor-pointer select-none"
                                      onClick={() => setSelectedImportEmp({ lineItem: item, previewEmp: pe, name: empName, position: empPos })}
                                    >
                                      <td className="px-4 py-3">
                                        <div className="text-white font-medium">{empName}</div>
                                        {empPos && <div className="text-white/40 text-[10px]">{empPos}</div>}
                                      </td>
                                      <td className="px-4 py-3">
                                        {basePay > 0 ? <span className="text-emerald-400 font-semibold">{fmtD(basePay)}</span> : <span className="text-white/30">$0.00</span>}
                                      </td>
                                      <td className="px-4 py-3">
                                        {addComp > 0 ? <span className="text-white/70">{fmtD(addComp)}</span> : <span className="text-white/30">$0.00</span>}
                                      </td>
                                      <td className="px-4 py-3">
                                        {empDed > 0 ? <span className="text-red-300">−{fmtD(empDed)}</span> : <span className="text-white/30">$0.00</span>}
                                      </td>
                                      <td className="px-4 py-3">
                                        {subtotal > 0 ? <span className="text-white font-bold">{fmtD(subtotal)}</span> : netPay > 0 ? <span className="text-white font-bold">{fmtD(netPay)}</span> : <span className="text-white/30">$0.00</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {importResult.success && !importResult.realTotals && (
                  <div className="px-5 py-4">
                    <p className="text-white/50 text-sm mb-4">Hours imported successfully. Real totals not yet available — review the preview above and confirm to continue.</p>
                  </div>
                )}

                {/* Submit button */}
                {importResult.success && !confirmOpen && (
                  <div className="px-5 pb-4">
                    <Button
                      disabled={submitPayroll.isPending}
                      onClick={() => setConfirmOpen(true)}
                      className="w-full gap-2 text-white font-semibold"
                      style={{ background: ORANGE }}
                    >
                      <Play className="h-4 w-4" /> Confirm &amp; Submit Payroll
                    </Button>
                  </div>
                )}

                {importResult.success && confirmOpen && (
                  <div className="mx-5 mb-4 border border-amber-500/40 rounded-lg p-4 space-y-3" style={{ background: "rgba(245,158,11,0.08)" }}>
                    <p className="text-amber-300 text-sm font-semibold">⚠ This will submit payroll to Rollfi. Are you sure?</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)} className="flex-1 text-white/70 border border-white/20">Cancel</Button>
                      <Button size="sm" disabled={submitPayroll.isPending} onClick={() => submitPayroll.mutate()}
                        className="flex-1 text-white font-bold" style={{ background: ORANGE }}>
                        {submitPayroll.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : "Submit Payroll"}
                      </Button>
                    </div>
                    {submitPayroll.isError && <p className="text-red-400 text-xs">{(submitPayroll.error as Error).message}</p>}
                  </div>
                )}
              </div>
            )}

            {/* Payroll result */}
            {payrollResult && (
              <PayrollResultCard result={payrollResult} onReset={() => setPayrollResult(null)} />
            )}
          </>
        )}

        {/* Back link */}
        <div className="mt-8 pt-6 border-t border-white/10">
          <button
            onClick={() => navigate("/manager-payroll")}
            className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Payroll Overview
          </button>
        </div>
      </div>
    </div>
  );
}
