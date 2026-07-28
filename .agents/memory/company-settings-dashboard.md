---
name: Company Settings dashboard endpoint
description: Route mounting and URL for the GET /dashboard endpoint in company-settings.ts
---

## Rule
`companySettingsRouter` is mounted in `routes/index.ts` with **no path prefix** (`router.use(companySettingsRouter)`). All routes in that file are therefore at `/api/<route>`, not `/api/company-settings/<route>`.

## Consequence
- `GET /dashboard` → `/api/dashboard`
- `GET /state-registrations` → `/api/state-registrations`
- `GET /company-info` → `/api/company-info`
- Frontend must call `/api/dashboard`, not `/api/company-settings/dashboard`

**Why:** The frontend (settings-hub.tsx) already calls `/api/state-registrations/gaps` without the prefix, confirming this mounting. The confusion arises because the FILE is named `company-settings.ts` but the router has no matching path prefix.

**How to apply:** Any new route added to `company-settings.ts` is accessible at `/api/<routePath>`, not `/api/company-settings/<routePath>`.
