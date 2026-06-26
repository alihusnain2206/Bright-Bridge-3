---
name: /clients is a legacy contract shim over the unified companies model
description: The /clients* endpoints are kept only for HTTP/Zod contract stability; they are backed by DB companies/employees, with clientId == companyId.
---

# /clients is a legacy contract shim over companies

The in-memory `Client`/`ClientEmployee` layer was merged into the unified DB
`companies` + `employees` model. The `/clients*` routes were kept as a thin shim:
a "client" *is* a company, so `clientId === companyId`, and handlers project DB
company/employee rows back into the legacy Client/ClientEmployee JSON shape.

**Why:** The OpenAPI spec + generated React Query hooks (`useCreateClient`,
`useDeleteClient`, `useListClients`, `useListClientEmployees`) are a published
contract that must stay stable (no OpenAPI regen). Removing `POST /clients` /
`DELETE /clients/:clientId` breaks those hooks even though the in-app wizard
actually creates companies via `POST /api/companies`.

**How to apply:** When touching `/clients*`, preserve request/response shapes and
status codes. Back everything with DB `companies`/`employees`. Do not drop the
`client_employee_records` table (data-retention). Cosmetic drift is acceptable
where the DB lacks columns (e.g. POST /clients ignores latitude/longitude/timezone
because `companies` has no such columns; the projection fills defaults).
