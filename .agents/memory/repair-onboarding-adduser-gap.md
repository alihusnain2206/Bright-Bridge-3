---
name: Repair onboarding — null rollfiUserId (addUser rejection) path
description: repair-onboarding endpoint now handles employees who were never created in Rollfi (total addUser rejection). Key design decisions and guard patterns.
---

# Repair onboarding — null rollfiUserId path

## The rule
`POST /api/rollfi/employees/:id/repair-onboarding` has two branches:
1. **`rollfiUserId` is null** → re-run full `onboardEmployeeToRollfi` chain with current DB values, write back the resulting ID, proceed.
2. **`rollfiUserId` is set** → re-run only `runKycOnboardingNew` (KYC/W4/bank chain).

**Why:** addUser was rejected at creation time for employees like Gail Davis (date-of-join before company incorporation). The endpoint previously returned HTTP 400 immediately when `rollfiUserId` was null. Now it re-runs addUser using whatever `startDate` is currently in the DB — so the owner edits the date, saves, and clicks "Retry payroll setup" in People Hub.

## How to apply
- When calling `onboardEmployeeToRollfi` in branch 1, bank credentials are NOT stored post-wizard (only `bankName`, `accountLast4`, `accountType`). Pass what's available; the bank step will land in "pending invite" — acceptable.
- After a successful branch-1 addUser, write `rollfiUserId` to both `employees` master row AND `rollfiEmployeeRecords` via `persistRollfiEmployee`.
- Translate Rollfi error strings using `translateOnboardingError()` (in rollfi.ts before the route) before returning them to the client — never expose raw Rollfi messages in `res.json`.

## Error translation patterns (rollfi.ts `translateOnboardingError`)
- `/date of join cannot be before.*incorporation/i` → "The employee's start date is before the company's payroll registration date. Please update the start date to the company's registration date or later, then retry."
- `/already exists/i` → "This employee already exists in the payroll system…"
- `/invalid.*email/i` → "The employee's email address was rejected…"

## People Hub retry UI (people.tsx)
- `PeopleEmployee` now includes `lastSyncError` and `rollfiSynced` fields.
- `parseSyncError(lastSyncError)` helper parses the stored JSON and returns a translated reason string (or null).
- Payroll cell shows error reason + "Retry payroll setup" button only when `!emp.rollfiUserId && parseSyncError(emp.lastSyncError) !== null`.
- On success, calls `refetchEmployees()` (invalidates `["people-employees", companyId]` query).
