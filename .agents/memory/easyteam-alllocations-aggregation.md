---
name: EasyTeam "All locations" aggregation rule
description: Root cause — secondary locations created from the settings dashboard were registered under ORG-BRIGHTBRIDGE instead of the company's own org, making them invisible in "All locations". Code fix + data migration notes inside.
---

## Root cause (confirmed Aug 2026)
`POST /api/locations` called `ensureLocationTimezone(easyteamLocationId, { country, state })` — NO `companyId`. Inside `ensureLocationTimezone`, `resolveEasyTeamOrgId(undefined)` falls back to `"ORG-BRIGHTBRIDGE"`. So the JWT exchanged with EasyTeam had `organizationId: "ORG-BRIGHTBRIDGE"`, registering the new location under the shared org instead of the company's dedicated org.

Result: Employees at a secondary location clock in correctly (EasyTeam resolves `FD490CFC-…` → `73a65890-…` globally), but the location *belongs* to ORG-BRIGHTBRIDGE. When the owner's timesheet JWT uses `organizationId: "ORG-MSSNEMFA-3WATY2"`, "All locations" only returns locations owned by that org — not Harbor Street — so those employees show 0m.

## The fix (applied Aug 2026)
`artifacts/api-server/src/routes/locations.ts` `POST /api/locations`:
```js
// BEFORE (bug):
await ensureLocationTimezone(easyteamLocationId, { country: "US", state: body.state || "NJ" });
await ensureTimeOffPolicy(easyteamLocationId);

// AFTER (fixed):
await ensureLocationTimezone(easyteamLocationId, { country: "US", state: body.state || "NJ", companyId });
await ensureTimeOffPolicy(easyteamLocationId, { companyId });
```

The boot sync (`setTimeout` in easyteam.ts ~line 2387) already correctly passes `companyId` — only the on-demand creation path was missing it.

## Data fix for already-broken locations
Locations created from settings before this fix are permanently registered under ORG-BRIGHTBRIDGE. The boot sync cannot move them (EasyTeam does not transfer location ownership on JWT re-exchange).

**To repair a broken location (e.g. Harborview's Harbor Street):**
1. Delete the location from Company Settings
2. Re-create it — the creation now correctly passes `companyId` → EasyTeam registers it under the company's own org
3. Re-assign affected employees to the new location
4. Note: existing clock-in shifts at the old location are lost (they live in EasyTeam under ORG-BRIGHTBRIDGE). For test companies this is acceptable; for production companies, ask EasyTeam support to migrate shifts before deleting.

## Why per-location filter worked but "All locations" didn't
EasyTeam resolves the clock-in location external key (`FD490CFC-…`) globally — clock-ins succeed and the shift is stored at `73a65890-…` (the location UUID under ORG-BRIGHTBRIDGE). When you select a specific location in the SDK dropdown, the SDK queries that UUID directly (bypasses org filter) → shows 6m correctly. "All locations" makes an org-scoped query → only finds locations *owned* by the company's org → Harbor Street excluded → 0m.
