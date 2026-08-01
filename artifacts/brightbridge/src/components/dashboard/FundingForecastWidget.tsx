import React from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { fmtD, fmtDate } from "./helpers";
import type { ProcessedPeriod, PayPeriod } from "./types";

export function FundingForecastWidget({
  history, payPeriod,
}: {
  history: { periods: ProcessedPeriod[] } | undefined;
  payPeriod: PayPeriod | null;
}) {
  const withAmounts = (history?.periods ?? []).filter((p) => (p.payrollAmount ?? 0) > 0);
  const recent = withAmounts.slice(0, 3);
  const avg = recent.length > 0
    ? recent.reduce((s, p) => s + (p.payrollAmount ?? 0), 0) / recent.length
    : null;

  const projections: string[] = [];
  if (payPeriod?.payDate && avg !== null) {
    let freqDays = 14;
    if (withAmounts.length >= 2) {
      const sorted = withAmounts
        .map((p) => new Date(p.payDate ?? "").getTime())
        .filter((d) => !isNaN(d))
        .sort((a, b) => b - a);
      if (sorted.length >= 2) {
        const gap = Math.round((sorted[0] - sorted[1]) / 86_400_000);
        if (gap > 0 && gap < 60) freqDays = gap;
      }
    }
    let cursor = new Date(payPeriod.payDate);
    for (let i = 0; i < 4; i++) {
      projections.push(fmtDate(cursor.toISOString()));
      cursor = new Date(cursor.getTime() + freqDays * 86_400_000);
    }
  }

  return (
    <WidgetCard
      title="Payroll Funding Forecast"
      footer={
        <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 cursor-default">
          View full forecast <ChevronRight className="h-3 w-3" />
        </span>
      }
    >
      {avg === null ? (
        <p className="text-white/40 text-sm text-center py-6">
          Forecast available after first completed payroll
        </p>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/30 text-[10px] uppercase">
                <th className="text-left pb-2 font-medium">Pay Date</th>
                <th className="text-right pb-2 font-medium">Projected Cash</th>
                <th className="w-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {projections.map((label) => (
                <tr key={label}>
                  <td className="py-2 text-white/70">{label}</td>
                  <td className="py-2 text-right font-semibold text-white">{fmtD(avg)}</td>
                  <td className="py-2 pl-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-white/30 text-[10px] mt-3">
            Based on average of last {recent.length} completed payroll{recent.length !== 1 ? "s" : ""}
          </p>
        </>
      )}
    </WidgetCard>
  );
}
