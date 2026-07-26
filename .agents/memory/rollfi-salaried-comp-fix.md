---
name: Rollfi salaried comp fix
description: How salaried employees are handled in importRegularPayrollData — omit from main import, inject comp separately, recover zeroed state.
---

## The Core Problem
Rollfi auto-computes Per Year salary only when a salaried employee is **absent** from
`importRegularPayrollData`. If they appear in the payload (even with correct hours), Rollfi
suppresses auto-computation and zeroes their base salary.

## Approved Solution (implemented)

### Step 1 — Detect salaried employees (restart-safe)
`salariedRollfiUids` is built by querying `employees.rollfiUserId` **directly from the DB** —
NOT via `store.getRollfiEmployee()` (store is rebuilt from `rollfi_employee_records` on restart,
which only has wizard-created employees, not test/store-only employees).

```typescript
const dbRows = await db.select({ id, payType, rollfiUserId }).from(employeesTable)
  .where(eq(employeesTable.companyId, companyId));
for (const r of dbRows) {
  if (r.payType === "salary" && r.rollfiUserId)
    salariedRollfiUids.add(r.rollfiUserId.toUpperCase());
}
```

Applied in all three endpoints: initiate, import, run-all.

**Why:** `employees.rollfiUserId` is persistent; the in-memory store loses non-persisted entries
on restart. Employees created only in the store (not via wizard) must be added to the `employees`
table with `rollfi_user_id` populated for this to work.

### Step 2 — Omit salaried from main import
Salaried employees always `continue` in the main `payrollData` build loop. They are excluded
from `importRegularPayrollData` (which uses `overwriteExistingLineItems:true`).

### Step 3 — Recovery for employees stuck at payHours=0
`recoverZeroedSalariedEmployees()` helper: remove + re-add via Rollfi API to reactivate
Per Year auto-computation. Triggers for any salaried employee with `payHours === 0` in
`enrolledItems`. Called before the main loop in all three endpoints.

- Remove: `{ payrollLineItems: [{ userId: uid }] }`
- Re-add: `{ payrollLineItems: [{ userId: uid, paymentMethod: "Direct Deposit" }] }`
- After remove+add, Rollfi repopulates payHours automatically (confirmed: 0 → 48, base → $1338.46)

### Step 4 — Inject comp separately
`injectSalariedCompensations()` helper: always wipes stale comp first, then injects via
`importRegularPayrollData` with `overwriteExistingLineItems:false` (critical — `true` would zero
the base again). Called after the main import in all three endpoints.

## Dev DB requirement
Salaried employees enrolled via the wizard must have a row in the `employees` table with
`rollfi_user_id` populated. If an employee only exists in the in-memory store (no DB row),
insert them manually:
```sql
INSERT INTO employees (id, company_id, first_name, last_name, email, position,
  start_date, pay_type, rollfi_user_id, status, employment_type, worker_type,
  created_at, updated_at)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET pay_type='salary', rollfi_user_id='...';
```
Diane Whitfield (`EMP-MS1JLSXM-3TOPI7`, Rollfi UUID `B11D088D-79BC-4390-8E76-DE0F58BA8E8F`)
was inserted into dev DB this way (July 2026).

## Verified test results (sandbox, pay period 338FA4C5, July 2026)
- T1 ($200 Bonus): payHours=48 ✅ baseTotal=1338.46 ✅ gross=1538.46 ✅ comp=[200] ✅
- T2 (change to $350): comp replaced not stacked ✅ base preserved ✅
- T3 (remove bonus): comp cleared ✅ base=1338.46 ✅
- T4 (Diane absent): base preserved ✅ comp=[] ✅
- T5a+T5b (duplicate import): no accumulation ✅

## Code locations
- `recoverZeroedSalariedEmployees` — approx line 572 in rollfi.ts
- `injectSalariedCompensations` — after `wipeAdditionalCompensations`
- Salaried UID detection block — present in all three endpoints (initiate / import / run-all)
