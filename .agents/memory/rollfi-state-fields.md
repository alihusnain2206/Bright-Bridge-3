---
name: Rollfi state registration field names
description: Rollfi companyStateRegistration requires exact state-specific field name strings; Rollfi returns HTTP 200 with error body on failure (not 4xx).
---

## The problem

`addStateRegistrationInfo` requires a `companyStateRegistration` object where keys are **exact UI label strings** that differ per state. Wrong key → `{"error": {"code": 400, "message": "Invalid tax item name: <key>"}}` returned as HTTP 200 (not a 4xx).

## Detection

Always check `response.data?.error` after a 2xx from Rollfi. The false-success pattern caused registrations to be marked "active" locally while Rollfi never actually saved them.

## Confirmed field names (from Rollfi portal screenshots)

| State | Field name | Maps to |
|-------|-----------|---------|
| AL | "Unemployment Rate" | suiRate |
| AL | "Withholding Tax Account Number" | stateEmployerId |
| AL | "UC Account Number" | suiAccountNumber |
| NY | "Unemployment Rate" | suiRate |
| NY | "Employer Registration Number" | stateEmployerId |
| NY | "Withholding ID Number" | suiAccountNumber |
| NJ | "Unemployment Rate" | suiRate |
| NJ | "NJ Employer Registration Number" | stateEmployerId |
| NJ | "NJ Department of Labor Account Number" | suiAccountNumber |
| NJ | "Disability Rate" | hardcoded "0.5" (not captured in our form) |

## Where the mapping lives

`artifacts/api-server/src/lib/rollfi-state-fields.ts` — `STATE_FIELD_MAP` and `buildStateRegistrationPayload()`.
Both `routes/rollfi.ts` and `routes/companies.ts` import and call `buildStateRegistrationPayload()`.
Add new states here as they are confirmed from the Rollfi portal.

**Why:** The Rollfi API is undocumented for field names — the only reliable source is their own portal UI. Each state's form shows the exact string keys required.
