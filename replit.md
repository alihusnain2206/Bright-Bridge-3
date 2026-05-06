# BrightBridge — EasyTeam Embedded SDK Integration Test

Sandbox testing app for the EasyTeam Embedded SDK. Tests JWT auth (RS256), client/employee management, and EasyTeam iframe components (Time Clock, Timesheets, Schedule) for daycare center staff.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080, routed to `/api`)
- `pnpm --filter @workspace/brightbridge run dev` — Frontend (Vite React, routed to `/`)
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm run typecheck` — Full typecheck across all packages

**Required env vars:**
- `EASYTEAM_API_KEY` — RSA private key (PEM); may be stored without newlines — backend auto-normalizes
- `SESSION_SECRET` — Express session secret
- `EASYTEAM_PARTNER_ID` — Optional; enables full token exchange with EasyTeam sandbox (without it, raw JWT is used with amber warning)

## Stack

- **Monorepo**: pnpm workspaces
- **API**: Express 5 + Pino logging
- **Frontend**: React + Vite + Tailwind + shadcn/ui + wouter routing
- **ORM**: Drizzle + PostgreSQL
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod)
- **EasyTeam SDK**: `@easyteam/launcher` v1.1.19

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — Generated hooks (do not edit directly)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/store.ts` — In-memory client/employee store with seeded data
- `artifacts/brightbridge/src/pages/` — React pages
- `artifacts/brightbridge/src/hooks/useEasyTeamLauncher.ts` — EasyTeam SDK hook

## Architecture decisions

- **In-memory store**: Clients and employees live in `store.ts` (no DB needed for sandbox testing); seeded with "Sunshine Daycare Center" and 3 staff members on startup
- **PEM normalization**: `normalizePemKey()` in `easyteam.ts` handles PEM keys stored without newlines (common in env vars) by reformatting into 64-char lines
- **Token exchange fallback**: If the EasyTeam exchange endpoint fails (e.g. missing Partner ID), backend returns raw RS256 JWT with an amber `exchangeWarning` flag; frontend shows this gracefully
- **URL-param deep-linking**: Component pages accept `?clientId=&employeeId=` from the Clients page launch buttons; auto-launch fires once employee data loads (race-condition-safe via `useRef`)
- **Codegen pattern**: Hooks don't need explicit `query: { enabled }` — the generated hooks set `enabled: !!pathParam` automatically

## Product

- **Clients page** (`/clients`): Add/delete daycare centers and their staff; per-employee launch buttons that deep-link to the component pages
- **Time Clock** (`/timeclock`): Launches EasyTeam Time Clock iframe for a selected employee
- **Timesheets** (`/timesheets`): All-staff or individual employee timesheet view
- **Schedule** (`/schedule`): Weekly schedule for a client's staff
- **Webhooks** (`/webhooks`): Live log of incoming EasyTeam webhook events
- **Config** (`/config`): Shows API key status and SDK configuration details

## Gotchas

- After backend code changes, restart the `artifacts/api-server: API Server` workflow (esbuild rebuild required)
- EasyTeam sandbox URLs: `baseURL = "https://www.easyteam.io/sandbox/embed/iframe"`, exchange at `POST /sandbox/embed/api/auth/exchangeToken`
- The generated `useListClientEmployees(clientId)` hook already includes `enabled: !!clientId` — don't pass explicit `query.enabled`
