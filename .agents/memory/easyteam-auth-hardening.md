---
name: EasyTeam auth hardening
description: Role + company-scope guards added to the 8 previously-unguarded easyteam.ts endpoints (August 2026).
---

## The fix

All 8 previously `requireAuth`-only endpoints in `easyteam.ts` were audited and hardened.

**Role applied (super_admin, owner, manager):**
- GET /easyteam/employees
- GET /easyteam/timesheets (stub — no data, but consistent)
- GET /easyteam/company-members
- GET /easyteam/hours
- POST /easyteam/hours/approve
- GET /timesheets/trend

**Kept requireAuth (employees need these for time clock):**
- POST /easyteam/token — but company-scope added: non-super_admin cannot request a token for a different company's client_id
- GET /easyteam/status — no company data, just API config

## Company-scoping pattern

For endpoints where owner/manager supply a companyId param:
- `assertCompanyAccess(req, res, companyId)` blocks cross-company calls → 403
- For `/easyteam/employees` and `/easyteam/hours` where companyId is optional: non-super_admin always gets their session companyId; the query param is **ignored** (overridden silently, not errored) — this prevents param injection while keeping the API interface simple.

**Why:** Silent override rather than 403 on bad param keeps client code simpler — the owner always gets their own data regardless of what companyId the frontend sends.

## Token endpoint scoping

`POST /easyteam/token` resolves `requestedCompanyId = client_id ?? company_id`. For non-super_admin, `assertCompanyAccess` is called on that value before any JWT is issued. Employee calling with a different company's client_id → 403 "Access denied: company mismatch".

## Confirmed attack results (post-fix)

All attacks → 403 or scoped-to-session data:
- Employee → any protected endpoint: 403
- Employee → /easyteam/token with wrong company: 403
- Owner A → /easyteam/hours/approve for Company B: 403
- Owner A → /easyteam/employees?companyId=CompanyB: HTTP 200 but returns Owner A's own employees (session-scoped override)
