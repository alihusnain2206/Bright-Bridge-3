---
name: Phase 2 multi-location feature
description: What was built for Phase 2 (locations visible + manageable); architecture decisions; integration behavior
---

# Phase 2 Multi-location Feature

## What was built

**Backend:**
- `routes/locations.ts` — full CRUD router (GET list, POST create, PUT edit, DELETE soft-deactivate with employee guard); mounted in `routes/index.ts`
- `ensureLocationTimezone` and `ensureTimeOffPolicy` exported from `routes/easyteam.ts` (they were module-private; now used by the locations router)
- `resolveEmployeeRollfiLocationId(employeeId, fallback)` added to `lib/location.ts` — returns employee's location's rollfiLocationId or the fallback
- B6 fix in `lib/employee-onboard.ts`: EasyTeam registration now uses `resolveEmployeeLocationId(emp.id)` not `resolveCompanyLocationId`
- B5 fix in `lib/rollfi-employee-sync.ts`: `RollfiEmployeeInput` has optional `companyLocationId?` field; addUser uses it over rollfiCompany.rollfiLocationId
- `routes/people.ts` PATCH: added `"locationId"` to `stringFields`; `syncEmployeeToRollfi` handles locationId change → Rollfi updateUser with new `companyLocationId`
- `routes/admin.ts`: `GET /admin/users` now returns `locationId` and `accountLocationId`; added `POST /api/admin/users/:employeeId/grant-access` endpoint
- `routes/companies.ts` POST `/employees`: uses `body.locationId` if provided (wizard 2+ location case), falls back to primary location

**Frontend:**
- `company-settings.tsx`: "Locations" tab with `LocationsTab` component (list, add, edit, deactivate modals)
- `users-access.tsx`: `GrantAccessModal` (role + location-for-manager), "Grant Access" button for employees without accounts
- `client-employees-new.tsx`: location dropdown at wizard step 1 (conditional on 2+ active locations)
- `employee-edit.tsx`: location dropdown in Employment tab (conditional on 2+ active locations)
- `people-directory.tsx`: location filter dropdown + Location column in table (both conditional on 2+ locations)
- `employee-profile.tsx`: Location InfoRow in OverviewTab and JobPayTab

## Key design decisions

**Why:** Location dropdown is hidden when company has only 1 active location — zero friction for single-site companies; auto-assigns silently.

**Why:** `easyteamLocationId` for new locations = the DB row's UUID (stable, not derived from mutable code/name).

**Why:** Rollfi `addCompanyLocation` response can use `registration.companyLocationId`, `registration.locationId`, or `registration.companyLocationID` — all three are checked.

**Why:** Location column + filter in directory only rendered when `locations.length >= 2` — keeps single-location companies clean.

## API shape

`GET /api/locations?companyId=X` → `{ locations: [{ id, companyId, code, name, address1, address2, city, state, zipcode, rollfiLocationId, easyteamLocationId, isActive, createdAt }] }`

`POST /api/locations` body: `{ companyId?, code, name, address1, address2, city, state, zipcode }` → `{ location, warnings? }`

`POST /api/admin/users/:employeeId/grant-access` body: `{ role, locationId? }` → `{ accountId, role, locationId, tempPassword, message }`

## Grant Access / Change Role bugs fixed (Aug 2026)
- Grant Access button was gated on `!u.hasAccount` → invisible when all employees have accounts
- Fixed: employees WITH accounts get a "Change Role" button; employees WITHOUT get "Grant Access"
- Added `PATCH /api/admin/users/:employeeId/role` endpoint with same guards as grant-access
- Fixed drizzle column name bug: `.set({ location_id })` → `.set({ locationId })` (drizzle uses JS camelCase property, not DB snake_case column; silent ignore caused locationId to never persist)
- Modal merged into single `ManageAccessModal` with `mode: "grant" | "change"`

## Outstanding (Phase 3)

Access-control enforcement: managers scoped to their locationId. Guards in `people.ts`, `easyteam.ts`, `companies.ts` etc. not yet applied for location-level scoping.
