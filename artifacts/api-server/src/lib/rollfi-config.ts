/**
 * Rollfi credential resolver — call getRollfiConfig() per request, never cache at module level.
 *
 * ROLLFI_ENV must equal "production" exactly to enable production mode.
 * Any other value (undefined, empty, "prod", "PRODUCTION", misspelled) → sandbox.
 *
 * Backward compatibility: if the new ROLLFI_SANDBOX_* / ROLLFI_PROD_* vars are absent,
 * falls back to the legacy ROLLFI_BASE_URL / ROLLFI_CLIENT_ID / ROLLFI_SECRET_KEY.
 *
 * ── Intended environment variable matrix ──────────────────────────────────────
 *
 *  Dev repl (default / sandbox testing):
 *    ROLLFI_ENV              — unset (or any value other than "production")
 *    ROLLFI_SANDBOX_API_URL  — sandbox base URL (or legacy ROLLFI_BASE_URL)
 *    ROLLFI_SANDBOX_CLIENT_ID — sandbox client id (or legacy ROLLFI_CLIENT_ID)
 *    ROLLFI_SANDBOX_SECRET_KEY — sandbox secret (or legacy ROLLFI_SECRET_KEY)
 *    DATABASE_URL            — dev Postgres instance (Replit auto-provisioned)
 *    DATABASE_ENV            — unset (or "sandbox")
 *
 *  Deployed production:
 *    ROLLFI_ENV=production
 *    ROLLFI_PROD_API_URL     — production base URL
 *    ROLLFI_PROD_CLIENT_ID   — production client id
 *    ROLLFI_PROD_SECRET_KEY  — production secret key
 *    DATABASE_URL            — prod Postgres instance (Replit deployment auto-provisioned)
 *    DATABASE_ENV=production — tells the coherence check this DB is prod
 *
 *  IMPORTANT: never set ROLLFI_ENV=production in the dev repl. The only
 *  safeguard preventing real-money calls against the dev database is
 *  keeping these two variables in their matching tiers.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const _env = process.env.ROLLFI_ENV;
const _isProduction = _env === "production";

// ── Startup validation (runs once at module load) ─────────────
if (_isProduction) {
  const required: Array<[string, string | undefined]> = [
    ["ROLLFI_PROD_API_URL",    process.env.ROLLFI_PROD_API_URL],
    ["ROLLFI_PROD_CLIENT_ID",  process.env.ROLLFI_PROD_CLIENT_ID],
    ["ROLLFI_PROD_SECRET_KEY", process.env.ROLLFI_PROD_SECRET_KEY],
  ];
  const missing = required.filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length > 0) {
    process.stderr.write(
      `[FATAL] ROLLFI_ENV=production but the following required variables are missing or empty: ${missing.join(", ")}. All Rollfi routes will return 503 until these are set.\n`,
    );
  }
}

// ── Types ─────────────────────────────────────────────────────

export interface RollfiConfig {
  env: "sandbox" | "production";
  baseUrl: string;
  clientId: string | undefined;
  secretKey: string | undefined;
  /** true only when both clientId and secretKey are non-empty */
  credentialsPresent: boolean;
}

// ── Resolver ──────────────────────────────────────────────────

export function getRollfiConfig(): RollfiConfig {
  if (_isProduction) {
    const baseUrl   = (process.env.ROLLFI_PROD_API_URL?.trim()   ?? "").replace(/\/+$/, "");
    const clientId  = process.env.ROLLFI_PROD_CLIENT_ID?.trim() || undefined;
    const secretKey = process.env.ROLLFI_PROD_SECRET_KEY?.trim() || undefined;
    return {
      env: "production",
      baseUrl: baseUrl || "https://api.rollfi.xyz",
      clientId,
      secretKey,
      credentialsPresent: !!(clientId && secretKey),
    };
  }

  // Sandbox (default) — with backward compat for legacy env var names.
  const baseUrl = (
    process.env.ROLLFI_SANDBOX_API_URL?.trim() ??
    process.env.ROLLFI_BASE_URL?.trim() ??
    "https://sandbox.rollfi.xyz"
  ).replace(/\/+$/, "");
  const clientId  = (process.env.ROLLFI_SANDBOX_CLIENT_ID?.trim() || process.env.ROLLFI_CLIENT_ID?.trim()) || undefined;
  const secretKey = (process.env.ROLLFI_SANDBOX_SECRET_KEY?.trim() || process.env.ROLLFI_SECRET_KEY?.trim()) || undefined;
  return {
    env: "sandbox",
    baseUrl,
    clientId,
    secretKey,
    credentialsPresent: !!(clientId && secretKey),
  };
}
