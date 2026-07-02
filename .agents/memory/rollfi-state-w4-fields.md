---
name: Rollfi state W-4 field names
description: The allowances field name in addStateW4Information differs by state; getStateW4FormFields endpoint location
---

## The rule

The "allowances" field name in `addStateW4Information` is NOT consistent across states. Use `getStateW4FormFields` to discover the correct field names per state before submitting.

**Confirmed field names (via getStateW4FormFields):**

| State | Allowances field | Notes |
|-------|-----------------|-------|
| NJ | `"Total Allowances"` | NJ-W4 line 4 |
| NY | `"Withholding Allowance"` | NY IT-2104 Box 1 |
| NY (extra) | `"NYC Withholding Allowance"` + `"NYC Additional Withholding"` | NYC/Yonkers local tax |

Both states use `"Filing Status"` and `"Additional Withholding"` as the other field names.

## getStateW4FormFields endpoint

- **URL**: `POST https://sandbox.rollfi.xyz/reports#getStateW4FormFields`
- **NOT** `/userOnboarding` (returns 400 empty body there)
- **Body**: `{ "method": "getStateW4FormFields", "stateCode": "NJ" }`
- **Route in our app**: `GET /api/rollfi/state-w4-fields/:stateCode`

## Why

Rollfi's state W-4 forms mirror the actual state paper form field labels. These differ because each state names its allowances line differently on the physical form. Sending the wrong field name returns: `"Withholding Allowance not available: Verify Documentation or Contact Support"`.

## How to apply

In `buildStateW4Payload` in `rollfi-employee-sync.ts`: use a state-specific lookup for the allowances key. For production, call `getStateW4FormFields` dynamically before building the payload so any new state is supported automatically without code changes.
