---
name: Owner Dashboard Phase 2 — Payroll Command Center
description: Full rebuild of dashboard-owner.tsx into a payroll command center matching the design reference
---

# Owner Dashboard Phase 2

## What was built

`artifacts/brightbridge/src/pages/dashboard-owner.tsx` was completely replaced with a multi-section payroll command center. All other screens are unchanged.

## Layout structure (top → bottom)

1. **Greeting header** — time-of-day greeting + Refresh button with last-fetched timestamp
2. **6 KPI cards** — Payroll Status, Next Payroll Date, Employees to Pay, Cash Required (green ring highlight), Payroll Exceptions, Compliance Score
3. **Two-column main area** (`1fr 280px`):
   - Left: Payroll Processing Center (tabbed: Overview | Cash Required | Employees | Exceptions)
   - Right: Payroll Alerts right-rail + AI Payroll Assistant (simplified)
4. **Dark panel with 4 widgets**: FundingForecastWidget, Bank Balance Verification, VarianceWidget, Multi-Entity Payroll
5. **RecentActivityWidget** (full width)
6. **Team Access Management** panel (existing, unchanged)
7. **Timesheets & Approval** + EasyTeam iframe panel (existing, unchanged)

## Data sources

| Data | Endpoint | Used for |
|---|---|---|
| `GET /api/dashboard/payroll` | `useQuery(["payroll-dashboard"])` | KPI cards, Processing Center, history, employeesToPay |
| `GET /api/dashboard` | `useQuery(["owner-attention"])` | Payroll Alerts right-rail, exception count, compliance score |

## Widget prop fixes (important)

`VarianceWidget` props: `selectedCompanyId`, `currentDetails` (cast `det as unknown as PeriodDetailsResponse`), `lastPeriodId` (from `history[0]?.payPeriodId`)

`RecentActivityWidget` props: `selectedCompanyId`, `companies={[]}` (empty array is fine for single-company owner view)

**Why:** Widget components were extracted during Phase 1 with props tuned for the super_admin multi-company view. Owner view passes a single companyId and empty companies list.

## Cash Required derivation

From `details.payPeriod[0]`:
- `total` → direct total cash required
- `employeeTaxSum` → employee tax withholdings
- `employerTaxSum` → employer payroll taxes
- `payrollLineItems[]` → `netTotal`/`netPay` summed for net pay estimate
- `serviceFees` computed as `total - netPay - empTaxSum - emprTaxSum` (fallback 350)
- All displayed in Cash Required tab breakdown table

## Compliance Score derivation

`Math.round((completedCount / totalCount) * 100)` from `/api/dashboard` progress block. Feeds both the KPI card value and the AI Assistant readiness message.

## Funding Readiness checklist

5 items derived at runtime: payroll calculated (detRow present), exceptions reviewed (highCount === 0), funding account verified (bankLinked), sufficient funds (bankLinked), payroll approved (approvalDone state).

## "Approve & Fund Payroll" button

Links to `/manager-payroll` — does NOT call initiatePayroll directly. Intentional: avoids accidentally triggering a live payroll submission from the dashboard.
