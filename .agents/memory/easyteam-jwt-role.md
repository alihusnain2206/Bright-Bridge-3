---
name: EasyTeam JWT role field requirement
description: EasyTeam's exchangeToken endpoint requires a `role` field in the JWT — not `accessRole`. Components spin forever if exchange fails.
---

## Rule
The JWT payload sent to EasyTeam **must** contain `role: { name: "..." }` — not `accessRole`.

**Why:** EasyTeam's `/embed/api/auth/exchangeToken` endpoint reads the `role` field to establish the session. If `role` is missing or named differently (e.g. `accessRole`), the exchange fails silently. The SDK still mounts the iframe and renders the component chrome (date picker, column headers), but data never loads — it spins forever. Confirmed by EasyTeam support.

**How to apply:** Every JWT payload in `auth.ts` must use the key `role`, not `accessRole`. Structure:
```json
{
  "employeeId": "...",
  "organizationId": "...",
  "role": {
    "name": "admin | manager | employee",
    "permissions": ["timeclock", "timesheet.view", ...]
  }
}
```
The employee role may also include `hourlyWage` inside `role`.

**Additional context:** EasyTeam lazily creates employees/organizations on first interaction — no pre-registration needed. But the token exchange must succeed first, which requires `role`.
