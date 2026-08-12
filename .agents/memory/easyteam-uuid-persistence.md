---
name: EasyTeam UUID persistence
description: easyteam_uuid column in employees table; boot sync phases; backfill pattern
---

## Rule
`registerEmployeeInEasyTeam` is the ONE place that writes to both the in-memory map
(`store.setEasyTeamUuidMapping`) and the DB column (`easyteam_uuid`). No caller should
duplicate these writes.

## DB column
`employees.easyteam_uuid text` — added alongside the existing `easyteam_synced boolean`.
Both fields live in `lib/db/src/schema/index.ts`.

## Boot sync (index.ts `bootEasyTeamSync`)
Three phases, in order:

**Phase 0 — backfill:** Write historically known UUID→empId pairs from `KNOWN_EASYTEAM_UUIDS`
to DB rows whose `easyteam_uuid` is currently null. Idempotent (WHERE easyteam_uuid IS NULL).
Add new entries only for UUIDs from the company's CURRENT EasyTeam org. If a company migrates
to a new EasyTeam org, their old-org UUIDs MUST be removed from this array — otherwise Phase 0
restores obsolete UUIDs, Phase 1 sees them as current, and Phase 2 skips re-registration.
Symptom: `backfilled: N, registered: 0` for those employees + `skippedUnknownEtIds` during sync.
Fix: delete stale entries from `KNOWN_EASYTEAM_UUIDS`, clear the DB rows
(`UPDATE employees SET easyteam_uuid=NULL WHERE id IN (...)`), restart.

**Phase 1 — DB → map:** `SELECT id, easyteam_uuid WHERE easyteam_uuid IS NOT NULL` → populate
`etUuidToEmployeeId` map instantly, NO API calls. Log line: "populated EasyTeam UUID map from DB".

**Phase 2 — API for unknowns:** Token-exchange every employee whose `easyteam_uuid IS NULL`,
regardless of `status`. `registerEmployeeInEasyTeam` handles persist + map update internally.
NO status filter — onboarding employees who clock in must be matched.

## Why
`etUuidToEmployeeId` is a module-level in-memory Map reset on every restart. Before this fix
the boot sync only registered `status='active'` employees, so any onboarding employee (including
wizard-created hires) would have their shifts silently dropped on restart. The DB column makes
the UUID durable; Phase 1 repopulates the map in <1 ms without any API calls.

## Quick-add path (rollfi.ts POST /rollfi/employees)
Now **awaited** (not fire-and-forget). `registerEmployeeInEasyTeam` internally calls
`setEasyTeamUuidMapping` and attempts a DB UPDATE. Store-only employees (no DB row) get a
0-row UPDATE that is harmless — the map entry is still created for the current process lifetime.

## lib/db build note
When changing `schema/index.ts`, always run `cd lib/db && pnpm tsc` before running `pnpm tsc`
in `artifacts/api-server` — the api-server uses TS project references and needs the compiled
declaration files from lib/db to see updated column types.
