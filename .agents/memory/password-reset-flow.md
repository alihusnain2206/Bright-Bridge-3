---
name: Password reset flow
description: Full forgot-password / reset-password feature — architecture, table, email lib, routes, pages
---

# Password Reset Flow

## Architecture
- `password_reset_tokens` DB table (TEXT columns for dates, not timestamps): `id`, `user_id`, `token`, `expires_at`, `used_at`, `created_at`
- Tokens are 32-byte hex strings, expire after 1 hour, marked `used_at` after use (not deleted)
- NULL check for `used_at` uses Drizzle's `isNull()` — NOT `eq(col, null)` which doesn't work

## Files
- `lib/db/src/schema/index.ts` — `passwordResetTokens` table export
- `artifacts/api-server/src/lib/email.ts` — nodemailer wrapper; dev fallback logs link to console when SMTP env vars absent
- `artifacts/api-server/src/routes/auth.ts` — `POST /auth/forgot-password` and `POST /auth/reset-password`
- `artifacts/brightbridge/src/pages/reset-password.tsx` — standalone page, reads `?token=` from URL
- `artifacts/brightbridge/src/pages/login.tsx` — `ForgotPasswordModal` component; "Forgot password?" link next to Password label
- `artifacts/brightbridge/src/App.tsx` — `/reset-password` route (no auth guard)

## Email config env vars
`SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (optional), `APP_URL` (base URL for reset link)

**Why:** Without `APP_URL` the reset link in the email falls back to a placeholder. Must be set to the deployed domain in production.

## DB table creation
Table was created with raw SQL (drizzle-kit push is interactive and can't be scripted). Run this in production too:
```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY, user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
  used_at TEXT, created_at TEXT NOT NULL
);
```

## Security notes
- `forgot-password` always returns the same message regardless of whether email exists (prevents enumeration)
- `reset-password` validates token is unused AND not expired in a single DB query
- Password updated in both DB (`user_accounts`) and in-memory store so active sessions get the new hash
