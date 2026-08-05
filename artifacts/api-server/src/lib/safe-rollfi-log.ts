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

// ── Verbose logging helpers (ROLLFI_VERBOSE=true only) ─────────────────────
//
// maskRollfiPii: deep-walk any object and mask PII field values in-place on a
// clone. Everything else is left untouched so callers see the full response.
//
// Masked fields:
//   ssn / socialSecurityNumber / ssnNumber          → ***-**-<last4>
//   accountNumber / bankAccountNumber               → ****<last4>
//   routingNumber / bankRoutingNumber               → *****<last4>
//   dateOfBirth / dob / birthDate                  → [DOB]

const _SSN_FIELDS     = new Set(["ssn", "socialSecurityNumber", "ssnNumber"]);
const _ACCT_FIELDS    = new Set(["accountNumber", "bankAccountNumber"]);
const _ROUTING_FIELDS = new Set(["routingNumber", "bankRoutingNumber"]);
const _DOB_FIELDS     = new Set(["dateOfBirth", "dob", "birthDate"]);

function _maskValue(key: string, value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  if (_SSN_FIELDS.has(key))     return `***-**-${value.slice(-4).padStart(4, "X")}`;
  if (_ACCT_FIELDS.has(key))    return `****${value.slice(-4).padStart(4, "X")}`;
  if (_ROUTING_FIELDS.has(key)) return `*****${value.slice(-4).padStart(4, "X")}`;
  if (_DOB_FIELDS.has(key))     return "[DOB]";
  return value;
}

export function maskRollfiPii(data: unknown): unknown {
  if (data === null || data === undefined || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(maskRollfiPii);
  const obj = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const isPiiKey = _SSN_FIELDS.has(k) || _ACCT_FIELDS.has(k) || _ROUTING_FIELDS.has(k) || _DOB_FIELDS.has(k);
    out[k] = isPiiKey ? _maskValue(k, v) : maskRollfiPii(v);
  }
  return out;
}

/**
 * rollfiVerboseLog — emit a structured [ROLLFI-OUT] / [ROLLFI-IN] line only
 * when ROLLFI_VERBOSE=true. PII is masked via maskRollfiPii before serialising.
 *
 * direction "OUT" = request payload being sent to Rollfi
 * direction "IN"  = full response body received from Rollfi
 */
export function rollfiVerboseLog(direction: "OUT" | "IN", url: string, data: unknown): void {
  if (process.env.ROLLFI_VERBOSE !== "true") return;
  const tag = direction === "OUT" ? "[ROLLFI-OUT]" : "[ROLLFI-IN]";
  // Pull the method name out of the URL fragment (e.g. /userOnboarding#addKycInformation → addKycInformation)
  const endpoint = url.includes("#") ? url.split("#")[1] : (url.split("/").pop() ?? url);
  try {
    // eslint-disable-next-line no-console
    console.log(tag, endpoint, JSON.stringify(maskRollfiPii(data), null, 2));
  } catch {
    // eslint-disable-next-line no-console
    console.log(tag, endpoint, "[unserializable payload]");
  }
}
