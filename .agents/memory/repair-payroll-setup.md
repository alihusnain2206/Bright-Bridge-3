---
name: Repair Payroll Setup endpoint
description: POST /rollfi/repair/employee-payroll-setup — live-detects missing KYC/bank steps for imported employees and runs only what's needed. SSN cleared after successful initiateUserKyc in production.
---

## The endpoint

`POST /rollfi/repair/employee-payroll-setup` in `artifacts/api-server/src/routes/rollfi.ts`

## Detection logic

Uses `getUsers` (read-only) to fetch live kycStatus + userStatus from Rollfi BEFORE running anything.

Rollfi's kycStatus after `initiateUserKyc` has been called:
- `not_started` | `pending` | `passed` | `failed` | `approved` | `verified` → KYC initiated (both addKycInformation + initiateUserKyc done)
- null or `"kyc not initiated"` → KYC steps needed

If live kycStatus is in the "initiated" set AND no bank credentials provided → returns `alreadyComplete: true` without any write calls.

## Steps run

A. `addKycInformation` — attempted when kycStatus shows nothing done; "already exists" treated as success (safe for Alexandra whose KYC data already exists in Rollfi from import)
B. `initiateUserKyc` — runs after A succeeds; KYB failure surfaced as user-friendly message
C. `addUserBankAccount` — only runs when `accountNumber + routingNumber` provided in request body

## SSN handling

After successful `initiateUserKyc` in production, SSN is immediately cleared from our DB (`ssn = null`). Rollfi holds it from that point. This is logged explicitly.

## Address warning

If `homeAddress` contains a 5-digit zip pattern (`\b\d{5}\b`) or comma, the backend logs a warning and the frontend modal shows a blocking warning (disables "Run Setup" button) with a "Fix address first →" link.

## Frontend

`PayrollSetupModal` component in `artifacts/brightbridge/src/pages/employee-profile.tsx` (defined before `PayrollReadinessPanel`).

"Complete Payroll Setup" button (wrench icon) in `PayrollReadinessPanel` Provider Verification section. Visible when:
- `emp.rollfiUserId` is set
- `accountStatus !== "Active"`
- `user.role === "owner" || user.role === "super_admin"`

**Important JSX gotcha**: The modal must be rendered INSIDE the outer panel `<div>` (not as a sibling after it closes). Attempting a fragment `<>...</>` or sibling placement after `</div>` causes Babel parse errors. Since the modal uses `position: fixed`, DOM placement inside the panel div doesn't affect layout.

## Per-employee state (production, as of July 2026)

- **Joanne Indviglio**: bank verifying in Rollfi → should detect as `alreadyComplete` (no write calls)
- **Agnes Johnson**: kycStatus=passed, needs bank only
- **Alexandra Indiviglio**: Rollfi has KYC data from import, needs only `initiateUserKyc` + bank
- **Arisleyda Reyes Lopez**: needs full chain; SSN + DOB now in production DB; address needs fix first (remove embedded city/zip from homeAddress field)
