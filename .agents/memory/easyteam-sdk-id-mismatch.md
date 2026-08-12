---
name: EasyTeam SDK employee ID mismatch
description: Employees registered directly in EasyTeam have a separate UUID; passing our internal ID causes their hours to appear in the SDK Total but not in a named row.
---

# EasyTeam SDK Employee ID Mismatch

## The Rule
When building the `employees` array for the EasyTeam SDK launcher, always use the employee's EasyTeam UUID (`easyteamUuid`) when one exists. Fall back to the internal ID (`id`) only for employees who were registered through our wizard (no separate UUID).

**Why:** EasyTeam's own database keys employees by whatever ID they were created with. Employees who registered in EasyTeam directly (before our integration) have a UUID as their primary ID. Employees created through our wizard use our internal ID (e.g. `EMP-SUNSHINE-001`) as their EasyTeam-side ID. When you pass the wrong ID in the `employees` array, EasyTeam counts those employees' shifts in the Grand Total but can't match them to a named row — the hours are invisible in the table.

## How to Apply
- `GET /api/easyteam/employees` now returns `easyteamUuid?: string` per employee (via `store.getEasyTeamUuidForEmployee`).
- `dashboard-manager.tsx` maps: `id: e.easyteamUuid ?? e.id` before passing to `launch()`.
- `timesheets.tsx` maps: `id: e.easyteamUuid ?? e.id` in `apiEmployees`.
- The manager's own `selfEntry` (isVisible: false) keeps the internal ID because the JWT's `employeeId` claim also uses the internal ID — they must match.

## Reverse UUID Lookup
`store.getEasyTeamUuidForEmployee(internalId)` iterates `etUuidToEmployeeId` in reverse to find the UUID. This map is populated at boot from the `easyteam_uuid_registry` DB table (19 entries at last check). Any new employee added via the EasyTeam SDK is backfilled on the next boot.
