---
name: EasyTeam timesheets API behavior
description: Key findings about EasyTeam's /timesheets endpoint shape and how to correctly sync hours from it.
---

## Working endpoint

`GET ${EASYTEAM_EMBED_API}/organizations/{internalOrgId}/locations/{internalLocId}/timesheets`

Call with **NO extra params** — adding `limit`, `page`, or date filters causes EasyTeam to return `[]`.

Internal org/loc UUIDs come from decoding the access token returned by `POST /embed/api/auth/exchangeToken`.

## Response shape

```json
[{
  "id": "...",
  "employeeId": "EasyTeam-internal-UUID",
  "startTime": "2026-06-23 22:39:31",
  "endTime":   "2026-06-23 22:42:24",
  "breaks": [],
  "hourlyWage": 1800,
  ...
}]
```

- `startTime`/`endTime`: space-separated `"YYYY-MM-DD HH:MM:SS"` — **not** ISO 8601
- `payableDuration`: in **milliseconds** (NOT minutes) — do NOT treat as minutes
- **Always calculate duration from `startTime`/`endTime`**: `(end - start) / 60000` = minutes
- No `shifts` endpoint — `/shifts` returns 404

## Employee UUID mapping

The `employeeId` in timesheets is EasyTeam's internal UUID, not our internal `employeeId` (like `EMP-RAINBOW-002`).

**Fix**: during boot sync and dynamic employee add, decode the access token returned from `exchangeToken` — it contains the EasyTeam UUID. Store that mapping in `store.setEasyTeamUuidMapping(etUuid, internalEmpId)`. Use `store.resolveEasyTeamUuid(etEmpId)` in sync step 3.

Employees added directly via the EasyTeam UI (not our app) will have unmapped UUIDs. Fix: add them to `testUsers` in store.ts and hardcode their UUID in the `etUuidToEmployeeId` map initialization. Arbab Nasir: UUID `2f1c0890-0eea-4eb6-9cb2-93ce5c45ba59` → `EMP-RAINBOW-004`.

## Unresolved UUID guard (sync AND approve endpoints)

After calling `store.resolveEasyTeamUuid(etEmpId)`, **always check** `if (internalEmpId === etEmpId) continue` before writing an entry. If the UUID wasn't mapped, `resolveEasyTeamUuid` returns the raw UUID as fallback — without this guard, EasyTeam employees not in our registry get stored verbatim and show as "External Staff" in the UI.

Apply this guard in BOTH `/easyteam/hours/sync` (Step 3) AND `/easyteam/hours/approve` (Step 2).

## Approve endpoint Step 2 — same rules as sync

The approve endpoint fetches raw EasyTeam shifts. Apply the exact same rules:
- Use `shiftDurationMinutes(s)` — NOT `shift.payableDuration` directly (payableDuration is ms)
- Use `breakDurationMinutes(s)` — NOT `shift.totalUnpaidBreaks` directly
- Normalize timestamps with `normTs = (t) => t.includes("T") ? t : t.replace(" ", "T") + "Z"` before `new Date()`
- Resolve UUID and skip unresolved entries

## Stale entry cleanup

Always call `clearTimesheetEntriesForCompanyPeriod(companyId, periodKey)` before writing fresh REST API data, to prevent stale entries from accumulating when UUIDs change (e.g. before/after the mapping fix).

**Why:** without clearing, old entries keyed by raw EasyTeam UUIDs remain alongside new entries keyed by internal IDs, causing duplicates and inflated hour counts.
