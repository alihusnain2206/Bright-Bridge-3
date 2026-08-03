import React from "react";
import { ChevronRight, TrendingUp } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { fmtD, fmtDate } from "./helpers";
import type { ProcessedPeriod, PayPeriod } from "./types";

export function FundingForecastWidget({
  history, payPeriod,
}: {
  history: { periods: ProcessedPeriod[] } | undefined;
  payPeriod: PayPeriod | null;
}) {
  const allPeriods = history?.periods ?? [];

  // ── Baseline amount ────────────────────────────────────────────────────────
  // Prefer average of up to 3 most-recent completed payrolls that have amounts.
  // Fall back to the active pay period's cashRequired so the forecast is useful
  // even before historical amounts accumulate.
  const withAmounts = allPeriods.filter((p) => typeof p.payrollAmount === "number" && (p.payrollAmount as number) > 0);
  const recent = withAmounts.slice(0, 3);
  const avg = recent.length > 0
    ? recent.reduce((s, p) => s + (p.payrollAmount as number), 0) / recent.length
    : null;

  const baselineAmount: number | null = avg ?? payPeriod?.payrollAmount ?? null;
  const baselineLabel = avg !== null
    ? `Average of last ${recent.length} completed payroll${recent.length !== 1 ? "s" : ""}`
    : payPeriod?.payrollAmount != null
      ? "Projected from current payroll estimate"
      : null;

  // ── Pay frequency ──────────────────────────────────────────────────────────
  // Compute from dates in ANY history period (amounts not required for this).
  let freqDays = 14; // default biweekly
  const sortedDates = allPeriods
    .map((p) => new Date(String(p.payDate ?? "")).getTime())
    .filter((d) => !isNaN(d))
    .sort((a, b) => b - a);
  if (sortedDates.length >= 2) {
    const gap = Math.round((sortedDates[0]! - sortedDates[1]!) / 86_400_000);
    if (gap > 0 && gap < 60) freqDays = gap;
  }

  // ── Start date ─────────────────────────────────────────────────────────────
  // Use the active pay period's pay date when available; otherwise extrapolate
  // the next pay date from the most-recent history entry.
  let startDate: Date | null = null;
  if (payPeriod?.payDate) {
    startDate = new Date(payPeriod.payDate);
  } else if (sortedDates.length > 0) {
    startDate = new Date(sortedDates[0]! + freqDays * 86_400_000);
  }

  // ── Projections ───────────────────────────────────────────────────────────
  const projections: string[] = [];
  if (baselineAmount !== null && startDate !== null) {
    let cursor = startDate;
    for (let i = 0; i < 4; i++) {
      projections.push(fmtDate(cursor.toISOString()));
      cursor = new Date(cursor.getTime() + freqDays * 86_400_000);
    }
  }

  const hasData = projections.length > 0 && baselineAmount !== null;

  return (
    <WidgetCard
      title="Payroll Funding Forecast"
      footer={
        <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 cursor-default">
          View full forecast <ChevronRight className="h-3 w-3" />
        </span>
      }
    >
      {!hasData ? (
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
                  <td className="py-2 text-right font-semibold text-white">{fmtD(baselineAmount!)}</td>
                  <td className="py-2 pl-2">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {baselineLabel && (
            <p className="text-white/30 text-[10px] mt-3">{baselineLabel}</p>
          )}
        </>
      )}
    </WidgetCard>
  );
}
