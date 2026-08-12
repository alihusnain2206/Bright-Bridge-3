---
name: EasyTeam JWT external key rule
description: JWT locationId must always be our locations.id (external key), never easyteam_location_id (EasyTeam's internal UUID). Violation creates phantom locations in the org.
---

## The rule
JWT `locationId` field must **always** be `locations.id` (our primary key / external key registered with EasyTeam at boot), never `locations.easyteam_location_id` (EasyTeam's internal UUID).

**Why:** EasyTeam treats JWT `locationId` as an external key. If it sees an unknown value, it auto-creates a new (phantom) location, permanently polluting the org. Internal UUIDs are by definition unknown externally, so sending them as JWT locationId creates one phantom per unique internal UUID sent.

**How to apply:**
- Token endpoint (`easyteam.ts`): use `resolveEmployeeLocationId(employee_id)` (returns `employees.location_id` = `locations.id`) to set `resolvedLocationId`. Falls back to `resolveCompanyLocationId(companyId)`.
- `resolveCompanyLocationId` step 2 (`lib/location.ts`): select `locationsTable.id` (NOT `easyteamLocationId`) and return it.
- Sync loop: carry both `externalLocIds` (`locations.id`) and `internalLocIds` (`easyteam_location_id`) in `SyncableCompany`. Pass `externalLocIds` to `fetchEasyTeamShiftsForLocation`. Pre-seed the guard with `internalLocIds`. The function decodes the access token and returns `easyteamLocationId` — add that to the guard set after each fetch.
- `easyteam_location_id` values are only valid in: REST URL path segments (PATCH .../locations/{internalId}), and shift guard matching (comparing shift.locationId against known internal UUIDs).

## Where internal UUIDs are stored
`locations.easyteam_location_id` — written by `ensureLocationTimezone` at boot from the access-token `locationId` claim returned after exchanging a JWT with a correct external key.

## Phantom locations created before this fix (ORG-SUNSHINE)
These 5 phantoms must be deleted by EasyTeam support:
- `5e7b7483-...` (externalId = `53f6b890-...`, primary's internal UUID used as external)
- `34c0ee20-...` (externalId = `693c7267-...`, Annex's internal UUID)
- `9facff02-...` (externalId = `06e611e0-67d6-...`, Amsterdam Ave's internal UUID — main production offender, caused all Amsterdam Ave shifts to be unfindable)
- `b6934adc-...` (externalId = `06e611e0-87b1-...`, dev probe)
- `76b0b66b-...` (externalId = `9defae07-4e35-...`, dev probe)

ORG-BRIGHTBRIDGE shared org also has Bug B phantoms (wizard-company employees got internal UUID as locationId in tokens before the lib/location.ts fix). Ask EasyTeam to purge ORG-BRIGHTBRIDGE locations with UUID-format externalIds and null names.

## Employee `644fe0ab-a60b-47fd-b39c-b23ee2a91c96`
This EasyTeam UUID appears in ORG-SUNSHINE shift data but is NOT registered to any production employee. Synced via the wizard-company fallback path. Likely a dev test clock-in or manually-added EasyTeam employee — not Natalie Reed (her UUID is `d4f0d77c-471f-4db0-9d23-11a2b39a37ae`, already correctly set in DB).

## Amsterdam Ave secondary location — confirmed production diagnosis (Aug 2026)
Amsterdam Ave JWT (`locationId = "9defae07-3f8f-43ad-9062-9963820014fd"`) returns **0 shifts** from EasyTeam's flat `/timesheets` endpoint. Primary JWT returns 13 shifts from the same endpoint.

Diane's clock-in (shift `b499504f-a0e0-4dff-a77d-2dd74ba62818`) was recorded under phantom `5e7b7483-4b10-4f43-a701-8bf2e9530450` — excluded by foreign-location guard.

Root cause: EasyTeam is not correctly associating `"9defae07-3f8f-..."` as the registered external key for Amsterdam Ave. Clock-ins go to phantom locations instead of `06e611e0-67d6-...` (Amsterdam Ave's correct internal UUID). EasyTeam support ticket required — phantom cleanup + location registration verification needed.
