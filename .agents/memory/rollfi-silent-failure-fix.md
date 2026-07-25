---
name: Rollfi silent failure fix
description: How we fixed 7 of 8 Rollfi onboarding steps swallowing body errors silently (the 200+error pattern)
---

## The bug
Rollfi returns HTTP 200 with `{"error":{"code":400,"message":"..."}}` for logical failures. Before this fix, all 8 onboarding steps logged the response but never checked the body for an error object, so a failure (e.g. "W4FilingStatus is not valid") was silently swallowed and the wizard showed a success screen.

## The fix (shipped July 2026)
- `extractRollfiError(data)` — shared helper in `rollfi-employee-sync.ts`. Extracts error message from any Rollfi body shape. Returns null on success.
- Hard steps (abort + record error + don't set `rollfiOnboardedAt`): `addUserWage`, `addW4Information`, `addUserBankAccount`
- Soft steps (warn + continue): `acceptTermsAndCondition`, `addKycInformation`, `addStateW4Information`, `initiateUserKyc`
- `onboardEmployeeToRollfi` now returns `{ success, rollfiUserId, rollfiWageId, hardErrors?, softWarnings? }`
- `rollfiUserId` is always persisted (even on hard failure) so the repair route can find the user.
- `last_sync_error` column (already existed) now stores `JSON.stringify({ failedSteps, softWarnings })` on hard failure.
- `rollfiOnboardedAt` is NOT set when any hard error occurred.
- API response includes `rollfiFailedSteps` and `rollfiSoftWarnings`.
- Wizard success screen shows red error panel + "Retry Failed Steps" button on hard failure.
- `POST /api/rollfi/employees/:employeeId/repair-onboarding` re-runs KYC/W4/bank chain; idempotent ("already exists" is treated as success).

## W4 filing status normalisation
- Valid values (sandbox-probed): `"Single"`, `"Married"`, `"Head of Household"`.
- `normalizeW4FilingStatus()` maps legacy/mis-cased values → canonical form, falls back to `"Single"`.
- Applied before every `addW4Information` call; original + normalized values are both logged.

**Why:** Gregory Lawson's production W4 failed with "W4FilingStatus is not valid" — the old code swallowed this silently. The normalized form would have prevented the failure AND the error is now surfaced to the operator immediately.
