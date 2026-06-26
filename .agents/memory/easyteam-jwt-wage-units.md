---
name: EasyTeam JWT wage units
description: The `wage` claim in EasyTeam embed JWTs must be DOLLARS, not cents.
---

## Rule

The `wage` field in the RS256 JWT we mint for EasyTeam (token exchange / embed) must be in
**dollars** (e.g. `18` for $18.00/hr), NOT cents. Internally we store hourly wage in **cents**
(e.g. `1800`), so every JWT-minting path must divide by 100 before setting the claim.

There are three wage paths that must stay consistent (all DOLLARS):
- `POST /easyteam/token` (per-employee token exchange)
- boot EasyTeam sync (registers seeded/active employees)
- single-employee add sync (`syncEmployeeToIntegrations` → `registerEmployeeInEasyTeam`)

**Why:** EasyTeam interprets `wage` as a currency amount; passing cents (1800) shows a $1,800/hr
wage in the embedded Time Clock / Timesheets UI. The bug is silent — the token still validates and
the iframe still renders — so it only surfaces as wildly wrong dollar amounts.

**How to apply:** when adding any new EasyTeam JWT path, pass `wageCents / 100`. The internal
employee/store records remain in cents; only the EasyTeam-facing claim is converted.
