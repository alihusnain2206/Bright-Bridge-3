---
name: EasyTeam "All locations" aggregation rule
description: Root cause + code fix + repair-without-delete mechanism for locations registered under the wrong EasyTeam org.
---

## Root cause (confirmed Aug 2026)
Two separate mechanisms can misfile a location under ORG-BRIGHTBRIDGE:

**A) `POST /api/locations` (Settings dashboard, pre-fix):** called `ensureLocationTimezone(rowId, { country, state })` with no `companyId`. `resolveEasyTeamOrgId(undefined) → "ORG-BRIGHTBRIDGE"`. Location registered under the shared org immediately on creation. Fixed by passing `companyId` to the call.

**B) `PUT /api/locations` (first edit/activation of a wizard-created location, pre-fix):** called `ensureLocationTimezone(loc.easyteamLocationId, ...)` without `companyId` AND used the stored `easyteam_location_id` internal UUID as the external key (double bug). For wizard-created locations, `easyteam_location_id` starts as the Rollfi-assigned location UUID. On first PUT, it gets registered under ORG-BRIGHTBRIDGE. Fixed by passing `companyId: loc.companyId` and using `easyteamExternalKey ?? loc.id` as external key.

**Harbor Street (Harborview's wizard-created location) was affected by mechanism B, not A.**

## EasyTeam org UUIDs (confirmed from production boot logs, Aug 2026)
- `c280023c-02e8-4025-8775-b96ca01fd451` = ORG-BRIGHTBRIDGE's internal EasyTeam org UUID
- `e22e33a0-fe40-466b-a5aa-f801eadc308b` = Harborview (ORG-MSSNEMFA-3WATY2)'s internal EasyTeam org UUID
- `a9bf558c-4968-4279-bb83-adefb4dee9de` = ORG-SUNSHINE's internal EasyTeam org UUID (appears in time-off 404 logs)

Harbor Street (`FD490CFC-…`, `73a65890-…`) was correctly re-registered under `e22e33a0-…` (Harborview's own org) at the first production restart that included the boot sync fix. The boot sync runs 5s after startup for ALL active locations using companyId from a JOIN.

## Code fix (applied Aug 2026)
All call sites for `ensureLocationTimezone` and `ensureTimeOffPolicy` now pass `companyId`:

| File | Context | Status |
|------|---------|--------|
| `routes/locations.ts` POST /api/locations | Creation | ✓ Fixed |
| `routes/locations.ts` PUT /api/locations (activation) | ensureLocationTimezone + ensureTimeOffPolicy | ✓ Fixed |
| `routes/locations.ts` PUT /api/locations (state change) | ensureLocationTimezone | ✓ Fixed |
| `routes/locations.ts` POST /api/locations/:id/repair-easyteam | Both | ✓ Correct |
| `routes/easyteam.ts` Boot 5s sync setTimeout | Both, via JOIN | ✓ Fixed |
| `routes/easyteam.ts` POST /api/easyteam/admin/patch-location-timezone | ensureLocationTimezone | ✓ Fixed (Aug 2026) |

Zero call sites without companyId remain.

## `easyteam_external_key` column + repair mechanism
Added `locations.easyteam_external_key` (TEXT, nullable). Repair endpoint generates fresh UUID, updates DB, re-registers under correct org. External key rule:
- JWT `locationId` = `easyteamExternalKey ?? locations.id`
- Boot sync uses same rule, passes `rowId: locations.id` for DB WHERE clause
- Old rows have NULL → fall back to `locations.id` (the stable external key)

The boot sync makes the repair endpoint redundant for locations that were active at the last server restart. The repair button remains useful for:
- Locations where the boot sync timed out
- Explicit confirmation that registration is under the correct org

## Repair button trigger condition
Shows when `easyteamExternalKey === null` (pre-fix rows). We cannot confirm from our own data alone whether a location is actually misfiled — that requires querying EasyTeam. Modal is honest about this uncertainty. The repair is safe but historical "All Locations" shifts will not retroactively appear.

## ⚠ Repair impact on historical shifts
Clock-in records before a repair (or before the first correct-org boot sync) are stored at the old EasyTeam location UUID. They remain visible via per-location filter but NOT in "All Locations" until the time-tracking provider migrates them.

## Per-location filter works but All Locations shows 0m
Mechanism: the per-location filter uses `easyteam_location_id` (internal UUID) directly in the SDK location payload. EasyTeam returns shifts for that specific UUID regardless of org boundary. "All Locations" queries via the company's org JWT, which only returns shifts for locations belonging to that org. Cross-org location UUIDs are excluded.
