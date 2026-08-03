---
name: App Activity Log Persistence
description: App activities now persist to DB so they survive server restarts; in-memory was the old approach.
---

## Rule
`store.logActivity()` fire-and-forgets a DB insert into `app_activity_log`. The `/activity` GET endpoint reads from DB (not in-memory), falls back to in-memory only on DB error.

**Why:** The in-memory `activityLog` array was wiped on every API server restart, making "Recent Activity" show only old Rollfi webhook events.

**How to apply:**
- New event types added to Rollfi webhook label map (`mapWebhookType` in `rollfi.ts`) — add to the `labels` record.
- Activity is capped at 8 events in both the API default and the widget's `?limit=8` query param.
- The `app_activity_log` table was created with raw SQL (drizzle-kit push was interactive); schema is in `lib/db/src/schema/index.ts` as `appActivityLog`.
- Future callers of `store.logActivity` don't need to change — persistence is handled inside the store method.
