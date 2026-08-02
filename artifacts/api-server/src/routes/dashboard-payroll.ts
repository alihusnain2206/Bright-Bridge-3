/**
 * GET /dashboard/payroll
 *
 * Consolidated payroll-dashboard endpoint. Batches the four expensive Rollfi
 * calls the owner dashboard needs into a single server-side request, with a
 * 60-second per-company in-memory cache.
 *
 * - Partial-failure tolerant: one failed upstream call populates errors{} but
 *   does NOT fail the whole response.
 * - Cache keyed by companyId — a user can never receive another company's data.
 * - ?refresh=true bypasses the cache for an explicit refresh action.
 * - Company scoping matches /api/dashboard: owner sees their own company;
 *   super_admin may pass ?companyId= to target a specific company.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import axios from "axios";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function rollfiHeaders() {
  const { clientId, secretKey } = getRollfiConfig();
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function getBaseUrl(): string { return getRollfiConfig().baseUrl; }

function assertNoRollfiError(raw: Record<string, unknown>, label: string): void {
  if (raw.error && typeof raw.error === "object") {
    const e = raw.error as { code?: number; message?: string };
    throw new Error(`Rollfi ${label} error (${e.code ?? "?"}): ${e.message ?? "Unknown error"}`);
  }
}

/** Resolve the companyId the caller may act on (mirrors company-settings.ts). */
function resolveCompanyId(req: Request, res: Response): string | null {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return null; }
  if (user.role !== "owner" && user.role !== "super_admin") {
    res.status(403).json({ error: "Access denied — owner or super_admin required" }); return null;
  }
  const companyId = user.role === "super_admin"
    ? ((req.query.companyId as string | undefined) ?? user.companyId)
    : user.companyId;
  if (!companyId) { res.status(400).json({ error: "No company associated with this account" }); return null; }
  return companyId;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  data: PayrollDashboardResponse;
  expiresAt: number; // Date.now() + 60_000
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// ── Response type ─────────────────────────────────────────────────────────────

interface PayrollDashboardResponse {
  payPeriod: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  history: Record<string, unknown>[];
  companyTasks: {
    tasks: Array<{ task: string; description: string }>;
    kybStatus: string;
    bankLinked: boolean;
  } | null;
  /**
   * Active funding source from Rollfi getCompanyInfo → FundingSources[].
   * Contains whatever Rollfi returns: bankName, accountType, last4, status, etc.
   * Null if the company has no linked funding account or the call fails.
   */
  fundingSource: Record<string, unknown> | null;
  employeesToPay: number | null;
  fetchedAt: string;
  errors: {
    payPeriod?: string;
    details?: string;
    history?: string;
    companyTasks?: string;
    fundingSource?: string;
  };
}

// ── Fetch helpers (each returns the data or throws) ───────────────────────────

