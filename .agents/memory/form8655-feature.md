---
name: Form 8655 e-sign feature
description: In-app IRS Form 8655 signing flow — architecture decisions, API shapes, deferred work
---

## What was built

Full Form 8655 in-app e-sign feature using the **official IRS Form 8655 fillable PDF** as the template.

**Key files:**
- `artifacts/api-server/src/lib/form8655.ts` — `getForm8655AuthDates()` + `buildForm8655Pdf()` using pdf-lib + official IRS AcroForm fields
- `artifacts/api-server/src/assets/f8655.pdf` — official IRS Form 8655 (Rev. Jan 2024), 85KB, embedded via esbuild `loader: {'.pdf': 'base64'}`
- `artifacts/api-server/src/types/assets.d.ts` — TypeScript declaration for `*.pdf` imports
- `lib/db/src/schema/index.ts` — `companySignedForms` table added
- `artifacts/api-server/build.mjs` — added `loader: { '.pdf': 'base64' }`

**Modified files:**
- `artifacts/api-server/src/routes/company-settings.ts` — sign-8655 endpoint, pending-signatures updated, dashboard step 8 + attention item
- `artifacts/brightbridge/src/components/SignaturesSection.tsx` — full rewrite: Form8655Card (in-app e-sign) + ExternalLinkCard (TR-2000 etc.)

**DB table:** `company_signed_forms` — id, company_id, form_type, signer_name, signer_title, signed_at, upload_status, upload_error, rollfi_document_id, created_at. Unique constraint on (company_id, form_type).

## AcroForm field mapping (official IRS f8655.pdf, Rev. Jan 2024)

All 42 fields are on Page1, sorted top→bottom. Key mappings:

| Field | y | Line | Value |
|---|---|---|---|
| f1_01 | 672 | 1a Taxpayer name | company name |
| f1_03 | 672 | 2 Taxpayer EIN | formatted EIN |
| f1_02 | 648 | 1b Trade name | blank |
| f1_04 | 624 | 3 Street address | |
| c1_1  | 651 | 4 Seasonal checkbox | unchecked |
| f1_06 | 624 | 5 Other ID | blank |
| f1_05 | 600 | 3 City/state/ZIP | |
| f1_07 | 576 | 6 Contact | blank (no separate field) |
| f1_08 | 576 | 7 Phone | taxpayer phone |
| f1_09 | 576 | 8 Fax | blank |
| f1_10 | 540 | 9 Agent name | "Rollfi, Inc" |
| f1_11 | 540 | 10 Agent EIN | "87-3373107" |
| f1_12 | 516 | 11 Agent address | "169 Maddison Ave #2351" |
| f1_13 | 492 | 11 Agent city/state/ZIP | "New York, NY 10016" |
| f1_14 | 468 | 12 Agent contact | "Perumalsamy Ramakrishnan" |
| f1_15 | 468 | 13 Agent phone | "(408) 582 4650" |
| f1_16 | 468 | 14 Agent fax | "1-646-849-4046" |
| f1_17 | 408 | L15 940 | annual940 (YYYY) |
| f1_18 | 408 | L15 941 | quarterly941 (YYYY/MM) |
| f1_19–f1_23 | 408–396 | L15 943/944/945/… | blank |
| f1_24 | 336 | L16 940 (x=173) | annual940 |
| f1_25 | 336 | L16 941 (x=259) | quarterly941 |
| f1_26–f1_35 | 336–324 | L16 others | blank |
| f1_36 | 240 | Line 18a — W-2 disclosure auth year | annual940 (e.g. "2026") |
| f1_37 | 216 | Line 18b — 1099 disclosure | blank (Rollfi does payroll, not 1099) |
| f1_38 | 192 | Line 18c — 3921/3922 disclosure | blank |
| c1_2  | 279 | Line 17 — duplicate notices checkbox | checked |
| c1_3  | 170 | Line 19 — state/local auth checkbox | checked |
| f1_39 | 60  | Footer area | blank |

**Sign Here section** — no AcroForm fields (XFA-only), filled via `drawText` overlay:
- Signer name:  x=50,  y=70, size=10, bold
- Title:        x=322, y=70, size=9
- Date:         x=466, y=70, size=9
y=83 lands on the "I certify…" certification text (wrong). y=70 lands on the actual signing lines. Verified via pdftoppm render + screenshot.

## getForm8655AuthDates — return type (updated)

```typescript
{ annual940: string, quarterly941: string }
// NOT { annualYear, quarterlyBeginMonth } — those old names are gone
```

- `annual940`: YYYY (e.g. "2026")
- `quarterly941`: YYYY/MM where MM is the **last month** of the current quarter
  - Q3 Jul 30 2026 → "2026/09"  (not "July 2026", not "2026/07")

**Why:** IRS Form 8655 line 15 940 blank uses YYYY; 941 blank uses YYYY/MM with the last month of the authorization quarter. Both line 15 and line 16 receive the same two values.

## Confirmed Rollfi API shapes (sandbox, company 43A90BF7-B2BB-4BB5-A6F5-090306556DC4)

**getCompanyInfo** → `r.data.Company[0]`:
- `company` — company name (NOT `companyName`)
- `KYBInformations[0].ein` — EIN digits
- `KYBInformations[0].phoneNumber` — digits only
- `CompanyLocations[0].{address1, city, state, zipcode, country}`

**getBusinessUsers** → `r.data.BusinessUser[0]`:
- `firstName`, `lastName`, `businessUser` (full name), `email`, `phoneNumber`
- No `title` field — signer provides their own title

## uploadDocument — CONFIRMED WORKING

**URL:** `POST ${baseUrl}/adminPortal/uploadDocument`

**Request shape:**
```json
{ "method": "uploadDocument", "companyId": "<rollfiCompanyId>",
  "fileName": "Form8655_<name>_<YYYYMMDD>.pdf",
  "documentType": "8655Form", "fileBase64": "<base64>" }
```

**Response 200:**
```json
{ "documentId": "<UUID>", "fileName": "...", "success": true }
```

## PDF implementation notes

- Official IRS form (f8655.pdf) embedded via esbuild `loader: {'.pdf': 'base64'}` — no runtime file I/O needed
- XFA layer is stripped by pdf-lib (harmless warning); the AcroForm fallback layer has all 42 fields
- `form.flatten()` called before `doc.save()` — bakes values in, prevents editing
- Output is ~95KB (original 85KB + filled content)
- End-to-end tested: upload returns `uploadStatus: "uploaded"` + Rollfi documentId on first call

## Dashboard changes

- Steps increased from 8 to 9: step 8 = "IRS Form 8655 signed", step 9 = "Ready to run payroll"
- `totalCount` in dashboard response is now 9
- `stepsAllDone` now requires `form8655Signed`
- Attention item added: id `form_8655_unsigned`, severity `high`, links to `/settings?tab=signatures`

## Rollfi auth header format

`Authorization: Basic base64(clientId:secretKey)` — NOT `clientId` / `secretKey` as separate headers.
