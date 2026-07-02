---
name: Rollfi onboarding order — wage before KYC
description: addUserWage must run before runEmployeeKycOnboarding, not after; initiateUserKyc fails if wage isn't set first
---

## The rule

`addUserWage` (via `adminPortal#addUserWage`) must be called **before** `initiateUserKyc`. If wage is added after KYC initiation, Rollfi returns:

```
{ "code": 400, "message": "User wage information is required before initiating KYC. Add employee wage information." }
```

## Correct order in onboardEmployeeToRollfi

1. `addUser` — create user in Rollfi
2. `addUserWage` ← **must be here**
3. `runEmployeeKycOnboarding` — contains: acceptTermsAndCondition → addKycInformation → addW4Information → addStateW4Information → initiateUserKyc → addUserBankAccount

## Why

Rollfi's KYC check validates that the employee's wage record exists as part of the compliance check before identity verification can be initiated.

## How to apply

In `onboardEmployeeToRollfi` in `rollfi-employee-sync.ts`: the `addUserWage` POST block must appear before the `runEmployeeKycOnboarding` call. Never move it after.
