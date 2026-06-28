import React from "react";
import { useParams, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, Download, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

interface RollfiTaxDetail {
  taxName: string;
  taxAmount: number;
  taxAmountYtd: number;
  isEmployerTax: boolean;
}
interface RollfiOvertime { type: string; amount: number; numberOfHours: number; }
interface RollfiCompensation {
  payrollLineItemAdditionalCompensationVertexCompensationIdentifier: { compensationDescription: string };
  amount: number;
}
interface RollfiReimbursement { reimbursementType: string; amount: number; }
interface RollfiPayDetail {
  payPercentage: number;
  amount: number;
  employeePayAccount: { accountName: string } | null;
}

interface PayStub {
  employeeId: string | null;
  rollfiUserId: string | null;
  name: string;
  position: string;
  hourlyRate: number;
  hoursWorked: number;
  grossPay: number;
  baseTotal: number | null;
  federalTax: number;
  stateTax: number;
  fica: number;
  deductions: number;
  netPay: number;
  ytdGross: number;
  fromRollfi: boolean;
  isProcessed: boolean;
  employeeTaxDetails: RollfiTaxDetail[] | null;
  employerTaxDetails: RollfiTaxDetail[] | null;
  overTimes: RollfiOvertime[] | null;
  additionalCompensations: RollfiCompensation[] | null;
  reimbursements: RollfiReimbursement[] | null;
  payDetails: RollfiPayDetail[] | null;
}
interface PayStubsData {
  payPeriodId: string | null;
  companyId: string;
  stubs: PayStub[];
  periodTotal: number | null;
  employeeTaxSum: number | null;
  employerTaxSum: number | null;
  isProcessed: boolean;
}

const api = {
  get: async <T,>(path: string) => {
    const r = await fetch(`/api${path}`, { credentials: "include" });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
    return r.json() as Promise<T>;
  },
};

function r2(n: number) { return Math.round(n * 100) / 100; }
function fmtD(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

const COMPANY_NAMES: Record<string, string> = {
  "ORG-SUNSHINE": "Sunshine Daycare Centre",
  "ORG-RAINBOW":  "Rainbow Kids Daycare",
};

export default function Paystub() {
  const params = useParams<{ companyId: string; employeeId: string; payPeriodId: string }>();
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const [, navigate] = useLocation();

  const companyId   = params.companyId ?? sp.get("companyId") ?? "";
  const employeeId  = params.employeeId ?? "";
  const payPeriodId = params.payPeriodId ?? sp.get("payPeriodId") ?? "";
  const periodLabel = sp.get("period") ?? payPeriodId;
  const payDate     = sp.get("payDate") ?? "";

  const { data, isLoading, error } = useQuery<PayStubsData>({
    queryKey: ["paystub", companyId, payPeriodId],
    queryFn: () => api.get(`/rollfi/paystubs?companyId=${companyId}&payPeriodId=${payPeriodId}`),
    enabled: !!companyId && !!payPeriodId,
    retry: false,
  });

  const stub = data?.stubs.find((s) => s.employeeId === employeeId || s.rollfiUserId === employeeId) ?? data?.stubs[0];

  const companyName = COMPANY_NAMES[companyId] ?? companyId;

  // Derived values — used as fallback when Rollfi tax details not available
  const medicare = stub ? r2(stub.fica * (1.45 / 7.65)) : 0;
  const ss       = stub ? r2(stub.fica - medicare) : 0;

  // YTD — use taxAmountYtd from Rollfi tax details when available
  const ytdTaxFromRollfi = stub?.employeeTaxDetails
    ? stub.employeeTaxDetails.reduce((sum, t) => sum + (t.taxAmountYtd ?? 0), 0)
    : null;
  const ytdGross = stub?.ytdGross ?? 0;
  const ytdTax   = ytdTaxFromRollfi !== null ? r2(ytdTaxFromRollfi) : r2(ytdGross * 0.2465);
  const ytdNet   = r2(ytdGross - ytdTax);

  // Employer fallback rates (used when Rollfi employerTaxDetails not available)
  const employerSS       = stub ? Math.round(stub.grossPay * 0.062  * 100) / 100 : 0;
  const employerMedicare = stub ? Math.round(stub.grossPay * 0.0145 * 100) / 100 : 0;
  const futa             = stub ? Math.round(stub.grossPay * 0.006  * 100) / 100 : 0;
  const njSuta           = stub ? Math.round(stub.grossPay * 0.005  * 100) / 100 : 0;
  const totalEmployerFallback = stub ? Math.round((employerSS + employerMedicare + futa + njSuta) * 100) / 100 : 0;

  // Determine if we have confirmed Rollfi data
  const isConfirmed = stub?.isProcessed ?? stub?.fromRollfi ?? false;

  const handlePrint = () => window.print();
  const handleDownload = () => { window.print(); };

  return (
    <div className="min-h-screen bg-white">
      {/* Screen-only controls */}
      <div className="print:hidden bg-[#284362] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate("/payroll")}
          className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Payroll
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E8622A] hover:bg-[#d4551f] text-white text-sm font-semibold transition-colors"
          >
            <Download className="h-4 w-4" /> Download PDF
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-24">
          <Loader2 className="h-8 w-8 text-[#284362] animate-spin" />
        </div>
      )}

      {error && (
        <div className="max-w-2xl mx-auto mt-12 p-6 border border-red-200 rounded-lg bg-red-50 text-red-700 text-sm">
          Could not load paystub: {(error as Error).message}
        </div>
      )}

      {!isLoading && stub && (
        <div className="max-w-2xl mx-auto my-8 print:my-0 print:max-w-none shadow-lg print:shadow-none border border-gray-200 print:border-0">
          {/* Header */}
          <div className="bg-[#284362] text-white px-8 py-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-1">BrightBridge Assist</p>
                <h1 className="text-2xl font-bold">Earnings Statement</h1>
              </div>
              <div className="text-right text-sm text-white/70">
                <p>{companyName}</p>
                <p className="text-white/40 text-xs mt-0.5">Pay Statement</p>
              </div>
            </div>
          </div>

          {/* Employee + Period Info */}
          <div className="grid grid-cols-2 gap-0 border-b border-gray-200">
            <div className="px-8 py-4 border-r border-gray-200">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">Employee</p>
              <p className="text-gray-900 font-bold text-base">{stub.name}</p>
              <p className="text-gray-500 text-sm">{stub.position}</p>
              <p className="text-gray-400 text-xs mt-2">{companyName}</p>
              {stub.employeeId && <p className="text-gray-400 text-xs font-mono mt-0.5">ID: {stub.employeeId}</p>}
            </div>
            <div className="px-8 py-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">Pay Period</p>
              <p className="text-gray-900 font-semibold text-sm">{periodLabel}</p>
              {payDate && (
                <>
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mt-3 mb-1">Pay Date</p>
                  <p className="text-gray-900 font-semibold text-sm">{payDate}</p>
                </>
              )}
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mt-3 mb-1">Payment Method</p>
              <p className="text-gray-700 text-sm">Direct Deposit</p>
              {stub.fromRollfi && (
                <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full border border-green-200">
                  ✓ Confirmed by Rollfi
                </span>
              )}
            </div>
          </div>

          {/* Earnings */}
          <div className="px-8 py-5 border-b border-gray-200">
            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3">Earnings</p>
            <div className="space-y-2 text-sm">
              {/* Base pay */}
              <div className="flex justify-between">
                <span className="text-gray-600">
                  Regular: {stub.hoursWorked}h @ ${stub.hourlyRate.toFixed(2)}/hr
                </span>
                <span className="text-gray-900">{fmtD(stub.baseTotal ?? stub.grossPay)}</span>
              </div>

              {/* Overtime — from Rollfi when available, else show 0 */}
              {stub.overTimes && stub.overTimes.filter(ot => ot.amount > 0).length > 0
                ? stub.overTimes.filter(ot => ot.amount > 0).map((ot, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-gray-600">{ot.type}: {ot.numberOfHours}h</span>
                      <span className="text-gray-900">{fmtD(ot.amount)}</span>
                    </div>
                  ))
                : !stub.fromRollfi && (
                    <div className="flex justify-between text-gray-400">
                      <span>Overtime: 0h</span>
                      <span>$0.00</span>
                    </div>
                  )
              }

              {/* Additional compensations (bonuses etc.) */}
              {stub.additionalCompensations?.filter(ac => ac.amount > 0).map((ac, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-gray-600">
                    {ac.payrollLineItemAdditionalCompensationVertexCompensationIdentifier?.compensationDescription ?? "Bonus"}
                  </span>
                  <span className="text-gray-900">{fmtD(ac.amount)}</span>
                </div>
              ))}

              {/* Reimbursements */}
              {stub.reimbursements?.filter(r => r.amount > 0).map((r, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-gray-600">{r.reimbursementType}</span>
                  <span className="text-gray-900">{fmtD(r.amount)}</span>
                </div>
              ))}

              {/* Gross Pay total */}
              <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-gray-900">
                <span>Gross Pay</span>
                <span className="text-[#284362]">{fmtD(stub.grossPay)}</span>
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="px-8 py-5 border-b border-gray-200">
            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Deductions</p>
            {isConfirmed
              ? <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-md bg-green-50 border border-green-200 text-green-700 text-xs">✅ All amounts confirmed by Rollfi</div>
              : <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs">⏳ Showing estimated amounts based on standard tax rates. Submit payroll to get exact figures.</div>
            }
            <div className="space-y-2 text-sm">
              {stub.employeeTaxDetails && stub.employeeTaxDetails.length > 0
                ? (
                  /* Dynamic lines from Rollfi */
                  stub.employeeTaxDetails.map((t, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">{t.taxName}</span>
                        <span className="text-[10px] text-green-600 font-medium" title="This amount has been confirmed by Rollfi after payroll processing.">✅ Confirmed</span>
                      </div>
                      <span className="text-red-600">−{fmtD(t.taxAmount)}</span>
                    </div>
                  ))
                )
                : (
                  /* Fallback: hardcoded estimated lines */
                  <>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Federal Income Tax</span>
                        <span className="text-[10px] text-gray-400" title="This is an estimate based on standard tax rates. The exact amount will be confirmed after Rollfi processes payroll.">⏳ Estimated</span>
                      </div>
                      <span className="text-red-600">~−{fmtD(stub.federalTax)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">NJ State Income Tax</span>
                        <span className="text-[10px] text-gray-400" title="This is an estimate based on standard tax rates. The exact amount will be confirmed after Rollfi processes payroll.">⏳ Estimated</span>
                      </div>
                      <span className="text-red-600">~−{fmtD(stub.stateTax)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Social Security (6.2%)</span>
                        <span className="text-[10px] text-gray-400" title="This is an estimate based on standard tax rates. The exact amount will be confirmed after Rollfi processes payroll.">⏳ Estimated</span>
                      </div>
                      <span className="text-red-600">~−{fmtD(ss)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Medicare (1.45%)</span>
                        <span className="text-[10px] text-gray-400" title="This is an estimate based on standard tax rates. The exact amount will be confirmed after Rollfi processes payroll.">⏳ Estimated</span>
                      </div>
                      <span className="text-red-600">~−{fmtD(medicare)}</span>
                    </div>
                  </>
                )
              }
              <div className="border-t border-gray-100 pt-2 flex justify-between font-semibold text-gray-700">
                <span>Total Deductions</span>
                <span className="text-red-600">{isConfirmed ? "" : "~"}−{fmtD(stub.deductions)}</span>
              </div>
            </div>
          </div>

          {/* Net Pay — hero number */}
          <div className="px-8 py-6 bg-[#284362] text-white flex items-center justify-between">
            <div>
              <p className="text-white/60 text-xs uppercase tracking-widest">
                {isConfirmed ? "Net Pay" : "Estimated Net Pay"}
              </p>
              {isConfirmed
                ? <p className="text-green-300 text-xs mt-0.5">✅ Confirmed by Rollfi</p>
                : <p className="text-white/40 text-xs mt-0.5">(Submit payroll for exact amount)</p>
              }
            </div>
            <p className="text-4xl font-bold">{isConfirmed ? fmtD(stub.netPay) : `~${fmtD(stub.netPay)}`}</p>
          </div>

          {/* Employer Contributions */}
          <div className="px-8 py-5 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Employer Contributions</p>
              <span
                title="These costs are paid by your employer directly to the government. They do not affect your take home pay."
                className="text-gray-400 cursor-help text-sm leading-none"
              >ℹ️</span>
            </div>
            <p className="text-gray-400 text-xs mb-3">These are paid by the company and are <strong>NOT</strong> deducted from your paycheck</p>
            <div className="space-y-2 text-sm">
              {stub.employerTaxDetails && stub.employerTaxDetails.length > 0
                ? (
                  /* Dynamic lines from Rollfi */
                  stub.employerTaxDetails.map((t, i) => (
                    <div key={i} className="flex justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{t.taxName}</span>
                        {isConfirmed && <span className="text-[10px] text-green-600 font-medium">✅ Confirmed</span>}
                      </div>
                      <span className="text-gray-700">{fmtD(t.taxAmount)}</span>
                    </div>
                  ))
                )
                : (
                  /* Fallback: hardcoded estimated lines */
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Social Security Match (6.2%)</span>
                      <span className="text-gray-700">{fmtD(employerSS)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Medicare Match (1.45%)</span>
                      <span className="text-gray-700">{fmtD(employerMedicare)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Federal Unemployment (0.6%)</span>
                      <span className="text-gray-700">{fmtD(futa)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">NJ State Unemployment (0.5%)</span>
                      <span className="text-gray-700">{fmtD(njSuta)}</span>
                    </div>
                  </>
                )
              }
              <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-700">
                <span>Total Employer Cost</span>
                <span>
                  {stub.employerTaxDetails
                    ? fmtD(r2(stub.employerTaxDetails.reduce((s, t) => s + t.taxAmount, 0)))
                    : fmtD(totalEmployerFallback)
                  }
                </span>
              </div>
            </div>
            <p className="text-gray-400 text-[10px] mt-3">
              {isConfirmed
                ? "* Employer tax amounts confirmed by Rollfi after payroll processing."
                : "* Employer tax amounts are calculated using standard rates. Actual amounts may vary."}
            </p>
          </div>

          {/* Payment Details — from Rollfi payDetails when available */}
          {stub.payDetails && stub.payDetails.length > 0 && (
            <div className="px-8 py-5 border-b border-gray-200">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3">Payment Details</p>
              <div className="space-y-2 text-sm">
                {stub.payDetails.map((pd, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <div>
                      <span className="text-gray-600">Direct Deposit</span>
                      {pd.employeePayAccount?.accountName && (
                        <span className="text-gray-400 text-xs ml-2">· {pd.employeePayAccount.accountName}</span>
                      )}
                    </div>
                    <span className="text-gray-900 font-medium">
                      {stub.payDetails && stub.payDetails.length > 1 ? `${pd.payPercentage}% → ` : ""}{fmtD(pd.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* YTD */}
          <div className="px-8 py-5 border-b border-gray-200">
            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3">Year To Date</p>
            <div className="grid grid-cols-3 gap-4 text-sm text-center">
              <div>
                <p className="text-gray-400 text-xs mb-1">YTD Gross</p>
                <p className="text-gray-900 font-semibold">{fmtD(ytdGross)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">YTD Taxes{ytdTaxFromRollfi === null ? " (est.)" : ""}</p>
                <p className="text-red-600 font-semibold">−{fmtD(ytdTax)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">YTD Net{ytdTaxFromRollfi === null ? " (est.)" : ""}</p>
                <p className="text-gray-900 font-semibold">{fmtD(ytdNet)}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 text-center">
            <p className="text-gray-400 text-xs">
              BrightBridge Assist · EasyTeam Embedded SDK Integration Test
              {!isConfirmed && " · Tax figures are estimates pending Rollfi confirmation"}
            </p>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
