---
name: Phase 3 multi-location time tracking
description: EasyTeam fully location-aware — JWT scoping, per-location sync, SDK launcher filtering, company-settings UI
---

## What was built

Phase 3 made EasyTeam fully location-aware across six areas:

**A — Schema:** `locations` table extended with `isPrimary boolean`, `latitude real`, `longitude real`.
- Boot migration: `bootPhase3LocationSchema()` runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, backfills `is_primary=true` on earliest active location per company, backfills coords for LOC-SUNSHINE (40.7357, -74.1724) and LOC-RAINBOW (40.7178, -74.0431).
- Boot backfill: `bootBackfillUserAccountLocations()` copies `employees.location_id → user_accounts.location_id` wherever NULL. First run patched 19 accounts.

**B — Deterministic location resolution:** `resolveCompanyLocationId` in `lib/location.ts` orders by `is_primary DESC, created_at ASC` so primary location always wins.

**C — JWT location resolution:** `auth.ts` employee + manager JWT branches use `user.locationId ?? resolveEmployeeLocationId(empId) ?? resolveCompanyLocationId(companyId) ?? "LOC-SUNSHINE"` chain. Wizard account creation in `companies.ts` calls `resolveEmployeeLocationId` at creation time so `user_accounts.location_id` is populated immediately.

**D — Sync all active locations:** `POST /easyteam/hours/sync` now iterates all `isActive=true` locations per company, collects shifts from each, deduplicates by shift ID (first-write-wins), guards against cross-company foreign locations using a Set of the company's own ET location IDs.

**E — Per-location employee filtering in SDK:**
- `GET /api/easyteam/employees` now returns `locationId` field per employee.
- `LauncherEmployee` interface has `locationId?: string`.
- `useEasyTeamLauncher.ts` `resolvedLocations` map filters employees: `!e.locationId || e.locationId === loc.id` — employees with a locationId appear only in their location's dict; those without (manager-self, legacy) appear in all.
- `dashboard-manager.tsx` and `timesheets.tsx` both fetch locations from `GET /api/locations?companyId=` in the same `Promise.all` as token + employees. Fall back to `COMPANY_LOCATIONS` (hardcoded coords) if API returns empty. `ALL_STATIC_LOCATIONS` constant removed.

**F — Scoped token permissions:**
- `POST /easyteam/token`: employee gets `LOCATION_READ + SHIFT_*`; manager gets those plus `SCHEDULE_* + TIMESHEET_*`; admin/super_admin gets `LOCATION_ADMIN + ORGANIZATION_ADMIN`.
- `PUT /api/locations/:id` accepts `isActive`, `latitude`, `longitude`. Deactivation blocks if `isPrimary` or employees assigned. Activation validates coords, runs `ensureLocationTimezone` + `ensureTimeOffPolicy` (failures surfaced as warnings).

**Company-settings UI:**
- `LocationRow` interface has `isPrimary?`, `latitude?`, `longitude?`.
- `LocationFormState` has `latitude: string`, `longitude: string` (converted to `parseFloat` before PUT/POST).
- Lat/lng inputs in `LocationFormFields`.
- Edit button shown for BOTH active and inactive locations (previously active-only).
- `handleActivate` calls `PUT /api/locations/:id` with `{ isActive: true, latitude, longitude }`.
- "Primary" badge rendered next to primary locations.
- Deactivate button hidden for primary locations (server also blocks it).

## Key invariants

- `loc.id` from the API (= `locations.id` in DB) must equal `employees.location_id` for the per-location SDK filter to work. Seeded companies use stable IDs like `LOC-SUNSHINE`; wizard companies get UUID rows.
- `LauncherLocation.id` passed to `launch()` must match the `loc.id` returned by `GET /api/locations` — never the `easyteamLocationId` (those are different columns).
- Always `parseFloat` lat/lng before sending to the API — form state stores strings.
