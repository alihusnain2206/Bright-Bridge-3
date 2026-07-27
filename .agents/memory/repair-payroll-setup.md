---
name: Repair Payroll Setup endpoint
description: POST /rollfi/repair/employee-payroll-setup — live-detects missing KYC/bank steps for imported employees and runs only what's needed. GET /rollfi/repair/preflight-status for modal pre-check.
---

## Endpoints

- `POST /rollfi/repair/employee-payroll-setup` — runs the missing steps
- `GET /rollfi/repair/preflight-status?employeeId=...` — read-only, called by modal on open

Both are in `artifacts/api-server/src/routes/rollfi.ts`. Auth: `owner` or `super_admin` only.

## Detection (getUsers live check)

`getUsers` fields captured per user: `kycStatus`, `status.userStatus`, `isTermsAccepted`, `bankAccounts[]`.

- `kycAlreadyInitiated` = kycStatus ∈ `{not_started, pending, passed, failed, approved, verified}`
- `liveHasBankInRollfi` = `bankAccounts.length > 0`
- `liveIsTermsAccepted` = `isTermsAccepted ?? false`

## alreadyComplete logic

- `alreadyComplete: true` → `!needsKycSteps && hasBankInRollfi && !hasBankCreds`
- `needsBankAccount: true` → `!needsKycSteps && !hasBankInRollfi && !hasBankCreds` (KYC done but bank missing — modal should prompt)
- Otherwise proceed to run steps

## Step order (matches wizard: acceptTerms → addKyc → initiateKyc → addBank)

- **Step A** `acceptTermsAndCondition` (SOFT) — skip API call if `liveIsTermsAccepted`, record as `already_done`. Must run before `initiateUserKyc`.
- **Step B** `addKycInformation` — "already exists" treated as `already_done` (safe for Alexandra)
- **Step C** `initiateUserKyc` (HARD) — KYB failure surfaced clearly; SSN cleared from DB after success in production
- **Step D** `addUserBankAccount` — only when `accountNumber + routingNumber` provided

## Wizard steps NOT in repair (intentionally omitted)

`addW4Information` and `addStateW4Information` — imported employees already have W4 in Rollfi directly; we don't have their W4 data and calling these could cause unintended overwrites.

## Phone number sync fix

`syncEmployeeToRollfi` in `people.ts`: phone must be digits-only before sending to Rollfi — strip with `.replace(/\D/g, "")` for both `updateUser.phoneNumber` and `updateKycInformation.phoneNumber`. Both calls also check `extractRollfiError(r.data)` now (Rollfi 200+error-body pattern).

## Frontend modal (`PayrollSetupModal` in employee-profile.tsx)

Phase machine: `loading → ready → running → done | error`

On mount (`useEffect`), calls `GET /api/rollfi/repair/preflight-status`. Preflight result drives:
- Bank section: shows "on file ✓" if `hasBankInRollfi`, shows form with amber warning if not
- Preflight status summary: shows KYC + bank status before user runs anything
- `skipBank` pre-set to `true` when `hasBankInRollfi`

**JSX gotcha**: Modal must render INSIDE the outer panel `<div>`, not as a sibling. Fragment `<>` causes Babel parse errors here; `position: fixed` means DOM placement doesn't affect layout.

## Production outcomes (Arisleyda, July 2026)

Steps ran: `addKycInformation (already_done)` → `acceptTermsAndCondition (success)` → `initiateUserKyc (success)`. Final kycStatus: `passed`. SSN cleared from DB. Still needs bank account (Agnes and Alexandra also need bank).
