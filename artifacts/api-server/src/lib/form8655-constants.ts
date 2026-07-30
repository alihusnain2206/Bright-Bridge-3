/**
 * Shared Form 8655 constants — single source of truth for thresholds used
 * across company-settings.ts, admin.ts, and any future consumers.
 */

/** Milliseconds after the most recent upload attempt before a pending
 *  Form 8655 upload is considered stuck / stale. */
export const FORM_8655_STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
