---
name: Rollfi updateCompanyLocation endpoint
description: Correct endpoint, payload structure, and known 500 bug for updating company address via Rollfi API
---

# Rollfi updateCompanyLocation

## Correct endpoint
`POST https://api.brightbridge.rollfi.xyz/adminPortal/updateCompanyLocation`

**Why:** `/companyOnboarding#updateCompanyLocation` is rejected at the gateway with HTTP 400 + empty body before reaching Rollfi's application. The `adminPortal` path-style routing (same as `updateStateRegistrationInfo`) is the correct pattern for update operations.

## Correct payload structure (flat, no wrapper)
```json
{
  "method": "updateCompanyLocation",
  "companyId": "...",
  "companyLocationId": "...",
  "address1": "...",
  "city": "...",
  "state": "NY",
  "zipcode": "...",
  "phoneNumber": "..."
}
```

**Why flat:** Fields go at the top level alongside `method`, same as other adminPortal endpoints.

**Do NOT include:**
- `country: "US"` — causes gateway 400
- `isWorkLocation / isMailingAddress / isFilingAddress` — these are create-time-only flags; including them on an update causes Rollfi HTTP 500

## Known Rollfi bug (as of 2026-08-06)
Even with the correct endpoint and payload, Rollfi returns HTTP 500 "Internal server error. Call log id: XXXXX" for company `5919B697-81C9-4225-8810-8BD543436F5C`. Log IDs reported: 17104, 17111, 17113, 17201. Rollfi support contacted with these IDs.

**How to apply:** When the Rollfi support ticket resolves, test with the payload above. No code changes needed — the endpoint and payload in `artifacts/api-server/src/routes/company-settings.ts` PUT /company-info/location are already correct.

## companyLocationId resolution
The live `getCompanyLocationInfo` pre-fetch (added to the handler) confirmed `F9F1F179-171C-436B-8FEA-133EAD1BA43D` is the correct Rollfi companyLocationID for Urban Concepts. The stored `companies.rollfiLocationId` matches.
