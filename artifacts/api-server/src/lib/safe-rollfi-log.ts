/**
 * safeRollfiLog — produce a log-safe summary of a Rollfi API response.
 *
 * Only scalar (string | number | boolean | null) values from an allow-list of
 * non-PII keys are copied into the result. Objects and arrays are replaced with
 * the string "[object]" so that nested KYC/bank payloads (SSN, routing number,
 * account number, etc.) that Rollfi may echo back in its responses can never
 * reach server logs.
 *
 * For the "error" key specifically, only the human-readable message string is
 * extracted; the full error object (which may contain submitted PII) is dropped.
 *
 * This is the single source of truth — import from here rather than defining
 * local copies so that all callers and tests exercise the same logic.
 */
export function safeRollfiLog(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const d = data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  const SCALAR_KEYS = ["status", "success", "message", "code", "id", "userId", "companyId", "referenceId", "taskId", "result"] as const;
  for (const k of SCALAR_KEYS) {
    if (!(k in d)) continue;
    const v = d[k];
    // Only scalars — never copy objects or arrays that may contain PII
    safe[k] = (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") ? v : "[object]";
  }

  // For "error": extract only the human-readable message string, never the full object
  if ("error" in d) {
    const e = d["error"];
    if (e === null || typeof e === "string" || typeof e === "number" || typeof e === "boolean") {
      safe["error"] = e;
    } else if (typeof e === "object" && e !== null) {
      const msg = (e as Record<string, unknown>)["message"];
      safe["error"] = typeof msg === "string" ? msg : "[error object]";
    }
  }

  return safe;
}
