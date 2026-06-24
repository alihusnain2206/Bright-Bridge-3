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

Employees added dynamically (not in boot sync) will have unmapped UUIDs — display as "External Staff" in the frontend.

## Stale entry cleanup

Always call `clearTimesheetEntriesForCompanyPeriod(companyId, periodKey)` before writing fresh REST API data, to prevent stale entries from accumulating when UUIDs change (e.g. before/after the mapping fix).

**Why:** without clearing, old entries keyed by raw EasyTeam UUIDs remain alongside new entries keyed by internal IDs, causing duplicates and inflated hour counts.
