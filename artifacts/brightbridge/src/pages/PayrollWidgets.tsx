import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, CheckCircle2, AlertCircle, ChevronRight,
  Banknote, BarChart3, Info,
} from "lucide-react";

// ── Local types ──────────────────────────────────────────────

interface ProcessedPeriod {
  payPeriodId?: string;
  payBeginDate?: string;
  payEndDate?: string;
  payDate?: string;
  payPeriodStatus?: string;
  payrollAmount?: number;
  [key: string]: unknown;
}

interface PayPeriod {
  payPeriodId: string;
  payDate: string;
  payrollAmount?: number;
}

interface PeriodDetailItem {
  payPeriodId: string;
  total: number;
  employeeTaxSum: number;
  employerTaxSum: number;
  payDate: string;
  payrollLineItems: Array<{ grossTotal: number; netTotal: number; userId: string }>;
}

interface PeriodDetailsResponse {
  payPeriod: PeriodDetailItem[];
}

interface CompanyState {
  id: string;
  name: string;
  rollfi: { rollfiCompanyId: string } | null;
}

interface WebhookEvent {
  id: string;
  eventType: string;
  companyId: string;
  receivedAt: string;
}

// ── API helper ───────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`/api${path}`, { credentials: "include" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
  return r.json() as Promise<T>;
}

// ── Helpers ──────────────────────────────────────────────────

function fmtD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string) {
  try { return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return dateStr; }
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Card shell ───────────────────────────────────────────────

function WidgetCard({
  title, subtitle, children, footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-white/10 overflow-hidden flex flex-col h-full"
      style={{ background: "rgba(255,255,255,0.04)" }}
    >
      <div className="px-5 py-3.5 border-b border-white/10">
        <p className="text-white font-semibold text-sm">{title}</p>
        {subtitle && <p className="text-white/40 text-[11px] mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-white/10">{footer}</div>}
    </div>
  );
}

// ── Widget 1 — Funding Forecast ──────────────────────────────

function FundingForecastWidget({
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

// ── Widget 2 — Variance ──────────────────────────────────────

function VarianceWidget({
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

// ── Widget 3 — Cost Trend ────────────────────────────────────

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

// ── Widget 4 — Recent Activity ───────────────────────────────

const EVENT_META: Record<string, { label: string; dot: string }> = {
  "payroll.calculated": { label: "Payroll calculated",  dot: "bg-emerald-400" },
  "payroll.submitted":  { label: "Payroll submitted",   dot: "bg-blue-400" },
  "payroll.processed":  { label: "Payroll processed",   dot: "bg-emerald-400" },
  "payroll.approved":   { label: "Payroll approved",    dot: "bg-emerald-400" },
  "payroll.failed":     { label: "Payroll failed",      dot: "bg-red-400" },
  "employee.added":     { label: "Employee added",      dot: "bg-blue-400" },
};

function RecentActivityWidget({
  selectedCompanyId, companies,
}: {
  selectedCompanyId: string;
  companies: CompanyState[];
}) {
  const company = companies.find((c) => c.id === selectedCompanyId);
  const { data, isLoading } = useQuery<{ events: WebhookEvent[] }>({
    queryKey: ["rollfi-webhooks"],
    queryFn: () => apiFetch("/rollfi/webhook/events"),
    staleTime: 30_000,
    retry: false,
  });

  const events = (data?.events ?? [])
    .filter((e) => e.companyId === selectedCompanyId)
    .slice(0, 9);

  return (
    <WidgetCard
      title="Recent Payroll Activity"
      footer={
        <span className="text-[11px] text-[#0EA5C9] flex items-center gap-0.5 cursor-default">
          View all activity <ChevronRight className="h-3 w-3" />
        </span>
      }
    >
      {isLoading ? (
        <p className="text-white/30 text-xs py-4 text-center">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-white/40 text-sm text-center py-4">
          No recent activity. Events will appear here as you process payroll.
        </p>
      ) : (
        <div className="space-y-0">
          {events.map((ev, i) => {
            const meta = EVENT_META[ev.eventType] ?? { label: ev.eventType, dot: "bg-blue-400" };
            return (
              <div key={ev.id} className="flex items-start gap-3 py-2.5">
                <div className="relative flex-shrink-0 flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-0.5 ${meta.dot}`} />
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-white/10 mt-1" style={{ minHeight: 16 }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-0.5">
                  <p className="text-white/80 text-xs font-medium leading-snug">{meta.label}</p>
                  {company && <p className="text-white/30 text-[10px]">{company.name}</p>}
                </div>
                <span className="text-white/25 text-[10px] shrink-0 mt-0.5">{timeAgo(ev.receivedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

// ── Widget 5 — Funding Account ───────────────────────────────

function FundingAccountWidget({
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
