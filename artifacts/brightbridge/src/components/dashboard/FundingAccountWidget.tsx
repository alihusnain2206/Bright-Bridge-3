import React from "react";
import { CheckCircle2, AlertCircle, ChevronRight, Banknote, Info } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { fmtD, fmtDate } from "./helpers";
import type { CompanyState, PayPeriod, PeriodDetailsResponse } from "./types";

export function FundingAccountWidget({
  selectedCompanyId, companies, payPeriod, currentDetails,
}: {
  selectedCompanyId: string;
  companies: CompanyState[];
  payPeriod: PayPeriod | null;
  currentDetails: PeriodDetailsResponse | undefined;
}) {
  const company = companies.find((c) => c.id === selectedCompanyId);
  const isOnboarded = !!company?.rollfi;
  const nextDebit = currentDetails?.payPeriod?.[0]?.total ?? payPeriod?.payrollAmount ?? null;
  const debitDate = payPeriod?.payDate;

  return (
    <WidgetCard title="Funding Account">
      {!isOnboarded ? (
        <p className="text-white/40 text-sm text-center py-6">Company not yet onboarded to Rollfi</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
              <Banknote className="h-4 w-4 text-white/40" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white/50 text-[10px]">Business Checking</p>
              <p className="text-white font-semibold text-xs">Connected via Rollfi</p>
            </div>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          </div>

          {nextDebit !== null && (
            <div
              className="rounded-lg border border-amber-500/20 px-3 py-2.5 flex items-center justify-between"
              style={{ background: "rgba(245,158,11,0.08)" }}
            >
              <div>
                <p className="text-amber-400/60 text-[10px] uppercase font-semibold tracking-wide">Next Debit</p>
                <p className="text-amber-300 font-bold text-base leading-tight">{fmtD(nextDebit)}</p>
              </div>
              {debitDate && (
                <p className="text-amber-300/50 text-xs">{fmtDate(debitDate)}</p>
              )}
            </div>
          )}

          {nextDebit === null && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <p className="text-white/50 text-xs">Run payroll to see debit amount</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
            <Info className="h-3.5 w-3.5 text-white/25 mt-0.5 shrink-0" />
            <p className="text-white/35 text-[10px] leading-relaxed">
              Please verify your bank account has sufficient funds before approving payroll.
              BrightBridge does not currently check your live balance automatically.
            </p>
          </div>

          <button className="w-full py-2 rounded-lg border border-white/10 text-white/50 hover:text-white/70 hover:border-white/20 text-xs font-medium transition-colors flex items-center justify-center gap-1">
            Manage Funding Account <ChevronRight className="h-3 w-3" />
          </button>

          <p className="text-center">
            <span className="text-[9px] text-white/20 border border-white/10 rounded px-2 py-0.5">
              Live Balance — Coming Soon
            </span>
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
