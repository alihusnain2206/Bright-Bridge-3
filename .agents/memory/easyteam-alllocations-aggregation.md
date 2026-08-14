---
name: EasyTeam "All locations" aggregation rule
description: How EasyTeam SDK aggregates hours in "All locations" mode and why per-location employee filtering breaks it.
---

## The rule
For the owner **timesheet** view (`Pages.TIMESHEET`), every time-tracking employee must appear in **every** location's `employees` dict. Do NOT apply `locationEtId` filtering when building the timesheet SDK payload.

**Why:** EasyTeam's "All locations" aggregation only totals hours for employees across the locations they appear in. When an employee is in only ONE location dict (Colleen in Harbor Street, Desmond in Water Street), "All locations" behaves as if only the last-processed location exists — Harbor Street data is silently dropped, showing 0m for Colleen.

**How to apply:**
- `timesheets.tsx` `handleLaunchScoped`: map `sdkData.employees` to `apiEmployees` WITHOUT including `locationEtId`. All employees go into all location dicts via `useEasyTeamLauncher`.
- `dashboard-employee.tsx` (employee time clock, `Pages.TIME_CLOCK`): KEEP `locationEtId` filtering — this is what routes the clock-in to the correct location. Removing it here sends all clock-ins to the wrong location.
- The `locationEtId` field is a BrightBridge routing key, not an EasyTeam API field. `useEasyTeamLauncher` uses it to build `resolvedLocations[].employees`, then strips it before calling the EasyTeam SDK.

## Reviewer/selfEntry rule (separate from above)
The owner's reviewer/selfEntry (`timeTrackingEnabled: false`) must NOT appear in any location dict. It belongs only in the flat `sdkEmployees` array. If it leaks into location dicts (because it has no `locationEtId`), `useEasyTeamLauncher` now correctly excludes it via the `e.timeTrackingEnabled !== false` guard (Aug 2026 fix).

## Side effect of correct fix
Per-location views (e.g. "Harbor Street") will now show ALL employees, including those at other locations (with 0m). This is acceptable — the owner can see that Desmond has 0m at Harbor Street.
