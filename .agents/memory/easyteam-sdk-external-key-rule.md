---
name: EasyTeam SDK external key rule — all SDK surfaces
description: EasyTeam confirmed all SDK-facing identifiers must be our own external IDs; internal UUIDs (easyteam_location_id) belong only in REST API paths and guard matching.
---

## Rule
Every identifier the EasyTeam SDK receives must be our own external key (`easyteamExternalKey ?? locations.id`), not EasyTeam's internal UUID (`easyteamLocationId`). This applies to:
- `locations[].id` in sdk-payload and in every `launch()` call
- `employee.locationEtId` routing key in sdk-payload and employee dashboard
- The `id` field in the `myLocations[]` array built in `dashboard-employee.tsx`

Internal UUIDs stay in: `easyteam_location_id` column reads for guard matching, REST API URL path segments, shift storage lookups.

**Why:** EasyTeam explicitly confirmed (Aug 2026): "use external IDs [your own IDs] throughout the system when using the SDK. If using the API directly, it's a mix of internal UUIDs and external IDs." Using internal UUIDs as SDK location IDs causes per-location timesheet filters to show 0 — shifts are stored under the JWT-resolved location but the iframe's filter queries a different identifier.

## Root cause of the web-timeclock bug
`timeclock.tsx` was passing `client.locationId` (from `companies.rollfiLocationId` via `projectCompany()`) as SDK `locations[].id`. That value has no relation to `locations.id` or `easyteamExternalKey`. The JWT used `resolveEmployeeLocationId` (returns `easyteamExternalKey ?? employees.locationId`). Mismatch → 0 per-location.

The employee dashboard (`dashboard-employee.tsx`) worked because it fetched `/api/locations` directly and used `l.id` (our DB PK), which matched what `resolveEmployeeLocationId` returned when `easyteamExternalKey` is null.

## Resolution
All four surfaces now use `easyteamExternalKey ?? locations.id`:
1. `sdk-payload` — `locEtIdMap` and `locations[].id` both switched from `easyteamLocationId` to `easyteamExternalKey ?? l.id`
2. `timeclock.tsx` — `handleLaunch` now parallel-fetches `/api/locations` and uses `easyteamExternalKey ?? l.id`; all active locations passed (not just one)
3. `dashboard-employee.tsx` — `myLocations[].id` and `locationEtId` derivation both use external key from fetched `activeLocs`
4. Token endpoint — `location_picker: false` for employee-role tokens (was hardcoded `true`)

## How to apply
When adding any new SDK launch surface or modifying an existing one:
- Never use `client.locationId`, `companies.rollfiLocationId`, or `easyteamLocationId` as a SDK location id
- Always source locations from `/api/locations` (returns full DB rows with `easyteamExternalKey`)
- Use `l.easyteamExternalKey ?? l.id` as `locations[].id` and as `locationEtId`
- Ensure JWT `locationId` comes from `resolveEmployeeLocationId` (same column, consistent value)
- Set `location_picker: false` for employee-role tokens
