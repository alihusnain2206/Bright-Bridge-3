---
name: Rollfi employee onboarding flow
description: The 5-step KYC sequence required to move an employee from "Invite Sent" to "Active" so they can be included in payroll
---

## The problem
After `addUser`, employees land in "Invite Sent" status. `addUsersToRegularPayPeriod` rejects them with "Employee has an invalid status that prevents payroll processing". Neither `activateUser` nor wages alone fix this — full onboarding must be completed programmatically.

## Required steps (in order)

1. `PUT /userOnboarding#acceptTermsAndCondition` — body: `{ method, userId }`
2. `POST /userOnboarding#addKycInformation` — body: `{ method, kycInformation: { userId, ssn, dateOfBirth, address1, address2, city, state, zipcode } }`
   - SSN must be **raw 9 digits, no dashes** (despite the example showing `659-89-9874`)
   - "KYC information already exists" on re-run = treat as success
3. `POST /userOnboarding#addW4Information` — body: `{ method, w4Information: { userId, w4FilingStatus: "Single", ... } }`
   - "W4Information already exists" on re-run = benign
4. `POST /userOnboarding#initiateUserKyc` — body: `{ method, userId }` — only run if step 2 succeeded or "already exists"
   - In sandbox, KYC auto-approves (`kycStatus: "passed"`) relatively quickly
5. `POST /userPortal#addUserBankAccount` — body: `{ method, linkType: "Manual", userPayAccountEntity: { companyId, userId, accountNumber, routingNumber, bankName, accountType, accountName } }`
   - **This is the final activation gate**: without a bank account, Direct Deposit employees never flip to "Active" even with `kycStatus: "passed"`
   - Returns `status: "pending"` on success in sandbox — that's fine
   - "Bank account already exists" on re-run = benign

## Why
Rollfi treats the employee invite as a self-service portal flow. All 5 steps replicate what the employee would do themselves. The bank account requirement is documented ("A bank account is required before employees using Direct Deposit can become active") but easy to miss.

## How to apply
Implemented in `runEmployeeKycOnboarding(rollfiUserId, rollfiCompanyId, log)` in `artifacts/api-server/src/routes/rollfi.ts`. Called in both the fresh registration path (after `addUser`) and the recovery path (after email-already-exists lookup). All steps are fire-and-forget with logged errors.

## Result
After all 5 steps complete, `initiatePayroll` succeeds end-to-end for both Sunshine and Rainbow companies in Rollfi sandbox.
