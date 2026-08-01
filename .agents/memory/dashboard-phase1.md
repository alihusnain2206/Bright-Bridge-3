---
name: Dashboard Phase 1 — shared components + consolidated endpoint
description: Widget extraction to components/dashboard/ and GET /dashboard/payroll consolidated endpoint
---

# Dashboard Phase 1

## Part A — Shared Widget Components

All 6 widgets extracted to `artifacts/brightbridge/src/components/dashboard/`:

| File | What it is |
|---|---|
| `types.ts` | Shared interfaces (ProcessedPeriod, PayPeriod, PeriodDetailsResponse, CompanyState, ActivityFeedEvent) |
| `helpers.ts` | Shared utils (apiFetch, fmtD, fmtDate, timeAgo) |
| `WidgetCard.tsx` | Dark glass card shell (title, subtitle, children, footer) |
| `KpiCard.tsx` | White stat card for KPI metrics |
| `FundingForecastWidget.tsx` | Props-fed; no own fetch |
| `VarianceWidget.tsx` | Self-fetches previous period via React Query key `rollfi-period-details` — key preserved exactly |
| `RecentActivityWidget.tsx` | Self-fetches `/api/activity?companyId=`; 30s refresh; company-scoped |
| `FundingAccountWidget.tsx` | Props-fed; no own fetch |
| `index.ts` | Barrel export for all of the above |

**CostTrendWidget was deliberately NOT extracted** (not in Phase 1 spec); it remains local in PayrollWidgets.tsx and uses WidgetCard via the shared import.

**Consumer updates:**
- `PayrollWidgets.tsx` — removed 5 local component definitions; now imports from `@/components/dashboard`
- `manager-payroll.tsx` — removed local `KpiCard` definition + `ArrowRight` from lucide imports; now imports from `@/components/dashboard`

## Part B — GET /dashboard/payroll

File: `artifacts/api-server/src/routes/dashboard-payroll.ts`
Mounted in: `artifacts/api-server/src/routes/index.ts`

**Response shape:**
```ts
{
  payPeriod: Record<string, unknown> | null,
  details: Record<string, unknown> | null,
  history: Record<string, unknown>[],
  companyTasks: { tasks, kybStatus, bankLinked } | null,
  employeesToPay: number | null,   // derived from details.payPeriod[0].payrollLineItems.length
  fetchedAt: string,               // ISO timestamp
  errors: { payPeriod?, details?, history?, companyTasks? }
}
```

**Cache:** In-memory Map keyed by companyId, TTL = 60s. `?refresh=true` bypasses.

**Auth:** Same `resolveCompanyId` pattern as `/api/dashboard` (owner sees own company; super_admin can pass `?companyId=`). Returns 401/403 without a session.

**Why:** Batches 4 expensive Rollfi calls server-side so the dashboard doesn't fire them independently on mount. Partial-failure tolerant — one failed upstream call populates `errors{}` but the rest still return.
