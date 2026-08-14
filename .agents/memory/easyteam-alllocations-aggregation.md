---
name: EasyTeam "All locations" aggregation rule
description: Root cause + code fix + repair-without-delete mechanism for locations registered under the wrong EasyTeam org.
---

## Root cause (confirmed Aug 2026)
`POST /api/locations` called `ensureLocationTimezone(easyteamLocationId, { country, state })` — NO `companyId`. Inside `ensureLocationTimezone`, `resolveEasyTeamOrgId(undefined)` falls back to `"ORG-BRIGHTBRIDGE"`. So the JWT exchanged with EasyTeam had `organizationId: "ORG-BRIGHTBRIDGE"`, registering the new location under the shared org instead of the company's dedicated org.

Result: employees at a secondary location clock in correctly (EasyTeam resolves the external key globally), but the location *belongs* to ORG-BRIGHTBRIDGE. When the owner's timesheet JWT uses `organizationId: "ORG-MSSNEMFA-3WATY2"`, "All locations" only returns locations owned by that org — not Harbor Street — so those employees show 0m.

## Code fix (applied Aug 2026)
`artifacts/api-server/src/routes/locations.ts` `POST /api/locations`:
```js
// Fixed: pass companyId to both calls
await ensureLocationTimezone(easyteamLocationId, { country: "US", state, companyId });
await ensureTimeOffPolicy(easyteamLocationId, { companyId });
```
The boot sync already correctly passed `companyId`.

## Repair-without-delete mechanism (Aug 2026)

### New column: `locations.easyteam_external_key` (TEXT, nullable)
- Mutable external key used in JWT `locationId` claims.
- NULL = created before the fix; resolver falls back to `locations.id` (existing behavior).
- POST /api/locations now sets it to `rowId` explicitly on insert.
- Repair endpoint sets it to a fresh UUID.

### Where external key is resolved
- `resolveCompanyLocationId` → returns `easyteamExternalKey ?? locations.id`
- `resolveEmployeeLocationId` → JOINs to locations, returns `easyteamExternalKey ?? employees.locationId`
- Boot sync → selects `easyteamExternalKey`, calls `ensureLocationTimezone(etKey, { rowId: locationId })`

### `rowId` parameter added to `ensureLocationTimezone` and `ensureTimeOffPolicy`
When `locationId` is a fresh UUID (post-repair), `opts.rowId` is the DB PK — used for:
- Store manager-user lookup (store has `locationId = locations.id`)
- DB UPDATE WHERE clause (to persist the new EasyTeam internal UUID)

### Repair endpoint
```
POST /api/locations/:id/repair-easyteam  (owner or super_admin)
```
1. Generates `newExternalKey = randomUUID()`
2. Updates DB: `easyteam_external_key = newExternalKey`
3. Calls `ensureLocationTimezone(newExternalKey, { companyId, rowId: id })` → registers under correct org
4. Returns `{ ok, newExternalKey, message }`

### Frontend repair button
Shown on location cards in Company Settings → Locations when `easyteamExternalKey === null` (i.e., old location created before the fix). Amber "Fix EasyTeam" button opens a confirmation modal with a shift-history warning.

## ⚠ Impact on historical shifts
Shifts recorded before repair are stored at the old EasyTeam location UUID (under ORG-BRIGHTBRIDGE). They remain visible via per-location filter but NOT in "All Locations" until EasyTeam support migrates them. The modal warns the owner about this. For test companies (Harborview), running repair immediately is safe. For production companies (Sunshine/Amsterdam Avenue), request EasyTeam shift migration first.

## Affected production companies
- **Harborview Test Daycare**: Harbor Street (FD490CFC-…) — registered under ORG-BRIGHTBRIDGE, should be ORG-MSSNEMFA-3WATY2
- **Sunshine Daycare / Amsterdam Avenue**: same root cause (secondary location created from settings before the fix)
- Any other company with a secondary location created from Company Settings before this deployment

## Why per-location filter worked but "All Locations" didn't
EasyTeam resolves the clock-in location external key globally — clock-ins succeed and the shift is stored at the EasyTeam UUID under ORG-BRIGHTBRIDGE. Selecting a specific location in the SDK queries that UUID directly (bypasses org filter) → shows hours correctly. "All locations" makes an org-scoped query → only finds locations *owned* by the company's org → broken locations excluded → 0m.
