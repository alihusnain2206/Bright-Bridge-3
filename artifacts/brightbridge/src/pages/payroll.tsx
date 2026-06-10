import React, { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, Loader2, Building2, Users, DollarSign,
  AlertTriangle, ChevronRight, RefreshCw, Play, Clock, Zap,
  ArrowRight, Activity,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────

interface RollfiCompanyRecord { rollfiCompanyId: string; rollfiLocationId: string; onboardedAt: string; }
interface RollfiEmployeeRecord { rollfiUserId: string; rollfiWageId?: string; onboardedAt: string; }
interface CompanyState { id: string; name: string; address?: string; rollfi: RollfiCompanyRecord | null; }
interface EmployeeState {
  employeeId: string | null; name: string; position: string; companyId: string;
  hourlyWage: number; rollfi: RollfiEmployeeRecord | null;
}
interface RollfiState { companies: CompanyState[]; employees: EmployeeState[]; }
interface PreviewEmployee {
  employeeId: string | null; name: string; position: string; companyId: string;
  hoursWorked: number; breakDeduction: number; unapprovedHours: number;
  netPayableHours: number; hourlyRate: number; grossPay: number;
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
}
interface EmpRollfiStatus { rollfiUserId: string; userStatus: string; kycStatus: string; }

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
};

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
  if (s === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> Active
      </span>
    );
  }
  if (s === "invitesent" && kycStatus === "passed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
        <Activity className="h-3 w-3" /> KYC ✓
      </span>
    );
  }
  if (s === "invitesent") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <Clock className="h-3 w-3" /> Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-white/10 text-white/50 border border-white/20">
      {userStatus}
    </span>
  );
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
    {
      label: "Hours Imported",
      detail: result.importResult?.importRegularPayrollLData?.message ?? "Payroll data imported successfully",
      done: true,
    },
    {
      label: "Payroll Initiated",
      detail: result.payPeriod?.message ?? "Pay period initiated successfully",
      done: result.payPeriod?.status === "Success",
    },
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

// ── Main page ────────────────────────────────────────────────

