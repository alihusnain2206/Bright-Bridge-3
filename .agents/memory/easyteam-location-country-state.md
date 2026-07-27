---
name: EasyTeam location timezone fix
description: How to set timezone on an EasyTeam location — PATCH uses country+state, not an IANA timezone string
---

## The fix

EasyTeam does NOT accept a `timezone` field on PATCH /organizations/{org}/locations/{loc}.
Returns HTTP 500 for `{ timezone: "America/New_York" }`, `{ timeZone: ... }`, `{ timezoneId: ... }`.

**What works:** `{ country: "US", state: "NJ" }` → HTTP 200. EasyTeam derives the IANA timezone from country+state internally.

**Why:** When neither country nor state is set on a location, EasyTeam defaults to the partner account's timezone (Asia/Karachi in this project's case).

**How to apply:** Call `ensureLocationTimezone(locationId, { country, state })` in easyteam.ts. Runs at server startup (5s delay) for seeded locations. Admin endpoint `POST /api/easyteam/admin/patch-location-timezone` accepts `{ companyId, country, state }`.

**Multi-state:** Pass the two-letter US state abbreviation (NJ, CA, IL, etc.). EasyTeam maps it to the correct IANA timezone automatically.
