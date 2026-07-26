---
name: KYC before wage — silent failure path
description: The new-employee wizard calls runEmployeeKycOnboarding BEFORE addUserWage, causing initiateUserKyc to fail silently; employees appear onboarded but are ineligible for payroll.
---

## Rule
`addUserWage` must be called and confirmed before `runEmployeeKycOnboarding` — specifically before step 4 (`initiateUserKyc`). Rollfi rejects `initiateUserKyc` when no wage record exists.

**Why:** Step 4 of KYC (`initiateUserKyc`) requires the employee to have a wage in Rollfi. The current wizard route (rollfi.ts) calls `runEmployeeKycOnboarding` at line ~1765, then `addUserWage` at line ~1773 — wrong order. Step 4 fails silently (inner catch swallows the error, logs WARN). The caller ignores the `{ kycInitiated: false }` return. The wizard responds `{ success: true }`.

Result: employee has Rollfi user + wage + bank but `kycStatus: "not_started"` and `rollfiAccountStatus: null` in our DB → Rollfi rejects them at import time with "Employee has an invalid status that prevents payroll processing."

**How to apply:** In the new-employee onboarding route (rollfi.ts ~line 1721):
1. Call `addUserWage` first (and confirm no error).
2. Call `persistRollfiEmployee` to store the rollfiUserId + wageId.
3. Then call `runEmployeeKycOnboarding`.

Same fix needed in the recovery path (~line 1845): KYC currently also runs before the recovery `addUserWage`.

Consider surfacing `kycInitiated` in the wizard response so the UI can flag employees needing a KYC retry, rather than silently reporting success.

**Known case:** Raymond Holt (EDF5C474-EAD4-470A-A4E6-F3461BEAEBDE, ORG-SUNSHINE) — bank added, wage added, KYC never initiated. Enrolled from payroll import gives "invalid status". As of 2026-07-26.