export default function Payroll() {
  const [tab, setTab] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [payPeriod, setPayPeriod] = useState<PayPeriod | null>(null);
  const [payPeriodCompanyId, setPayPeriodCompanyId] = useState<string>("");
  const [payrollResult, setPayrollResult] = useState<PayrollResult | null>(null);
  const [empStatuses, setEmpStatuses] = useState<Record<string, EmpRollfiStatus[]>>({});
  const [empStatusLoading, setEmpStatusLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const autoFetchedRef = useRef<string>("");
  const qc = useQueryClient();

  const { data: state, isLoading: stateLoading, refetch: refetchState } = useQuery<RollfiState>({
    queryKey: ["rollfi-state"],
    queryFn: () => api.get("/rollfi/state"),
    refetchInterval: false,
  });

  const { data: preview, isLoading: previewLoading, refetch: refetchPreview } = useQuery<PayrollPreview>({
    queryKey: ["rollfi-preview", selectedCompanyId],
    queryFn: () => api.get(`/rollfi/payroll/preview${selectedCompanyId !== "all" ? `?companyId=${selectedCompanyId}` : ""}`),
    enabled: tab === 2,
  });

  const companies = state?.companies ?? [];
  const employees = state?.employees ?? [];
  const allCompaniesOnboarded = companies.length > 0 && companies.every((c) => c.rollfi);
  const employeesForCompany = (cId: string) => employees.filter((e) => e.companyId === cId);

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
    try {
      const data = await api.get<PayPeriod>(`/rollfi/payperiod?companyId=${companyId}`);
      setPayPeriod(data);
    } catch (e) {
      setPayPeriod(null);
      console.warn("Failed to get pay period:", (e as Error).message);
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

  // Auto-fetch employee statuses when entering tab 1
  useEffect(() => {
    if (tab === 1 && companies.length > 0) {
      void fetchEmpStatuses(companies);
    }
  }, [tab, companies.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch pay period when entering tab 2 with a company selected
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

  // Re-fetch pay period when company selection changes on tab 2
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
        const terminal = ["processed", "failed", "returned", "skipped"];
        if (terminal.includes(data.payPeriodStatus.toLowerCase())) setIsPolling(false);
      } catch { setIsPolling(false); }
    }, 4000);
    return () => clearInterval(timer);
  }, [isPolling, payPeriodCompanyId]);

  const submitPayroll = useMutation({
    mutationFn: ({ companyId, payPeriodId }: { companyId: string; payPeriodId: string }) =>
      api.post<PayrollResult>("/rollfi/payroll/initiate", { companyId, payPeriodId }),
    onSuccess: (data) => {
      setPayrollResult(data);
      setIsPolling(true);
      // Refresh pay period after a short delay to get updated status
      setTimeout(() => { void fetchPayPeriod(selectedCompanyId); }, 1500);
    },
    onError: (e) => { setPayrollResult({ success: false, error: (e as Error).message }); },
  });

  // Derived: can we submit? pay period must be in a submittable state
  const submittableStatuses = ["new", "cancelled", "failed"];
  const periodSubmittable = !payPeriod || submittableStatuses.includes(payPeriod.payPeriodStatus.toLowerCase());

  // Get rollfi status for a specific employee
  const getRollfiStatus = (companyId: string, rollfiUserId: string | undefined) => {
    if (!rollfiUserId) return null;
    return empStatuses[companyId]?.find((s) => s.rollfiUserId.toUpperCase() === rollfiUserId.toUpperCase()) ?? null;
  };

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
          <Button
            variant="ghost" size="sm"
            className="text-white/60 hover:text-white hover:bg-white/10 gap-1.5"
            onClick={() => { void refetchState(); }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <Steps current={tab} />

        {/* ── Tab 0: Companies ───────────────────────────── */}
        {tab === 0 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-orange-400" /> Daycare Companies</h2>
              <p className="text-white/40 text-xs">Register each company with Rollfi to enable payroll</p>
            </div>

            {stateLoading && (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>
            )}

            <div className="grid gap-4">
              {companies.map((company) => (
                <div key={company.id} className="rounded-xl p-5 border border-white/10 bg-white/5 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white font-semibold">{company.name}</span>
                      <StatusBadge onboarded={!!company.rollfi} />
                    </div>
                    {company.address && <p className="text-white/40 text-xs">{company.address}</p>}
                    {company.rollfi && (
                      <p className="text-white/30 text-xs mt-1 font-mono">
                        Rollfi ID: {company.rollfi.rollfiCompanyId}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={!!company.rollfi || onboardCompany.isPending}
                    onClick={() => onboardCompany.mutate(company.id)}
                    className="shrink-0 text-white font-semibold"
                    style={{ background: company.rollfi ? "rgba(255,255,255,0.1)" : ORANGE, opacity: company.rollfi ? 0.6 : 1 }}
                  >
                    {onboardCompany.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : company.rollfi ? "Registered ✓" : "Register with Rollfi"}
                  </Button>
                </div>
              ))}
            </div>

            {onboardCompany.isError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                {onboardCompany.error?.message}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                disabled={!allCompaniesOnboarded}
                onClick={() => setTab(1)}
                className="gap-2 text-white font-semibold"
                style={{ background: allCompaniesOnboarded ? ORANGE : "rgba(255,255,255,0.1)" }}
              >
                Next: Add Employees <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {!allCompaniesOnboarded && companies.length > 0 && (
              <p className="text-center text-white/30 text-xs mt-2">Register all companies to continue</p>
            )}
          </div>
        )}

        {/* ── Tab 1: Employees ───────────────────────────── */}
        {tab === 1 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-white font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-orange-400" /> Staff Employees</h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost" size="sm"
                  className="text-white/40 hover:text-white/70 gap-1.5 h-7 text-xs"
                  disabled={empStatusLoading}
                  onClick={() => void fetchEmpStatuses(companies)}
                >
                  {empStatusLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Sync Rollfi Status
                </Button>
                <Button variant="ghost" size="sm" className="text-white/50 hover:text-white gap-1" onClick={() => setTab(0)}>
                  ← Back
                </Button>
              </div>
            </div>

            {!allCompaniesOnboarded && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-amber-300 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Register all companies first before adding employees.
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
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-orange-400" />
                        <span className="text-white font-semibold text-sm">{company.name}</span>
                        <span className="text-white/30 text-xs">({compEmployees.length} staff)</span>
                        {statusList.length > 0 && (
                          <span className="text-emerald-400/60 text-xs">
                            · {activeCount}/{statusList.length} active in Rollfi
                          </span>
                        )}
                      </div>
                      {company.rollfi && !allEmpOnboarded && (
                        <Button
                          size="sm" variant="ghost"
                          className="text-xs text-orange-400 hover:text-orange-300 hover:bg-orange-400/10 h-7"
                          disabled={onboardEmployee.isPending}
                          onClick={async () => {
                            for (const emp of compEmployees.filter((e) => !e.rollfi && e.employeeId)) {
                              await onboardEmployee.mutateAsync({ employeeId: emp.employeeId!, companyId: company.id });
                            }
                          }}
                        >
                          Add All to Rollfi
                        </Button>
                      )}
                    </div>
                    <div className="divide-y divide-white/5">
                      {compEmployees.map((emp) => {
                        const rollfiStatus = emp.rollfi?.rollfiUserId
                          ? getRollfiStatus(company.id, emp.rollfi.rollfiUserId)
                          : null;
                        return (
                          <div key={emp.employeeId} className="px-5 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-medium">{emp.name}</span>
                                <StatusBadge onboarded={!!emp.rollfi} />
                                {rollfiStatus && (
                                  <UserStatusBadge
                                    userStatus={rollfiStatus.userStatus}
                                    kycStatus={rollfiStatus.kycStatus}
                                  />
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-white/40 text-xs">{emp.position}</span>
                                <span className="text-white/30 text-xs">·</span>
                                <span className="text-white/40 text-xs">${emp.hourlyWage}/hr</span>
                                {emp.rollfi && (
                                  <span className="text-white/25 text-xs font-mono">ID: {emp.rollfi.rollfiUserId.slice(0, 8)}…</span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              disabled={!!emp.rollfi || !company.rollfi || onboardEmployee.isPending || !emp.employeeId}
                              onClick={() => emp.employeeId && onboardEmployee.mutate({ employeeId: emp.employeeId, companyId: company.id })}
                              className="shrink-0 text-white text-xs"
                              style={{ background: emp.rollfi ? "rgba(255,255,255,0.08)" : company.rollfi ? ORANGE : "rgba(255,255,255,0.08)", opacity: (emp.rollfi || !company.rollfi) ? 0.5 : 1 }}
                            >
                              {onboardEmployee.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : emp.rollfi ? "Added ✓" : !company.rollfi ? "Register company first" : "Add to Rollfi"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {onboardEmployee.isError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                {onboardEmployee.error?.message}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => setTab(0)} className="text-white/60 hover:text-white">← Back</Button>
              <Button
                onClick={() => { setTab(2); void refetchPreview(); }}
                className="gap-2 text-white font-semibold"
                style={{ background: ORANGE }}
              >
                Next: Run Payroll <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab 2: Run Payroll ─────────────────────────── */}
        {tab === 2 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4 text-orange-400" /> Payroll Preview</h2>
              <Button variant="ghost" size="sm" className="text-white/50 hover:text-white gap-1" onClick={() => setTab(1)}>← Back</Button>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-white/40 text-xs">Company</span>
                <select
                  value={selectedCompanyId}
                  onChange={(e) => { setSelectedCompanyId(e.target.value); setPayrollResult(null); autoFetchedRef.current = ""; }}
                  className="bg-transparent text-white text-sm outline-none"
                >
                  <option value="all">All Companies</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <Button
                variant="ghost" size="sm"
                className="text-white/60 hover:text-white gap-1.5 border border-white/10"
                onClick={() => void refetchPreview()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh Hours
              </Button>

              {selectedCompanyId !== "all" && companies.find((c) => c.id === selectedCompanyId)?.rollfi && (
                <Button
                  variant="ghost" size="sm"
                  className="text-white/60 hover:text-white gap-1.5 border border-white/10"
                  onClick={() => void fetchPayPeriod(selectedCompanyId)}
                >
                  <Clock className="h-3.5 w-3.5" /> {payPeriod ? "Re-fetch Pay Period" : "Get Pay Period"}
                </Button>
              )}
            </div>

            {/* Pay period card */}
            {payPeriod && (
              <div className="mb-4 p-4 rounded-xl border border-white/10 bg-white/5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Period</p>
                    <p className="text-white text-sm font-medium">{payPeriod.payPeriod}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Pay Date</p>
                    <p className="text-white text-sm">{payPeriod.payDate}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Status</p>
                    <PayPeriodStatusBadge status={payPeriod.payPeriodStatus} />
                  </div>
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Deadline</p>
                    <p className="text-white text-sm">{payPeriod.deadLineToRunPayroll}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-0.5">Period ID</p>
                    <p className="text-white/40 text-xs font-mono">{payPeriod.payPeriodId.slice(0, 8)}…</p>
                  </div>
                  {isPolling && (
                    <div className="ml-auto flex items-center gap-1.5 text-orange-300/70 text-xs">
                      <Loader2 className="h-3 w-3 animate-spin" /> Watching for status updates…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preview table */}
            {previewLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-white/40 animate-spin" /></div>}

            {preview && !previewLoading && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-white/40 text-xs">Period: {preview.period.from} → {preview.period.to} ({preview.period.workdays} workdays)</p>
                  {!preview.allOnboarded && (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Some employees not yet onboarded to Rollfi
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.06)" }}>
                        {["Employee", "Worked", "Breaks", "Unapproved", "Net Hrs", "Rate", "Gross Pay", "Rollfi"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-white/50 font-semibold text-xs">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {preview.employees.map((emp) => (
                        <tr key={emp.employeeId} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3">
                            <div className="text-white font-medium">{emp.name}</div>
                            <div className="text-white/40 text-xs">{emp.position}</div>
                          </td>
                          <td className="px-4 py-3 text-white/70">{emp.hoursWorked}h</td>
                          <td className="px-4 py-3 text-amber-400/80">−{emp.breakDeduction}h</td>
                          <td className="px-4 py-3 text-red-400/80">{emp.unapprovedHours > 0 ? `−${emp.unapprovedHours}h` : "—"}</td>
                          <td className="px-4 py-3 text-white font-semibold">{emp.netPayableHours}h</td>
                          <td className="px-4 py-3 text-white/70">${emp.hourlyRate}</td>
                          <td className="px-4 py-3 text-emerald-400 font-bold">${emp.grossPay.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            {emp.onboardedToRollfi
                              ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                              : <XCircle className="h-4 w-4 text-white/20" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                        <td className="px-4 py-3 text-white font-semibold" colSpan={6}>Total Gross Pay</td>
                        <td className="px-4 py-3 text-emerald-400 font-bold text-base" colSpan={2}>
                          ${preview.totalGrossPay.toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Submit area */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={
                      !payPeriod ||
                      !preview.allOnboarded ||
                      submitPayroll.isPending ||
                      selectedCompanyId === "all" ||
                      !periodSubmittable
                    }
                    onClick={() => {
                      if (payPeriod && selectedCompanyId !== "all") {
                        setPayrollResult(null);
                        submitPayroll.mutate({ companyId: selectedCompanyId, payPeriodId: payPeriod.payPeriodId });
                      }
                    }}
                    className="gap-2 text-white font-semibold"
                    style={{
                      background: (!payPeriod || !preview.allOnboarded || selectedCompanyId === "all" || !periodSubmittable)
                        ? "rgba(255,255,255,0.1)" : ORANGE,
                    }}
                  >
                    {submitPayroll.isPending
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                      : <><Play className="h-4 w-4" /> Submit Payroll to Rollfi</>
                    }
                  </Button>

                  {!payPeriod && <p className="text-white/30 text-xs">Fetching pay period…</p>}
                  {payPeriod && !periodSubmittable && (
                    <div className="flex items-center gap-1.5">
                      <PayPeriodStatusBadge status={payPeriod.payPeriodStatus} />
                      <p className="text-white/30 text-xs">— already submitted</p>
                    </div>
                  )}
                  {payPeriod && periodSubmittable && !preview.allOnboarded && (
                    <p className="text-white/30 text-xs">All employees must be onboarded first</p>
                  )}
                  {selectedCompanyId === "all" && <p className="text-white/30 text-xs">Select a specific company to submit</p>}
                </div>

                {/* Result card */}
                {payrollResult && (
                  <PayrollResultCard
                    result={payrollResult}
                    onReset={() => setPayrollResult(null)}
                  />
                )}

                {/* Next pay period hint */}
                {payPeriod && !periodSubmittable && (
                  <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
                    <ArrowRight className="h-4 w-4 text-white/30 shrink-0" />
                    <p className="text-white/40 text-xs">
                      The current pay period is <strong className="text-white/60">{payPeriod.payPeriodStatus}</strong>. Once it processes, a new period will appear automatically — come back to submit the next payroll run.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
