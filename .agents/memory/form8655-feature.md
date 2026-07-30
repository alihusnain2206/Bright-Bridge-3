---
name: Form 8655 e-sign feature
description: In-app IRS Form 8655 signing flow — architecture decisions, API shapes, deferred work
---

## What was built

Full Form 8655 in-app e-sign feature (uploadDocument deferred).

**New files:**
- `artifacts/api-server/src/lib/form8655.ts` — `getForm8655AuthDates()` + `buildForm8655Pdf()` (pdf-lib, standard fonts, ~2.9KB output, all content verified)
- `lib/db/src/schema/index.ts` — `companySignedForms` table added

**Modified files:**
- `artifacts/api-server/src/routes/company-settings.ts` — sign-8655 endpoint, pending-signatures updated, dashboard step 8 + attention item
- `artifacts/brightbridge/src/components/SignaturesSection.tsx` — full rewrite: Form8655Card (in-app e-sign) + ExternalLinkCard (TR-2000 etc.)

**DB table:** `company_signed_forms` — id, company_id, form_type, signer_name, signer_title, signed_at, upload_status, upload_error, rollfi_document_id, created_at. Unique constraint on (company_id, form_type).

## Confirmed Rollfi API shapes (sandbox, company 43A90BF7-B2BB-4BB5-A6F5-090306556DC4)

**getCompanyInfo** → `r.data.Company[0]`:
- `company` — company name (NOT `companyName`)
- `KYBInformations[0].ein` — EIN digits
- `KYBInformations[0].phoneNumber` — digits only
- `CompanyLocations[0].{address1, city, state, zipcode, country}`
- `BankAccounts[0]`, `PaySchedules[0]`, `StateTaxRegistrations[]`

**getBusinessUsers** → `r.data.BusinessUser[0]`:
- `firstName`, `lastName`, `businessUser` (full name), `email`, `phoneNumber`
- `beneficialOwner: true`, `payrollAdmin`, `bookKeeper`
- `address1`, `city`, `state`, `zipcode`, `ssn`, `dateOfBirth`
- No `title` field — signer provides their own title

## uploadDocument — CONFIRMED WORKING

**URL:** `POST ${baseUrl}/adminPortal/uploadDocument` (NOT `/reports#uploadDocument` — that always 400s)

**Request shape (confirmed against sandbox):**
```json
{ "method": "uploadDocument", "companyId": "<rollfiCompanyId>",
  "fileName": "Form8655_<name>_<YYYYMMDD>.pdf",
  "documentType": "8655Form", "fileBase64": "<base64>" }
```
For Company 8655: only `companyId` required (no `employeeId` or `payPeriodId`).

**Response 200:**
```json
{ "documentId": "<UUID>", "fileName": "...", "success": true, "message": "Document uploaded successfully" }
```

**Why `/reports` didn't work:** Rollfi routes document uploads through `/adminPortal/`, not `/reports`. The `#methodName` fragment pattern only applies to their reports/onboarding endpoints. Docs: https://developer.rollfi.xyz/api-reference/adminportal/uploadDocument

## PDF notes

- Standard fonts (HelveticaBold, Helvetica, HelveticaOblique) — no font embedding, ~2.9KB output
- Content streams are zlib-compressed — text appears as hex `<hex>` in raw bytes, not plain text
- Verified with zlib decompress + hex-decode: all 10 content fields confirmed present
- Size check threshold for tests: use >1500 bytes (not >10000 — that's for embedded-font PDFs)

## Dashboard changes

- Steps increased from 8 to 9: step 8 = "IRS Form 8655 signed", step 9 = "Ready to run payroll"
- `totalCount` in dashboard response is now 9
- `stepsAllDone` now requires `form8655Signed`
- Attention item added: id `form_8655_unsigned`, severity `high`, links to `/settings?tab=signatures`

## Rollfi auth header format

`Authorization: Basic base64(clientId:secretKey)` — NOT `clientId` / `secretKey` as separate headers.
