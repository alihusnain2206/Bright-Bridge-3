import React from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { apiFetch, fmtD } from "./helpers";
import type { PeriodDetailsResponse } from "./types";

export function VarianceWidget({
  selectedCompanyId, currentDetails, lastPeriodId,
}: {
  selectedCompanyId: string;
  currentDetails: PeriodDetailsResponse | undefined;
  lastPeriodId: string | undefined;
}) {
  const { data: lastDetails } = useQuery<PeriodDetailsResponse>({
    queryKey: ["rollfi-period-details", selectedCompanyId, lastPeriodId],
    queryFn: () => apiFetch(`/rollfi/payperiod/details?companyId=${selectedCompanyId}&payPeriodId=${encodeURIComponent(lastPeriodId!)}`),
    enabled: !!lastPeriodId && selectedCompanyId !== "all",
    staleTime: 60_000,
    retry: false,
  });

  const cur = currentDetails?.payPeriod?.[0];
  const last = lastDetails?.payPeriod?.[0];

  const noCurrentData = !cur || cur.total === 0;
  const noHistory = !last;

  if (noCurrentData) {
    return (
      <WidgetCard title="Payroll Variance" subtitle="vs Last Pay Period">
        <p className="text-white/40 text-sm text-center py-6">Submit payroll to see variance analysis</p>
      </WidgetCard>
    );
  }
  if (noHistory) {
    return (
      <WidgetCard title="Payroll Variance" subtitle="vs Last Pay Period">
        <p className="text-white/40 text-sm text-center py-6">Variance available after first completed payroll</p>
      </WidgetCard>
    );
  }

  const varAmt = cur.total - last.total;
  const varPct = last.total > 0 ? (varAmt / last.total) * 100 : 0;
  const isUp = varAmt >= 0;

  const curMap = Object.fromEntries((cur.payrollLineItems ?? []).map((i) => [i.userId, i]));
  const lastMap = Object.fromEntries((last.payrollLineItems ?? []).map((i) => [i.userId, i]));
  let newHires = 0, changed = 0;
  for (const uid of Object.keys(curMap)) {
    const c = curMap[uid];
    const l = lastMap[uid];
    if (!l) { newHires += c.grossTotal; }
    else { changed += c.grossTotal - l.grossTotal; }
  }
  const drivers = [
    { label: "New Hires", value: newHires },
    { label: "Pay Changes", value: changed },
  ].filter((d) => Math.abs(d.value) > 0.01).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const maxAbs = Math.max(...drivers.map((d) => Math.abs(d.value)), 1);

  return (
    <WidgetCard
      title="Payroll Variance"
      subtitle="vs Last Pay Period"
      footer={
        <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 cursor-default">
          View full variance report <ChevronRight className="h-3 w-3" />
        </span>
      }
    >
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-3xl font-bold ${isUp ? "text-red-400" : "text-emerald-400"}`}>
          {isUp ? "+" : ""}{varPct.toFixed(1)}%
        </span>
        {isUp
          ? <TrendingUp className="h-5 w-5 text-red-400" />
          : <TrendingDown className="h-5 w-5 text-emerald-400" />}
      </div>
      <p className="text-white/40 text-xs mb-5">
        {isUp ? "+" : ""}{fmtD(varAmt)} Change in Cash Required
      </p>
      {drivers.length > 0 && (
        <div className="space-y-2.5">
          {drivers.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span className="w-24 text-white/50 shrink-0 truncate">{d.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${d.value >= 0 ? "bg-red-400" : "bg-emerald-400"}`}
                  style={{ width: `${Math.round(Math.abs(d.value / maxAbs) * 100)}%` }}
                />
              </div>
              <span className={`w-20 text-right font-semibold shrink-0 ${d.value >= 0 ? "text-red-300" : "text-emerald-300"}`}>
                {d.value >= 0 ? "+" : ""}{fmtD(d.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