async function fetchPayPeriod(rollfiCompanyId: string): Promise<Record<string, unknown>> {
  const FINAL_STATUSES = new Set(["processed", "skipped"]);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Strategy 1: getPayPeriod
  try {
    const gpResp = await axios.post(
      `${getBaseUrl()}/reports#getPayPeriod`,
      { method: "getPayPeriod", companyId: rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    const gpRaw = gpResp.data as Record<string, unknown>;
    assertNoRollfiError(gpRaw, "getPayPeriod");
    const status = String(gpRaw.payPeriodStatus ?? "").toLowerCase();
    if (gpRaw.payPeriodId && !FINAL_STATUSES.has(status)) {
      return gpRaw;
    }
  } catch {
    // fall through to strategy 2
  }

  // Strategy 2: getUnProcessedPayPeriod (up to 3 retries)
  let periods: Array<Record<string, unknown>> = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await axios.post(
      `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
      { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    const raw = resp.data as Record<string, unknown>;
    assertNoRollfiError(raw, "getUnProcessedPayPeriod");
    periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
    if (periods.length > 0) break;
    if (attempt < 3) await sleep(400);
  }

  if (periods.length === 0) throw new Error("No unprocessed pay periods found");

  const STATUS_PRIORITY: Record<string, number> = { preprocess: 0, new: 1, inprocess: 2 };
  const sorted = [...periods].sort((a, b) => {
    const aPrio = STATUS_PRIORITY[String(a.payPeriodStatus ?? "").toLowerCase()] ?? 99;
    const bPrio = STATUS_PRIORITY[String(b.payPeriodStatus ?? "").toLowerCase()] ?? 99;
    if (aPrio !== bPrio) return aPrio - bPrio;
    return String(a.payBeginDate ?? "").localeCompare(String(b.payBeginDate ?? ""));
  });
  return sorted[0];
}

async function fetchDetails(rollfiCompanyId: string, payPeriodId: string): Promise<Record<string, unknown>> {
  const resp = await axios.post(
    `${getBaseUrl()}/reports#getPayPeriodDetails`,
    { method: "getPayPeriodDetails", companyId: rollfiCompanyId, payPeriodId },
    { headers: rollfiHeaders() }
  );
  return resp.data as Record<string, unknown>;
}

async function fetchHistory(rollfiCompanyId: string): Promise<Record<string, unknown>[]> {
  // Processed periods
  let processedPeriods: Array<Record<string, unknown>> = [];
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getProcessedPayperiodsDetails`,
      { method: "getProcessedPayperiodsDetails", companyId: rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    const raw = r.data as Record<string, unknown>;
    processedPeriods = (
      raw.processedPayPeriods ?? raw.processedPayperiods ?? raw.payPeriods ?? raw.periods ?? []
    ) as Array<Record<string, unknown>>;
  } catch { /* continue with empty */ }

  // Unprocessed (non-new) periods
  let pendingPeriods: Array<Record<string, unknown>> = [];
  try {
    const r2 = await axios.post(
      `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
      { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    const raw2 = r2.data as Record<string, unknown>;
    const allUnprocessed = (raw2.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
    const CURRENT_STATUSES = new Set(["new", ""]);
    pendingPeriods = allUnprocessed.filter(
      (p) => !CURRENT_STATUSES.has(String(p.payPeriodStatus ?? "").toLowerCase())
    );
  } catch { /* continue with empty */ }

  // Merge + deduplicate + sort newest first
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const p of [...processedPeriods, ...pendingPeriods]) {
    const id = String(p.payPeriodId ?? p.payBeginDate ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(p);
  }
  return merged
    .sort((a, b) => String(b.payBeginDate ?? b.payDate ?? "").localeCompare(String(a.payBeginDate ?? a.payDate ?? "")))
    .slice(0, 20);
}

/**
 * Fetches the company's active funding source (bank account) from Rollfi.
 * Uses getCompanyInfo → Company[0].FundingSources[] and returns the first
 * non-deactivated entry.  The returned object contains whatever Rollfi
 * provides: bankName, accountType, last4, status, accountBalance, etc.
 */
async function fetchFundingSource(rollfiCompanyId: string): Promise<Record<string, unknown> | null> {
  const r = await axios.post(
    `${getBaseUrl()}/reports#getCompanyInfo`,
    { method: "getCompanyInfo", companyId: rollfiCompanyId },
    { headers: rollfiHeaders() },
  );
  const raw = r.data as Record<string, unknown>;
  const companies = Array.isArray(raw.Company) ? raw.Company as Record<string, unknown>[] : [];
  const co = companies[0] ?? {};
  const sources = Array.isArray(co.FundingSources)
    ? co.FundingSources as Record<string, unknown>[]
    : [];
  // Prefer an active/verified source; fall back to first entry
  const active =
    sources.find((f) => ["active", "verified", "ready"].includes(String(f.status ?? "").toLowerCase())) ??
    sources.find((f) => String(f.status ?? "").toLowerCase() !== "deactivated") ??
    sources[0] ??
    null;
  return active;
}

async function fetchCompanyTasks(rollfiCompanyId: string) {
  const r = await axios.post(
    `${getBaseUrl()}/reports#getCompanyTask`,
    { method: "getCompanyTask", companyId: rollfiCompanyId },
    { headers: rollfiHeaders() }
  );
  const raw = r.data as Record<string, unknown>;
  const tasks = (raw.tasks ?? []) as Array<{ task: string; description: string }>;
  const kybTask = tasks.find((t) => t.task === "KYB verification");
  const bankTask = tasks.find((t) => t.task === "Connect bank account");
  let kybStatus: string;
  if (!kybTask) {
    kybStatus = "approved";
  } else {
    const desc = kybTask.description.toLowerCase();
    if (desc.includes("failed")) kybStatus = "failed";
    else if (desc.includes("pending") || desc.includes("review")) kybStatus = "pending";
    else if (desc.includes("approved") || desc.includes("verified") || desc.includes("success")) kybStatus = "approved";
    else kybStatus = "issue";
  }
  return { tasks, kybStatus, bankLinked: !bankTask };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/dashboard/payroll", requireAuth, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req, res);
  if (!companyId) return;

  const bypassCache = req.query.refresh === "true";

  // Cache hit
  if (!bypassCache) {
    const cached = cache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }
  }

  // Credentials check
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  const rollfiCompanyId = rollfiCompany.rollfiCompanyId;
  const fetchedAt = new Date().toISOString();

  // ── Step 1: fetch pay period (needed for details call) ───────────────────
  let payPeriod: Record<string, unknown> | null = null;
  const errors: PayrollDashboardResponse["errors"] = {};

  try {
    payPeriod = await fetchPayPeriod(rollfiCompanyId);
  } catch (err) {
    errors.payPeriod = String(err);
    req.log.warn({ err, companyId }, "dashboard/payroll: payPeriod fetch failed");
  }

  // ── Step 2: fan out the remaining calls in parallel ─────────────────────
  const payPeriodId = payPeriod?.payPeriodId as string | undefined;

  const [detailsResult, historyResult, tasksResult, fundingResult] = await Promise.allSettled([
    payPeriodId
      ? fetchDetails(rollfiCompanyId, payPeriodId)
      : Promise.reject(new Error("No payPeriodId — skipping details")),
    fetchHistory(rollfiCompanyId),
    fetchCompanyTasks(rollfiCompanyId),
    fetchFundingSource(rollfiCompanyId),
  ]);

  let details: Record<string, unknown> | null = null;
  if (detailsResult.status === "fulfilled") {
    details = detailsResult.value;
  } else {
    errors.details = detailsResult.reason instanceof Error
      ? detailsResult.reason.message
      : String(detailsResult.reason);
    if (payPeriodId) {
      req.log.warn({ err: detailsResult.reason, companyId }, "dashboard/payroll: details fetch failed");
    }
  }

  let history: Record<string, unknown>[] = [];
  if (historyResult.status === "fulfilled") {
    history = historyResult.value;
  } else {
    errors.history = String(historyResult.reason);
    req.log.warn({ err: historyResult.reason, companyId }, "dashboard/payroll: history fetch failed");
  }

  let companyTasks: PayrollDashboardResponse["companyTasks"] = null;
  if (tasksResult.status === "fulfilled") {
    companyTasks = tasksResult.value;
  } else {
    errors.companyTasks = String(tasksResult.reason);
    req.log.warn({ err: tasksResult.reason, companyId }, "dashboard/payroll: companyTasks fetch failed");
  }

  let fundingSource: Record<string, unknown> | null = null;
  if (fundingResult.status === "fulfilled") {
    fundingSource = fundingResult.value;
  } else {
    errors.fundingSource = String(fundingResult.reason);
    req.log.warn({ err: fundingResult.reason, companyId }, "dashboard/payroll: fundingSource fetch failed");
  }

  // ── Derive employeesToPay from details payrollLineItems ──────────────────
  let employeesToPay: number | null = null;
  if (details) {
    const detailsTyped = details as { payPeriod?: Array<{ payrollLineItems?: unknown[] }> };
    const items = detailsTyped.payPeriod?.[0]?.payrollLineItems;
    if (Array.isArray(items)) employeesToPay = items.length;
  }

  // ── Augment history with the current pay period if it has an amount ─────────
  // getProcessedPayperiodsDetails only returns fully ACH-processed payrolls.
  // A submitted-but-not-yet-processed period carries payrollAmount in the
  // getPayPeriod response but may not appear in the history list with an amount.
  // Synthesise an entry so the Funding Forecast widget has data on the first run.
  if (payPeriod && (payPeriod.payrollAmount as number | undefined)) {
    const currentId = String(payPeriod.payPeriodId ?? "");
    const alreadyPresent = currentId
      ? history.some((h) => String(h.payPeriodId ?? "") === currentId)
      : false;
    if (!alreadyPresent) {
      history = [
        {
          payPeriodId:   payPeriod.payPeriodId,
          payBeginDate:  payPeriod.payBeginDate,
          payEndDate:    payPeriod.payEndDate,
          payDate:       payPeriod.payDate,
          payrollAmount: payPeriod.payrollAmount,
          payPeriodStatus: payPeriod.payPeriodStatus,
        },
        ...history,
      ];
    }
  }

  const responseData: PayrollDashboardResponse = {
    payPeriod,
    details,
    history,
    companyTasks,
    fundingSource,
    employeesToPay,
    fetchedAt,
    errors,
  };

  // Cache the result (even partial — better than nothing for subsequent fast loads)
  cache.set(companyId, { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS });

  res.json(responseData);
});

export default router;
