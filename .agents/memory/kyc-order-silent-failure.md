---
name: KYC before wage — silent failure path (FIXED)
description: Root cause + fix for KYC initiation failures at employee creation. initiateUserKyc is now HARD; rollfi.ts routes restructured to call wage before KYC; result no longer discarded.
---

## Rule
`addUserWage` must complete before `runEmployeeKycOnboarding` is called — specifically before step 4 (`initiateUserKyc`). Rollfi rejects `initiateUserKyc` when no wage record exists.

**Why:** Step 4 of KYC (`initiateUserKyc`) requires the employee to have a wage in Rollfi. The wizard route in rollfi.ts previously called `runEmployeeKycOnboarding` at line ~1765, then `addUserWage` at line ~1773 — wrong order. Step 4 failed silently (inner catch swallowed the error, logged WARN). The caller discarded the `{ kycInitiated: false }` return. The wizard responded `{ success: true }`. Result: employee had Rollfi user + wage + bank but `kycStatus: "not_started"` → Rollfi rejects at import with "invalid status."

**How to apply:**

### Two onboarding paths — both now fixed (July 2026):

1. **`POST /api/employees` → `syncEmployeeToIntegrations()` in rollfi-employee-sync.ts**
   - Lines 383-427: `addUserWage` (HARD, line 383) → `runEmployeeKycOnboarding` (line 414). 
   - This was ALREADY in correct order; `initiateUserKyc` upgraded to HARD.

2. **`POST /api/rollfi/onboard/employee` in rollfi.ts (was broken, now fixed)**
   - Normal path: was KYC at line 1765, wage at 1773. Fixed: wage first, then `runKycOnboardingNew`, result checked, `lastSyncError` written, `rollfiFailedSteps` returned in response.
   - Recovery path (`email already in use`): same fix — wage first, then `runKycOnboardingNew`.

### `initiateUserKyc` classification (rollfi-employee-sync.ts)
Was: `softWarnings.push(...)`. Now: `hardErrors.push(...)`. Reason: without successful KYC initiation the employee is payroll-ineligible (Rollfi "invalid status" at import). Any failure here must surface in the wizard's warning panel and block `rollfiOnboardedAt` from being set.

### Wizard response — no longer silent success
When `kycResult.hardErrors.length > 0`:
- `rollfiFailedSteps` included in response (triggers warning panel + Retry button)
- `lastSyncError` written to DB as `{ failedSteps, softWarnings }`
- `syncStatus: "error"` in DB
- Message: "Payroll account created but identity verification could not be started — this employee cannot be paid until it completes"
- `rollfiOnboardedAt` NOT set when hard failures present

### Wizard warning panel (client-employees-new.tsx)
- "Identity verification submitted" step is now conditional on absence of `initiateUserKyc` / `addKycInformation` in `rollfiFailedSteps`.
- Retry button calls `repair-onboarding` which uses `runKycOnboardingNew` (same hard/soft classification).

## Verified (2026-07-26 sandbox)
- KYC HourlyTest (`ADB3C221`): `kycStatus: "passed"`, `rollfiFailedSteps: []` ✓
- KYC SalaryTest (`3A54FB34`): `kycStatus: "passed"`, `rollfiFailedSteps: []` ✓
- Raymond Holt (`EDF5C474`): `kycStatus: "passed"` after `retry-kyc` ✓; live-status wrote `kycStatus: "passed"` back to DB.

## Note on `userStatus: "Invite Sent"` vs payroll enrollment
`kycStatus: "passed"` is necessary but not sufficient for payroll enrollment. Rollfi also requires `userStatus: "Active"` (employee must accept their invite). New sandbox employees show "Invite Sent" until activated in Rollfi's admin. This is separate from the KYC ordering bug.
