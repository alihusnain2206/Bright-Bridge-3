import React from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { BarChart3 } from "lucide-react";
import {
  WidgetCard,
  FundingForecastWidget,
  VarianceWidget,
  RecentActivityWidget,
  FundingAccountWidget,
} from "@/components/dashboard";
import type { ProcessedPeriod, PayPeriod, PeriodDetailsResponse, CompanyState } from "@/components/dashboard";
import { fmtD, fmtDate } from "@/components/dashboard/helpers";

// ── Widget 3 — Cost Trend ────────────────────────────────────
// Not extracted in Phase 1 (not listed in the extraction spec).

function CostTrendWidget({ history }: { history: { periods: ProcessedPeriod[] } | undefined; }) {
  const data = (history?.periods ?? [])
    .filter((p) => (p.payrollAmount ?? 0) > 0 && p.payDate)
    .slice(0, 8)
    .reverse()
    .map((p) => ({
      label: fmtDate(p.payDate ?? ""),
      total: p.payrollAmount ?? 0,
      net: Math.round((p.payrollAmount ?? 0) * 0.78 * 100) / 100,
    }));

  return (
    <WidgetCard title="Payroll Cost Trend">
      {data.length < 2 ? (
        <p className="text-white/40 text-sm text-center py-6">
          Trend chart available after 2+ completed payrolls
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#1a2f4a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, fontSize: 11,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.7)", marginBottom: 4 }}
                itemStyle={{ color: "rgba(255,255,255,0.85)" }}
                formatter={(value: unknown, name: string) => [
                  fmtD(value as number),
                  name === "total" ? "Total Required" : "Est. Net Pay",
                ]}
              />
              <Line
                type="monotone" dataKey="total" stroke="#0EA5C9" strokeWidth={2}
                dot={{ r: 3, fill: "#0EA5C9", strokeWidth: 0 }} name="total"
              />
              <Line
                type="monotone" dataKey="net" stroke="#10B981" strokeWidth={1.5}
                strokeDasharray="4 2" dot={false} name="net"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-5 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-0.5 rounded bg-[#0EA5C9]" />
              <span className="text-white/35 text-[10px]">Total Required</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t border-dashed border-[#10B981]" />
              <span className="text-white/35 text-[10px]">Est. Net Pay</span>
            </div>
          </div>
        </>
      )}
    </WidgetCard>
  );
}

// ── Main export ──────────────────────────────────────────────

export interface PayrollWidgetsProps {
  selectedCompanyId: string;
  history: { periods: ProcessedPeriod[] } | undefined;
  currentPeriodDetails: PeriodDetailsResponse | undefined;
  payPeriod: PayPeriod | null;
  companies: CompanyState[];
}

export function PayrollWidgets({
  selectedCompanyId, history, currentPeriodDetails, payPeriod, companies,
}: PayrollWidgetsProps) {
  const periods = history?.periods ?? [];
  const lastPeriodId = periods[0]?.payPeriodId;

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-white/30" />
        <h2 className="text-white/40 text-[11px] font-semibold uppercase tracking-wider">
          Operations Command Center
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FundingForecastWidget history={history} payPeriod={payPeriod} />
        <VarianceWidget
          selectedCompanyId={selectedCompanyId}
          currentDetails={currentPeriodDetails}
          lastPeriodId={lastPeriodId}
        />
        <CostTrendWidget history={history} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FundingAccountWidget
          selectedCompanyId={selectedCompanyId}
          companies={companies}
          payPeriod={payPeriod}
          currentDetails={currentPeriodDetails}
        />
        <div className="lg:col-span-2">
          <RecentActivityWidget selectedCompanyId={selectedCompanyId} companies={companies} />
        </div>
      </div>
    </div>
  );
}
