---
name: Platform roles and login DB fallback
description: New "technical"/"super_manager" roles, platform account management, and DB-fallback login path added to auth system.
---

## New roles
- `"technical"` and `"super_manager"` added to `UserRole` in `store.ts` and `useAuth.tsx`.
- Both roles land at `/support-admin` (placeholder) via `dashboardPath()`; neither is in any `requireRole` call site.
- Sidebar: shows only "Support Tickets" (`/support-admin`) for these roles.
- `assertCompanyAccess` intentionally NOT updated — these roles are company-scoped to their own companyId (empty string).

## Login DB fallback (auth.ts POST /auth/login + GET /auth/me)
- In-memory `store.getUserByEmail` checked FIRST (unchanged for all existing accounts).
- If miss: falls back to `user_accounts` DB query by email, bcrypt-only comparison.
- On hit: calls `store.addTestUser(dbUser)` to populate in-memory for subsequent `getUserById` calls.
- DB-fallback accounts must have a bcrypt hash (not plaintext) — enforced by the fallback branch.
- Same fallback pattern added to `/auth/me` (by id).

## isActive column
- `user_accounts.is_active BOOLEAN NOT NULL DEFAULT TRUE` added to DB and Drizzle schema.
- `store.getUserByEmail` and `store.getUserById` return `undefined` when `isActive === false`.
- `PATCH /api/admin/platform-users/:id` syncs both DB and in-memory entry immediately on deactivate/reactivate.

## Platform account management endpoints
- `POST /api/admin/platform-users` — creates account with `companyId = null` in DB, pushes to store immediately.
  - Checks both in-memory store AND DB for email conflicts (covers deactivated accounts).
  - Returns `tempPassword` once (bcrypt-hashed in DB, never logged).
  - IDs prefixed `PLAT-` (e.g. `PLAT-8575F7AC319C`).
- `GET /api/admin/platform-users` — lists rows where `companyId IS NULL`.
- `PATCH /api/admin/platform-users/:id` — isActive, role, resetPassword (returns new tempPassword once).

## Ali Husnain platform account
- Email: `ali@brightbridgeassist.com`, role: `technical`, id: `PLAT-8575F7AC319C`
- Created via new endpoint. DB row exists; survives restart.
- `ali@rainbow.com` is the old test account (still hardcoded testUsers) — kept separate.

**Why:** Boot loads DB rows via `loadUserAccountsFromDb()` → `store.addTestUser()`, but newly-created accounts in the same session need the DB fallback to be reachable across processes/instances.
