/**
 * Shared Form 8655 constants — single source of truth for thresholds used
 * across company-settings.ts, admin.ts, and any future consumers.
 */

/** Milliseconds after the most recent upload attempt before a pending
 *  Form 8655 upload is considered stuck / stale. */
export const FORM_8655_STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// ── Signature placement constants ────────────────────────────────────────────
// Used by buildForm8655Pdf (form8655.ts) and its unit tests (form8655.test.ts).
// Any coordinate adjustment must happen here; both consumers track the change
// automatically.

/** X-coordinate (pt) of the signature image/text on the IRS form page.
 *  Placed to the right of the "Sign Here" label that occupies ~x=35–85. */
export const SIG_X = 90;

/** Y-coordinate (pt) of the signature image/text on the IRS form page. */
export const SIG_Y = 70;

/** Maximum width (pt) to which a drawn signature image is scaled. */
export const SIG_MAX_W = 220;

/** Maximum height (pt) to which a drawn signature image is scaled. */
export const SIG_MAX_H = 44;
