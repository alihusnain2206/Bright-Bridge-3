---
name: Rollfi updateCompanyLocation endpoint
description: Correct endpoint, payload structure for updating company address via Rollfi API
---

# Rollfi updateCompanyLocation

## Correct endpoint
`POST https://api.brightbridge.rollfi.xyz/adminPortal/updateCompanyLocation`

**Why:** `/companyOnboarding#updateCompanyLocation` is rejected at the gateway with HTTP 400 + empty body before reaching Rollfi's application. The `adminPortal` path-style routing (same as `updateStateRegistrationInfo`) is the correct pattern for update operations.

## Correct payload structure — fields nested inside `companyLocation`
```json
{
  "method": "updateCompanyLocation",
  "companyLocation": {
    "companyLocationId": "...",
    "address1": "...",
    "city": "...",
    "state": "NY",
    "zipcode": "...",
    "phoneNumber": "..."
  }
}
```

**Why nested:** Rollfi support confirmed (2026-08-06) that the payload must be nested inside a `companyLocation` object. Sending a flat body causes HTTP 500 on their side. `companyId` is NOT required.

**Do NOT include:**
- `country: "US"` — causes gateway 400
- `isWorkLocation / isMailingAddress / isFilingAddress` — create-time-only flags; including them on an update causes Rollfi HTTP 500

## companyLocationId resolution
The live `getCompanyLocationInfo` pre-fetch (added to the handler) confirmed `F9F1F179-171C-436B-8FEA-133EAD1BA43D` is the correct Rollfi companyLocationID for Urban Concepts. The stored `companies.rollfiLocationId` matches.
