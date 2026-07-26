---
name: Rollfi salaried comp fix
description: FIX 1 (preserve base salary when bonus added) + FIX 2 (recovery for zeroed hours) for salaried employees in importRegularPayrollData
---

## The Bug
Including a salaried employee in `importRegularPayrollData` **without a `basicPay` key** causes
Rollfi to set `payHours=0` and zero the base salary. The gross becomes only the bonus amount.

This fires whenever `isSalariedEmp && hasActiveAdj` — the previous code skipped `basicPay` for
salaried employees entirely.

## FIX 1 — Preserve hours (both initiate + import endpoints)
When `isSalariedEmp && hasActiveAdj`:
```
entry.basicPay = { payHours: Number(item.payHours ?? 0) }
```
`item` is the Rollfi enrolled line item for this employee (from `getPayPeriodDetails` roster).
Rollfi auto-prorates the hours from the Per Year wage record; echoing them back tells Rollfi
"keep these hours, add the comp on top."

**Why:** Without `basicPay`, Rollfi interprets the entry as explicit 0-hours and overrides its
own auto-computation. Confirmed via sandbox: Test A (no basicPay) → gross=$1550, base=$0;
Test B (basicPay:48) → payHours=48, comp preserved.

## FIX 2 — Recovery for zeroed employees (same endpoints)
Once stuck at payHours=0, simply omitting the employee from a subsequent import does NOT
restore them — the zeroed state persists. `recoverZeroedSalariedEmployees()` helper fixes this.

**Trigger:** `isSalariedEmp && hasActiveAdj && item.payHours === 0`

**Mechanism:** `removeUsersFromRegularPayPeriod` + `addUsersToRegularPayPeriod`
- Remove API format: `{ payrollLineItems: [{ userId: uid }] }` (NOT `userIds: [uid]`)
- Re-add API format: `{ payrollLineItems: [{ userId: uid, paymentMethod: "Direct Deposit" }] }`
- After remove+add, Rollfi repopulates payHours automatically (confirmed: 0 → 48, gross → $1338.46)
- Helper re-fetches `getPayPeriodDetails` after recovery so FIX 1 sees the restored payHours

**How to apply:** Called before the main payrollData build loop in both initiate and import
endpoints, after `dbPayTypeByEmpId*` is built and `rollfiIdToUser` is available.

## Code locations
- Helper: `recoverZeroedSalariedEmployees` — after `enrollMissingEmployeesInPeriod` (≈line 445)
- Initiate: FIX 2 call after `dbPayTypeByEmpId` build; FIX 1 in loop (`isSalariedEmp` branch)
- Import: FIX 2 call after `dbPayTypeByEmpIdImport` build; FIX 1 in loop (`isSalariedEmpImport` branch)
