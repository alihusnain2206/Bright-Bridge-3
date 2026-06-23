---
name: EasyTeam environment
description: EasyTeam is production, not sandbox — affects URLs and token exchange endpoint
---

EasyTeam is **production**, not sandbox. The user confirmed this explicitly.

**Why:** Variable names in the codebase say "SANDBOX" but the actual URLs used are production ones.

**How to apply:**
- Base URL: `https://www.easyteam.io/embed/iframe` (no `/sandbox/` prefix)
- Token exchange: `POST https://www.easyteam.io/embed/api/auth/exchangeToken`
- Do NOT revert to sandbox URLs (`/sandbox/embed/`) — those are wrong
- The `replit.md` gotchas section still says "sandbox URLs" — that comment is outdated; actual code uses production URLs
