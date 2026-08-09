---
name: Plaid bank linking
description: How the Plaid vs Manual bank-account linking feature is implemented — DB columns, API shape, guard conditions, polling pattern.
---

## Plaid bank linking — design decisions

**DB columns added to `companies`:**
- `bank_link_method` (text) — "Manual" | "Plaid"
- `bank_link_generated_at` (text ISO date) — when the Plaid link was generated, for 72-hour expiry display

**Why:** Rollfi needs to know how the bank was linked to track status and show the owner expiry warnings.

**API shape — POST /rollfi/onboard/bank-account:**
- Accepts: `{ companyId, linkType?: "Manual"|"Plaid", plaidOptions?: "generateURL"|"sendInviteByEmail", email?, ...bankFields }`
- Plaid + generateURL: calls Rollfi, extracts `plaidLinkURL` (or `linkURL`/`url`), returns URL to client — **never logged**
- Plaid + sendInviteByEmail: sends invite, returns `{ success, sentTo }`
- Manual: existing logic unchanged; DB write adds `bankLinkMethod: "Manual"`
- Plaid is production-only guard: returns 400 in sandbox

**POST /api/companies (wizard) — bankSetupMethod:**
- Body accepts `bankSetupMethod?: "Manual" | "Plaid"`
- Bank validation is skipped when `bankSetupMethod === "Plaid"` (no account numbers needed upfront)
- DB insert writes `bankLinkMethod: body.bankSetupMethod ?? "Manual"`
- `ensureFullOnboarding` receives `linkType: "Plaid"` to skip the bank step in production

**Frontend — /bank-account-setup page:**
- Standalone page at `/bank-account-setup`, registered in App.tsx, reachable from Company Settings "Bank Account" card
- Shows current bank-status card at top, then Plaid/Manual choice (production-only; sandbox shows info note)
- Plaid: two sub-options (generateURL opens new tab, sendInviteByEmail), polls every 5 s up to 60 polls (5 min), then "Check again"
- Manual: full form (bankName, routingNumber, accountNumber, accountType, accountName) with micro-deposit warning

**Frontend — clients-new.tsx wizard:**
- Step 6 (production): Plaid/Manual toggle at top; Plaid shows info card "bank connection happens after creation"; Manual shows existing form unchanged
- Micro-deposit warning wrapped in `(!isProduction || form.bankSetupMethod === "Manual")`
- Success screen: Plaid connection panel rendered when `hasRollfi && isProduction && form.bankSetupMethod === "Plaid"`, with same generateURL/sendInviteByEmail sub-options and polling

**Syntax gotcha:**
- Babel strict mode rejects `a ?? b || c` without parens — must write `(a ?? b) || c`

**How to apply:**
- Any new page that initiates Plaid must POST `linkType: "Plaid"` + `plaidOptions` to `/api/rollfi/onboard/bank-account`
- Poll via `GET /api/rollfi/onboard/bank-status?companyId=` every 5 s; `{ verified: true }` means complete
- Never log `plaidLinkURL` on the server side
