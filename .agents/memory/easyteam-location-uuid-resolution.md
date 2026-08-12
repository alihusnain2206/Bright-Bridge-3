---
name: EasyTeam location UUID resolution
description: How boot-time token exchange resolves the real EasyTeam UUID for each location, and the two pitfalls that silently drop secondary-location shifts.
---

# EasyTeam location UUID resolution

## The rule
`locations.easyteam_location_id` must hold the EasyTeam **internal** UUID for the location under the **current org** (per-company or shared). This is the value that appears in `shift.locationId` from EasyTeam's `/timesheets` API. If the column holds anything else — a self-referential internal row ID, or an old shared-org UUID — shifts for that location are silently discarded by the foreign-location guard.

**Why:** EasyTeam's shift records key to their own internal UUID, not to the external ID we embed in JWTs. After migrating a company to a per-company org, the internal UUID for each location changes; the old shared-org UUID becomes stale.

## How to resolve the correct UUID (token exchange mechanism)
Exchange a JWT signed with `locationId = <our internal row ID>` and `organizationId = resolveEasyTeamOrgId(companyId)`. The returned access token's `locationId` field contains EasyTeam's internal UUID for that location under the target org. Write that UUID back to `locations.easyteam_location_id`.

This is done automatically at boot by `ensureLocationTimezone` (`artifacts/api-server/src/routes/easyteam.ts` ~line 2111). The boot loop (setTimeout 5 s) now queries ALL active locations from the DB and runs `ensureLocationTimezone` for each — not a hardcoded list.

## Pitfall 1 — persist WHERE clause (stale-UUID case)
The original persist condition was:
```typescript
.where(and(eq(locationsTable.id, locationId), eq(locationsTable.easyteamLocationId, locationId)))
```
The second clause (`easyteam_location_id = locationId`) only matched when the column held the row's own ID (self-referential case). A column holding an old shared-org UUID (e.g. `9defae07-...`) never satisfied it — the update was silently skipped.

**Fix:** Use only `eq(locationsTable.id, locationId)` — always write the token-exchange result unconditionally. Idempotent if already correct.

## Pitfall 2 — sync guard pre-seed (token-exchange round-trip returns wrong UUID)
When `fetchEasyTeamShiftsForLocation` sends `locationId = <ET internal UUID>` in the JWT, EasyTeam may not recognise it as a registered *external* ID and falls back to returning the primary location's UUID in the access token. This means `companyEtLocIds.add(result.easyteamLocationId)` silently adds the primary UUID again; the secondary-location UUID never enters the guard set, and all secondary-location shifts are dropped as "foreign".

**Fix:** Pre-seed `companyEtLocIds` from `co.locationIds` (the DB-validated values) before the fetch loop:
```typescript
for (const locId of co.locationIds) { companyEtLocIds.add(locId); }
```
The boot has already validated these via token exchange, so they can be trusted without a live round-trip.

## How to apply
- Any time a company gains a per-company org (added to `resolveEasyTeamOrgId`), the boot will automatically resolve and persist the correct UUID for all its active locations on next restart.
- No manual DB UPDATE needed — the mechanism is self-healing.
- The historical-location expansion (reads distinct `easyteam_location_id` from `timesheet_shifts`) still runs as a belt-and-suspenders for UUIDs that predate the boot fix.
