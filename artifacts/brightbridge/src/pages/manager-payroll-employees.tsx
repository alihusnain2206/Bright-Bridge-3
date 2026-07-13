import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Users, ChevronLeft, DollarSign, TrendingDown, Receipt } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

interface TaxRow { taxName: string; taxAmount: number; taxAmountYtd: number; isEmployerTax: boolean }
interface PayStub {
  employeeId?: string | null; rollfiUserId?: string | null;
  name: string; position: string; hourlyRate: number; hoursWorked: number;
  grossPay: number; baseTotal: number | null; netPay: number;
  federalTax: number; stateTax: number; fica: number; deductions: number; ytdGross: number;
  fromRollfi: boolean; isProcessed: boolean;
  employeeTaxDetails: TaxRow[] | null;
  employerTaxDetails: TaxRow[] | null;
  additionalCompensations: { payrollLineItemAdditionalCompensationVertexCompensationIdentifier: { compensationDescription: string }; amount: number }[] | null;
  overTimes: { type: string; amount: number; numberOfHours: number }[] | null;
}
interface PayStubsData {
  payPeriodId: string | null; stubs: PayStub[];
  periodTotal: number | null; employeeTaxSum: number | null; employerTaxSum: number | null;
  isProcessed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

const api = {
  get: async <T,>(path: string): Promise<T> => {
    const r = await fetch(`/api${path}`, { credentials: "include" });
    if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? r.statusText); }
    return r.json() as Promise<T>;
  },
};

function fmtD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Stat Card ─────────────────────────────────────────────────

