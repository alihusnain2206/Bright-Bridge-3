---
name: FIX 6 employee audit results July 2026
description: getUser audit of all 17 Rollfi-enrolled production employees; gaps found
---

## Audit date: 2026-07-25 (sandbox)
All 17 employees with a rollfiUserId were queried via getUser.

## Key gaps found

### Missing federal W4 — NEEDS REPAIR
- **Sophia Bennett** — Active, KYC passed, bank ✓, but W4=MISSING and StateW4=MISSING

### KYC not initiated + no bank (Invite Sent) — NEEDS REPAIR
- **Alex Thompson** — wage shows 1800.0 (stored in cents, sent wrong)
- **Kevin Roberts** — wage shows 1800.0 (stored in cents, sent wrong)
- **Olivia Grant** — KYC not initiated, no bank
- **Victor Osei** — KYC not initiated, no bank

### Wage stored in cents instead of dollars — NEEDS REPAIR
These employees show abnormally high wage rates in Rollfi (cents were sent as dollars):
- Alex Thompson: 1800.0 (should be $18.00)
- Kevin Roberts: 1800.0 (should be $18.00)
- Marcus Webb: 3000.0 (should be $30.00)
- Elena Vasquez: 820.0 (may be $8.20 or something else)
- Mary Johnson: 1500.0 (should be $15.00)
- John Smith: 1800.0 (should be $18.00)

### Fully complete employees
Amanda Foster, Leila Hassan, Hannah Price, Nathan Cross, Olivia Grant (wage ✓),
Gregory Lawson (salaried $60k/yr ✓), Tasha Bright (Invite Sent but W4+bank ✓).

## Status: Audit complete, repairs NOT yet implemented
The wage-in-cents bug was fixed going forward (via `getRollfiWageFields` resolver) but
existing employees in Rollfi still have the wrong wageRate. A repair script using
`updateUserWage` is needed for the 6 employees above.

**Why:** Historical onboarding code passed hourlyWageCents directly to Rollfi's wageRate
(which expects dollars). The resolver now converts cents→dollars, but existing Rollfi
records are not retroactively fixed.
