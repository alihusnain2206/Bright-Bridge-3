# BrightBridge — EasyTeam Embedded SDK Integration Test

Sandbox testing app for the EasyTeam Embedded SDK. Tests JWT auth (RS256), role-based access, and EasyTeam iframe components (Time Clock, Timesheets, Schedule) for daycare center staff.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080, routed to `/api`)
- `pnpm --filter @workspace/brightbridge run dev` — Frontend (Vite React, routed to `/`)
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm run typecheck` — Full typecheck across all packages

**Required env vars:**
- `EASYTEAM_API_KEY` — RSA private key (PEM); may be stored without newlines — backend auto-normalizes
- `SESSION_SECRET` — Express session secret (used by express-session)
- `EASYTEAM_PARTNER_ID` — Optional; enables full token exchange with EasyTeam sandbox

## Stack

- **Monorepo**: pnpm workspaces
- **API**: Express 5 + express-session + Pino logging
- **Frontend**: React + Vite + Tailwind + shadcn/ui + wouter routing
- **ORM**: Drizzle + PostgreSQL
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod)
- **EasyTeam SDK**: `@easyteam/launcher` v1.1.19

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — Generated hooks (do not edit directly)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/routes/auth.ts` — Login/logout/me + role-based JWT generation
- `artifacts/api-server/src/store.ts` — In-memory store: clients, employees, testUsers, companies, locations, children
- `artifacts/brightbridge/src/hooks/useAuth.tsx` — Auth context (login, logout, user state)
- `artifacts/brightbridge/src/pages/` — React pages including 4 role dashboards
- `artifacts/brightbridge/src/hooks/useEasyTeamLauncher.ts` — EasyTeam SDK hook

## Architecture decisions

- **In-memory store**: Clients, employees, testUsers, companies, locations, children all live in `store.ts`; seeded on startup
- **Session auth**: Cookie-based sessions via `express-session` (SESSION_SECRET). `req.session.userId` set on login. Frontend calls `/api/auth/me` on mount via `useAuth` context.
- **Role-based JWTs**: `POST /api/auth/token-by-role` generates different RS256 JWTs per role (admin/manager/employee). Parents get no JWT.
- **PEM normalization**: `normalizePemKey()` handles PEM keys stored without newlines (common in env vars)
- **Token exchange fallback**: If EasyTeam exchange endpoint fails, raw RS256 JWT is returned with `exchangeWarning` flag; frontend shows amber warning
- **Role dashboards**: Each role routes to its own standalone page (`/dashboard/super-admin`, `/dashboard/manager`, `/dashboard/employee`, `/dashboard/parent`) — no shared layout

## Product

- **Login** (`/login`): Email+password form + quick-login buttons for all 7 test users
- **Roles** (`/roles`): Comparison table + quick-login buttons for each role
- **Super Admin** (`/dashboard/super-admin`): Full EasyTeam access, all companies, all staff
- **Manager** (`/dashboard/manager`): Company-scoped EasyTeam view + access comparison
- **Employee** (`/dashboard/employee`): Own time clock only + access comparison
- **Parent** (`/dashboard/parent`): Custom child check-in (Emma & Liam) with camera; no EasyTeam
- **Clients** (`/clients`): Manage daycare centers and staff (super_admin only)
- **Time Clock / Timesheets / Schedule / Webhooks / Config** — EasyTeam iframes (super_admin only)

## Test Credentials

| Role | Name | Email | Password |
|------|------|-------|----------|
| Super Admin | Joanne Indiviglio | joanne@brightbridgeassist.com | Admin123! |
| Manager (Sunshine) | Susan Manager | manager@sunshine.com | Manager123! |
| Manager (Rainbow) | Mike Manager | manager@rainbow.com | Manager123! |
| Employee (Sunshine) | John Smith | john@sunshine.com | Staff123! |
| Employee (Sunshine) | Mary Johnson | mary@sunshine.com | Staff123! |
| Employee (Rainbow) | Tom Wilson | tom@rainbow.com | Staff123! |
| Employee (Rainbow) | Ali Husnain | ali@rainbow.com | Staff123! |
| Employee (Rainbow) | Lisa Chen | lisa.chen@rainbow.com | Staff123! |
| Employee (Rainbow) | Arbab Nasir | arbab@rainbow.com | Staff123! |
| Parent | Sarah Parent | sarah@parent.com | Parent123! |

## Gotchas

- After backend code changes, restart the `artifacts/api-server: API Server` workflow (esbuild rebuild required)
- EasyTeam sandbox URLs: `baseURL = "https://www.easyteam.io/sandbox/embed/iframe"`, exchange at `POST /sandbox/embed/api/auth/exchangeToken`
- Dashboard pages (`/dashboard/*`) are standalone pages without AppLayout — they have their own nav
- `express-session` requires `credentials: "include"` on all frontend fetch calls to the API
- Role dashboards redirect non-matching roles to their correct dashboard on access attempt
