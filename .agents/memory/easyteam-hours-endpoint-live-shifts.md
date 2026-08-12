---
name: EasyTeam hours endpoint reads from live shifts
description: GET /api/easyteam/hours now aggregates from timesheet_shifts by local_date, not stale timesheet_entries by periodKey.
---

# EasyTeam Hours Endpoint — Live Shifts Aggregation

## The Rule
`GET /api/easyteam/hours` (the Pull Hours table + manager approval input) must aggregate from `timesheet_shifts` by `local_date` for the requested date range. Never use pre-aggregated `timesheet_entries` as the primary source.

**Why:** `timesheet_entries` are keyed by an exact `periodKey` string (e.g. `2026-07-21/2026-08-03`). A sync run for a *different* date range writes a *different* periodKey and does NOT refresh the old one. This means old period entries become stale — new shifts that fall within the old range are counted in `timesheet_shifts` but not reflected in `timesheet_entries` for that period. The fix: aggregate `payable_duration_ms` from `timesheet_shifts` by `local_date` every time; fall back to `timesheet_entries` only when no shifts exist in the DB for the range.

## Approval Status Merge
`timesheet_entries` is still read alongside the shift aggregate — solely to carry forward `managerApproved`, `approvedAt`, and `approvedHours` for periods the manager has already signed off. If `managerApproved` is true, the approved hours from the stored entry are preserved even if new shifts arrive.

## Key Helper
`getTimesheetShiftsByCompanyAndRange(companyId, from, to)` in `lib/timesheet-shifts-persist.ts` compares by `localDate` column (not UTC), so shifts near period boundaries are correctly attributed.
