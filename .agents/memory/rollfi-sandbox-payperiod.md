---
name: Rollfi sandbox pay period and KYB quirks
description: Key constraints when using Rollfi sandbox for payroll flow testing
---

# Rollfi Sandbox: Pay Period & KYB Constraints

## Rule 1: Use `getUnProcessedPayPeriod` instead of `getPayPeriod`
`getPayPeriod` returns "Company onboarding incomplete: bank account not linked" even when a pay schedule is active. `getUnProcessedPayPeriod` (POST to `/reports#getUnProcessedPayPeriod`) returns the same `payPeriodId` without requiring a bank account link. Returns `{ unprocessedPayPeriods: [...] }` — pick the most recent by `payBeginDate`.

**Why:** `getPayPeriod` has a hard gate on bank account status. `getUnProcessedPayPeriod` is a read-only reports endpoint with no such gate.

## Rule 2: Rollfi sandbox KYB always fails for synthetic test data
`createBusiness` submits KYB data inline. Rollfi's sandbox tries to verify the EIN against real business records — fake test EINs fail. Result: `kybStatus: "failed"` which blocks `addCompanyBankAccount` ("KYB is not initiated") and `initiatePayroll` ("KYB verification must be completed and approved"). This is a sandbox-only limitation; production uses real business data.

**How to detect:** Call `GET /reports#getCompanyTask` — look for task `"KYB verification"` with description containing "failed".

## Rule 3: `addKybInformation` fails with "Ein already in use" on recovered companies
Since `createBusiness` includes KYB data inline, calling `addKybInformation` separately on the same company returns "Ein already in use". `initiateCompanyKyb` still returns "KYB Verification Initiated" but the underlying status stays "failed" — the 3-second delay workaround does NOT help.

## Rule 4: Pay schedule setup works and creates real unprocessed periods
`addPaySchedule` (BiWeekly W2, payBeginDate = today-14d, payDate = tomorrow, paymentMode = "Self-Initiated") succeeds and creates real pay periods. Confirmed via `getCompanyTask` showing "Run Payroll: Overdue..." and `getUnProcessedPayPeriod` returning a real `payPeriodId`.

## Rule 5: `getUsers` not `getActiveUsers` for employee recovery
Sandbox users stay in "Add Wage" status, so `getActiveUsers` returns empty. Use `getUsers` (POST `/userPortal#getUsers`, body `{ method: "getUsers", companyId }`) to recover existing users.

## Rollfi Sandbox base URL
`https://sandbox.rollfi.xyz` — auth: Basic base64(ROLLFI_CLIENT_ID:ROLLFI_SECRET_KEY).
Silent error pattern: HTTP 200 with `{ error: { code, message } }` body — always call `assertNoRollfiError`.
