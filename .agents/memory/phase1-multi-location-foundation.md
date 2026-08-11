---
name: Phase 1 multi-location data foundation
description: Invisible DB foundation for multi-location: locations + departments tables, employees.locationId FK, boot migrations, resolver update. No UI changes.
---

## What was built

**New DB tables** (lib/db/src/schema/index.ts):
- `locations` — one row per company; key cols: `easyteamLocationId`, `rollfiLocationId`, `isActive`, `code` default "100"
- `departments` — replaces the in-memory `store.departments` array; same shape as the old `Department` interface

**New column**: `employees.location_id` (nullable text, backfilled at boot)

**resolveCompanyLocationId** (lib/location.ts) — new step 2 in chain (after store, before companies.rollfiLocationId): queries `locations` table for `easyteamLocationId`. New helper `resolveEmployeeLocationId` added.

**seedDepartmentsForCompany** (people.ts) — now async; writes to DB instead of in-memory array; idempotent (checks DB first).

**Department CRUD routes** (people.ts) — all 4 routes (GET/POST/PUT/DELETE) now read/write DB directly.

## Boot migrations (index.ts)

Chain: `bootSeedCompanies → bootSeedEmployees → bootSeedLocations → bootAssignEmployeeLocations`

- `bootSeedLocations`: one location row per company using `resolveCompanyLocationId` for `easyteamLocationId`. Idempotent.
- `bootAssignEmployeeLocations`: fills `employees.locationId` WHERE locationId IS NULL. Idempotent.
- `backfillPeopleModule` (app.ts, called at boot): now seeds departments to DB via async `seedDepartmentsForCompany`.

## drizzle-kit push caveat

drizzle-kit interactive prompt confuses new `departments` table with a rename of `easyteam_ignored_uuids`. Fix: pre-create the table via raw SQL (`CREATE TABLE IF NOT EXISTS departments ...`) before running drizzle-kit push.

**Why:** drizzle-kit's heuristic for detecting renames can misfire when a new table name matches the column structure of an existing table. Raw SQL creation first sidesteps the interactive prompt.

## Scope boundary (do NOT touch in Phase 1)

No UI changes. No new EasyTeam API calls. No new Rollfi addCompanyLocation calls. All existing callers of `resolveCompanyLocationId` unchanged — same return value, just from locations table now.

## Dead code note

`store.ts` departments array and store methods (getDepartments, addDepartment, etc.) marked as dead code with comment. Still compile; no live callers remain.
