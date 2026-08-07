---
name: people.ts security guards
description: All 33 routes in people.ts are now role-guarded and company-scoped. Documents the pattern used and the two special cases.
---

## Rule
Every route in `artifacts/api-server/src/routes/people.ts` now carries:
1. `requireRole("super_admin", "owner", "manager")` as Express middleware (exception: `/compliance/:id/waive` is `super_admin` + `owner` only — no manager)
2. An `assertCompanyAccess(req, res, <companyId>)` call inside the handler, drawing companyId from the already-fetched resource row (no extra queries), except for three cases below.

**Why:** All five people tables (onboardingTasks, complianceItems, employeeDocuments, emergencyContacts, peopleActivityLog) carry `companyId` directly on every row. Resource rows are already fetched for 404 checks, so company comparison is zero-cost in most cases.

## Helpers added to people.ts
- `resolveEmployeeCompany(employeeId)` — single `SELECT companyId FROM employees WHERE id = :id`. Used when only an `employeeId` query param is present (GET /documents, GET /emergency-contacts, GET /compliance, GET /onboarding-tasks with employeeId, GET /employees/:id/photo).
- Import of `requireRole` and `assertCompanyAccess` from `../lib/auth-middleware.js`.

## New DB queries (unavoidable)
- `GET /employees/:id/photo` — filesystem-only route; no employee row was read previously. Added `resolveEmployeeCompany` lookup before serving the file.
- `PUT /documents/:id`, `DELETE /documents/:id`, `PUT /emergency-contacts/:id`, `DELETE /emergency-contacts/:id` — previously did update-first with no pre-fetch. Added a SELECT before the write to get companyId for the ownership check.
- `GET /compliance`, `GET /onboarding-tasks` (employeeId path), `GET /emergency-contacts`, `GET /documents` (employeeId path) — `resolveEmployeeCompany` call (all pre-existing query paths; one extra single-column SELECT).

## Departments (in-memory store)
`store.getDepartments(companyId)` and `store.getDepartmentById(id)` both expose `companyId` on the returned Department object. For GET/POST, the caller-supplied `companyId` is verified with `assertCompanyAccess`. For PUT/DELETE, the stored `dept.companyId` is used — same pattern as DB-backed routes.

## What was NOT changed
- No handler business logic, response shapes, or status codes other than the added 403 paths.
- No frontend files.
- No other route files (rollfi.ts, easyteam.ts, companies.ts, clients.ts untouched by these two tasks).

**How to apply:** Any new route added to people.ts must follow the same two-step pattern: `requireRole` middleware + `assertCompanyAccess` after the first resource fetch.