function StatCard({ label, value, accent = "#284362" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-1">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-xl font-bold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

// ── Employee Detail View ──────────────────────────────────────

function EmployeeDetail({ stub, payDate, onBack }: {
  stub: PayStub; payDate?: string; onBack: () => void;
}) {
  const totalEmpTax = (stub.employeeTaxDetails ?? []).reduce((s, t) => s + t.taxAmount, 0);
  const totalErTax = (stub.employerTaxDetails ?? []).reduce((s, t) => s + t.taxAmount, 0);
  const addComp = (stub.additionalCompensations ?? []).reduce((s, a) => s + a.amount, 0);

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-[#284362] hover:text-[#1a2e47] transition-colors">
        <ChevronLeft className="h-4 w-4" />
        Back to all employees
      </button>

      {/* Employee header */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{stub.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{stub.position}</p>
          </div>
          {payDate && (
            <div className="text-right">
              <div className="text-xs text-gray-400">Pay Date</div>
              <div className="text-sm font-semibold text-gray-700">{fmtDate(payDate)}</div>
            </div>
          )}
        </div>

        {/* Earnings summary */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-0.5">Base Earnings</div>
            <div className="text-xl font-bold text-gray-900">{fmtD(stub.baseTotal ?? stub.grossPay)}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-0.5">Gross Earnings</div>
            <div className="text-xl font-bold text-gray-900">{fmtD(stub.grossPay + addComp)}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-0.5">Net Earnings</div>
            <div className="text-xl font-bold text-emerald-600">{fmtD(stub.netPay)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-400">Regular Hours</span><br /><span className="font-semibold text-gray-800">{stub.hoursWorked}</span></div>
          <div><span className="text-gray-400">Total Hours</span><br /><span className="font-semibold text-gray-800">{stub.hoursWorked}</span></div>
          <div><span className="text-gray-400">Pay Date</span><br /><span className="font-semibold text-gray-800">{fmtDate(payDate)}</span></div>
        </div>
      </div>

      {/* Tax tables side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Employee Taxes */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
            <span className="font-semibold text-gray-800">Employee Taxes</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
          </div>
          {stub.employeeTaxDetails && stub.employeeTaxDetails.length > 0 ? (
            <>
              {stub.employeeTaxDetails.map((t, i) => (
                <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                  <span className="text-gray-700">{t.taxName}</span>
                  <span className="font-medium text-gray-900">{fmtD(t.taxAmount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                <span>Total</span><span>{fmtD(totalEmpTax)}</span>
              </div>
            </>
          ) : (
            <div className="px-5 py-4 text-sm text-gray-400">
              {stub.fromRollfi ? "No employee tax details for this period." : "Employee not yet processed in Rollfi."}
            </div>
          )}
        </div>

        {/* Employer Taxes */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
            <span className="font-semibold text-gray-800">Employer Taxes</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
          </div>
          {stub.employerTaxDetails && stub.employerTaxDetails.length > 0 ? (
            <>
              {stub.employerTaxDetails.map((t, i) => (
                <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                  <span className="text-gray-700">{t.taxName}</span>
                  <span className="font-medium text-gray-900">{fmtD(t.taxAmount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                <span>Total</span><span>{fmtD(totalErTax)}</span>
              </div>
            </>
          ) : (
            <div className="px-5 py-4 text-sm text-gray-400">No employer tax details available.</div>
          )}
        </div>
      </div>

      {/* Additional Compensations */}
      {stub.additionalCompensations && stub.additionalCompensations.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b font-semibold text-gray-800">Additional Compensation</div>
          {stub.additionalCompensations.map((a, i) => (
            <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
              <span className="text-gray-700">
                {a.payrollLineItemAdditionalCompensationVertexCompensationIdentifier.compensationDescription}
              </span>
              <span className="font-medium">{fmtD(a.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Employee List View ────────────────────────────────────────

function EmployeeList({ stubs, onSelect }: { stubs: PayStub[]; onSelect: (s: PayStub) => void }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b">
            {["Employee", "Base Pay", "Employer Tax", "Additional Comp", "Deductions", "Subtotal"].map(h => (
              <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {stubs.map((stub, i) => {
            const addComp = (stub.additionalCompensations ?? []).reduce((s, a) => s + a.amount, 0);
            const erTax = (stub.employerTaxDetails ?? []).reduce((s, t) => s + t.taxAmount, 0);
            const subtotal = stub.grossPay + erTax + addComp;
            return (
              <tr
                key={i}
                onClick={() => onSelect(stub)}
                className="hover:bg-blue-50 cursor-pointer transition-colors group">
                <td className="px-5 py-4">
                  <div className="font-semibold text-gray-900 group-hover:text-[#284362] transition-colors">
                    {stub.name}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{stub.position}</div>
                </td>
                <td className="px-5 py-4 text-gray-700">{fmtD(stub.baseTotal ?? stub.grossPay)}</td>
                <td className="px-5 py-4 text-gray-700">{fmtD(erTax)}</td>
                <td className="px-5 py-4 text-gray-700">{fmtD(addComp)}</td>
                <td className="px-5 py-4 text-gray-700">{fmtD(stub.deductions)}</td>
                <td className="px-5 py-4 font-semibold text-gray-900">{fmtD(subtotal)}</td>
              </tr>
            );
          })}
          {stubs.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                No employee data found for this pay period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function ManagerPayrollEmployees() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? "";
  const [, setLocation] = useLocation();
  const search = useSearch();

  const params = new URLSearchParams(search);
  const periodId = params.get("periodId") ?? "";
  const payDate = params.get("payDate") ?? undefined;
  const label = params.get("label") ?? undefined;

  const [selectedStub, setSelectedStub] = useState<PayStub | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mgr-paystubs", companyId, periodId],
    queryFn: () => api.get<PayStubsData>(`/rollfi/paystubs?companyId=${companyId}&payPeriodId=${encodeURIComponent(periodId)}`),
    enabled: !!companyId && !!periodId,
  });

  const periodTotal = data?.periodTotal ?? 0;
  const employerTaxSum = data?.employerTaxSum ?? 0;
  const employeeTaxSum = data?.employeeTaxSum ?? 0;
  const totalDebit = periodTotal + employerTaxSum;

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setLocation("/manager-payroll")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4" />
          Payroll
        </button>
        <div className="h-5 w-px bg-gray-200" />
        <div>
          <h1 className="text-2xl font-bold text-[#284362]">
            {selectedStub ? selectedStub.name : "Employees to Pay"}
          </h1>
          {label && <p className="text-sm text-gray-500 mt-0.5">{label}</p>}
        </div>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-[#284362]" />
        </div>
      )}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-600 text-sm">
          Failed to load employee data. Please go back and try again.
        </div>
      )}

      {/* Content */}
      {data && !selectedStub && (
        <>
          {/* Period summary KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Employer Taxes" value={fmtD(employerTaxSum)} accent="#284362" />
            <StatCard label="Total Employee Deductions" value={fmtD(employeeTaxSum)} accent="#6b7280" />
            <StatCard label="Total Gross Pay" value={fmtD(periodTotal)} accent="#284362" />
            <StatCard label="Total Debit Amount" value={fmtD(totalDebit)} accent="#E8622A" />
          </div>

          {/* Employees count */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Users className="h-4 w-4" />
            <span>{data.stubs.length} employee{data.stubs.length !== 1 ? "s" : ""} · Click a row to view tax breakdown</span>
          </div>

          {/* Employee table */}
          <EmployeeList stubs={data.stubs} onSelect={setSelectedStub} />
        </>
      )}

      {/* Detail view */}
      {data && selectedStub && (
        <>
          {/* Summary KPIs still visible */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Employer Taxes" value={fmtD(employerTaxSum)} accent="#284362" />
            <StatCard label="Total Employee Deductions" value={fmtD(employeeTaxSum)} accent="#6b7280" />
            <StatCard label="Total Gross Pay" value={fmtD(periodTotal)} accent="#284362" />
            <StatCard label="Total Debit Amount" value={fmtD(totalDebit)} accent="#E8622A" />
          </div>

          <EmployeeDetail
            stub={selectedStub}
            payDate={payDate}
            onBack={() => setSelectedStub(null)}
          />
        </>
      )}

      {/* No period ID guard */}
      {!periodId && !isLoading && (
        <div className="text-center py-24 text-gray-400">
          <Receipt className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No pay period selected. <button onClick={() => setLocation("/manager-payroll")} className="text-[#284362] underline">Go back to Payroll.</button></p>
        </div>
      )}
    </div>
  );
}
