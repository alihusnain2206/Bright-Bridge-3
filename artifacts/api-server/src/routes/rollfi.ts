import { Router, type IRouter } from "express";
import axios from "axios";
import { store } from "../store";
import { persistRollfiCompany, persistRollfiEmployee } from "../lib/rollfi-persist.js";
import { getTimesheetApprovalsByCompanyPeriod, getLatestTimesheetApprovalsByCompany } from "../lib/timesheet-approvals-persist.js";
import { deleteUserAccount } from "../lib/user-account-persist.js";
import { registerEmployeeInEasyTeam } from "../lib/easyteam-employee-sync.js";
import { db, rollfiWebhookEvents, rollfiEmployeeRecords, companies as companiesTable, employees as employeesTable, stateRegistrations as stateRegistrationsTable, appActivityLog } from "@workspace/db";
import { buildStateRegistrationPayload } from "../lib/rollfi-state-fields.js"; // kept for retry fallback on legacy records
import { runEmployeeKycOnboarding as runKycOnboardingNew, extractRollfiError } from "../lib/rollfi-employee-sync.js";
import { desc, eq, inArray, and, isNull, isNotNull } from "drizzle-orm";
import { getRollfiConfig } from "../lib/rollfi-config.js";
import { getRollfiWageFields } from "../lib/rollfi-wage.js";
import { safeRollfiLog } from "../lib/safe-rollfi-log.js";
import crypto from "crypto";

// ── Rollfi / Convoy webhook HMAC verification ─────────────────────────────────
// Prefer the service-specific secret; fall back to the shared legacy one so
// the rename from CONVOY_WEBHOOK_SECRET → ROLLFI_WEBHOOK_SECRET is zero-downtime.
const CONVOY_WEBHOOK_SECRET =
  process.env.ROLLFI_WEBHOOK_SECRET ?? process.env.CONVOY_WEBHOOK_SECRET;

function verifyConvoySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  // Accept Convoy format "v1=<hmac>,v1=<hmac>" OR plain hex
  const tokens = signatureHeader.split(",").map((s) => s.trim());
  return tokens.some((tok) => {
    const eqIdx = tok.indexOf("=");
    const hashStr = eqIdx >= 0 ? tok.slice(eqIdx + 1) : tok;
    try {
      return crypto.timingSafeEqual(Buffer.from(hashStr, "hex"), expectedBuf);
    } catch {
      return false;
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

function rollfiHeaders() {
  const { clientId, secretKey } = getRollfiConfig();
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function getBaseUrl(): string { return getRollfiConfig().baseUrl; }

// Generate a random 9-digit number string (EIN or SSN format, no leading zeros)
function randomNineDigits(): string {
  const n = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return String(n);
}

// Format a 9-digit SSN string as XXX-XX-XXXX
function formatSsn(n: string): string {
  const d = n.replace(/\D/g, "").padStart(9, "0");
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

// safeRollfiLog is imported from lib/safe-rollfi-log.ts (single source of truth)

interface KycOnboardingResult {
  kycInitiated: boolean;
  kycBlockedByKyb: boolean;
  bankAdded: boolean;
  error?: string;
}

// Run the mandatory employee KYC onboarding steps so status moves from "Invite Sent" to active.
// Steps run sequentially; KYC identity must succeed before initiating KYC.
// Non-fatal errors are logged (idempotent re-runs are fine).
async function runEmployeeKycOnboarding(
  rollfiUserId: string,
  rollfiCompanyId: string,
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
  bankInput?: { bankName?: string; routingNumber?: string; accountNumber?: string; accountType?: string }
): Promise<KycOnboardingResult> {
  const headers = rollfiHeaders();

  // Look up real employee data from DB — use it if present, fall back to sandbox defaults
  let empAddress1 = "123 Main St";
  let empCity = "Newark";
  let empState = "NJ";
  let empZipcode = "07101";
  let empDateOfBirth = "1990-01-15";
  // SSN: never fabricate in production — use null so KYC is skipped with a clear log entry.
  // In sandbox, fall back to a random 9-digit test value (never reaches real payroll systems).
  const isProductionEnv = getRollfiConfig().env === "production";
  let ssn: string | null = isProductionEnv ? null : randomNineDigits();
  try {
    const [emp] = await db.select({
      homeAddress: employeesTable.homeAddress,
      homeCity: employeesTable.homeCity,
      homeState: employeesTable.homeState,
      homeZip: employeesTable.homeZip,
      dateOfBirth: employeesTable.dateOfBirth,
      ssn: employeesTable.ssn,
    }).from(employeesTable).where(eq(employeesTable.rollfiUserId, rollfiUserId));
    if (emp) {
      if (emp.homeAddress) empAddress1 = emp.homeAddress;
      if (emp.homeCity)    empCity     = emp.homeCity;
      if (emp.homeState)   empState    = emp.homeState;
      if (emp.homeZip)     empZipcode  = emp.homeZip;
      if (emp.dateOfBirth) empDateOfBirth = emp.dateOfBirth;
      if (emp.ssn) {
        const digits = emp.ssn.replace(/\D/g, "");
        if (digits.length === 9) ssn = digits;
      } else if (isProductionEnv) {
        log.warn({ rollfiUserId }, "KYC: SSN not stored for this employee — production KYC will be skipped (PRODUCTION: hard stop)");
      } else {
        log.warn({ rollfiUserId }, "KYC: SSN not stored — using random test value (SANDBOX ONLY)");
      }
    }
    log.info({ rollfiUserId, hasRealAddress: !!emp?.homeAddress, hasRealDob: !!emp?.dateOfBirth, hasRealSsn: !!ssn }, "KYC: resolved employee identity data");
  } catch (e) {
    log.warn({ e }, "KYC: failed to look up employee data from DB — using defaults");
  }

  // Step 1 — accept terms (PUT)
  try {
    const r = await axios.put(
      `${getBaseUrl()}/userOnboarding#acceptTermsAndCondition`,
      { method: "acceptTermsAndCondition", userId: rollfiUserId },
      { headers }
    );
    log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi acceptTermsAndCondition response");
  } catch (e) { log.warn({ e }, "acceptTermsAndCondition failed (ignoring)"); }

  // Step 2 — KYC identity information (must succeed before initiateUserKyc)
  let kycAdded = false;
  if (!ssn) {
    log.warn({ rollfiUserId, isProductionEnv }, "KYC: skipping addKycInformation — SSN not available (production: hard stop; sandbox: should not reach here)");
  } else {
    try {
      const r = await axios.post(
        `${getBaseUrl()}/userOnboarding#addKycInformation`,
        {
          method: "addKycInformation",
          kycInformation: {
            userId: rollfiUserId,
            ssn,
            dateOfBirth: empDateOfBirth,
            address1: empAddress1,
            address2: "",
            city: empCity,
            state: empState,
            zipcode: empZipcode,
          },
        },
        { headers }
      );
      log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addKycInformation response");
      const raw = r.data as Record<string, unknown>;
      const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
      // "already exists" means KYC was submitted in a previous run — treat as success
      kycAdded = !raw.error || errMsg.toLowerCase().includes("already exists");
    } catch (e) { log.warn({ e }, "addKycInformation failed (ignoring)"); }
  }

  // Step 3 — W4 federal tax withholding (independent of KYC)
  try {
    const r = await axios.post(
      `${getBaseUrl()}/userOnboarding#addW4Information`,
      {
        method: "addW4Information",
        w4Information: {
          userId: rollfiUserId,
          w4FilingStatus: "Single",
          haveMultipleJob: false,
          dependents: 0,
          dependentsAbove18: 0,
          otherIncome: 0,
          otherDeduction: 0,
          extraWithholding: 0,
        },
      },
      { headers }
    );
    log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addW4Information response");
  } catch (e) { log.warn({ e }, "addW4Information failed (ignoring)"); }

  // Step 4 — initiate KYC verification (only if KYC info was accepted)
  let kycInitiated = false;
  let kycBlockedByKyb = false;
  if (!kycAdded) {
    log.warn({ rollfiUserId }, "Skipping initiateUserKyc — addKycInformation did not succeed");
  } else {
    try {
      const r = await axios.post(
        `${getBaseUrl()}/userOnboarding#initiateUserKyc`,
        { method: "initiateUserKyc", userId: rollfiUserId },
        { headers }
      );
      log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi initiateUserKyc response");
      const raw = r.data as Record<string, unknown>;
      const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
      if (errMsg.toLowerCase().includes("kyb is not initiated") || errMsg.toLowerCase().includes("company kyb")) {
        kycBlockedByKyb = true;
        log.warn({ rollfiUserId }, "initiateUserKyc blocked — company KYB has not passed");
      } else if (!raw.error) {
        kycInitiated = true;
      }
    } catch (e) { log.warn({ e }, "initiateUserKyc failed (ignoring)"); }
  }

  // Step 5 — add employee bank account (first-time only: full numbers come from wizard in memory).
  // Production: submit only if bankInput has full account number (first-time wizard flow);
  //   skip on retry — Rollfi already holds the account after first submission.
  // Sandbox: always use hardcoded test values.
  let bankAdded = false;
  const isProduction = getRollfiConfig().env === "production";
  if (isProduction && !bankInput?.accountNumber) {
    log.info({}, "addUserBankAccount: production retry — Rollfi already holds account, skipping");
    bankAdded = true;
  } else {
    try {
      const bank = (isProduction && bankInput?.routingNumber && bankInput?.accountNumber)
        ? { accountNumber: bankInput.accountNumber, routingNumber: bankInput.routingNumber, bankName: bankInput.bankName ?? "Direct Deposit", accountType: bankInput.accountType ?? "checking", accountName: "default" }
        : { accountNumber: "9889890989", routingNumber: "122238242", bankName: "Chase Bank", accountType: "savings", accountName: "default" };
      log.info({ env: getRollfiConfig().env, bankName: bank.bankName, maskedAcct: `****${bank.accountNumber.slice(-4)}` }, "addUserBankAccount: submitting bank details");
      const r = await axios.post(
        `${getBaseUrl()}/userPortal#addUserBankAccount`,
        {
          method: "addUserBankAccount",
          linkType: "Manual",
          userPayAccountEntity: {
            companyId: rollfiCompanyId,
            userId: rollfiUserId,
            accountNumber: bank.accountNumber,
            routingNumber: bank.routingNumber,
            bankName: bank.bankName,
            accountType: bank.accountType,
            accountName: bank.accountName,
            payPercentage: 100,
            isPrimary: true,
          },
        },
        { headers }
      );
      log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addUserBankAccount response");
      const raw = r.data as Record<string, unknown>;
      if (!raw.error) bankAdded = true;
    } catch (e) { log.warn({ e }, "addUserBankAccount failed (ignoring)"); }
  }

  return { kycInitiated, kycBlockedByKyb, bankAdded };
}

// Derive a stable UUID-shaped ID from a seed string (for recovery fallback)
function deriveStableId(seed: string): string {
  const hash = (s: string, salt: number) => {
    let h = 5381 + salt;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
    return Math.abs(h).toString(16).padStart(8, "0");
  };
  const p = [hash(seed, 0), hash(seed, 1), hash(seed, 2), hash(seed, 3), hash(seed, 4)];
  return `${p[0]}-${p[1].slice(0, 4)}-${p[2].slice(0, 4)}-${p[3].slice(0, 4)}-${p[4]}${p[0].slice(0, 4)}`;
}

// Rollfi sometimes returns HTTP 200 with {error:{code,message}} instead of throwing
function assertNoRollfiError(raw: Record<string, unknown>, label: string): void {
  if (raw.error && typeof raw.error === "object") {
    const e = raw.error as { code?: number; message?: string };
    throw new Error(`Rollfi ${label} error (${e.code ?? "?"}): ${e.message ?? "Unknown error"}`);
  }
}

/** Check for a validationWarning at any level of the Rollfi response. */
function extractValidationWarning(raw: Record<string, unknown>): { message?: string; userIds?: string[] } | null {
  const findWarning = (obj: Record<string, unknown>): Record<string, unknown> | null => {
    if (obj.validationWarning && typeof obj.validationWarning === "object") return obj.validationWarning as Record<string, unknown>;
    if (obj.warning && typeof obj.warning === "object") return obj.warning as Record<string, unknown>;
    return null;
  };
  const top = findWarning(raw);
  if (top) return { message: top.message as string | undefined, userIds: top.userIds as string[] | undefined };
  for (const val of Object.values(raw)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = findWarning(val as Record<string, unknown>);
      if (nested) return { message: nested.message as string | undefined, userIds: nested.userIds as string[] | undefined };
    }
  }
  return null;
}

interface WipeResult {
  wiped: string[];
  warnings: { userId: string; message: string }[];
}

async function wipeAdditionalCompensations(
  companyId: string,
  payPeriodId: string,
  userIds: string[],
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }
): Promise<WipeResult> {
  const wiped: string[] = [];
  const warnings: { userId: string; message: string }[] = [];
  const BATCH = 3;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (userId) => {
        try {
          const r = await axios.post(
            `${getBaseUrl()}/payroll#removeAdditionalCompensations`,
            { method: "removeAdditionalCompensations", companyId, payPeriodId, userId },
            { headers: rollfiHeaders() }
          );
          const raw = r.data as Record<string, unknown>;
          const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string | undefined) ?? "";
          const isNothingToRemove = /no additional comp|nothing to remove|not found|no comp|does not exist/i.test(errMsg);
          if (raw.error && isNothingToRemove) {
            log.info({ userId, response: raw }, "comp wipe: nothing to remove (normal)");
          } else if (raw.error) {
            log.warn({ userId, response: raw }, "comp wipe: Rollfi error (continuing)");
            warnings.push({ userId, message: errMsg || JSON.stringify(raw.error) });
          } else {
            log.info({ userId, response: raw }, "comp wipe");
            wiped.push(userId);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ userId, err }, "comp wipe: HTTP error (continuing)");
          warnings.push({ userId, message: msg });
        }
      })
    );
  }
  return { wiped, warnings };
}

type SalariedCompEntry = {
  rollfiUserId: string;
  name?: string;
  additionalCompensation: { description: string; amount: number }[];
  overTime: { type: string; noOfHours: number; multiplier: number }[];
};
type SalariedCompResult = {
  injected: string[];
  wiped: string[];
  warnings: { userId: string; message: string }[];
};

/**
 * Post-import salaried compensation handler — shared by initiate, import, and run-all.
 *
 * Two responsibilities per salaried employee:
 *   1. Wipe any stale comp (idempotent; no-op if none). Always runs, even when new comp will
 *      be injected, to prevent accumulation when the comp description changes across runs.
 *   2. If comp is present for this period, inject it via importRegularPayrollData with
 *      overwriteExistingLineItems: FALSE.
 *
 * WHY overwriteExistingLineItems must be FALSE here (and TRUE in the main hourly import):
 *   TRUE  → Rollfi replaces the entire line item; even without basicPay, its absence sets
 *           payHours=0 and zeroes the Per Year auto-computed baseTotal.
 *           Confirmed in sandbox testing 2026-07-26.
 *   FALSE → Rollfi merges only the supplied fields; auto-computed baseTotal is untouched.
 *
 * The main hourly import MUST stay TRUE to prevent comp accumulation (explicit [] does not
 * clear stale comp when overwrite=false). Salaried employees must be excluded from that call.
 */
async function injectSalariedCompensations(
  companyId: string,
  payPeriodId: string,
  entries: SalariedCompEntry[],
  log: BasicLog
): Promise<SalariedCompResult> {
  const injected: string[] = [];
  const wiped: string[] = [];
  const warnings: { userId: string; message: string }[] = [];
  if (entries.length === 0) return { injected, wiped, warnings };

  for (const { rollfiUserId: userId, name, additionalCompensation, overTime } of entries) {
    const hasComp = (additionalCompensation?.length ?? 0) > 0 || (overTime?.length ?? 0) > 0;

    // ── Step 1: always wipe stale comp ─────────────────────────────────────
    // Runs even when new comp will be injected — descriptions may change across runs.
    try {
      const wipeR = await axios.post(
        `${getBaseUrl()}/payroll#removeAdditionalCompensations`,
        { method: "removeAdditionalCompensations", companyId, payPeriodId, userId },
        { headers: rollfiHeaders() }
      );
      const wipeRaw = wipeR.data as Record<string, unknown>;
      const wipeErr = String((wipeRaw.error as Record<string, unknown> | undefined)?.message ?? "");
      const isNone = /no additional comp|nothing to remove|not found|no comp|does not exist|no payroll data/i.test(wipeErr);
      if (wipeRaw.error && !isNone) {
        log.warn({ userId, name, response: wipeRaw }, "injectSalaryComp: wipe error (continuing)");
        warnings.push({ userId, message: wipeErr || JSON.stringify(wipeRaw.error) });
      } else if (!wipeRaw.error) {
        wiped.push(userId);
        log.info({ userId, name }, "injectSalaryComp: stale comp wiped");
      } else {
        log.info({ userId, name }, "injectSalaryComp: no stale comp (normal)");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ userId, name, err: e }, "injectSalaryComp: wipe HTTP error (continuing)");
      warnings.push({ userId, message: msg });
    }

    if (!hasComp) {
      log.info({ userId, name }, "injectSalaryComp: no comp this period — wipe only");
      continue;
    }

    // ── Step 2: inject comp — overwriteExistingLineItems MUST be false ─────
    // See function-level comment. No basicPay key — overwrite=false leaves
    // Rollfi's auto-computed baseTotal intact.
    try {
      const injectBody = {
        method: "importRegularPayrollData",
        companyId,
        payPeriodId,
        overwriteExistingLineItems: false,
        payrollData: [{ userId, additionalCompensation, overTime }],
      };
      log.info({ userId, name, additionalCompensation, overTime,
        outgoing: JSON.stringify(injectBody) }, "injectSalaryComp: injecting (overwriteExistingLineItems=false)");
      const injectR = await axios.post(
        `${getBaseUrl()}/payroll#importRegularPayrollData`,
        injectBody,
        { headers: rollfiHeaders() }
      );
      const injectRaw = injectR.data as Record<string, unknown>;
      const injectErr = extractRollfiError(injectRaw);
      if (injectErr) {
        log.warn({ userId, name, response: injectRaw }, "injectSalaryComp: inject error");
        warnings.push({ userId, message: injectErr });
      } else {
        injected.push(userId);
        log.info({ userId, name }, "injectSalaryComp: comp injected successfully");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ userId, name, err: e }, "injectSalaryComp: inject HTTP error");
      warnings.push({ userId, message: msg });
    }
  }

  return { injected, wiped, warnings };
}

// ── FIX 1b helper: enrol mid-period hires absent from Rollfi's pay-period roster ─────────────
// Rollfi snapshots its pay-period roster at PERIOD CREATION TIME; employees hired after the
// snapshot (or not yet enrolled when it ran) are absent. This helper detects and enrolls them.
//
// Guardrails (spec):
//   1. NEVER call blindly — only for employees confirmed ABSENT from the current roster.
//   2. Treat "already has a payroll line item" as SUCCESS (desired state reached; log INFO).
//   3. Only enrol into "new" OR "cancelled" periods (both are editable states in Rollfi).
//      "cancelled" means a previously-submitted payroll was cancelled to allow corrections —
//      imports already succeed against it, and enrollment is expected to behave the same.
//      EXCLUDED: submitted, inProcess, processed, failed — those are locked states.
//      If Rollfi rejects addUsersToRegularPayPeriod for a cancelled period, the exact error
//      body is logged as WARN rather than swallowed.
type BasicLog = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
async function enrollMissingEmployeesInPeriod(
  rollfiCompanyId: string,
  payPeriodId: string,
  /** Lower-cased PayPeriodStatus / payPeriodStatus from getPayPeriodDetails response. */
  periodStatus: string,
  enrolledItems: Array<Record<string, unknown>>,
  companyId: string,
  log: BasicLog
): Promise<{ newlyEnrolled: number; updatedItems: Array<Record<string, unknown>> | null; notEnrolled: Array<{ rollfiUserId: string; employeeId: string; name: string; reason: string }> }> {
  // Guardrail 3: only "new" or "cancelled" periods (both are Rollfi editable states)
  const ENROLLABLE_STATUSES = ["new", "cancelled"];
  if (!ENROLLABLE_STATUSES.includes(periodStatus)) {
    log.info({ payPeriodId, periodStatus }, "Safety net: skipping enrollment — period is not in an editable state (new/cancelled)");
    return { newlyEnrolled: 0, updatedItems: null, notEnrolled: [] };
  }

  const enrolledUids = new Set(
    enrolledItems
      .map((item) => String(item.userId ?? item.userID ?? item.employeeId ?? "").toUpperCase())
      .filter(Boolean)
  );

  // Join rollfi_employee_records → employees to filter by our internal companyId
  const companyRollfiEmps = await db
    .select({
      rollfiUserId: rollfiEmployeeRecords.rollfiUserId,
      employeeId:   rollfiEmployeeRecords.employeeId,
      firstName:    employeesTable.firstName,
      lastName:     employeesTable.lastName,
    })
    .from(rollfiEmployeeRecords)
    .innerJoin(employeesTable, eq(rollfiEmployeeRecords.employeeId, employeesTable.id))
    .where(eq(employeesTable.companyId, companyId));

  // Build uid → { employeeId, name } for per-employee error reporting
  const empInfoByUid = new Map(
    companyRollfiEmps
      .filter((r): r is typeof r & { rollfiUserId: string } => !!r.rollfiUserId)
      .map((r) => [r.rollfiUserId.toUpperCase(), { employeeId: r.employeeId, name: `${r.firstName} ${r.lastName}` }])
  );

  // Guardrail 1: only employees ABSENT from the current roster
  const missingUids = companyRollfiEmps
    .map((r) => r.rollfiUserId)
    .filter((uid): uid is string => !!uid && !enrolledUids.has(uid.toUpperCase()));

  if (missingUids.length === 0) {
    log.info({ payPeriodId, companyId }, "Safety net: all Rollfi employees already present in roster");
    return { newlyEnrolled: 0, updatedItems: null, notEnrolled: [] };
  }

  log.info(
    { payPeriodId, companyId, missingCount: missingUids.length, missingUids },
    "Safety net: enrolling mid-period hires absent from Rollfi roster"
  );

  let newlyEnrolled = 0;
  const notEnrolled: Array<{ rollfiUserId: string; employeeId: string; name: string; reason: string }> = [];
  for (const uid of missingUids) {
    const empInfo = empInfoByUid.get(uid.toUpperCase());
    try {
      const enrollResp = await axios.post(
        `${getBaseUrl()}/payroll#addUsersToRegularPayPeriod`,
        {
          method: "addUsersToRegularPayPeriod",
          companyId: rollfiCompanyId,
          payPeriodId,
          payrollLineItems: [{ userId: uid, paymentMethod: "Direct Deposit" }],
        },
        { headers: rollfiHeaders() }
      );
      const enrollRaw = enrollResp.data as Record<string, unknown>;
      const errMsg = extractRollfiError(enrollRaw);
      if (!errMsg) {
        log.info({ uid, name: empInfo?.name, payPeriodId, rollfiResult: safeRollfiLog(enrollResp.data) }, "Safety net: enrolled successfully");
        newlyEnrolled++;
      } else if (errMsg.toLowerCase().includes("already has a payroll line item")) {
        // Guardrail 2: race — desired state already reached
        log.info({ uid, name: empInfo?.name, payPeriodId }, "Safety net: already enrolled (desired state — success)");
        newlyEnrolled++;
      } else if (errMsg.toLowerCase().includes("invalid status") || errMsg.toLowerCase().includes("employee validation failed")) {
        // Per-employee ineligibility — not fully onboarded / not yet Active in Rollfi.
        // Skip this employee; do not block the others.
        log.warn({ uid, name: empInfo?.name, payPeriodId, reason: errMsg }, "Safety net: employee not payroll-eligible — skipping (notEnrolled)");
        notEnrolled.push({ rollfiUserId: uid, employeeId: empInfo?.employeeId ?? uid, name: empInfo?.name ?? uid, reason: errMsg });
      } else {
        log.warn({ uid, name: empInfo?.name, payPeriodId, errMsg }, "Safety net: enrollment returned error (non-fatal — skipping)");
      }
    } catch (enrollErr) {
      log.warn({ uid, name: empInfo?.name, payPeriodId, enrollErr }, "Safety net: enrollment request failed (non-fatal — skipping)");
    }
  }

  if (newlyEnrolled === 0) {
    return { newlyEnrolled: 0, updatedItems: null, notEnrolled };
  }

  // Re-fetch roster so newly enrolled employees appear in the import payload
  const refreshResp = await axios.post(
    `${getBaseUrl()}/reports#getPayPeriodDetails`,
    { method: "getPayPeriodDetails", companyId: rollfiCompanyId, payPeriodId },
    { headers: rollfiHeaders() }
  );
  const refreshRaw = refreshResp.data as Record<string, unknown>;
  const refreshArr = (refreshRaw.payPeriod ?? []) as Array<Record<string, unknown>>;
  const refreshPd = refreshArr[0] as Record<string, unknown> | undefined;
  const updatedItems = (refreshPd?.payrollLineItems ?? []) as Array<Record<string, unknown>>;
  log.info(
    { newlyEnrolled, newRosterCount: updatedItems.length, payPeriodId },
    "Safety net: re-fetched roster after mid-period hire enrollment"
  );
  return { newlyEnrolled, updatedItems, notEnrolled };
}

/**
 * Recovery: salaried employees stuck at payHours=0 (freshly enrolled in a new period or
 * zeroed by a prior broken import that used overwriteExistingLineItems:true).
 *
 * Rollfi auto-computes Per Year salary only when an employee is ABSENT from
 * importRegularPayrollData. Once their line item is explicitly included — even with a
 * correct basicPay.payHours — the auto-computation is suppressed. The only way to
 * re-activate it is remove + re-add (confirmed in sandbox 2026-07-26).
 *
 * Triggered for every salaried employee reporting payHours=0 in the enrolled roster,
 * regardless of whether they have comp adjustments (no longer restricted to adj employees).
 *
 * Returns the refreshed enrolledItems after recovery.
 */
async function recoverZeroedSalariedEmployees(
  rollfiCompanyId: string,
  payPeriodId: string,
  enrolledItems: Array<Record<string, unknown>>,
  salariedRollfiUids: Set<string>,
  log: BasicLog
): Promise<Array<Record<string, unknown>>> {
  const toRecover = enrolledItems.filter((item) => {
    const uid = String(item.userId ?? item.userID ?? "").toUpperCase();
    return salariedRollfiUids.has(uid) && Number(item.payHours ?? 0) === 0;
  });
  if (toRecover.length === 0) return enrolledItems;

  log.warn({ count: toRecover.length, uids: toRecover.map((i) => i.userId ?? i.userID) },
    "Salaried employees stuck at payHours=0 — recovering via remove+re-add");

  for (const item of toRecover) {
    const uid = String(item.userId ?? item.userID ?? "");
    try {
      await axios.post(
        `${getBaseUrl()}/payroll#removeUsersFromRegularPayPeriod`,
        { method: "removeUsersFromRegularPayPeriod", companyId: rollfiCompanyId, payPeriodId,
          payrollLineItems: [{ userId: uid }] },
        { headers: rollfiHeaders() }
      );
      await axios.post(
        `${getBaseUrl()}/payroll#addUsersToRegularPayPeriod`,
        { method: "addUsersToRegularPayPeriod", companyId: rollfiCompanyId, payPeriodId,
          payrollLineItems: [{ userId: uid, paymentMethod: "Direct Deposit" }] },
        { headers: rollfiHeaders() }
      );
      log.info({ rollfiUserId: uid }, "Salaried recovery: remove+re-add succeeded");
    } catch (err) {
      log.error({ rollfiUserId: uid, err }, "Salaried recovery: remove+re-add failed — payHours may still be 0");
    }
  }

  // Re-fetch enrolledItems so FIX 1 sees the restored payHours
  const refreshResp = await axios.post(
    `${getBaseUrl()}/reports#getPayPeriodDetails`,
    { method: "getPayPeriodDetails", companyId: rollfiCompanyId, payPeriodId },
    { headers: rollfiHeaders() }
  );
  const refreshRaw = refreshResp.data as Record<string, unknown>;
  const refreshArr = (refreshRaw.payPeriod ?? []) as Array<Record<string, unknown>>;
  const refreshPd = refreshArr[0] as Record<string, unknown> | undefined;
  const refreshed = (refreshPd?.payrollLineItems ?? []) as Array<Record<string, unknown>>;
  log.info({ recoveredCount: toRecover.length, newItemCount: refreshed.length },
    "Salaried recovery: enrolledItems refreshed after remove+re-add");
  return refreshed;
}

// ── Status ───────────────────────────────────────────────────

router.get("/rollfi/status", (_req, res) => {
  const cfg = getRollfiConfig();
  res.json({
    configured: cfg.credentialsPresent,
    baseUrl: cfg.baseUrl,
    rollfiEnv: cfg.env,
  });
});

router.get("/config/env", (_req, res) => {
  res.json({ rollfiEnv: getRollfiConfig().env });
});

// ── State W-4 form fields (proxy to Rollfi getStateW4FormFields) ──────────────
// Returns the dynamic field list for a given state — use this to build the UI
// form and to know the correct field names for addStateW4Information.

router.get("/rollfi/state-w4-fields/:stateCode", async (req, res) => {
  const stateCode = (req.params.stateCode ?? "").toUpperCase();
  if (!stateCode) { res.status(400).json({ error: "stateCode is required" }); return; }
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getStateW4FormFields`,
      { method: "getStateW4FormFields", stateCode },
      { headers: rollfiHeaders() }
    );
    res.json(r.data);
  } catch (err) {
    const e = err as { response?: { data: unknown; status?: number } };
    req.log.error({ err, stateCode }, "getStateW4FormFields failed");
    res.status(e.response?.status ?? 500).json({ error: "Failed to fetch state W4 fields", details: e.response?.data ?? String(err) });
  }
});

// ── Full state (companies + employees + their Rollfi IDs) ────

router.get("/rollfi/state", async (_req, res) => {
  // Store companies (hardcoded Sunshine + Rainbow)
  const storeCompanies = store.getDaycareCompanies();
  const storeCompanyIds = new Set(storeCompanies.map((c) => c.id));

  // DB companies not already in the store
  const dbRows = await db.select({
    id: companiesTable.id,
    name: companiesTable.name,
    rollfiCompanyId: companiesTable.rollfiCompanyId,
    address1: companiesTable.address1,
    city: companiesTable.city,
    state: companiesTable.state,
  }).from(companiesTable);

  const dbOnlyCompanies = dbRows
    .filter((r) => !storeCompanyIds.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: "daycare" as const,
      rollfiCompanyId: r.rollfiCompanyId ?? undefined,
      address: [r.address1, r.city, r.state].filter(Boolean).join(", "),
    }));

  const companies = [
    ...storeCompanies.map((c) => ({ ...c, rollfi: store.getRollfiCompany(c.id) ?? null })),
    ...dbOnlyCompanies.map((c) => ({ ...c, rollfi: store.getRollfiCompany(c.id) ?? null })),
  ];

  // TestUser-based employees (existing payroll system)
  const testUserEmployees = store
    .getAllStaffUsers()
    .filter((u) => u.employeeId && u.role !== "super_admin")
    .map((u) => ({
      userId: u.id,
      employeeId: u.employeeId,
      name: u.name,
      email: u.email,
      position: u.position,
      companyId: u.companyId,
      hourlyWage: u.hourlyWage ?? 1500,
      rollfi: u.employeeId ? (store.getRollfiEmployee(u.employeeId) ?? null) : null,
      source: "testuser" as const,
    }));

  // Emails already represented by testUser-based employees (dedupe key for DB employees below)
  const existingEmails = new Set(testUserEmployees.map((e) => e.email?.toLowerCase()).filter(Boolean));

  // DB employees (from the employees table) that are Rollfi-onboarded and not already listed
  const dbOnlyIds = dbOnlyCompanies.map((c) => c.id);
  const dbEmployeeRows = dbOnlyIds.length > 0
    ? await db.select().from(employeesTable).where(inArray(employeesTable.companyId, dbOnlyIds))
    : [];
  const dbEmployees = dbEmployeeRows
    .filter((e) => e.status === "active" && !!e.rollfiUserId)
    .filter((e) => !e.email || !existingEmails.has(e.email.toLowerCase()))
    .map((e) => ({
      userId: e.id,
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
      email: e.email,
      position: e.position,
      companyId: e.companyId,
      hourlyWage: e.hourlyWage ?? 1500,
      rollfi: store.getRollfiEmployee(e.id) ?? null,
      source: "dbemployee" as const,
    }));

  const employees = [...testUserEmployees, ...dbEmployees];

  res.json({ companies, employees });
});

// ── Create / delete payroll employee ─────────────────────────

router.post("/rollfi/employees", async (req, res) => {
  const { name, email, position, hourlyWage, companyId } = req.body as {
    name: string;
    email: string;
    position: string;
    hourlyWage?: number;
    companyId: string;
  };

  if (!name || !email || !position || !companyId) {
    res.status(400).json({ error: "name, email, position, and companyId are required" });
    return;
  }

  // Check in-memory store first; fall back to DB for wizard-created (dynamic) companies.
  // Without the DB fallback, POST /rollfi/employees returns 404 for dynamic companies even
  // though they exist — blocking the entire employee creation flow.
  const company = store.getCompany(companyId);
  let etLocationId = company?.locationId;

  if (!company) {
    const [dbCompany] = await db
      .select({ rollfiLocationId: companiesTable.rollfiLocationId })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .catch(() => [undefined]);
    if (!dbCompany) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    etLocationId = dbCompany.rollfiLocationId ?? undefined;
  }

  const existing = store.getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "An employee with that email already exists" });
    return;
  }

  const user = store.createStaffUser({ name, email, position, hourlyWage: hourlyWage ?? 1500, companyId });

  // Register the new employee with EasyTeam immediately so they can clock in/out.
  // EasyTeam creates the employee record on token exchange — without this step,
  // the employee is in our store but unknown to EasyTeam and shifts are silently dropped.
  // Awaited (not fire-and-forget) so the UUID is mapped before we respond: the caller
  // gets a 201 only after the employee is registered and etUuidToEmployeeId is updated.
  // registerEmployeeInEasyTeam handles setEasyTeamUuidMapping + DB persist internally.
  const resolvedEtLocationId = etLocationId ?? "LOC-SUNSHINE";
  const etResult = await registerEmployeeInEasyTeam(
    {
      id: user.employeeId!,
      name: user.name,
      email: user.email,
      roleName: user.position ?? position,
      wage: (user.hourlyWage ?? 1500) / 100,
      wageType: "hourly",
    },
    resolvedEtLocationId,
    req.log
  );
  if (!etResult.success) {
    req.log.warn(
      { employeeId: user.employeeId, reason: etResult.error },
      "EasyTeam registration failed for new employee — hours will not import until next server restart"
    );
  }

  const actor = req.session.userId ? store.getUserById(req.session.userId) : undefined;
  store.logActivity({
    companyId,
    type: "employee.added",
    description: `Employee "${name}" added`,
    actorName: actor?.name,
    actorRole: actor?.role,
  });
  res.status(201).json(user);
});

router.delete("/rollfi/employees/:userId", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { userId } = req.params;
  const deleted = store.deleteStaffUser(userId);
  if (!deleted) {
    res.status(404).json({ error: "Employee not found or cannot be deleted" });
    return;
  }
  // Durable delete: remove from DB so it doesn't return on next restart.
  // If the DB delete fails, surface an error — otherwise the row would
  // silently reappear on the next server restart.
  try {
    await deleteUserAccount(userId);
  } catch (err) {
    req.log.error({ err, userId }, "Failed to delete user_account row from DB");
    res.status(500).json({ error: "Employee removed from session but failed to delete from database; it may reappear after restart." });
    return;
  }
  res.json({ deleted: true, id: userId });
});

// ── Employee Status Management ────────────────────────────────

router.post("/rollfi/employees/deactivate", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { employeeId, reason, expectedReturnDate } = req.body as { employeeId: string; reason?: string; expectedReturnDate?: string };
  if (!employeeId) { res.status(400).json({ error: "employeeId is required" }); return; }

  const allStaff = store.getAllStaffUsers();
  const employee = allStaff.find((u) => u.employeeId === employeeId);
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  // Resolve actual status: store resets to "active" on restart; trust DB for non-active states
  let deactivateStatus = employee.status;
  if (!deactivateStatus || deactivateStatus === "active") {
    const [dbEmpStatus] = await db.select({ status: employeesTable.status }).from(employeesTable).where(eq(employeesTable.id, employeeId)).catch(() => [undefined]);
    if (dbEmpStatus?.status) deactivateStatus = dbEmpStatus.status as typeof deactivateStatus;
  }

  // State machine: only active → on_leave is allowed
  if (deactivateStatus === "terminated") {
    res.status(400).json({ error: "Cannot put a terminated employee on leave. Terminated is a terminal state." }); return;
  }
  if (deactivateStatus === "on_leave") {
    res.status(400).json({ error: "Employee is already on leave." }); return;
  }

  const rollfiRecord = store.getRollfiEmployee(employeeId);
  let rollfiUserId = rollfiRecord?.rollfiUserId;
  if (!rollfiUserId) {
    const [dbEmp] = await db.select({ rollfiUserId: employeesTable.rollfiUserId }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    rollfiUserId = dbEmp?.rollfiUserId ?? undefined;
  }
  if (!rollfiUserId) {
    res.status(400).json({ error: "Employee is not yet onboarded to Rollfi. Complete Rollfi onboarding first." }); return;
  }
  const rollfiCompany = store.getRollfiCompany(employee.companyId);
  const rollfiCompanyId = rollfiCompany?.rollfiCompanyId;

  const exitDate = expectedReturnDate ? expectedReturnDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/deactivateUser`,
      {
        method: "deactivateUser",
        user: {
          userId: rollfiUserId,
          exitDate,
          personalEmail: employee.email,
          finalPayCheckType: "They have already been paid",
          additionalNotes: reason ?? "",
        },
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data, employeeId, rollfiUserId }, "Rollfi deactivateUser response");
    assertNoRollfiError(response.data as Record<string, unknown>, "deactivateUser");

    const nowISO = new Date().toISOString();
    const previousStatus = employee.status;
    store.updateEmployeeStatus(employeeId, "on_leave", { onLeaveReason: reason, onLeaveDate: nowISO, expectedReturnDate });
    req.log.info({ employeeId, previousStatus, newStatus: "on_leave", reason, changedBy: req.session.userId }, "Employee status changed to on_leave");
    await db.update(employeesTable).set({ status: "on_leave", updatedAt: nowISO }).where(eq(employeesTable.id, employeeId)).catch((e: unknown) => { req.log.warn({ err: e }, "DB status update failed (non-fatal)"); });

    // Best-effort: remove from any open pay period so they don't appear in the next import.
    // Rollfi never auto-removes deactivated employees from in-flight periods.
    if (rollfiCompanyId) {
      try {
        const ppResp = await axios.post(
          `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
          { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        const ppArr = ((ppResp.data as Record<string, unknown>).unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
        const openPeriod = ppArr[0] as Record<string, unknown> | undefined;
        if (openPeriod?.payPeriodId) {
          const removeResp = await axios.post(
            `${getBaseUrl()}/payroll#removeUsersFromRegularPayPeriod`,
            { method: "removeUsersFromRegularPayPeriod", companyId: rollfiCompanyId, payPeriodId: openPeriod.payPeriodId,
              payrollLineItems: [{ userId: rollfiUserId }] },
            { headers: rollfiHeaders() }
          );
          req.log.info({ rollfiResponse: removeResp.data, rollfiUserId, payPeriodId: openPeriod.payPeriodId },
            "Deactivate: removed employee from open pay period");
        }
      } catch (ppErr) {
        req.log.warn({ err: ppErr, rollfiUserId }, "Deactivate: failed to remove from open pay period (non-fatal — employee still deactivated)");
      }
    }

    res.json({ success: true, status: "on_leave", rollfiResponse: response.data });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, employeeId, rollfiUserId }, "deactivateUser failed — local state NOT mutated");
    res.status(500).json({ error: "Failed to deactivate employee in Rollfi", details: e.response?.data ?? String(err) });
  }
});

router.post("/rollfi/employees/terminate", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { employeeId, terminationReason, lastWorkingDay } = req.body as { employeeId: string; terminationReason: string; lastWorkingDay: string };
  if (!employeeId) { res.status(400).json({ error: "employeeId is required" }); return; }

  const allStaff = store.getAllStaffUsers();
  const employee = allStaff.find((u) => u.employeeId === employeeId);
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  // Resolve actual status: store resets to "active" on restart; trust DB for non-active states
  let terminateStatus = employee.status;
  if (!terminateStatus || terminateStatus === "active") {
    const [dbEmpStatus] = await db.select({ status: employeesTable.status }).from(employeesTable).where(eq(employeesTable.id, employeeId)).catch(() => [undefined]);
    if (dbEmpStatus?.status) terminateStatus = dbEmpStatus.status as typeof terminateStatus;
  }

  // State machine: terminated is terminal
  if (terminateStatus === "terminated") {
    res.status(400).json({ error: "Employee is already terminated. Terminated is a terminal state." }); return;
  }

  const rollfiRecord = store.getRollfiEmployee(employeeId);
  let rollfiUserId = rollfiRecord?.rollfiUserId;
  if (!rollfiUserId) {
    const [dbEmp] = await db.select({ rollfiUserId: employeesTable.rollfiUserId }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    rollfiUserId = dbEmp?.rollfiUserId ?? undefined;
  }
  if (!rollfiUserId) {
    res.status(400).json({ error: "Employee is not yet onboarded to Rollfi. Complete Rollfi onboarding first." }); return;
  }
  const rollfiCompany = store.getRollfiCompany(employee.companyId);
  const rollfiCompanyId = rollfiCompany?.rollfiCompanyId;

  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/terminateUser`,
      {
        method: "terminateUser",
        user: {
          userId: rollfiUserId,
          companyId: rollfiCompanyId,
          exitDate: lastWorkingDay,
          personalEmail: employee.email,
          finalPayCheckType: "They have already been paid",
          terminationChoice: "No - This user did not choose to leave",
          dismissalType: "Other",
          severance: false,
          additionalNotes: terminationReason ?? "",
        },
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data, employeeId, rollfiUserId }, "Rollfi terminateUser response");
    assertNoRollfiError(response.data as Record<string, unknown>, "terminateUser");

    const nowISO = new Date().toISOString();
    const previousStatus = employee.status;
    store.updateEmployeeStatus(employeeId, "terminated", { terminatedAt: nowISO, terminationReason, lastWorkingDay, terminatedBy: req.session.userId });
    req.log.info({ employeeId, previousStatus, newStatus: "terminated", terminationReason, lastWorkingDay, changedBy: req.session.userId }, "Employee status changed to terminated");
    await db.update(employeesTable).set({ status: "terminated", updatedAt: nowISO }).where(eq(employeesTable.id, employeeId)).catch((e: unknown) => { req.log.warn({ err: e }, "DB status update failed (non-fatal)"); });

    // Best-effort: remove from any open pay period (same as deactivate).
    if (rollfiCompanyId) {
      try {
        const ppResp = await axios.post(
          `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
          { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        const ppArr = ((ppResp.data as Record<string, unknown>).unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
        const openPeriod = ppArr[0] as Record<string, unknown> | undefined;
        if (openPeriod?.payPeriodId) {
          const removeResp = await axios.post(
            `${getBaseUrl()}/payroll#removeUsersFromRegularPayPeriod`,
            { method: "removeUsersFromRegularPayPeriod", companyId: rollfiCompanyId, payPeriodId: openPeriod.payPeriodId,
              payrollLineItems: [{ userId: rollfiUserId }] },
            { headers: rollfiHeaders() }
          );
          req.log.info({ rollfiResponse: removeResp.data, rollfiUserId, payPeriodId: openPeriod.payPeriodId },
            "Terminate: removed employee from open pay period");
        }
      } catch (ppErr) {
        req.log.warn({ err: ppErr, rollfiUserId }, "Terminate: failed to remove from open pay period (non-fatal — employee still terminated)");
      }
    }

    res.json({ success: true, status: "terminated", rollfiResponse: response.data });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, employeeId, rollfiUserId }, "terminateUser failed — local state NOT mutated");
    res.status(500).json({ error: "Failed to terminate employee in Rollfi", details: e.response?.data ?? String(err) });
  }
});

router.post("/rollfi/employees/reactivate", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { employeeId } = req.body as { employeeId: string };
  if (!employeeId) { res.status(400).json({ error: "employeeId is required" }); return; }

  const allStaff = store.getAllStaffUsers();
  const employee = allStaff.find((u) => u.employeeId === employeeId);
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  // Resolve actual status: in-memory store resets to "active" on restart, so trust DB when store says active
  let effectiveStatus = employee.status;
  if (!effectiveStatus || effectiveStatus === "active") {
    const [dbEmpStatus] = await db.select({ status: employeesTable.status }).from(employeesTable).where(eq(employeesTable.id, employeeId)).catch(() => [undefined]);
    if (dbEmpStatus?.status) effectiveStatus = dbEmpStatus.status as typeof effectiveStatus;
  }

  // State machine: terminated is terminal; already-active is a no-op error
  if (effectiveStatus === "terminated") {
    res.status(400).json({ error: "Terminated employees cannot be reactivated. Add them as a new employee if rehired." }); return;
  }
  if (!effectiveStatus || effectiveStatus === "active") {
    res.status(400).json({ error: "Employee is already active. No status change needed." }); return;
  }

  const rollfiRecord = store.getRollfiEmployee(employeeId);
  let rollfiUserId = rollfiRecord?.rollfiUserId;
  if (!rollfiUserId) {
    const [dbEmp] = await db.select({ rollfiUserId: employeesTable.rollfiUserId }).from(employeesTable).where(eq(employeesTable.id, employeeId));
    rollfiUserId = dbEmp?.rollfiUserId ?? undefined;
  }
  if (!rollfiUserId) {
    res.status(400).json({ error: "Employee is not yet onboarded to Rollfi. Complete Rollfi onboarding first." }); return;
  }
  let rollfiCompanyId = store.getRollfiCompany(employee.companyId)?.rollfiCompanyId;
  if (!rollfiCompanyId) {
    const [dbCo] = await db.select({ rollfiCompanyId: companiesTable.rollfiCompanyId }).from(companiesTable).where(eq(companiesTable.id, employee.companyId)).catch(() => [undefined]);
    rollfiCompanyId = dbCo?.rollfiCompanyId ?? undefined;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/activateUser`,
      {
        method: "activateUser",
        user: {
          userId: rollfiUserId,
        },
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data, employeeId, rollfiUserId }, "Rollfi reactivateUser response");
    assertNoRollfiError(response.data as Record<string, unknown>, "activateUser");

    const nowISO = new Date().toISOString();
    const previousStatus = employee.status;
    store.updateEmployeeStatus(employeeId, "active", { onLeaveReason: undefined, onLeaveDate: undefined, expectedReturnDate: undefined });
    req.log.info({ employeeId, previousStatus, newStatus: "active", changedBy: req.session.userId }, "Employee status changed to active");
    await db.update(employeesTable).set({ status: "active", updatedAt: nowISO }).where(eq(employeesTable.id, employeeId)).catch((e: unknown) => { req.log.warn({ err: e }, "DB status update failed (non-fatal)"); });

    res.json({ success: true, status: "active", rollfiResponse: response.data });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, employeeId, rollfiUserId }, "reactivateUser failed — local state NOT mutated");
    res.status(500).json({ error: "Failed to reactivate employee in Rollfi", details: e.response?.data ?? String(err) });
  }
});

// ── Company onboarding ───────────────────────────────────────

router.post("/rollfi/onboard/company", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "ROLLFI_CLIENT_ID and ROLLFI_SECRET_KEY are not configured" });
    return;
  }

  const { companyId } = req.body as { companyId: string };
  // Resolve from the in-memory store (seeded demo) or DB (wizard-created companies) so
  // dynamically-created companies can also be onboarded to Rollfi.
  let company: { name: string; address?: string } | undefined = store.getCompany(companyId);
  if (!company) {
    const [dbCo] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
    if (dbCo) {
      const address = [dbCo.address1, dbCo.city, dbCo.state].filter(Boolean).join(", ");
      company = { name: dbCo.name, address: address || undefined };
    }
  }
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }

  const existing = store.getRollfiCompany(companyId);
  if (existing) { res.json({ success: true, alreadyOnboarded: true, ...existing }); return; }

  // Helper: recover an existing Rollfi company when EIN was already registered
  async function findExistingRollfiCompany(name: string): Promise<{ companyID: string } | null> {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanies`,
      { method: "getCompanies" },
      { headers: rollfiHeaders() }
    );
    const list = (r.data as { Company?: { company: string; companyID: string }[] }).Company ?? [];
    const match = list.find((c) => c.company.toLowerCase() === name.toLowerCase());
    return match ?? null;
  }

  // Helper: fetch the first work-location ID for a Rollfi company
  async function fetchRollfiLocationId(rollfiCompanyId: string): Promise<string> {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanyLocationInfo`,
      { method: "getCompanyLocationInfo", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const locs = (r.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
    const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
    return work?.companyLocationID ?? "";
  }

  // Helper: run the full post-registration onboarding chain so getPayPeriod works.
  // Steps: 0. addKybInformation  1. initiateCompanyKyb  2. addCompanyBankAccount  3. addPaySchedule
  // All steps are fire-and-forget: errors are logged but never fail company onboarding.
  async function ensureFullOnboarding(rollfiCompanyId: string, localCompanyId: string): Promise<void> {
    // Read the stored EIN (set by createBusiness before this is called)
    const ein = store.getRollfiCompany(localCompanyId)?.ein ?? randomNineDigits();

    // 0 — Submit KYB data (prerequisite for initiateCompanyKyb to take effect)
    try {
      const r0 = await axios.post(
        `${getBaseUrl()}/companyOnboarding#addKybInformation`,
        {
          method: "addKybInformation",
          kybInformation: {
            companyId: rollfiCompanyId,
            ein,
            entityType: "LLC",
            dateOfIncorporation: "2015-01-01",
            incorporationState: "New Jersey",
            irsAssisgnedFederalFilingForm: "941",
          },
        },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResult: safeRollfiLog(r0.data) }, "Rollfi addKybInformation response");
    } catch (e) { req.log.warn({ e }, "addKybInformation failed (ignoring)"); }

    // 1 — Initiate KYB verification
    try {
      const r1 = await axios.post(
        `${getBaseUrl()}/companyOnboarding#initiateCompanyKyb`,
        { method: "initiateCompanyKyb", companyId: rollfiCompanyId },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r1.data }, "Rollfi initiateCompanyKyb response");
    } catch (e) { req.log.warn({ e }, "initiateCompanyKyb failed (ignoring)"); }

    // Brief pause — Rollfi sandbox may need a moment to commit KYB status before bank account check
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 2 — Bank account: sandbox uses test values; production skips — Rollfi holds the real account
    //     after first-time submission. To re-add in production use POST /rollfi/onboard/bank-account
    //     with full bank details in the request body.
    if (getRollfiConfig().env !== "production") {
      try {
        const bankAcct = { accountNumber: ein, routingNumber: "221982389", bankName: "BrightBridge Test Bank", accountType: "checking", accountName: "Payroll Account" };
        req.log.info({ bankName: bankAcct.bankName, maskedAcct: `****${bankAcct.accountNumber.slice(-4)}` }, "addCompanyBankAccount: sandbox test values");
        const r2 = await axios.post(
          `${getBaseUrl()}/adminPortal#addCompanyBankAccount`,
          {
            method: "addCompanyBankAccount",
            companyFundingSourceEntity: {
              companyId: rollfiCompanyId,
              accountNumber: bankAcct.accountNumber,
              routingNumber: bankAcct.routingNumber,
              bankName: bankAcct.bankName,
              accountType: bankAcct.accountType,
              accountName: bankAcct.accountName,
            },
          },
          { headers: rollfiHeaders() }
        );
        req.log.info({ rollfiResult: safeRollfiLog(r2.data) }, "Rollfi addCompanyBankAccount response");
      } catch (e) { req.log.warn({ e }, "addCompanyBankAccount failed (ignoring)"); }
    } else {
      req.log.info({ companyId: localCompanyId }, "addCompanyBankAccount: production — Rollfi already holds bank account, skipping");
    }

    // 3 — Pay schedule (BiWeekly W2, starting 2 weeks ago so a period exists now)
    try {
      const today = new Date();
      const payBeginDate = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      const payDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000); // tomorrow
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const r3 = await axios.post(
        `${getBaseUrl()}/payroll#addPaySchedule`,
        {
          method: "addPaySchedule",
          paySchedule: {
            companyId: rollfiCompanyId,
            workerType: "W2",
            standardWorkingHours: 8,
            compensationFrequency: "BiWeekly",
            payBeginDate: fmt(payBeginDate),
            payDate: fmt(payDate),
            paymentMode: "Self-Initiated",
          },
        },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r3.data }, "Rollfi addPaySchedule response");
    } catch (e) { req.log.warn({ e }, "addPaySchedule failed (ignoring)"); }
  }

  // Generate fresh random EIN and owner SSN — avoids Rollfi's "EIN already in use" KYB rejection
  const newEin = randomNineDigits();
  const newOwnerSsn = randomNineDigits();

  try {
    const response = await axios.post(
      `${getBaseUrl()}/companyOnboarding#createBusiness`,
      {
        method: "createBusiness",
        registration: {
          company: company.name,
          businessWebsite: "www.brightbridgeassist.com",
          doingBusinessAs: company.name,
          isTermsAccepted: true,
        },
        kybInformation: {
          ein: newEin,
          entityType: "LLC",
          incorporationState: "New Jersey",
          dateOfIncorporation: "2015-01-01",
          irsAssisgnedFederalFilingForm: "941",
          payrollRunThisYear: "Yes",
          formerPaidThisYear: "No",
        },
        companyLocation: {
          companyLocation: "Main",
          address1: company.address ?? "123 Main St",
          address2: "",
          city: "Newark",
          state: "NJ",
          zipcode: "07101",
          phoneNumber: "9733330001",
          isWorkLocation: true,
          isMailingAddress: true,
          isFilingAddress: true,
        },
        businessUser: {
          firstName: "Joanne",
          middleName: "",
          lastName: "Indiviglio",
          phoneNumber: "9733330001",
          email: "joanne@brightbridgeassist.com",
          address1: "123 Main St",
          address2: "",
          city: "Newark",
          state: "NJ",
          zipcode: "07101",
          ssn: newOwnerSsn,
          dateOfBirth: "1980-01-01",
          payrollAdmin: true,
          bookkeeper: true,
          beneficialOwner: true,
          ownershipPercentage: 100,
        },
      },
      { headers: rollfiHeaders() }
    );

    // safeRollfiLog strips raw fields — never log full response (may echo SSN/bank)
    req.log.info({ rollfiResult: safeRollfiLog(response.data) }, "Rollfi createBusiness response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "createBusiness");

    // Rollfi wraps success under `registration`, but may return a flat object on error
    const reg = (raw.registration ?? raw) as Record<string, unknown>;
    const rollfiCompanyId = (reg.companyId ?? reg.id) as string | undefined;
    const rollfiLocationId = (reg.companyLocationId ?? reg.locationId) as string | undefined;

    if (!rollfiCompanyId) {
      req.log.error({ rollfiResult: safeRollfiLog(raw) }, "Rollfi createBusiness returned unexpected shape — missing companyId");
      res.status(500).json({ error: "Rollfi returned an unexpected response — missing companyId" });
      return;
    }

    await persistRollfiCompany(companyId, {
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      onboardedAt: new Date().toISOString(),
      ein: newEin,
      ownerSsn: newOwnerSsn,
    });

    await ensureFullOnboarding(rollfiCompanyId, companyId);

    res.json({
      success: true,
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      status: reg.status as string | undefined,
      message: reg.message as string | undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // "Ein already in use" or "Company already exists" means this company was registered in a previous server run.
    // Recover by looking up the existing Rollfi company ID via getCompanies.
    if (msg.toLowerCase().includes("ein already in use") || msg.toLowerCase().includes("company already exists")) {
      req.log.warn({ companyName: company.name }, "EIN already in use — looking up existing Rollfi company");
      try {
        const found = await findExistingRollfiCompany(company.name);
        if (found) {
          const rollfiLocationId = await fetchRollfiLocationId(found.companyID);
          await persistRollfiCompany(companyId, {
            rollfiCompanyId: found.companyID,
            rollfiLocationId,
            onboardedAt: new Date().toISOString(),
          });
          await ensureFullOnboarding(found.companyID, companyId);
          req.log.info({ rollfiCompanyId: found.companyID, rollfiLocationId }, "Recovered existing Rollfi company");
          res.json({ success: true, recovered: true, rollfiCompanyId: found.companyID, rollfiLocationId });
          return;
        }
        req.log.error({ companyName: company.name }, "Could not find existing Rollfi company by name");
        res.status(500).json({ error: "EIN already in use and could not find existing Rollfi company by name" });
        return;
      } catch (lookupErr: unknown) {
        req.log.error({ lookupErr }, "getCompanies lookup failed");
        res.status(500).json({ error: "EIN already in use; failed to recover existing company", details: String(lookupErr) });
        return;
      }
    }

    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi company onboarding failed");
    res.status(500).json({ error: "Rollfi company onboarding failed", details: e.response?.data ?? String(err) });
  }
});

// ── Retry company KYB with fresh random EIN ──────────────────
// Works around Rollfi sandbox "EIN already in use" KYB failures.
// Generates new random EIN + owner SSN, re-submits addKybInformation,
// re-initiates initiateCompanyKyb, and re-adds the bank account.

router.post("/rollfi/retry-kyb", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi yet" });
    return;
  }
  const { rollfiCompanyId } = rollfiCompany;
  const headers = rollfiHeaders();

  const newEin = randomNineDigits();
  const newOwnerSsn = randomNineDigits();
  req.log.info({ companyId, rollfiCompanyId, newEin }, "Retrying company KYB with fresh random EIN + SSN");

  const steps: Record<string, unknown> = {};

  // Step 1 — re-submit KYB info with fresh random EIN + beneficial owner SSN.
  // Rollfi KYBs both the company EIN and the beneficial owner SSN — both must be
  // unique in their sandbox or KYB is rejected ("already exists for another user").
  try {
    const r = await axios.post(
      `${getBaseUrl()}/companyOnboarding#addKybInformation`,
      {
        method: "addKybInformation",
        kybInformation: {
          companyId: rollfiCompanyId,
          ein: newEin,
          entityType: "LLC",
          dateOfIncorporation: "2015-01-01",
          incorporationState: "New Jersey",
          irsAssisgnedFederalFilingForm: "941",
          beneficialOwners: [
            {
              firstName: "Joanne",
              lastName: "Indiviglio",
              ssn: newOwnerSsn,
              dateOfBirth: "1980-01-01",
              ownershipPercentage: 100,
              address1: "123 Main St",
              city: "Newark",
              state: "NJ",
              zipcode: "07101",
            },
          ],
        },
      },
      { headers }
    );
    req.log.info({ rollfiResult: safeRollfiLog(r.data) }, "retry-kyb: addKybInformation response");
    steps.addKybInformation = r.data;
  } catch (e) {
    const err = e as { response?: { data: unknown } };
    req.log.warn({ e }, "retry-kyb: addKybInformation failed");
    steps.addKybInformationError = err.response?.data ?? String(e);
  }

  // Step 2 — re-initiate KYB
  try {
    const r = await axios.post(
      `${getBaseUrl()}/companyOnboarding#initiateCompanyKyb`,
      { method: "initiateCompanyKyb", companyId: rollfiCompanyId },
      { headers }
    );
    req.log.info({ rollfiResult: safeRollfiLog(r.data) }, "retry-kyb: initiateCompanyKyb response");
    steps.initiateCompanyKyb = r.data;
  } catch (e) {
    const err = e as { response?: { data: unknown } };
    req.log.warn({ e }, "retry-kyb: initiateCompanyKyb failed");
    steps.initiateCompanyKybError = err.response?.data ?? String(e);
  }

  // Step 3 — re-add bank account (funding source)
  // Sandbox: re-submit with newEin as account number (test bank).
  // Production: skip — Rollfi holds the real account; use POST /rollfi/onboard/bank-account to update.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (getRollfiConfig().env !== "production") {
    try {
      const bankAcct = { accountNumber: newEin, routingNumber: "221982389", bankName: "BrightBridge Test Bank", accountType: "checking", accountName: "Payroll Account" };
      req.log.info({ bankName: bankAcct.bankName, maskedAcct: `****${bankAcct.accountNumber.slice(-4)}` }, "retry-kyb: addCompanyBankAccount sandbox details");
      const r = await axios.post(
        `${getBaseUrl()}/adminPortal#addCompanyBankAccount`,
        {
          method: "addCompanyBankAccount",
          companyFundingSourceEntity: {
            companyId: rollfiCompanyId,
            accountNumber: bankAcct.accountNumber,
            routingNumber: bankAcct.routingNumber,
            bankName: bankAcct.bankName,
            accountType: bankAcct.accountType,
            accountName: bankAcct.accountName,
          },
        },
        { headers }
      );
      req.log.info({ rollfiResult: safeRollfiLog(r.data) }, "retry-kyb: addCompanyBankAccount response");
      steps.addCompanyBankAccount = r.data;
    } catch (e) {
      const err = e as { response?: { data: unknown } };
      req.log.warn({ e }, "retry-kyb: addCompanyBankAccount failed");
      steps.addCompanyBankAccountError = err.response?.data ?? String(e);
    }
  } else {
    req.log.info({ companyId }, "retry-kyb: production — Rollfi already holds bank account, skipping bank step");
    steps.addCompanyBankAccount = { skipped: true, reason: "production: Rollfi holds account" };
  }

  // Persist the new EIN + SSN so future retries don't reuse the same values
  await persistRollfiCompany(companyId, { ...rollfiCompany, ein: newEin, ownerSsn: newOwnerSsn });

  res.json({
    success: true,
    rollfiCompanyId,
    newEin,
    steps,
    message: "KYB re-submitted with a fresh EIN — check Setup Checklist in ~60 seconds to see if KYB passed",
  });
});

// ── Fix pay schedule ─────────────────────────────────────────

router.post("/rollfi/fix-pay-schedule", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId, rollfiCompanyId: rawRollfiId, frequency: rawFrequency } = req.body as { companyId?: string; rollfiCompanyId?: string; frequency?: string };

  // Allow passing rollfiCompanyId + frequency directly (useful for production repairs from dev)
  let rollfiCompanyId: string | undefined = rawRollfiId;
  let compensationFrequency = rawFrequency ?? "BiWeekly";

  if (!rollfiCompanyId && companyId) {
    const [dbCompany] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const rollfiRecord = store.getRollfiCompany(companyId);
    rollfiCompanyId = dbCompany?.rollfiCompanyId || rollfiRecord?.rollfiCompanyId;
    compensationFrequency = (dbCompany?.payFrequency as string | null) ?? compensationFrequency;
  }

  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Provide rollfiCompanyId directly, or a companyId with a known Rollfi mapping" });
    return;
  }
  const gapDays: Record<string, number> = { Weekly: 7, BiWeekly: 14, SemiMonthly: 15, Monthly: 30 };
  const gap = gapDays[compensationFrequency] ?? 14;
  const fmtDate = (d: Date) => d.toISOString().split("T")[0];
  const today = new Date();
  const payBeginDate = fmtDate(new Date(today.getTime() - gap * 86_400_000));
  const payDate = fmtDate(today);

  req.log.info({ companyId, rollfiCompanyId, compensationFrequency, payBeginDate, payDate }, "fix-pay-schedule: attempting fix");
  const headers = rollfiHeaders();
  const results: Record<string, unknown> = {};

  // Try update first (schedule may already exist)
  try {
    const upd = await axios.post(`${getBaseUrl()}/payroll#updatePaySchedule`, {
      method: "updatePaySchedule",
      paySchedule: { companyId: rollfiCompanyId, workerType: "W2", compensationFrequency, payBeginDate, payDate, paymentMode: "Self-Initiated", standardWorkingHours: 8 },
    }, { headers });
    results.updatePaySchedule = upd.data;
    req.log.info({ rollfiResponse: upd.data }, "fix-pay-schedule: updatePaySchedule response");
    if (!(upd.data as Record<string, unknown>).error) {
      res.json({ ok: true, via: "update", compensationFrequency, payBeginDate, payDate, rollfiCompanyId, results });
      return;
    }
  } catch (e) {
    results.updateError = String(e);
    req.log.warn({ e }, "fix-pay-schedule: updatePaySchedule failed, falling back to add");
  }

  // Fallback: addPaySchedule
  try {
    const add = await axios.post(`${getBaseUrl()}/payroll#addPaySchedule`, {
      method: "addPaySchedule",
      paySchedule: { companyId: rollfiCompanyId, workerType: "W2", compensationFrequency, payBeginDate, payDate, paymentMode: "Self-Initiated", standardWorkingHours: 8 },
    }, { headers });
    results.addPaySchedule = add.data;
    req.log.info({ rollfiResponse: add.data }, "fix-pay-schedule: addPaySchedule response");
    res.json({ ok: true, via: "add", compensationFrequency, payBeginDate, payDate, rollfiCompanyId, results });
  } catch (e) {
    results.addError = String(e);
    req.log.error({ e }, "fix-pay-schedule: both update and add failed");
    res.status(500).json({ ok: false, error: "Both updatePaySchedule and addPaySchedule failed", results });
  }
});

// ── Bank account linking ─────────────────────────────────────

router.post("/rollfi/onboard/bank-account", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  const isProduction = getRollfiConfig().env === "production";
  const { bankName: bodyBankName, routingNumber: bodyRouting, accountNumber: bodyAccount, accountType: bodyAccountType } =
    req.body as { bankName?: string; routingNumber?: string; accountNumber?: string; accountType?: string };

  let bankAcct: { accountNumber: string; routingNumber: string; bankName: string; accountType: string; accountName: string };
  if (isProduction) {
    if (!bodyRouting || !bodyAccount || !bodyBankName) {
      res.status(400).json({ error: "Production requires bankName, routingNumber, and accountNumber in the request body. Full numbers are never stored — provide them on each call." });
      return;
    }
    bankAcct = { accountNumber: bodyAccount, routingNumber: bodyRouting, bankName: bodyBankName, accountType: bodyAccountType ?? "checking", accountName: "Payroll Funding" };
  } else {
    bankAcct = { accountNumber: rollfiCompany.ein ?? randomNineDigits(), routingNumber: "221982389", bankName: "BrightBridge Test Bank", accountType: "checking", accountName: "Payroll Account" };
  }
  req.log.info({ env: getRollfiConfig().env, bankName: bankAcct.bankName, maskedAcct: `****${bankAcct.accountNumber.slice(-4)}` }, "onboard/bank-account: using bank details");

  try {
    const r = await axios.post(
      `${getBaseUrl()}/adminPortal#addCompanyBankAccount`,
      {
        method: "addCompanyBankAccount",
        companyFundingSourceEntity: {
          companyId: rollfiCompany.rollfiCompanyId,
          accountNumber: bankAcct.accountNumber,
          routingNumber: bankAcct.routingNumber,
          bankName: bankAcct.bankName,
          accountType: bankAcct.accountType,
          accountName: bankAcct.accountName,
        },
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addCompanyBankAccount response");
    const raw = r.data as Record<string, unknown>;
    // Rollfi returns 200 with error body when bank already linked — treat as success
    const isAlreadyLinked = JSON.stringify(raw).toLowerCase().includes("already");
    res.json({ success: true, alreadyLinked: isAlreadyLinked, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "addCompanyBankAccount failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Funding source status (via getCompanyInfo) ───────────────

router.get("/rollfi/onboard/bank-status", async (req, res) => {
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

  try {
    // Support confirmed: use getCompanyInfo to read current funding source status
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanyInfo`,
      { method: "getCompanyInfo", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "getCompanyInfo response");
    const raw = r.data as Record<string, unknown>;
    // Extract funding source info from Company array
    const companies = Array.isArray(raw.Company) ? raw.Company as Record<string, unknown>[] : [];
    const company = companies[0] ?? {};
    const fundingSources = Array.isArray(company.FundingSources)
      ? company.FundingSources as Record<string, unknown>[]
      : [];
    const active = fundingSources.find((f) => f.status !== "Deactivated") ?? fundingSources[0];
    res.json({ rollfiCompanyId: rollfiCompany.rollfiCompanyId, fundingSource: active ?? null, raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.warn({ err }, "getCompanyInfo failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Micro-deposit verification ────────────────────────────────

router.post("/rollfi/onboard/verify-bank", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  const rollfiCompanyId = rollfiCompany.rollfiCompanyId;

  // Step 1: check current status via getCompanyInfo (confirmed endpoint from Rollfi support)
  let currentStatus: string | undefined;
  try {
    const infoResp = await axios.post(
      `${getBaseUrl()}/reports#getCompanyInfo`,
      { method: "getCompanyInfo", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: infoResp.data }, "getCompanyInfo for verify-bank");
    const infoRaw = infoResp.data as Record<string, unknown>;
    const companies = Array.isArray(infoRaw.Company) ? infoRaw.Company as Record<string, unknown>[] : [];
    const co = companies[0] ?? {};
    const sources = Array.isArray(co.FundingSources) ? co.FundingSources as Record<string, unknown>[] : [];
    const active = sources.find((f) => f.status !== "Deactivated") ?? sources[0];
    currentStatus = active?.status as string | undefined;
    req.log.info({ currentStatus }, "Funding source status from getCompanyInfo");
    if (currentStatus && !["microdeposit pending", "pending"].includes(currentStatus.toLowerCase())) {
      // Already verified or not pending — return early with status
      res.json({ success: currentStatus.toLowerCase() === "ready" || currentStatus.toLowerCase() === "active", currentStatus, rollfiCompanyId, message: `Funding source status: ${currentStatus}` });
      return;
    }
  } catch (e) {
    req.log.warn({ e }, "getCompanyInfo failed in verify-bank — proceeding to verifyMicroDeposits");
  }

  // Step 2: attempt micro-deposit verification
  const { debitAmount1 = 0.01, debitAmount2 = 0.01 } = req.body as { debitAmount1?: number; debitAmount2?: number };
  try {
    const r = await axios.post(
      `${getBaseUrl()}/adminPortal#verifyMicroDeposits`,
      { method: "verifyMicroDeposits", companyId: rollfiCompanyId, debitAmount1, debitAmount2 },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data, debitAmount1, debitAmount2 }, "verifyMicroDeposits response");
    const raw = r.data as Record<string, unknown>;
    const verified = String(raw.status ?? "").toLowerCase() === "success" || String(raw.message ?? "").toLowerCase().includes("success");
    res.json({ success: verified, rollfiCompanyId, currentStatus, verifyResponse: raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.warn({ err, rollfiErrorBody: e.response?.data }, "verifyMicroDeposits failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── State Tax Registrations ───────────────────────────────────

router.get("/rollfi/state-fields/:stateCode", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { stateCode } = req.params;
  try {
    const response = await axios({
      method: "get",
      url: `${getBaseUrl()}/reports/getStateRegistrationFields`,
      data: { method: "getStateRegistrationFields", code: stateCode },
      headers: rollfiHeaders(),
    });
    res.json(response.data);
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, stateCode }, "getStateRegistrationFields failed");
    res.status(500).json({ error: "Failed to fetch state fields from Rollfi", details: e.response?.data });
  }
});

router.get("/rollfi/state-registrations", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  try {
    const rows = await db.select().from(stateRegistrationsTable).where(eq(stateRegistrationsTable.companyId, companyId));
    res.json({ registrations: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list state registrations");
    res.status(500).json({ error: "Failed to list state registrations" });
  }
});

router.post("/rollfi/onboard/state-registration", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { companyId, stateCode, stateName, fieldValues } = req.body as {
    companyId: string; stateCode: string; stateName: string;
    fieldValues: Record<string, string>;
  };
  if (!companyId || !stateCode || !fieldValues || Object.keys(fieldValues).length === 0) {
    res.status(400).json({ error: "companyId, stateCode, and fieldValues are required" }); return;
  }

  // Resolve rollfiCompanyId from store or DB
  let rollfiCompanyId = store.getRollfiCompany(companyId)?.rollfiCompanyId;
  if (!rollfiCompanyId) {
    const [dbCo] = await db.select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => [undefined]);
    rollfiCompanyId = dbCo?.rollfiCompanyId ?? undefined;
  }
  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company is not yet registered with Rollfi. Complete Rollfi onboarding first." }); return;
  }

  // Guard: no duplicate per company+state (allow retry if previously failed)
  const [existing] = await db.select().from(stateRegistrationsTable)
    .where(and(eq(stateRegistrationsTable.companyId, companyId), eq(stateRegistrationsTable.stateCode, stateCode)))
    .catch(() => [undefined]);
  if (existing && existing.status !== "failed") {
    res.status(400).json({ error: `${stateName} (${stateCode}) is already registered for this company.`, existing }); return;
  }

  const id = existing?.id ?? `SR-${stateCode}-${Date.now()}`;
  const nowISO = new Date().toISOString();
  const fieldValuesJson = JSON.stringify(fieldValues);

  try {
    const response = await axios.post(
      `${getBaseUrl()}/adminPortal/addStateRegistrationInfo`,
      {
        method: "addStateRegistrationInfo",
        companyId: rollfiCompanyId,
        code: stateCode,
        companyStateRegistration: fieldValues,
      },
      { headers: rollfiHeaders() }
    );
    // Rollfi returns HTTP 200 even on errors — check the body for an error object
    const rollfiErr = (response.data as { error?: { code?: number; message?: string } })?.error;
    if (rollfiErr) {
      req.log.error({ rollfiResponse: response.data, companyId, stateCode }, "Rollfi addStateRegistrationInfo returned error in body");
      const failValues = {
        id, companyId, rollfiCompanyId, stateCode, stateName,
        stateEmployerId: null, suiAccountNumber: null, suiRate: null,
        fieldValuesJson,
        status: "failed" as const, rollfiResponse: JSON.stringify(response.data), registeredAt: nowISO, updatedAt: nowISO,
      };
      if (existing) {
        await db.update(stateRegistrationsTable).set(failValues).where(eq(stateRegistrationsTable.id, id)).catch(() => {});
      } else {
        await db.insert(stateRegistrationsTable).values(failValues).catch(() => {});
      }
      res.status(400).json({ error: rollfiErr.message ?? "Rollfi rejected state registration", rollfiResponse: response.data }); return;
    }

    req.log.info({ rollfiResponse: response.data, companyId, stateCode }, "Rollfi addStateRegistrationInfo response");

    const values = {
      id, companyId, rollfiCompanyId, stateCode, stateName,
      stateEmployerId: null, suiAccountNumber: null, suiRate: null,
      fieldValuesJson,
      status: "active" as const, rollfiResponse: JSON.stringify(response.data), registeredAt: nowISO, updatedAt: nowISO,
    };
    const [saved] = existing
      ? await db.update(stateRegistrationsTable).set({ ...values }).where(eq(stateRegistrationsTable.id, id)).returning()
      : await db.insert(stateRegistrationsTable).values(values).returning();

    res.json({ success: true, registration: saved, rollfiResponse: response.data });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, companyId, stateCode, rollfiErrorBody: e.response?.data }, "addStateRegistrationInfo failed");

    const failValues = {
      id, companyId, rollfiCompanyId, stateCode, stateName,
      stateEmployerId: null, suiAccountNumber: null, suiRate: null,
      fieldValuesJson,
      status: "failed" as const, rollfiResponse: JSON.stringify(e.response?.data ?? String(err)), registeredAt: nowISO, updatedAt: nowISO,
    };
    if (existing) {
      await db.update(stateRegistrationsTable).set(failValues).where(eq(stateRegistrationsTable.id, id)).catch(() => {});
    } else {
      await db.insert(stateRegistrationsTable).values(failValues).catch(() => {});
    }

    res.status(500).json({ error: "Rollfi state registration failed", details: e.response?.data ?? String(err) });
  }
});

router.post("/rollfi/state-registrations/:id/retry", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { id } = req.params;

  const [reg] = await db.select().from(stateRegistrationsTable).where(eq(stateRegistrationsTable.id, id)).catch(() => [undefined]);
  if (!reg) { res.status(404).json({ error: "State registration not found" }); return; }

  let rollfiCompanyId: string | undefined = reg.rollfiCompanyId ?? store.getRollfiCompany(reg.companyId)?.rollfiCompanyId ?? undefined;
  if (!rollfiCompanyId) {
    const [dbCo] = await db.select({ rollfiCompanyId: companiesTable.rollfiCompanyId }).from(companiesTable).where(eq(companiesTable.id, reg.companyId)).catch(() => [undefined]);
    rollfiCompanyId = dbCo?.rollfiCompanyId ?? undefined;
  }
  if (!rollfiCompanyId) { res.status(400).json({ error: "Company not registered with Rollfi." }); return; }

  const nowISO = new Date().toISOString();

  // Use stored dynamic fieldValues if available; fall back to legacy static mapping for old records
  const companyStateRegistration: Record<string, string> = reg.fieldValuesJson
    ? JSON.parse(reg.fieldValuesJson) as Record<string, string>
    : buildStateRegistrationPayload(reg.stateCode, reg.stateEmployerId ?? "", reg.suiAccountNumber, reg.suiRate ?? 2.8);

  // Detect whether this state is already registered at the provider (i.e. the
  // prior failure was a duplicate-registration error).  If so, we must call
  // updateStateRegistrationInfo instead of addStateRegistrationInfo — calling
  // add again would produce the same "already registered" 400 error.
  const isAlreadyAtProvider = (() => {
    if (!reg.rollfiResponse) return false;
    try {
      const parsed = JSON.parse(reg.rollfiResponse) as { error?: { message?: string } };
      return /already registered/i.test(parsed?.error?.message ?? "");
    } catch { return false; }
  })();

  const rollfiMethodName = isAlreadyAtProvider ? "updateStateRegistrationInfo" : "addStateRegistrationInfo";
  const rollfiEndpoint   = isAlreadyAtProvider
    ? `${getBaseUrl()}/adminPortal/updateStateRegistrationInfo`
    : `${getBaseUrl()}/adminPortal/addStateRegistrationInfo`;

  req.log.info({ regId: id, stateCode: reg.stateCode, rollfiMethod: rollfiMethodName, isAlreadyAtProvider },
    "state-reg retry: routing to provider method");

  try {
    const response = await axios.post(
      rollfiEndpoint,
      {
        method: rollfiMethodName,
        companyId: rollfiCompanyId,
        code: reg.stateCode,
        companyStateRegistration,
      },
      { headers: rollfiHeaders() }
    );
    // Provider returns HTTP 200 even on errors — check the body for an error object
    const rollfiRetryErr = (response.data as { error?: { code?: number; message?: string } })?.error;
    if (rollfiRetryErr) {
      req.log.error({ rollfiResponse: response.data, regId: id, stateCode: reg.stateCode, rollfiMethod: rollfiMethodName }, "state-reg retry: provider returned body error");
      await db.update(stateRegistrationsTable)
        .set({ status: "failed", rollfiResponse: JSON.stringify(response.data), updatedAt: nowISO })
        .where(eq(stateRegistrationsTable.id, id)).catch(() => {});
      res.status(400).json({ error: rollfiRetryErr.message ?? "Provider rejected state registration", rollfiResponse: response.data }); return;
    }

    req.log.info({ rollfiResponse: response.data, regId: id, stateCode: reg.stateCode, rollfiMethod: rollfiMethodName }, "state-reg retry: success");

    const [updated] = await db.update(stateRegistrationsTable)
      .set({ status: "active", rollfiCompanyId, rollfiResponse: JSON.stringify(response.data), updatedAt: nowISO })
      .where(eq(stateRegistrationsTable.id, id)).returning();

    res.json({ success: true, registration: updated });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, regId: id, rollfiErrorBody: e.response?.data }, "addStateRegistrationInfo retry failed");
    await db.update(stateRegistrationsTable)
      .set({ status: "failed", rollfiResponse: JSON.stringify(e.response?.data ?? String(err)), updatedAt: nowISO })
      .where(eq(stateRegistrationsTable.id, id)).catch(() => {});
    res.status(500).json({ error: "Retry failed", details: e.response?.data ?? String(err) });
  }
});

// ── Employee onboarding ──────────────────────────────────────

router.post("/rollfi/onboard/employee", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "ROLLFI_CLIENT_ID and ROLLFI_SECRET_KEY are not configured" });
    return;
  }

  const { employeeId, companyId } = req.body as { employeeId: string; companyId: string };

  let rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company must be onboarded to Rollfi before adding employees" });
    return;
  }

  const existing = store.getRollfiEmployee(employeeId);
  if (existing) { res.json({ success: true, alreadyOnboarded: true, ...existing }); return; }

  const staffUser = store.getAllStaffUsers().find((u) => u.employeeId === employeeId);
  if (!staffUser) { res.status(404).json({ error: "Employee not found" }); return; }

  const nameParts = staffUser.name.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ") || "Staff";
  const wage = staffUser.hourlyWage ?? 1500;

  // Look up pay-type fields from DB (the in-memory store only carries hourlyWage)
  const [dbPayInfo] = await db.select({
    payType:         employeesTable.payType,
    hourlyWage:      employeesTable.hourlyWage,
    annualSalary:    employeesTable.annualSalary,
    overtimeEligible: employeesTable.overtimeEligible,
    phone:           employeesTable.phone,
    startDate:       employeesTable.startDate,
    homeState:       employeesTable.homeState,
  }).from(employeesTable).where(eq(employeesTable.id, employeeId)).catch(() => [] as never[]);

  // If location ID is missing (e.g. company was recovered via getCompanies), fetch it now
  if (!rollfiCompany.rollfiLocationId) {
    try {
      const locationId = await (async () => {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getCompanyLocationInfo`,
          { method: "getCompanyLocationInfo", companyId: rollfiCompany.rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        const locs = (r.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
        const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
        return work?.companyLocationID ?? "";
      })();
      if (locationId) {
        rollfiCompany = { ...rollfiCompany, rollfiLocationId: locationId };
        await persistRollfiCompany(companyId, rollfiCompany);
        req.log.info({ locationId }, "Lazily resolved Rollfi location ID");
      }
    } catch (locErr) {
      req.log.warn({ locErr }, "Could not fetch Rollfi location ID — proceeding without it");
    }
  }

  try {
    const addUserResp = await axios.post(
      `${getBaseUrl()}/adminPortal#addUser`,
      {
        method: "addUser",
        user: {
          companyId: rollfiCompany.rollfiCompanyId,
          firstName,
          middleName: "",
          lastName,
          email: staffUser.email,
          phoneNumber: (() => {
            // Strip formatting — Rollfi expects raw 10 digits (no dashes/parens/spaces)
            const digits = (dbPayInfo?.phone ?? "").replace(/\D/g, "");
            return digits.length >= 10 ? digits.slice(-10) : "9733330001";
          })(),
          dateOfJoin: dbPayInfo?.startDate ?? new Date().toISOString().slice(0, 10),
          workerType: "W2",
          jobTitle: staffUser.position,
          companyLocationCategory: "Office",
          stateCode: dbPayInfo?.homeState ?? "NJ",
          companyLocationId: rollfiCompany.rollfiLocationId,
        },
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResult: safeRollfiLog(addUserResp.data) }, "Rollfi addUser response");

    const addUserRaw = addUserResp.data as Record<string, unknown>;
    assertNoRollfiError(addUserRaw, "addUser");
    const userObj = (addUserRaw.user ?? addUserRaw) as Record<string, unknown>;
    const rollfiUserId = (userObj.userId ?? userObj.id) as string | undefined;

    if (!rollfiUserId) {
      req.log.error({ rollfiResult: safeRollfiLog(addUserRaw) }, "Rollfi addUser returned unexpected shape — missing userId");
      res.status(500).json({
        error: "Rollfi returned an unexpected response for addUser — missing userId",
      });
      return;
    }

    // addUserWage FIRST — Rollfi rejects initiateUserKyc when no wage record exists yet.
    const _wf1 = getRollfiWageFields({
      payType:         dbPayInfo?.payType,
      hourlyWage:      dbPayInfo?.hourlyWage ?? wage,
      annualSalary:    dbPayInfo?.annualSalary ?? null,
      overtimeEligible: dbPayInfo?.overtimeEligible ?? true,
    });
    const addWageResp = await axios.post(
      `${getBaseUrl()}/adminPortal#addUserWage`,
      {
        method: "addUserWage",
        userWage: {
          companyId: rollfiCompany.rollfiCompanyId,
          userId: rollfiUserId,
          differentialPay: "No",
          wageRate: _wf1.wageRate,
          workerType: "W2",
          wageBasis: _wf1.wageBasis,
          userType: _wf1.userType,
          employmentStatus: "Full Time (30+ Hours per week)",
          userRefTaxExempt: "No, this employee is not tax exempt",
          startDate: dbPayInfo?.startDate ?? new Date().toISOString().slice(0, 10),
          paymentMethod: "Direct Deposit",
        },
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResult: safeRollfiLog(addWageResp.data) }, "Rollfi addUserWage response");

    const addWageRaw = addWageResp.data as Record<string, unknown>;
    assertNoRollfiError(addWageRaw, "addUserWage"); // surface errors instead of silently swallowing
    const wageObj = (addWageRaw.userWage ?? addWageRaw) as Record<string, unknown>;
    const rollfiWageId = (wageObj.userWageId ?? wageObj.id) as string | undefined;

    await persistRollfiEmployee(employeeId, {
      rollfiUserId,
      rollfiWageId: rollfiWageId ?? "",
      onboardedAt: new Date().toISOString(),
    });

    // KYC runs AFTER wage — use structured runKycOnboardingNew so hard/soft classification
    // is consistent with the repair-onboarding endpoint; result is never discarded.
    const kycResult = await runKycOnboardingNew(
      rollfiUserId,
      rollfiCompany.rollfiCompanyId,
      req.log,
      { filingStatus: "Single", multipleJobs: false, dependents: 0, extraWithholding: 0, homeState: dbPayInfo?.homeState ?? "NJ" }
    );

    const nowISO = new Date().toISOString();
    if (kycResult.hardErrors.length > 0) {
      await db.update(employeesTable).set({
        lastSyncError: JSON.stringify({ failedSteps: kycResult.hardErrors, softWarnings: kycResult.softWarnings }),
        syncStatus: "error",
        updatedAt: nowISO,
      }).where(eq(employeesTable.id, employeeId));
      req.log.warn({ employeeId, rollfiUserId, hardErrors: kycResult.hardErrors }, "KYC onboarding completed with hard failures — employee is payroll-ineligible until repaired");
    } else {
      await db.update(employeesTable).set({ lastSyncError: null, syncStatus: "synced", updatedAt: nowISO }).where(eq(employeesTable.id, employeeId));
    }

    res.json({
      success: true,
      rollfiUserId,
      rollfiWageId: rollfiWageId ?? "",
      rollfiFailedSteps: kycResult.hardErrors,
      rollfiSoftWarnings: kycResult.softWarnings,
      userStatus: userObj.status as string | undefined,
      wageStatus: wageObj.status as string | undefined,
      message: kycResult.hardErrors.length > 0
        ? "Payroll account created but identity verification could not be started — this employee cannot be paid until it completes"
        : (userObj.message as string | undefined),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // "Email already in use" means this employee was registered in a previous server run.
    // Recovery: try getUsers (all statuses, not just active) then fall back to a stable derived ID.
    if (msg.toLowerCase().includes("email already in use")) {
      req.log.warn({ email: staffUser.email }, "Email already in use — looking up existing Rollfi employee via getUsers");
      try {
        // getUsers returns ALL users (active + inactive + pending KYC) — key is `users` not `user`
        const usersResp = await axios.post(
          `${getBaseUrl()}/reports#getUsers`,
          { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        req.log.info({ rollfiResult: safeRollfiLog(usersResp.data) }, "Rollfi getUsers response");

        type RollfiUser = { userId: string; email?: string; user?: string };
        const users = (usersResp.data as { users?: RollfiUser[] }).users ?? [];
        const found = users.find((u) => u.email?.toLowerCase() === staffUser.email.toLowerCase());

        if (found?.userId) {
          // Store immediately so later steps can reference the userId
          await persistRollfiEmployee(employeeId, {
            rollfiUserId: found.userId,
            rollfiWageId: "",
            onboardedAt: new Date().toISOString(),
          });
          req.log.info({ rollfiUserId: found.userId }, "Recovered existing Rollfi employee via getUsers");

          // Ensure wage is set FIRST — Rollfi rejects initiateUserKyc when no wage record exists
          let rollfiWageId = "";
          try {
            const _wf2 = getRollfiWageFields({
              payType:         dbPayInfo?.payType,
              hourlyWage:      dbPayInfo?.hourlyWage ?? staffUser.hourlyWage ?? 1500,
              annualSalary:    dbPayInfo?.annualSalary ?? null,
              overtimeEligible: dbPayInfo?.overtimeEligible ?? true,
            });
            const addWageResp = await axios.post(
              `${getBaseUrl()}/adminPortal#addUserWage`,
              {
                method: "addUserWage",
                userWage: {
                  companyId: rollfiCompany.rollfiCompanyId,
                  userId: found.userId,
                  differentialPay: "No",
                  wageRate: _wf2.wageRate,
                  workerType: "W2",
                  wageBasis: _wf2.wageBasis,
                  userType: _wf2.userType,
                  employmentStatus: "Full Time (30+ Hours per week)",
                  userRefTaxExempt: "No, this employee is not tax exempt",
                  startDate: dbPayInfo?.startDate ?? new Date().toISOString().slice(0, 10),
                  paymentMethod: "Direct Deposit",
                },
              },
              { headers: rollfiHeaders() }
            );
            req.log.info({ rollfiResult: safeRollfiLog(addWageResp.data) }, "Rollfi addUserWage (recovery) response");
            const wageRaw = addWageResp.data as Record<string, unknown>;
            const wageObj = (wageRaw.userWage ?? wageRaw) as Record<string, unknown>;
            rollfiWageId = (wageObj.userWageId ?? wageObj.id ?? "") as string;
          } catch (wageErr) {
            req.log.warn({ wageErr }, "addUserWage (recovery) failed — wage may already exist");
          }

          await persistRollfiEmployee(employeeId, {
            rollfiUserId: found.userId,
            rollfiWageId,
            onboardedAt: new Date().toISOString(),
          });

          // KYC runs AFTER wage — use structured runKycOnboardingNew for consistent classification
          const recoveryKycResult = await runKycOnboardingNew(
            found.userId,
            rollfiCompany.rollfiCompanyId,
            req.log,
            { filingStatus: "Single", multipleJobs: false, dependents: 0, extraWithholding: 0, homeState: dbPayInfo?.homeState ?? "NJ" }
          );

          const recoveryNowISO = new Date().toISOString();
          if (recoveryKycResult.hardErrors.length > 0) {
            await db.update(employeesTable).set({
              lastSyncError: JSON.stringify({ failedSteps: recoveryKycResult.hardErrors, softWarnings: recoveryKycResult.softWarnings }),
              syncStatus: "error",
              updatedAt: recoveryNowISO,
            }).where(eq(employeesTable.id, employeeId));
            req.log.warn({ employeeId, rollfiUserId: found.userId, hardErrors: recoveryKycResult.hardErrors }, "KYC onboarding (recovery) completed with hard failures — employee is payroll-ineligible until repaired");
          } else {
            await db.update(employeesTable).set({ lastSyncError: null, syncStatus: "synced", updatedAt: recoveryNowISO }).where(eq(employeesTable.id, employeeId));
          }

          res.json({
            success: true,
            recovered: true,
            rollfiUserId: found.userId,
            rollfiWageId,
            rollfiFailedSteps: recoveryKycResult.hardErrors,
            rollfiSoftWarnings: recoveryKycResult.softWarnings,
            message: recoveryKycResult.hardErrors.length > 0
              ? "Payroll account recovered but identity verification could not be started — this employee cannot be paid until it completes"
              : undefined,
          });
          return;
        }

        // User not in this company's list — email may be registered globally in Rollfi sandbox.
        // Derive a stable placeholder ID so we can mark the employee as onboarded.
        // (initiatePayroll only needs companyId + payPeriodId, not individual userIds)
        req.log.warn({ email: staffUser.email, userCount: users.length }, "User not found in getUsers — using stable derived ID");
        const stableId = deriveStableId(staffUser.email);
        await persistRollfiEmployee(employeeId, {
          rollfiUserId: stableId,
          rollfiWageId: "",
          onboardedAt: new Date().toISOString(),
        });
        res.json({ success: true, recovered: true, derivedId: true, rollfiUserId: stableId });
        return;
      } catch (lookupErr: unknown) {
        req.log.error({ lookupErr }, "getUsers lookup failed");
        res.status(500).json({ error: "Email already in use; failed to recover existing employee", details: String(lookupErr) });
        return;
      }
    }

    const e = err as { response?: { data: unknown; status: number } };
    // safeRollfiLog strips raw response body — Rollfi error responses may echo submitted KYC/bank data
    req.log.error({ rollfiResult: safeRollfiLog(e.response?.data), status: e.response?.status, msg: err instanceof Error ? err.message : String(err) }, "Rollfi employee onboarding failed");
    res.status(500).json({ error: "Rollfi employee onboarding failed", details: safeRollfiLog(e.response?.data) });
  }
});

// ── Retry KYC for an already-onboarded employee ──────────────
// Useful when addKycInformation failed on the first onboard attempt,
// leaving KYC in "new" state and account stuck on "Pending".

// ── Fix wage rate already sent to Rollfi at wrong amount (100x) ─────────
// Called when an employee was onboarded before the cents→dollars fix.
// Tries editUserWage first (update in-place), then addUserWage (add new record).

router.post("/rollfi/employees/:rollfiUserId/fix-wage", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { rollfiUserId } = req.params;
  const { companyId } = req.body as { companyId: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

  // Find the staff user whose rollfi record matches this rollfiUserId
  const allUsers = store.getAllStaffUsers().filter(u => u.companyId === companyId);
  const staffUser = allUsers.find(u => {
    const rec = u.employeeId ? store.getRollfiEmployee(u.employeeId) : null;
    return rec?.rollfiUserId === rollfiUserId;
  });
  // Look up pay type from DB (the store only has hourlyWage; employees table has annualSalary + payType)
  const fixWageEmpId = staffUser?.employeeId;
  const [fixWageDbInfo] = fixWageEmpId
    ? await db.select({
        payType:         employeesTable.payType,
        hourlyWage:      employeesTable.hourlyWage,
        annualSalary:    employeesTable.annualSalary,
        overtimeEligible: employeesTable.overtimeEligible,
      }).from(employeesTable).where(eq(employeesTable.id, fixWageEmpId)).catch(() => [] as never[])
    : [undefined];
  const _wfFix = getRollfiWageFields({
    payType:         fixWageDbInfo?.payType,
    hourlyWage:      fixWageDbInfo?.hourlyWage ?? staffUser?.hourlyWage ?? 1800,
    annualSalary:    fixWageDbInfo?.annualSalary ?? null,
    overtimeEligible: fixWageDbInfo?.overtimeEligible ?? true,
  });
  const wageRateDollars = _wfFix.wageRate; // preserved for logging

  const rollfiWageId = staffUser?.employeeId ? store.getRollfiEmployee(staffUser.employeeId)?.rollfiWageId : undefined;

  req.log.info({ rollfiUserId, wageRateDollars, rollfiWageId }, "Fixing wage rate in Rollfi");

  const headers = rollfiHeaders();

  // If we don't have the wageId stored, try to fetch it from Rollfi
  let resolvedWageId = rollfiWageId;
  if (!resolvedWageId) {
    // Try variant 1: with companyId
    for (const body of [
      { method: "getUserWage", userId: rollfiUserId, companyId: rollfiCompany.rollfiCompanyId },
      { method: "getUserWage", userId: rollfiUserId },
      { method: "getUserWage", rollfiUserId, companyId: rollfiCompany.rollfiCompanyId },
    ]) {
      try {
        const r = await axios.post(
          `${getBaseUrl()}/adminPortal#getUserWage`,
          body,
          { headers, validateStatus: () => true }
        );
        req.log.info({ status: r.status, rollfiResult: safeRollfiLog(r.data) }, "fix-wage: getUserWage attempt");
        if (r.status === 200) {
          const raw = r.data as Record<string, unknown>;
          const wages = Array.isArray(raw.userWages) ? raw.userWages as Array<Record<string, unknown>>
            : raw.userWageId ? [raw] : [];
          const active = wages.find(w => (w.status as string)?.toLowerCase() !== "inactive") ?? wages[0];
          resolvedWageId = (active?.userWageId ?? active?.id) as string | undefined;
          if (resolvedWageId) break;
        }
      } catch (e) {
        req.log.warn({ e }, "fix-wage: getUserWage attempt threw");
      }
    }
    req.log.info({ resolvedWageId }, "fix-wage: resolved wageId from Rollfi");
  }

  // Attempt 1: updateUserWage — Rollfi's correct method for updating existing wage records
  // (Rollfi error message explicitly says: "You can update using the updateUserWage API")
  if (resolvedWageId) {
    try {
      const r = await axios.post(
        `${getBaseUrl()}/adminPortal#updateUserWage`,
        {
          method: "updateUserWage",
          userWage: {
            companyId: rollfiCompany.rollfiCompanyId,
            userId: rollfiUserId,
            userWageId: resolvedWageId,
            wageRate: _wfFix.wageRate,
            wageBasis: _wfFix.wageBasis,
            workerType: "W2",
            differentialPay: "No",
            userType: _wfFix.userType,
            employmentStatus: "Full Time (30+ Hours per week)",
            userRefTaxExempt: "No, this employee is not tax exempt",
            paymentMethod: "Direct Deposit",
          },
        },
        { headers }
      );
      req.log.info({ rollfiResult: safeRollfiLog(r.data) }, "fix-wage: updateUserWage response");
      const raw = r.data as Record<string, unknown>;
      const errMsg = (raw.error as Record<string, unknown> | undefined)?.message as string | undefined;
      if (!errMsg) {
        // Persist the wageId in case it was missing before
        if (staffUser?.employeeId && resolvedWageId) {
          const existing = store.getRollfiEmployee(staffUser.employeeId);
          if (existing) await persistRollfiEmployee(staffUser.employeeId, { ...existing, rollfiWageId: resolvedWageId });
        }
        res.json({ success: true, method: "updateUserWage", wageRateDollars });
        return;
      }
      req.log.warn({ errMsg }, "fix-wage: updateUserWage returned error body");
    } catch (e) {
      req.log.warn({ e }, "fix-wage: updateUserWage failed");
    }
  }

  // Attempt 2: addUserWage — fallback when no wageId is available (seeded employees whose
  // wageId was never persisted during KYC onboarding). Rollfi may create a second wage
  // record, but the most recent active one takes precedence for payroll calculations.
  try {
    const r2 = await axios.post(
      `${getBaseUrl()}/adminPortal#addUserWage`,
      {
        method: "addUserWage",
        userWage: {
          companyId: rollfiCompany.rollfiCompanyId,
          userId: rollfiUserId,
          wageRate: _wfFix.wageRate,
          wageBasis: _wfFix.wageBasis,
          workerType: "W2",
          differentialPay: "No",
          userType: _wfFix.userType,
          employmentStatus: "Full Time (30+ Hours per week)",
          userRefTaxExempt: "No, this employee is not tax exempt",
          paymentMethod: "Direct Deposit",
        },
      },
      { headers }
    );
    req.log.info({ rollfiResult: safeRollfiLog(r2.data) }, "fix-wage: addUserWage (fallback) response");
    const raw2 = r2.data as Record<string, unknown>;
    const errMsg2 = (raw2.error as Record<string, unknown> | undefined)?.message as string | undefined;
    if (!errMsg2) {
      const newWageId = (raw2.userWage as Record<string, unknown> | undefined)?.userWageId as string | undefined;
      if (staffUser?.employeeId && newWageId) {
        const existing = store.getRollfiEmployee(staffUser.employeeId);
        if (existing) await persistRollfiEmployee(staffUser.employeeId, { ...existing, rollfiWageId: newWageId });
      }
      res.json({ success: true, method: "addUserWage", wageRateDollars });
      return;
    }
    req.log.warn({ errMsg2 }, "fix-wage: addUserWage (fallback) returned error body");
    res.status(400).json({ error: errMsg2, wageRateDollars });
    return;
  } catch (e2) {
    req.log.warn({ e2 }, "fix-wage: addUserWage (fallback) failed");
  }

  res.status(400).json({
    error: "Could not update wage in Rollfi — both updateUserWage and addUserWage failed.",
    wageRateDollars,
    resolvedWageId: resolvedWageId ?? null,
  });
});

// ── Repair wages for all store-based employees with Rollfi records ──
// One-shot repair: pushes correct hourlyWage (in dollars) from our store to Rollfi
// for every store employee that has been onboarded. Safe to call repeatedly.

router.post("/rollfi/repair-store-wages", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const headers = rollfiHeaders();
  const allUsers = store.getAllStaffUsers().filter(u => u.employeeId && u.role === "employee");
  const results: Array<Record<string, unknown>> = [];

  // Batch-load pay type data for all employees
  const _repairEmpIds = allUsers.map(u => u.employeeId).filter((id): id is string => !!id);
  const _repairPayRows = _repairEmpIds.length > 0
    ? await db.select({
        id:              employeesTable.id,
        payType:         employeesTable.payType,
        hourlyWage:      employeesTable.hourlyWage,
        annualSalary:    employeesTable.annualSalary,
        overtimeEligible: employeesTable.overtimeEligible,
      }).from(employeesTable).where(inArray(employeesTable.id, _repairEmpIds)).catch(() => [] as never[])
    : [];
  const _repairPayMap = new Map(_repairPayRows.map(r => [r.id, r]));

  for (const u of allUsers) {
    const rollfiRec = store.getRollfiEmployee(u.employeeId!);
    if (!rollfiRec?.rollfiUserId) continue;

    const rollfiUserId  = rollfiRec.rollfiUserId;
    const _empPay = u.employeeId ? _repairPayMap.get(u.employeeId) : undefined;
    const _wfRepair = getRollfiWageFields({
      payType:         _empPay?.payType,
      hourlyWage:      _empPay?.hourlyWage ?? u.hourlyWage ?? 1500,
      annualSalary:    _empPay?.annualSalary ?? null,
      overtimeEligible: _empPay?.overtimeEligible ?? true,
    });
    const wageRateDollars = _wfRepair.wageRate; // preserved for logging
    const rollfiCompany = store.getRollfiCompany(u.companyId);
    if (!rollfiCompany) continue;

    let resolvedWageId = rollfiRec.rollfiWageId;
    if (!resolvedWageId) {
      for (const body of [
        { method: "getUserWage", userId: rollfiUserId, companyId: rollfiCompany.rollfiCompanyId },
        { method: "getUserWage", userId: rollfiUserId },
      ]) {
        try {
          const r = await axios.post(
            `${getBaseUrl()}/adminPortal#getUserWage`,
            body,
            { headers, validateStatus: () => true }
          );
          req.log.info({ status: r.status, rollfiResult: safeRollfiLog(r.data), name: u.name }, "repair-store-wages: getUserWage attempt");
          if (r.status === 200) {
            const raw = r.data as Record<string, unknown>;
            const wages = Array.isArray(raw.userWages) ? raw.userWages as Array<Record<string, unknown>>
              : raw.userWageId ? [raw] : [];
            const active = wages.find(w => (w.status as string)?.toLowerCase() !== "inactive") ?? wages[0];
            resolvedWageId = (active?.userWageId ?? active?.id) as string | undefined;
            if (resolvedWageId) break;
          }
        } catch (e) {
          req.log.warn({ e, rollfiUserId, name: u.name }, "repair-store-wages: getUserWage attempt threw");
        }
      }
      req.log.info({ resolvedWageId, rollfiUserId, name: u.name }, "repair-store-wages: resolved wageId");
    }

    let repairSuccess = false;
    let repairMethod = "";
    let repairError: string | null = null;
    let repairResponse: unknown = null;

    if (resolvedWageId) {
      try {
        const r = await axios.post(`${getBaseUrl()}/adminPortal#updateUserWage`, {
          method: "updateUserWage",
          userWage: {
            companyId: rollfiCompany.rollfiCompanyId,
            userId: rollfiUserId,
            userWageId: resolvedWageId,
            wageRate: _wfRepair.wageRate,
            wageBasis: _wfRepair.wageBasis,
            workerType: "W2",
            differentialPay: "No",
            userType: _wfRepair.userType,
            employmentStatus: "Full Time (30+ Hours per week)",
            userRefTaxExempt: "No, this employee is not tax exempt",
            paymentMethod: "Direct Deposit",
          },
        }, { headers });
        req.log.info({ rollfiUserId, name: u.name, rollfiResult: safeRollfiLog(r.data) }, "repair-store-wages: updateUserWage response");
        const raw = r.data as Record<string, unknown>;
        const errMsg = (raw.error as Record<string, unknown> | undefined)?.message as string | undefined;
        if (!errMsg) {
          repairSuccess = true; repairMethod = "updateUserWage"; repairResponse = raw;
          if (u.employeeId) {
            const existing = store.getRollfiEmployee(u.employeeId);
            if (existing) await persistRollfiEmployee(u.employeeId, { ...existing, rollfiWageId: resolvedWageId });
          }
        } else {
          repairError = errMsg;
        }
      } catch (e) {
        repairError = e instanceof Error ? e.message : String(e);
        req.log.warn({ rollfiUserId, name: u.name, err: e }, "repair-store-wages: updateUserWage HTTP error");
      }
    }

    // Fallback: addUserWage when no wageId available or update failed
    if (!repairSuccess) {
      try {
        const r2 = await axios.post(`${getBaseUrl()}/adminPortal#addUserWage`, {
          method: "addUserWage",
          userWage: {
            companyId: rollfiCompany.rollfiCompanyId,
            userId: rollfiUserId,
            wageRate: _wfRepair.wageRate,
            wageBasis: _wfRepair.wageBasis,
            workerType: "W2",
            differentialPay: "No",
            userType: _wfRepair.userType,
            employmentStatus: "Full Time (30+ Hours per week)",
            userRefTaxExempt: "No, this employee is not tax exempt",
            paymentMethod: "Direct Deposit",
          },
        }, { headers });
        req.log.info({ rollfiUserId, name: u.name, rollfiResult: safeRollfiLog(r2.data) }, "repair-store-wages: addUserWage (fallback) response");
        const raw2 = r2.data as Record<string, unknown>;
        const errMsg2 = (raw2.error as Record<string, unknown> | undefined)?.message as string | undefined;
        if (!errMsg2) {
          repairSuccess = true; repairMethod = "addUserWage"; repairResponse = raw2; repairError = null;
          const newWageId = (raw2.userWage as Record<string, unknown> | undefined)?.userWageId as string | undefined;
          if (u.employeeId && newWageId) {
            const existing = store.getRollfiEmployee(u.employeeId);
            if (existing) await persistRollfiEmployee(u.employeeId, { ...existing, rollfiWageId: newWageId });
          }
        } else {
          repairError = errMsg2;
        }
      } catch (e2) {
        repairError = e2 instanceof Error ? e2.message : String(e2);
        req.log.warn({ rollfiUserId, name: u.name, err: e2 }, "repair-store-wages: addUserWage HTTP error");
      }
    }

    results.push({ name: u.name, rollfiUserId, wageRateDollars, success: repairSuccess, method: repairMethod || null, error: repairError, rollfiResponse: repairResponse });
  }

  res.json({ repaired: results.filter(r => r.success).length, total: results.length, results });
});

router.post("/rollfi/employees/:rollfiUserId/retry-kyc", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { rollfiUserId } = req.params;
  const { companyId } = req.body as { companyId: string };

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  req.log.info({ rollfiUserId, rollfiCompanyId: rollfiCompany.rollfiCompanyId }, "Retrying KYC onboarding for employee");

  try {
    const result = await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, req.log);
    if (result.kycBlockedByKyb) {
      res.status(400).json({
        error: "Company KYB verification has not passed. Employee KYC cannot be initiated until the company completes KYB verification with Rollfi.",
        kycBlockedByKyb: true,
        rollfiUserId,
      });
      return;
    }
    res.json({
      success: true,
      rollfiUserId,
      kycInitiated: result.kycInitiated,
      bankAdded: result.bankAdded,
      message: result.kycInitiated
        ? "KYC initiated successfully — status should update within seconds"
        : "KYC steps re-submitted — some steps may already have been completed",
    });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "retry-kyc failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Pay period ───────────────────────────────────────────────

router.get("/rollfi/payperiod", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // FINAL statuses — not actionable for submission
  const FINAL_STATUSES = new Set(["processed", "skipped"]);

  try {
    // ── Strategy 1: getPayPeriod ───────────────────────────────
    // Docs recommend this as the primary endpoint: "Retrieves the next pay period
    // that should be processed for a company." Returns a single flat object.
    let period: Record<string, unknown> | null = null;
    try {
      const gpResponse = await axios.post(
        `${getBaseUrl()}/reports#getPayPeriod`,
        { method: "getPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
        { headers: rollfiHeaders() }
      );
      const gpRaw = gpResponse.data as Record<string, unknown>;
      req.log.info({ rollfiResponse: gpRaw }, "Rollfi getPayPeriod raw response");
      assertNoRollfiError(gpRaw, "getPayPeriod");

      // getPayPeriod returns the period fields directly (no wrapper array).
      // Accept it if it has a payPeriodId and is not in a final state.
      const status = String(gpRaw.payPeriodStatus ?? "").toLowerCase();
      if (gpRaw.payPeriodId && !FINAL_STATUSES.has(status)) {
        period = gpRaw;
        req.log.info({ payPeriodId: gpRaw.payPeriodId, status }, "getPayPeriod returned actionable period");
      } else {
        req.log.warn({ status, payPeriodId: gpRaw.payPeriodId }, "getPayPeriod returned non-actionable or empty period — falling back");
      }
    } catch (gpErr: unknown) {
      const e = gpErr as { response?: { data: unknown } };
      req.log.warn({ err: gpErr, rollfiErrorBody: e.response?.data }, "getPayPeriod failed — falling back to getUnProcessedPayPeriod");
    }

    // ── Strategy 2: getUnProcessedPayPeriod (fallback with retries) ───
    // Returns an array of all unprocessed periods. Retry up to 3× because the
    // sandbox intermittently returns an empty array for valid companies.
    if (!period) {
      let periods: Array<Record<string, unknown>> = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await axios.post(
          `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
          { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
          { headers: rollfiHeaders() }
        );
        req.log.info({ rollfiResponse: response.data, attempt }, "Rollfi getUnProcessedPayPeriod raw response");
        const raw = response.data as Record<string, unknown>;
        assertNoRollfiError(raw, "getUnProcessedPayPeriod");
        periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
        if (periods.length > 0) break;
        if (attempt < 3) {
          req.log.warn({ attempt, rollfiCompanyId: rollfiCompany.rollfiCompanyId }, "Rollfi returned empty pay periods — retrying");
          await sleep(400);
        }
      }

      if (periods.length > 0) {
        // Prefer submittable periods (preProcess/new/inProcess) over already-submitted,
        // then pick the earliest deadline among them (most overdue first).
        const STATUS_PRIORITY: Record<string, number> = { preprocess: 0, new: 1, inprocess: 2 };
        const sorted = [...periods].sort((a, b) => {
          const aPrio = STATUS_PRIORITY[String(a.payPeriodStatus ?? "").toLowerCase()] ?? 99;
          const bPrio = STATUS_PRIORITY[String(b.payPeriodStatus ?? "").toLowerCase()] ?? 99;
          if (aPrio !== bPrio) return aPrio - bPrio;
          return String(a.payBeginDate ?? "").localeCompare(String(b.payBeginDate ?? ""));
        });
        period = sorted[0];
      }
    }

    if (!period) {
      res.status(404).json({ error: "No unprocessed pay periods found for this company" });
      return;
    }

    res.json(period);
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    const msg = err instanceof Error ? err.message : String(err);
    // Rollfi returns "Company not found" when the rollfiCompanyId isn't registered yet
    // (common in sandbox / newly-created companies). Treat as no-data, not a 500.
    if (msg.toLowerCase().includes("company not found") || msg.toLowerCase().includes("companyid does not exist")) {
      req.log.warn({ rollfiCompanyId: rollfiCompany.rollfiCompanyId }, "Rollfi pay period: company not known to Rollfi — returning no-data gracefully");
      res.status(404).json({ error: "No unprocessed pay periods found for this company" });
      return;
    }
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi pay period fetch failed");
    res.status(500).json({ error: "Failed to get pay period", details: e.response?.data ?? String(err) });
  }
});

// ── Repair failed onboarding steps ───────────────────────────
// POST /api/rollfi/employees/:employeeId/repair-onboarding
// Re-runs the hard steps that failed during initial onboarding (stored in last_sync_error).
// Returns { success, fixed, stillFailed }.
router.post("/rollfi/employees/:employeeId/repair-onboarding", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { employeeId } = req.params;
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  try {
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
    if (!emp.rollfiUserId) { res.status(400).json({ error: "Employee has no Rollfi user ID — cannot repair" }); return; }

    const rollfiCompany = store.getRollfiCompany(emp.companyId);
    if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

    // Parse which steps previously failed from last_sync_error
    let previouslyFailed: string[] = [];
    if (emp.lastSyncError) {
      try {
        const parsed = JSON.parse(emp.lastSyncError) as { failedSteps?: { step: string }[] };
        previouslyFailed = (parsed.failedSteps ?? []).map((s) => s.step);
      } catch { previouslyFailed = []; }
    }

    req.log.info({ employeeId, rollfiUserId: emp.rollfiUserId, previouslyFailed }, "repair-onboarding: starting");

    // Re-run the KYC/W4/bank chain — all hard steps check for "already exists" and skip gracefully
    const result = await runKycOnboardingNew(
      emp.rollfiUserId,
      rollfiCompany.rollfiCompanyId,
      req.log,
      {
        filingStatus: "Single", // safe default — already-exists responses are treated as success
        multipleJobs: false,
        dependents: 0,
        extraWithholding: 0,
        homeState: emp.homeState ?? "NJ",
      }
    );

    const fixed = previouslyFailed.filter((s) => !result.hardErrors.some((e) => e.step === s));
    const stillFailed = result.hardErrors.map((e) => e.step);
    const success = result.hardErrors.length === 0;

    // Update DB
    const now = new Date().toISOString();
    if (success) {
      await db.update(employeesTable).set({
        rollfiOnboardedAt: now,
        lastSyncError: null,
        syncStatus: "synced",
        updatedAt: now,
      }).where(eq(employeesTable.id, employeeId));
    } else {
      await db.update(employeesTable).set({
        lastSyncError: JSON.stringify({ failedSteps: result.hardErrors, softWarnings: result.softWarnings }),
        updatedAt: now,
      }).where(eq(employeesTable.id, employeeId));
    }

    req.log.info({ employeeId, success, fixed, stillFailed, softWarnings: result.softWarnings }, "repair-onboarding: complete");
    res.json({ success, fixed, stillFailed, softWarnings: result.softWarnings });
  } catch (err) {
    req.log.error({ err, employeeId }, "repair-onboarding failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Complete Payroll Setup (imported / stale employees) ────────────────────
// POST /rollfi/repair/employee-payroll-setup
//
// Detects which steps are missing by querying Rollfi live (getUsers), then
// runs ONLY the missing steps.  Safe to call on an employee who needs nothing
// (e.g. Joanne, whose bank is already pending) — it updates our stale
// kycStatus from Rollfi's live value and returns alreadyComplete:true without
// making any Rollfi write calls.
//
// Detection logic:
//   Rollfi kycStatus after initiateUserKyc was called:
//     "not_started" | "pending" | "passed" | "failed" | "approved" | "verified"
//   If kycStatus is null or "kyc not initiated", both addKycInformation AND
//   initiateUserKyc are attempted (addKycInformation handles "already exists"
//   gracefully, so it is safe for Alexandra whose KYC data already exists in Rollfi).
//
// SSN handling: SSN is read from our DB, sent to Rollfi, and then CLEARED from
// our DB after a successful initiateUserKyc in production — Rollfi holds it
// from that point on.
router.post("/rollfi/repair/employee-payroll-setup", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }

  const caller = store.getUserById(req.session.userId);
  if (!caller || !["owner", "super_admin"].includes(caller.role)) {
    res.status(403).json({ error: "Only owners and super admins can run payroll setup" }); return;
  }

  const { employeeId, bankName, routingNumber, accountNumber, accountType } = req.body as {
    employeeId: string; bankName?: string; routingNumber?: string; accountNumber?: string; accountType?: string;
  };
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  if (!emp.rollfiUserId) { res.status(400).json({ error: "Employee has no Rollfi account" }); return; }

  if (caller.role !== "super_admin" && caller.companyId !== emp.companyId) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const [companyRow] = await db
    .select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
    .from(companiesTable).where(eq(companiesTable.id, emp.companyId));
  const rollfiCompanyId =
    companyRow?.rollfiCompanyId ?? store.getRollfiCompany(emp.companyId)?.rollfiCompanyId ?? null;
  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company is not registered with payroll provider" }); return;
  }

  const now = new Date().toISOString();
  const isProduction = getRollfiConfig().env === "production";
  type RollfiUser = {
    userId: string;
    status?: { userStatus?: string };
    kycStatus?: string;
    isTermsAccepted?: boolean;
    bankAccounts?: Array<{ status?: string }>;
  };

  // ── Phase 1: read-only live detection ────────────────────────────────────
  let liveKycStatus: string | null = null;
  let liveUserStatus: string | null = null;
  let liveIsTermsAccepted = false;
  let liveHasBankInRollfi = false;
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const users: RollfiUser[] = ((r.data as { users?: RollfiUser[] }).users ?? []);
    const found = users.find(u => u.userId === emp.rollfiUserId);
    if (!found) {
      res.status(404).json({ error: "Employee not found in payroll provider — cannot determine repair steps" }); return;
    }
    liveKycStatus        = found.kycStatus          ?? null;
    liveUserStatus       = found.status?.userStatus ?? null;
    liveIsTermsAccepted  = found.isTermsAccepted    ?? false;
    liveHasBankInRollfi  = (found.bankAccounts?.length ?? 0) > 0;
    req.log.info({ employeeId, liveKycStatus, liveUserStatus, liveIsTermsAccepted, liveHasBankInRollfi }, "repair-payroll-setup: live status fetched");
  } catch (err) {
    req.log.error({ err }, "repair-payroll-setup: getUsers failed");
    res.status(502).json({ error: "Could not reach payroll provider to check current status. Please try again." }); return;
  }

  // Write live status back to DB immediately (even when no steps will run)
  await db.update(employeesTable).set({
    kycStatus:           liveKycStatus  ?? emp.kycStatus           ?? undefined,
    rollfiAccountStatus: liveUserStatus ?? emp.rollfiAccountStatus ?? undefined,
    updatedAt: now,
  }).where(eq(employeesTable.id, employeeId));

  // ── Determine needed steps ────────────────────────────────────────────────
  // Rollfi sets kycStatus to one of these once initiateUserKyc has been called.
  // "not_started" = addKycInformation + initiateUserKyc done; employee hasn't verified yet.
  const KYC_POST_INITIATE = new Set(["not_started", "pending", "passed", "failed", "approved", "verified"]);
  const kycAlreadyInitiated = !!liveKycStatus && KYC_POST_INITIATE.has(liveKycStatus);
  const needsKycSteps = !kycAlreadyInitiated;
  const hasBankCreds  = !!(accountNumber && routingNumber);

  // Truly complete: KYC initiated AND bank already exists in Rollfi AND no new creds to process
  if (!needsKycSteps && liveHasBankInRollfi && !hasBankCreds) {
    req.log.info({ employeeId, liveKycStatus }, "repair-payroll-setup: already complete — no steps needed");
    res.json({
      alreadyComplete: true,
      message: "Payroll setup is already complete for this employee. Status updated from live provider.",
      liveKycStatus, liveUserStatus, isTermsAccepted: liveIsTermsAccepted, hasBankInRollfi: liveHasBankInRollfi,
      stepsRun: [],
    });
    return;
  }

  // KYC done but no bank found in Rollfi and no creds provided — tell the modal to ask for bank details
  if (!needsKycSteps && !liveHasBankInRollfi && !hasBankCreds) {
    req.log.info({ employeeId, liveKycStatus }, "repair-payroll-setup: KYC complete but bank missing and no creds provided");
    res.json({
      needsBankAccount: true,
      message: "Identity verification is complete, but no bank account was found. Please provide direct deposit details.",
      liveKycStatus, liveUserStatus, isTermsAccepted: liveIsTermsAccepted, hasBankInRollfi: liveHasBankInRollfi,
      stepsRun: [],
    });
    return;
  }

  // ── Phase 2: pre-flight validation ───────────────────────────────────────
  if (needsKycSteps) {
    const ssnDigits = (emp.ssn ?? "").replace(/\D/g, "");
    if (!ssnDigits || ssnDigits.length !== 9) {
      res.status(400).json({
        error: "SSN is required before identity verification can be submitted. Enter a valid 9-digit SSN on the Personal tab first.",
      }); return;
    }
    if (!emp.dateOfBirth) {
      res.status(400).json({
        error: "Date of Birth is required. Enter it on the Personal tab first.",
      }); return;
    }
    const a1 = emp.homeAddress ?? "";
    if (/\b\d{5}\b/.test(a1) || a1.includes(",")) {
      req.log.warn({ employeeId }, "repair-payroll-setup: address1 may contain embedded city/zip — KYC may reject it; owner warned in UI");
    }
  }

  type StepResult = { step: string; result: "success" | "already_done" | "skipped" | "error"; detail?: string };
  const stepsRun: StepResult[] = [];

  // ── Step A: acceptTermsAndCondition ──────────────────────────────────────
  // Matches wizard order (acceptTerms → addKyc → initiateKyc).
  // Must be called before initiateUserKyc. Idempotent — safe when already accepted.
  // Skip the API call (record as already_done) when getUsers confirmed it's already accepted.
  if (needsKycSteps) {
    if (liveIsTermsAccepted) {
      stepsRun.push({ step: "acceptTermsAndCondition", result: "already_done" });
    } else {
      try {
        const r = await axios.put(`${getBaseUrl()}/userOnboarding#acceptTermsAndCondition`, {
          method: "acceptTermsAndCondition", userId: emp.rollfiUserId,
        }, { headers: rollfiHeaders() });
        req.log.info({ rollfiResult: safeRollfiLog(r.data), employeeId }, "repair-payroll-setup: acceptTermsAndCondition response");
        const errMsg = extractRollfiError(r.data as Record<string, unknown>);
        const alreadyAccepted = errMsg?.toLowerCase().includes("already") ?? false;
        stepsRun.push({
          step: "acceptTermsAndCondition",
          result: alreadyAccepted ? "already_done" : (errMsg ? "error" : "success"),
          detail: (errMsg && !alreadyAccepted) ? errMsg : undefined,
        });
        // Not fatal even on error — Rollfi may already have accepted terms for this user
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err, employeeId }, "repair-payroll-setup: acceptTermsAndCondition failed (soft — continuing)");
        stepsRun.push({ step: "acceptTermsAndCondition", result: "already_done", detail: msg });
      }
    }
  }

  // ── Step B: addKycInformation ─────────────────────────────────────────────
  // "already exists" = Rollfi already has the KYC data (e.g. Alexandra). Treat as success.
  let kycAdded = kycAlreadyInitiated;
  if (needsKycSteps) {
    const ssnDigits = (emp.ssn ?? "").replace(/\D/g, "");
    try {
      const r = await axios.post(`${getBaseUrl()}/userOnboarding#addKycInformation`, {
        method: "addKycInformation",
        kycInformation: {
          userId: emp.rollfiUserId, ssn: ssnDigits,
          dateOfBirth: emp.dateOfBirth ?? "",
          address1: emp.homeAddress ?? "", address2: "",
          city: emp.homeCity ?? "", state: emp.homeState ?? "", zipcode: emp.homeZip ?? "",
        },
      }, { headers: rollfiHeaders() });
      // safeRollfiLog strips raw fields — never log the full response here (may echo SSN)
      req.log.info({ rollfiResult: safeRollfiLog(r.data), employeeId }, "repair-payroll-setup: addKycInformation response");
      const errMsg = extractRollfiError(r.data);
      const alreadyExists = errMsg?.toLowerCase().includes("already exists") ?? false;
      if (!errMsg || alreadyExists) {
        kycAdded = true;
        stepsRun.push({ step: "addKycInformation", result: alreadyExists ? "already_done" : "success" });
      } else {
        stepsRun.push({ step: "addKycInformation", result: "error", detail: errMsg });
        res.status(422).json({ error: `Identity information rejected: ${errMsg}`, stepsRun }); return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stepsRun.push({ step: "addKycInformation", result: "error", detail: msg });
      res.status(502).json({ error: `Could not submit identity information: ${msg}`, stepsRun }); return;
    }
  }

  // ── Step C: initiateUserKyc ───────────────────────────────────────────────
  if (needsKycSteps) {
    if (!kycAdded) {
      stepsRun.push({ step: "initiateUserKyc", result: "skipped", detail: "addKycInformation did not succeed" });
      res.status(422).json({ error: "Cannot initiate verification — identity information was not accepted.", stepsRun }); return;
    }
    try {
      const r = await axios.post(`${getBaseUrl()}/userOnboarding#initiateUserKyc`, {
        method: "initiateUserKyc", userId: emp.rollfiUserId,
      }, { headers: rollfiHeaders() });
      req.log.info({ rollfiResult: safeRollfiLog(r.data), employeeId }, "repair-payroll-setup: initiateUserKyc response");
      const errMsg = extractRollfiError(r.data as Record<string, unknown>);
      if (errMsg) {
        const isKyb = /kyb is not initiated|company kyb/i.test(errMsg);
        const surfaced = isKyb
          ? "Company identity verification (KYB) has not passed — contact Rollfi support before employees can be verified"
          : errMsg;
        stepsRun.push({ step: "initiateUserKyc", result: "error", detail: surfaced });
        res.status(422).json({ error: `Identity verification could not be started: ${surfaced}`, stepsRun }); return;
      }
      stepsRun.push({ step: "initiateUserKyc", result: "success" });
      // In production: clear SSN now that Rollfi holds it — no reason to retain it
      if (isProduction) {
        await db.update(employeesTable).set({ ssn: null, updatedAt: now }).where(eq(employeesTable.id, employeeId));
        req.log.info({ employeeId }, "repair-payroll-setup: SSN cleared from DB after successful initiateUserKyc");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stepsRun.push({ step: "initiateUserKyc", result: "error", detail: msg });
      res.status(502).json({ error: `Could not start identity verification: ${msg}`, stepsRun }); return;
    }
  }

  // ── Step C: addUserBankAccount ────────────────────────────────────────────
  if (hasBankCreds) {
    const maskedAcct = `****${(accountNumber ?? "").slice(-4)}`;
    req.log.info({ employeeId, bankName, maskedAcct }, "repair-payroll-setup: submitting bank account");
    try {
      const r = await axios.post(`${getBaseUrl()}/userPortal#addUserBankAccount`, {
        method: "addUserBankAccount",
        linkType: "Manual",
        userPayAccountEntity: {
          companyId: rollfiCompanyId, userId: emp.rollfiUserId,
          accountNumber, routingNumber,
          bankName: bankName ?? "Direct Deposit",
          accountType: accountType ?? "checking",
          accountName: "default", payPercentage: 100, isPrimary: true,
        },
      }, { headers: rollfiHeaders() });
      req.log.info({ rollfiResult: safeRollfiLog(r.data), employeeId }, "repair-payroll-setup: addUserBankAccount response");
      const errMsg = extractRollfiError(r.data as Record<string, unknown>);
      if (errMsg && !errMsg.toLowerCase().includes("already exists")) {
        stepsRun.push({ step: "addUserBankAccount", result: "error", detail: errMsg });
        res.status(422).json({ error: `Bank account rejected: ${errMsg}`, stepsRun }); return;
      }
      stepsRun.push({
        step: "addUserBankAccount",
        result: errMsg?.toLowerCase().includes("already exists") ? "already_done" : "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stepsRun.push({ step: "addUserBankAccount", result: "error", detail: msg });
      res.status(502).json({ error: `Could not add bank account: ${msg}`, stepsRun }); return;
    }
  }

  // ── Final: refresh live status and write back ─────────────────────────────
  let finalKycStatus  = liveKycStatus;
  let finalUserStatus = liveUserStatus;
  try {
    const r2 = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const u2 = ((r2.data as { users?: RollfiUser[] }).users ?? []).find(u => u.userId === emp.rollfiUserId);
    if (u2) {
      finalKycStatus  = u2.kycStatus           ?? liveKycStatus;
      finalUserStatus = u2.status?.userStatus  ?? liveUserStatus;
      await db.update(employeesTable).set({
        kycStatus:           finalKycStatus  ?? undefined,
        rollfiAccountStatus: finalUserStatus ?? undefined,
        updatedAt: new Date().toISOString(),
      }).where(eq(employeesTable.id, employeeId));
    }
  } catch { /* non-fatal — steps already ran */ }

  req.log.info({ employeeId, stepsRun, finalKycStatus, finalUserStatus }, "repair-payroll-setup: complete");
  res.json({
    success: true, stepsRun,
    liveKycStatus: finalKycStatus, liveUserStatus: finalUserStatus,
    isTermsAccepted: liveIsTermsAccepted, hasBankInRollfi: liveHasBankInRollfi,
  });
});

// ── Preflight status for repair modal ────────────────────────────────────────
// Called by the modal on open to know what steps are needed before the user clicks "Run Setup".
// Read-only — no Rollfi writes.
router.get("/rollfi/repair/preflight-status", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || !["owner", "super_admin"].includes(caller.role)) {
    res.status(403).json({ error: "Owners and super admins only" }); return;
  }
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
  if (!emp.rollfiUserId) { res.status(400).json({ error: "Employee has no Rollfi account" }); return; }

  if (caller.role !== "super_admin" && caller.companyId !== emp.companyId) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const [companyRow] = await db
    .select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
    .from(companiesTable).where(eq(companiesTable.id, emp.companyId));
  const rollfiCompanyId =
    companyRow?.rollfiCompanyId ?? store.getRollfiCompany(emp.companyId)?.rollfiCompanyId ?? null;
  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company is not registered with payroll provider" }); return;
  }

  try {
    type PreflightUser = {
      userId: string;
      status?: { userStatus?: string };
      kycStatus?: string;
      isTermsAccepted?: boolean;
      bankAccounts?: Array<{ status?: string }>;
    };
    const r = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const users: PreflightUser[] = ((r.data as { users?: PreflightUser[] }).users ?? []);
    const found = users.find(u => u.userId === emp.rollfiUserId);
    if (!found) {
      res.status(404).json({ error: "Employee not found in payroll provider" }); return;
    }
    const KYC_POST_INITIATE = new Set(["not_started", "pending", "passed", "failed", "approved", "verified"]);
    const liveKycStatus       = found.kycStatus          ?? null;
    const liveUserStatus      = found.status?.userStatus ?? null;
    const isTermsAccepted     = found.isTermsAccepted    ?? false;
    const hasBankInRollfi     = (found.bankAccounts?.length ?? 0) > 0;
    const kycAlreadyInitiated = !!liveKycStatus && KYC_POST_INITIATE.has(liveKycStatus);
    res.json({ liveKycStatus, liveUserStatus, isTermsAccepted, kycAlreadyInitiated, hasBankInRollfi });
  } catch (err) {
    req.log.error({ err }, "preflight-status: getUsers failed");
    res.status(502).json({ error: "Could not reach payroll provider. Try again." });
  }
});

// ── Employee Rollfi activation status ────────────────────────

router.get("/rollfi/employees/status", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    type RollfiUser = { userId: string; status?: { userStatus?: string }; kycStatus?: string };
    const users = ((r.data as { users?: RollfiUser[] }).users ?? []);
    res.json({
      employees: users.map((u) => ({
        rollfiUserId: u.userId,
        userStatus: u.status?.userStatus ?? "Unknown",
        kycStatus: u.kycStatus ?? "unknown",
      })),
    });
  } catch (err) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "getUsers failed");
    res.status(500).json({ error: "Failed to fetch employee statuses", details: e.response?.data ?? String(err) });
  }
});

// GET /rollfi/employees/:rollfiUserId/live-status — fetch current Rollfi status
// for a single employee, write kycStatus + rollfiAccountStatus back to DB.
// Used by the manual Refresh button on the employee profile Payroll tab.
router.get("/rollfi/employees/:rollfiUserId/live-status", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }

  const { rollfiUserId } = req.params;
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.rollfiUserId, rollfiUserId));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  const caller = store.getUserById(req.session.userId);
  if (!caller) { res.status(401).json({ error: "User not found" }); return; }
  if (caller.role !== "super_admin" && caller.companyId !== emp.companyId) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const [companyRow] = await db.select({
    rollfiCompanyId: companiesTable.rollfiCompanyId,
    name: companiesTable.name,
  }).from(companiesTable).where(eq(companiesTable.id, emp.companyId));

  let rollfiCompanyId = companyRow?.rollfiCompanyId ?? null;

  // Auto-recover: if rollfiCompanyId is missing from our DB but the employee has a rollfiUserId,
  // the company was registered in Rollfi in a prior session without the ID being saved back.
  // Use getCompanies to find it by name, then persist it so future calls are instant.
  if (!rollfiCompanyId && companyRow?.name) {
    req.log.warn({ companyId: emp.companyId, companyName: companyRow.name }, "live-status: rollfiCompanyId missing — attempting recovery via getCompanies");
    try {
      const gcRes = await axios.post(
        `${getBaseUrl()}/reports#getCompanies`,
        { method: "getCompanies" },
        { headers: rollfiHeaders() }
      );
      const list = (gcRes.data as { Company?: { company: string; companyID: string }[] }).Company ?? [];
      const match = list.find(c => c.company.toLowerCase() === companyRow.name.toLowerCase());
      if (match) {
        rollfiCompanyId = match.companyID;
        // Also fetch the location ID so the record is complete
        let rollfiLocationId = "";
        try {
          const locRes = await axios.post(
            `${getBaseUrl()}/reports#getCompanyLocationInfo`,
            { method: "getCompanyLocationInfo", companyId: match.companyID },
            { headers: rollfiHeaders() }
          );
          const locs = (locRes.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
          rollfiLocationId = (locs.find(l => l.isWorkLocation) ?? locs[0])?.companyLocationID ?? "";
        } catch { /* location is optional for live-status */ }
        await persistRollfiCompany(emp.companyId, { rollfiCompanyId: match.companyID, rollfiLocationId, onboardedAt: new Date().toISOString() });
        req.log.info({ companyId: emp.companyId, rollfiCompanyId }, "live-status: recovered rollfiCompanyId via getCompanies");
      }
    } catch (recoveryErr) {
      req.log.error({ recoveryErr }, "live-status: getCompanies recovery failed");
    }
  }

  if (!rollfiCompanyId) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" }); return;
  }

  try {
    type RollfiUser = { userId: string; status?: { userStatus?: string }; kycStatus?: string };
    const r = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const users: RollfiUser[] = ((r.data as { users?: RollfiUser[] }).users ?? []);
    const found = users.find(u => u.userId === rollfiUserId);
    if (!found) { res.status(404).json({ error: "Employee not found in Rollfi" }); return; }

    const nowISO = new Date().toISOString();
    const newUserStatus = found.status?.userStatus ?? emp.rollfiAccountStatus ?? undefined;
    const newKycStatus  = found.kycStatus ?? emp.kycStatus ?? undefined;
    const payrollReady  = newUserStatus === "Active" &&
      (newKycStatus === "passed" || newKycStatus === "verified");

    await db.update(employeesTable).set({
      kycStatus:           newKycStatus,
      rollfiAccountStatus: newUserStatus,
      payrollReady,
      updatedAt: nowISO,
    }).where(eq(employeesTable.id, emp.id));

    req.log.info({ employeeId: emp.id, userStatus: newUserStatus, kycStatus: newKycStatus, payrollReady }, "live-status: wrote back");
    res.json({
      rollfiUserId,
      employeeId: emp.id,
      userStatus: found.status?.userStatus ?? null,
      kycStatus: found.kycStatus ?? null,
      fetchedAt: nowISO,
    });
  } catch (err) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "live-status: getUsers failed");
    res.status(500).json({ error: "Failed to reach payroll provider", details: e.response?.data ?? String(err) });
  }
});

// ── Sync employees from Rollfi → link missing rollfiUserIds ──

router.post("/rollfi/companies/:companyId/sync-employees", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin required" }); return; }

  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }

  const { companyId } = req.params;
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" }); return;
  }

  try {
    const usersResp = await axios.post(
      `${getBaseUrl()}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    type RollfiUser = { userId: string; email?: string };
    const rollfiUsers: RollfiUser[] = (usersResp.data as { users?: RollfiUser[] }).users ?? [];
    req.log.info({ rollfiUserCount: rollfiUsers.length, companyId }, "Sync: fetched Rollfi users");

    const localEmps = await db.select().from(employeesTable).where(eq(employeesTable.companyId, companyId));
    let linked = 0;
    let alreadyLinked = 0;
    const details: Array<{ name: string; email: string; result: string }> = [];

    for (const emp of localEmps) {
      if (emp.rollfiUserId) { alreadyLinked++; continue; }
      const match = rollfiUsers.find((ru) => ru.email?.toLowerCase() === emp.email.toLowerCase());
      if (!match?.userId) {
        details.push({ name: `${emp.firstName} ${emp.lastName}`, email: emp.email, result: "not_found_in_rollfi" });
        continue;
      }
      const nowISO = new Date().toISOString();
      await db.update(employeesTable)
        .set({ rollfiUserId: match.userId, rollfiOnboardedAt: nowISO, status: emp.status === "onboarding" ? "active" : emp.status })
        .where(eq(employeesTable.id, emp.id));
      await persistRollfiEmployee(emp.id, { rollfiUserId: match.userId, rollfiWageId: "", onboardedAt: nowISO });
      linked++;
      details.push({ name: `${emp.firstName} ${emp.lastName}`, email: emp.email, result: "linked" });
      req.log.info({ employeeId: emp.id, rollfiUserId: match.userId }, "Sync: linked employee to Rollfi");
    }

    res.json({ linked, alreadyLinked, total: localEmps.length, details });
  } catch (err) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "sync-employees failed");
    res.status(500).json({ error: "Sync failed", details: e.response?.data ?? String(err) });
  }
});

// ── Payroll preview (EasyTeam hours → calculated pay) ────────

router.get("/rollfi/payroll/preview", async (req, res) => {
  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };

  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const calendarDays = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  const workdays = Math.min(Math.round(calendarDays * (5 / 7)), 10);

  const allStaff = store
    .getAllStaffUsers()
    .filter((u) => u.employeeId) // include all roles — owners/managers can appear in payroll too
    .filter((u) => !companyId || u.companyId === companyId);

  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  // Fetch current hourlyWage from DB for each staff employee (single batch query).
  // People Hub wage edits write to the DB; the in-memory store is seeded at startup and
  // never updated, so the DB is the source of truth for current rates.
  const staffEmpIds = allStaff.map((u) => u.employeeId).filter((id): id is string => !!id);
  const dbWageRows = staffEmpIds.length > 0
    ? await db
        .select({
          id:              employeesTable.id,
          hourlyWage:      employeesTable.hourlyWage,
          payType:         employeesTable.payType,
          annualSalary:    employeesTable.annualSalary,
          overtimeEligible: employeesTable.overtimeEligible,
        })
        .from(employeesTable)
        .where(inArray(employeesTable.id, staffEmpIds))
    : [];
  const dbWageByEmpId = new Map(dbWageRows.map((r) => [r.id, r]));

  // Only show employees that have a real row in the employees DB table.
  // This filters out store-only phantom entries (super_admin accounts, daycare_manager
  // placeholders, etc.) that have an employeeId in the store but no actual employees record.
  const staffWithDbRecord = allStaff.filter((u) => u.employeeId && dbWageByEmpId.has(u.employeeId));

  // Preview is display-only: show period-specific approvals if they exist,
  // otherwise fall back to the latest approval so the submit page shows meaningful hours.
  // (The fallback does NOT apply to the actual import/initiate endpoints.)
  const dbApprovalsByPeriod = companyId
    ? await getTimesheetApprovalsByCompanyPeriod(companyId, periodKey)
    : [];
  const dbApprovals = dbApprovalsByPeriod.length > 0
    ? dbApprovalsByPeriod
    : companyId ? await getLatestTimesheetApprovalsByCompany(companyId) : [];
  const approvalsByEmpId = new Map(dbApprovals.map((a) => [a.employeeId, a]));

  const entries = staffWithDbRecord.map((u) => {
    // Only DB-approved hours are shown — no fallback to in-memory store or estimates.
    // Employees without a manager-approved record in timesheet_approvals show as pending.
    const approval = u.employeeId ? approvalsByEmpId.get(u.employeeId) : undefined;
    const hoursWorked     = approval ? approval.hoursWorked    : 0;
    const breakDeduction  = approval ? approval.breakDeduction : 0;
    const unapprovedHours = 0;
    const netPayableHours = approval ? approval.approvedHours  : 0;
    const hoursSource     = approval ? approval.source         : "pending_approval";
    // DB value takes priority over the in-memory store (DB reflects People Hub edits)
    const dbRow = dbWageByEmpId.get(u.employeeId ?? "");
    const hourlyRateCents = dbRow?.hourlyWage ?? u.hourlyWage ?? 1500;
    const hourlyRate = hourlyRateCents / 100; // convert cents to dollars for display & calculation
    // FIX 2: fall back to store's payType (set at wizard creation) if the DB lookup failed.
    // This keeps salaried employees visible in the preview even on a warm-cache hit before
    // the DB round-trip resolves. DB value always takes priority when present.
    const payType = dbRow?.payType ?? u.payType ?? "hourly";
    // FIX 2 observability: log per-employee payType resolution so we can confirm source
    req.log.info({
      employeeId:      u.employeeId,
      dbRowFound:      !!dbRow,
      dbPayType:       dbRow?.payType ?? null,
      storePayType:    (u as { payType?: string }).payType ?? null,
      resolvedPayType: payType,
      source:          dbRow?.payType ? "db" : ((u as { payType?: string }).payType ? "store" : "default"),
    }, "preview: payType resolution");
    const annualSalaryCents = dbRow?.annualSalary ?? null;
    // Salaried employees: estimate per-period pay as annual ÷ 26 (bi-weekly).
    // This is only used for the dashboard estimate (~); the real figure comes from Rollfi after import.
    const salariedEstimate = annualSalaryCents != null
      ? Math.round((annualSalaryCents / 100 / 26) * 100) / 100
      : 0;
    const grossPay = payType === "salary" || payType?.startsWith("salary_")
      ? salariedEstimate
      : Math.round(netPayableHours * hourlyRate * 100) / 100;
    const rollfiEmp = u.employeeId ? (store.getRollfiEmployee(u.employeeId) ?? null) : null;

    return {
      employeeId: u.employeeId,
      name: u.name,
      position: u.position,
      companyId: u.companyId,
      hoursWorked,
      breakDeduction,
      unapprovedHours,
      netPayableHours,
      hourlyRate,
      grossPay,
      hoursSource,
      payType,
      annualSalaryCents,
      onboardedToRollfi: !!rollfiEmp,
      rollfiUserId: rollfiEmp?.rollfiUserId ?? null,
    };
  });

  const totalGrossPay = entries.reduce((s, e) => s + e.grossPay, 0);

  // Prevent HTTP-level caching — browsers must always send a fresh request so payType,
  // annualSalaryCents, and onboardedToRollfi reflect the latest DB state.
  // React Query handles client-side caching with explicit invalidateQueries() calls.
  res.setHeader("Cache-Control", "no-store");
  res.json({
    companyId: companyId ?? "all",
    period: {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
      workdays,
    },
    employees: entries,
    totalGrossPay: Math.round(totalGrossPay * 100) / 100,
    allOnboarded: entries.every((e) => e.onboardedToRollfi),
  });
});

// ── Payroll type lookups ──────────────────────────────────────

router.get("/rollfi/overtime-types", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }
  try {
    const resp = await axios.post(
      `${getBaseUrl()}/reports/getOverTimeTypes`,
      { method: "getOverTimeTypes" },
      { headers: rollfiHeaders() }
    );
    res.json(resp.data);
  } catch (err) {
    req.log.error({ err }, "getOverTimeTypes failed");
    res.status(500).json({ error: "Failed to fetch overtime types" });
  }
});

router.get("/rollfi/compensation-types", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }
  try {
    const resp = await axios.post(
      `${getBaseUrl()}/reports/getAdditionalCompensationDescription`,
      { method: "getAdditionalCompensationDescription" },
      { headers: rollfiHeaders() }
    );
    res.json(resp.data);
  } catch (err) {
    req.log.error({ err }, "getAdditionalCompensationDescription failed");
    res.status(500).json({ error: "Failed to fetch compensation types" });
  }
});

// ── Initiate payroll ─────────────────────────────────────────

router.post("/rollfi/payroll/initiate", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  type AdjInput = {
    rollfiUserId: string;
    additionalCompensation?: { description: string; amount: number }[];
    overTime?: { type: string; noOfHours: number; multiplier: number }[];
  };
  const { companyId, payPeriodId, adjustments = [], payBeginDate, payEndDate, employeeHours = [] } = req.body as {
    companyId: string; payPeriodId: string; adjustments?: AdjInput[];
    payBeginDate?: string; payEndDate?: string;
    employeeHours?: { rollfiUserId: string; hours: number }[];
  };
  // Build a quick lookup from rollfiUserId → hours passed from the frontend display
  const frontendHours = new Map<string, number>(
    employeeHours.map(({ rollfiUserId, hours }) => [rollfiUserId.toUpperCase(), hours])
  );
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  req.log.info({ companyId, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId }, "Rollfi initiatePayroll request");

  try {
    // Build the payroll roster from Rollfi's getPayPeriodDetails — not from our in-memory store.
    // This ensures employees auto-enrolled by Rollfi (e.g. from previous sessions) are never skipped.
    req.log.info({ rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId }, "Rollfi initiatePayroll: fetching enrolled employees");
    const rosterResp = await axios.post(
      `${getBaseUrl()}/reports#getPayPeriodDetails`,
      { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
      { headers: rollfiHeaders() }
    );
    const rosterRaw = rosterResp.data as Record<string, unknown>;
    const rosterPeriodArr = (rosterRaw.payPeriod ?? []) as Array<Record<string, unknown>>;
    const rosterPd = rosterPeriodArr[0] as Record<string, unknown> | undefined;
    // FIX 1b: must be `let` so the safety net can replace it with a refreshed roster.
    let enrolledItems = rosterPd ? (rosterPd.payrollLineItems ?? []) as Array<Record<string, unknown>> : [];
    req.log.info({ enrolledCount: enrolledItems.length, sampleItem: JSON.stringify(enrolledItems[0]) }, "getPayPeriodDetails enrolled employees (initiate)");

    if (enrolledItems.length === 0) {
      res.status(400).json({ error: "No employees enrolled in this Rollfi pay period. Ensure employees are active with a start date before the period." });
      return;
    }

    // FIX 1b: Safety net — enrol any mid-period hires absent from Rollfi's roster snapshot.
    // Must run BEFORE building payrollData so newly enrolled employees appear in the payload.
    const periodStatus = String(rosterPd?.PayPeriodStatus ?? rosterPd?.payPeriodStatus ?? "").toLowerCase();
    let newlyEnrolled = 0;
    let notEnrolledEmployees: Array<{ rollfiUserId: string; employeeId: string; name: string; reason: string }> = [];
    {
      const safetyNet = await enrollMissingEmployeesInPeriod(
        rollfiCompany.rollfiCompanyId, payPeriodId, periodStatus, enrolledItems, companyId, req.log
      );
      newlyEnrolled = safetyNet.newlyEnrolled;
      notEnrolledEmployees = safetyNet.notEnrolled;
      if (safetyNet.newlyEnrolled > 0 && safetyNet.updatedItems) {
        enrolledItems = safetyNet.updatedItems;
        req.log.info({ newlyEnrolled, newRosterCount: enrolledItems.length }, "Initiate: roster refreshed after mid-period hire enrollment");
      }
    }

    // Build a reverse-lookup: rollfiUserId (uppercase) → store user (for hours resolution)
    const staffUsers = store.getAllStaffUsers()
      .filter((u) => u.employeeId && u.companyId === companyId && u.role === "employee");
    const rollfiIdToUser = new Map<string, typeof staffUsers[0]>();
    for (const u of staffUsers) {
      const emp = store.getRollfiEmployee(u.employeeId!);
      if (emp?.rollfiUserId) rollfiIdToUser.set(emp.rollfiUserId.toUpperCase(), u);
    }

    // Batch-fetch payType + rollfi_user_id from DB for ALL employees in this company.
    // Using employees.rollfiUserId directly is restart-safe: store.getRollfiEmployee() loses
    // data on server restart for employees not persisted in rollfi_employee_records.
    const dbPayTypeRowsInit = await db
      .select({ id: employeesTable.id, payType: employeesTable.payType, rollfiUserId: employeesTable.rollfiUserId, status: employeesTable.status })
      .from(employeesTable).where(eq(employeesTable.companyId, companyId));
    const dbPayTypeByEmpId = new Map(dbPayTypeRowsInit.map((r) => [r.id, r.payType ?? "hourly"]));
    // Extend rollfiIdToUser with DB employees not covered by testUsers, using the DB column directly.
    for (const dbEmp of dbPayTypeRowsInit) {
      if (!dbEmp.rollfiUserId) continue;
      const uid = dbEmp.rollfiUserId.toUpperCase();
      if (!rollfiIdToUser.has(uid)) {
        rollfiIdToUser.set(uid, { id: dbEmp.id, name: "", email: "", role: "employee" as const,
          companyId, employeeId: dbEmp.id, position: "" } as typeof staffUsers[0]);
      }
    }

    // Build the salaried UID set: cover both testUsers (via employeeId→payType) AND DB employees
    // identified directly by employees.rollfiUserId (restart-safe, no store dependency).
    const salariedRollfiUids = new Set<string>();
    for (const [uid, su] of rollfiIdToUser) {
      if (su.employeeId && dbPayTypeByEmpId.get(su.employeeId) === "salary") salariedRollfiUids.add(uid);
    }
    for (const r of dbPayTypeRowsInit) {
      if (r.payType === "salary" && r.rollfiUserId) salariedRollfiUids.add(r.rollfiUserId.toUpperCase());
    }

    // Filter out employees whose local status is on_leave or terminated (same as import route).
    {
      const inactiveUidsInit = new Set(
        dbPayTypeRowsInit
          .filter((r) => !!r.rollfiUserId && (r.status === "on_leave" || r.status === "terminated"))
          .map((r) => r.rollfiUserId!.toUpperCase())
      );
      if (inactiveUidsInit.size > 0) {
        const before = enrolledItems.length;
        enrolledItems = enrolledItems.filter((item) => {
          const uid = String(item.userId ?? item.userID ?? item.employeeId ?? item.id ?? "").toUpperCase();
          return !inactiveUidsInit.has(uid);
        });
        req.log.info({ filtered: before - enrolledItems.length, remaining: enrolledItems.length, inactiveUids: [...inactiveUidsInit] },
          "Initiate: filtered out on_leave/terminated employees from Rollfi roster");
      }
    }

    enrolledItems = await recoverZeroedSalariedEmployees(
      rollfiCompany.rollfiCompanyId, payPeriodId, enrolledItems, salariedRollfiUids, req.log
    );

    const periodKey = payBeginDate && payEndDate ? `${payBeginDate}/${payEndDate}` : null;
    const dbApprovals1 = periodKey ? await getTimesheetApprovalsByCompanyPeriod(companyId, periodKey) : [];
    const approvalsByEmpId = new Map(dbApprovals1.map((a) => [a.employeeId, a]));

    const skippedEmployees: { rollfiUserId: string; name?: string; type?: "zero_hours" | "onboarding"; reason: string }[] = [];
    const payrollData: Array<Record<string, unknown>> = [];

    for (const item of enrolledItems) {
      const rollfiUid = (item.userId ?? item.userID ?? item.employeeId ?? item.id) as string | undefined;
      if (!rollfiUid) {
        req.log.warn({ item: JSON.stringify(item) }, "Payroll initiate: line item has no user ID field — skipped");
        continue;
      }
      const storeUser = rollfiIdToUser.get(rollfiUid.toUpperCase());
      const adj = adjustments.find((a) => a.rollfiUserId?.toUpperCase() === rollfiUid.toUpperCase());
      const frontendH = frontendHours.get(rollfiUid.toUpperCase());

      let payHours = 0;
      if (frontendH !== undefined) {
        payHours = frontendH;
        req.log.info({ rollfiUserId: rollfiUid, hours: frontendH }, "Initiate: using frontend-supplied hours");
      } else if (storeUser?.employeeId) {
        const approval = approvalsByEmpId.get(storeUser.employeeId);
        if (approval) {
          payHours = approval.approvedHours;
          req.log.info({ rollfiUserId: rollfiUid, hours: payHours, source: approval.source }, "Initiate: using DB-approved hours for period");
        } else if (periodKey) {
          const synced = store.getTimesheetEntry(storeUser.employeeId, periodKey);
          payHours = synced?.approvedHours ?? 0;
          if (!synced) req.log.warn({ rollfiUserId: rollfiUid, name: storeUser.name }, "Initiate: no approved hours for this period — defaulting to 0h");
        }
      } else {
        req.log.warn({ rollfiUserId: rollfiUid }, "Initiate: unknown Rollfi employee (not in store) — defaulted to 0h");
      }

      const payHoursRounded = Math.round(payHours * 10000) / 10000;
      // FIX 3: Salaried employees — Rollfi auto-computes pay from the Per Year wage record,
      // prorated by workdays in the period. Sending basicPay.payHours overrides that calculation
      // and zeroes their gross pay. Salaried employees must be omitted (no adjustments) or sent
      // with adjustment arrays but NO basicPay key.
      // IMPORTANT: to reduce a salaried employee's pay for unpaid leave, use Rollfi's
      // unPaidLeave field — NEVER by manipulating hours.
      const isSalariedEmp = storeUser?.employeeId
        ? (dbPayTypeByEmpId.get(storeUser.employeeId) === "salary")
        : false;
      if (isSalariedEmp) {
        // Salaried employees are ALWAYS omitted from the main import — comp is handled by
        // injectSalariedCompensations (called below, after the main import). Including them
        // here — even with a correct basicPay.payHours — suppresses Rollfi's Per Year
        // auto-computation and zeroes baseTotal (confirmed sandbox 2026-07-26).
        req.log.info({ rollfiUserId: rollfiUid, name: storeUser?.name }, "Initiate: salaried employee — omitted from main import (comp injected separately)");
        continue;
      }
      const entry: Record<string, unknown> = { userId: rollfiUid };
      // Hourly employee: always send payHours and explicit comp/OT arrays.
      // Explicit [] clears stale comp only when overwriteExistingLineItems:true (see import body).
      entry.basicPay = { payHours: payHoursRounded };
      entry.additionalCompensation = adj?.additionalCompensation ?? [];
      entry.overTime = adj?.overTime ?? [];
      payrollData.push(entry);
    }

    req.log.info({
      rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId,
      employeeCount: payrollData.length,
      adjustmentsReceived: JSON.stringify(adjustments),
      payrollData: JSON.stringify(payrollData),
    }, "Rollfi importRegularPayrollData request (initiate)");

    const initiateImportBody = {
      // overwriteExistingLineItems: true — required for hourly employees to prevent comp
      // accumulation: explicit [] clears stale additionalCompensation/overTime only when this
      // flag is true. Decision confirmed with Rollfi 2026-07-22.
      // IMPORTANT — salaried employees must NOT be in this payrollData array. Sending them
      // here (even with correct basicPay.payHours) suppresses Rollfi's Per Year salary
      // auto-computation and zeroes baseTotal. Their comp is handled by the separate
      // injectSalariedCompensations call below, which uses overwriteExistingLineItems:false.
      method: "importRegularPayrollData",
      companyId: rollfiCompany.rollfiCompanyId,
      payPeriodId,
      overwriteExistingLineItems: true,
      payrollData,
    };
    req.log.info({ fullRollfiRequestBody: JSON.stringify(initiateImportBody) }, "outgoing importRegularPayrollData (initiate)");
    if (initiateImportBody.overwriteExistingLineItems !== true) {
      req.log.error({ overwriteExistingLineItems: initiateImportBody.overwriteExistingLineItems }, "FLAG MISSING FROM OUTGOING BODY");
    }
    const { warnings: compWipeWarnings } = await wipeAdditionalCompensations(
      rollfiCompany.rollfiCompanyId,
      payPeriodId,
      payrollData.map((e) => e.userId as string),
      req.log
    );
    const importResp = await axios.post(
      `${getBaseUrl()}/payroll#importRegularPayrollData`,
      initiateImportBody,
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: importResp.data }, "Rollfi importRegularPayrollData response (initiate)");
    const importRaw = importResp.data as Record<string, unknown>;
    assertNoRollfiError(importRaw, "importRegularPayrollData");
    const validationWarning = extractValidationWarning(importRaw);
    if (validationWarning) {
      req.log.warn({ validationWarning }, "importRegularPayrollData returned validationWarning (initiate)");
    }

    // Post-import: inject comp for salaried employees and wipe any stale comp.
    // Salaried employees were excluded from the main import above to preserve Rollfi's Per Year
    // auto-computation. Their comp is added here via overwriteExistingLineItems:false.
    const salariedEntriesInit: SalariedCompEntry[] = [];
    for (const item of enrolledItems) {
      const uid = String(item.userId ?? item.userID ?? "");
      if (!salariedRollfiUids.has(uid.toUpperCase())) continue;
      const su = rollfiIdToUser.get(uid.toUpperCase());
      const a = (adjustments as AdjInput[]).find((x) => x.rollfiUserId?.toUpperCase() === uid.toUpperCase());
      salariedEntriesInit.push({
        rollfiUserId: uid,
        name: su?.name,
        additionalCompensation: a?.additionalCompensation ?? [],
        overTime: a?.overTime ?? [],
      });
    }
    const { warnings: salariedCompWarnings } = await injectSalariedCompensations(
      rollfiCompany.rollfiCompanyId, payPeriodId, salariedEntriesInit, req.log
    );

    // Step 2: initiatePayroll
    const response = await axios.post(
      `${getBaseUrl()}/payroll#initiatePayroll`,
      {
        method: "initiatePayroll",
        companyId: rollfiCompany.rollfiCompanyId,
        payPeriodId,
        runNow: false,
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: response.data }, "Rollfi initiatePayroll raw response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "initiatePayroll");
    // Guard: Rollfi returns HTTP 200 even for failures; check the nested payPeriod.status field.
    const ppResult2 = raw.payPeriod as { status?: string; message?: string } | undefined;
    if (ppResult2?.status && ppResult2.status !== "Success") {
      const reason2 = ppResult2.message ?? `Rollfi payPeriod status: ${ppResult2.status}`;
      req.log.error({ raw, reason: reason2 }, "initiatePayroll (initiate): non-Success payPeriod status — payroll did not run");
      res.status(422).json({ error: reason2, payPeriod: ppResult2, importResult: importRaw });
      return;
    }

    const actor2 = req.session.userId ? store.getUserById(req.session.userId) : undefined;
    store.logActivity({
      companyId,
      type: "payroll.initiated",
      description: "Payroll run started",
      actorName: actor2?.name,
      actorRole: actor2?.role,
    });
    res.json({ success: true, importResult: importRaw, skippedEmployees: skippedEmployees.length > 0 ? skippedEmployees : undefined, ...(newlyEnrolled > 0 ? { newlyEnrolledMidPeriod: newlyEnrolled } : {}), ...(notEnrolledEmployees.length > 0 ? { notEnrolled: notEnrolledEmployees } : {}), ...(validationWarning ? { warning: validationWarning } : {}), ...(compWipeWarnings.length > 0 ? { compWipeWarnings } : {}), ...(salariedCompWarnings.length > 0 ? { salariedCompWarnings } : {}), ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi initiatePayroll failed");
    const rollfiMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: rollfiMessage, details: e.response?.data });
  }
});

// ── Import payroll data (Step 1 of 2-step payroll flow) ──────

router.post("/rollfi/payroll/import", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  type AdjInput = {
    rollfiUserId: string;
    additionalCompensation?: { description: string; amount: number }[];
    overTime?: { type: string; noOfHours: number; multiplier: number }[];
  };
  const { companyId, payPeriodId, adjustments = [], payBeginDate, payEndDate, employeeHours = [] } = req.body as {
    companyId: string; payPeriodId: string; adjustments?: AdjInput[];
    payBeginDate?: string; payEndDate?: string;
    employeeHours?: { rollfiUserId: string; hours: number }[];
  };
  const frontendHours = new Map<string, number>(
    employeeHours.map(({ rollfiUserId, hours }) => [rollfiUserId.toUpperCase(), hours])
  );
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

  try {
    // Build the payroll roster from Rollfi's getPayPeriodDetails — not from our in-memory store.
    req.log.info({ rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId }, "Rollfi import: fetching enrolled employees from getPayPeriodDetails");
    const rosterResp = await axios.post(
      `${getBaseUrl()}/reports#getPayPeriodDetails`,
      { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
      { headers: rollfiHeaders() }
    );
    const rosterRaw = rosterResp.data as Record<string, unknown>;
    const rosterPeriodArr = (rosterRaw.payPeriod ?? []) as Array<Record<string, unknown>>;
    const rosterPd = rosterPeriodArr[0] as Record<string, unknown> | undefined;
    // FIX 1b: must be `let` so the safety net can replace it with a refreshed roster.
    let enrolledItems = rosterPd ? (rosterPd.payrollLineItems ?? []) as Array<Record<string, unknown>> : [];
    req.log.info({ enrolledCount: enrolledItems.length, sampleItem: JSON.stringify(enrolledItems[0]) }, "getPayPeriodDetails enrolled employees (import)");

    if (enrolledItems.length === 0) {
      res.status(400).json({ error: "No employees enrolled in this Rollfi pay period." });
      return;
    }

    // FIX 1b: Safety net — enrol any mid-period hires absent from Rollfi's roster snapshot.
    // Must run BEFORE building payrollData so newly enrolled employees appear in the payload.
    const importPeriodStatus = String(rosterPd?.PayPeriodStatus ?? rosterPd?.payPeriodStatus ?? "").toLowerCase();
    let newlyEnrolled = 0;
    let notEnrolledEmployees: Array<{ rollfiUserId: string; employeeId: string; name: string; reason: string }> = [];
    {
      const safetyNet = await enrollMissingEmployeesInPeriod(
        rollfiCompany.rollfiCompanyId, payPeriodId, importPeriodStatus, enrolledItems, companyId, req.log
      );
      newlyEnrolled = safetyNet.newlyEnrolled;
      notEnrolledEmployees = safetyNet.notEnrolled;
      if (safetyNet.newlyEnrolled > 0 && safetyNet.updatedItems) {
        enrolledItems = safetyNet.updatedItems;
        req.log.info({ newlyEnrolled, newRosterCount: enrolledItems.length }, "Import: roster refreshed after mid-period hire enrollment");
      }
    }

    // Build a reverse-lookup: rollfiUserId (uppercase) → store user (for hours resolution)
    const staffUsers = store.getAllStaffUsers()
      .filter((u) => u.employeeId && u.companyId === companyId && u.role === "employee");
    const rollfiIdToUser = new Map<string, typeof staffUsers[0]>();
    for (const u of staffUsers) {
      const emp = store.getRollfiEmployee(u.employeeId!);
      if (emp?.rollfiUserId) rollfiIdToUser.set(emp.rollfiUserId.toUpperCase(), u);
    }

    // Batch-fetch payType + rollfi_user_id from DB for ALL employees in this company.
    // Using employees.rollfiUserId directly is restart-safe: store.getRollfiEmployee() loses
    // data on server restart for employees not persisted in rollfi_employee_records.
    const dbPayTypeRowsImport = await db
      .select({ id: employeesTable.id, payType: employeesTable.payType, rollfiUserId: employeesTable.rollfiUserId, status: employeesTable.status })
      .from(employeesTable).where(eq(employeesTable.companyId, companyId));
    const dbPayTypeByEmpIdImport = new Map(dbPayTypeRowsImport.map((r) => [r.id, r.payType ?? "hourly"]));
    // Extend rollfiIdToUser with DB employees not covered by testUsers, using the DB column directly.
    for (const dbEmp of dbPayTypeRowsImport) {
      if (!dbEmp.rollfiUserId) continue;
      const uid = dbEmp.rollfiUserId.toUpperCase();
      if (!rollfiIdToUser.has(uid)) {
        rollfiIdToUser.set(uid, { id: dbEmp.id, name: "", email: "", role: "employee" as const,
          companyId, employeeId: dbEmp.id, position: "" } as typeof staffUsers[0]);
      }
    }

    // Build the salaried UID set: cover both testUsers (via employeeId→payType) AND DB employees
    // identified directly by employees.rollfiUserId (restart-safe, no store dependency).
    const salariedRollfiUidsImport = new Set<string>();
    for (const [uid, su] of rollfiIdToUser) {
      if (su.employeeId && dbPayTypeByEmpIdImport.get(su.employeeId) === "salary") salariedRollfiUidsImport.add(uid);
    }
    for (const r of dbPayTypeRowsImport) {
      if (r.payType === "salary" && r.rollfiUserId) salariedRollfiUidsImport.add(r.rollfiUserId.toUpperCase());
    }

    // Filter out employees whose local status is on_leave or terminated.
    // Rollfi never auto-removes deactivated employees from an open pay period, so their
    // line items remain in getPayPeriodDetails after deactivation. We must exclude them here
    // to prevent them from appearing in the payroll table or being included in the import.
    {
      const inactiveUids = new Set(
        dbPayTypeRowsImport
          .filter((r) => !!r.rollfiUserId && (r.status === "on_leave" || r.status === "terminated"))
          .map((r) => r.rollfiUserId!.toUpperCase())
      );
      if (inactiveUids.size > 0) {
        const before = enrolledItems.length;
        enrolledItems = enrolledItems.filter((item) => {
          const uid = String(item.userId ?? item.userID ?? item.employeeId ?? item.id ?? "").toUpperCase();
          return !inactiveUids.has(uid);
        });
        req.log.info({ filtered: before - enrolledItems.length, remaining: enrolledItems.length, inactiveUids: [...inactiveUids] },
          "Import: filtered out on_leave/terminated employees from Rollfi roster");
      }
    }

    enrolledItems = await recoverZeroedSalariedEmployees(
      rollfiCompany.rollfiCompanyId, payPeriodId, enrolledItems, salariedRollfiUidsImport, req.log
    );

    const periodKey = payBeginDate && payEndDate ? `${payBeginDate}/${payEndDate}` : null;
    const dbApprovals2 = periodKey ? await getTimesheetApprovalsByCompanyPeriod(companyId, periodKey) : [];
    const approvalsByEmpId2 = new Map(dbApprovals2.map((a) => [a.employeeId, a]));

    const skippedEmployees: { rollfiUserId: string; name?: string; type?: "zero_hours" | "onboarding"; reason: string }[] = [];
    const payrollData: Array<Record<string, unknown>> = [];

    for (const item of enrolledItems) {
      const rollfiUid = (item.userId ?? item.userID ?? item.employeeId ?? item.id) as string | undefined;
      if (!rollfiUid) {
        req.log.warn({ item: JSON.stringify(item) }, "Payroll import: line item has no user ID field — skipped");
        continue;
      }
      const storeUser = rollfiIdToUser.get(rollfiUid.toUpperCase());
      const adj = adjustments.find((a) => a.rollfiUserId?.toUpperCase() === rollfiUid.toUpperCase());
      const frontendH = frontendHours.get(rollfiUid.toUpperCase());

      let payHours = 0;
      if (frontendH !== undefined) {
        payHours = frontendH;
        req.log.info({ rollfiUserId: rollfiUid, hours: frontendH }, "Import: using frontend-supplied hours");
      } else if (storeUser?.employeeId) {
        const approval = approvalsByEmpId2.get(storeUser.employeeId);
        if (approval) {
          payHours = approval.approvedHours;
          req.log.info({ rollfiUserId: rollfiUid, hours: payHours, source: approval.source }, "Import: using DB-approved hours for period");
        } else if (periodKey) {
          const synced = store.getTimesheetEntry(storeUser.employeeId, periodKey);
          payHours = synced?.approvedHours ?? 0;
          if (!synced) req.log.warn({ rollfiUserId: rollfiUid, name: storeUser.name }, "Import: no approved hours for this period — defaulting to 0h");
        }
      } else {
        req.log.warn({ rollfiUserId: rollfiUid }, "Import: unknown Rollfi employee (not in store) — defaulted to 0h");
      }

      const payHoursRounded = Math.round(payHours * 10000) / 10000;
      // FIX 3: Salaried employees — Rollfi auto-computes pay from the Per Year wage record.
      // Sending basicPay.payHours for a salaried employee overrides that and zeroes their gross.
      // IMPORTANT: to reduce a salaried employee's pay for unpaid leave, use Rollfi's
      // unPaidLeave field — NEVER by manipulating hours.
      const isSalariedEmpImport = storeUser?.employeeId
        ? (dbPayTypeByEmpIdImport.get(storeUser.employeeId) === "salary")
        : false;
      if (isSalariedEmpImport) {
        // Salaried employees are ALWAYS omitted from the main import — comp is handled by
        // injectSalariedCompensations (called below, after the main import). Including them
        // here — even with a correct basicPay.payHours — suppresses Rollfi's Per Year
        // auto-computation and zeroes baseTotal (confirmed sandbox 2026-07-26).
        req.log.info({ rollfiUserId: rollfiUid, name: storeUser?.name }, "Import: salaried employee — omitted from main import (comp injected separately)");
        continue;
      }
      const entry: Record<string, unknown> = { userId: rollfiUid };
      // Hourly employee: always send payHours and explicit comp/OT arrays.
      // Explicit [] clears stale comp only when overwriteExistingLineItems:true (see import body).
      entry.basicPay = { payHours: payHoursRounded };
      entry.additionalCompensation = adj?.additionalCompensation ?? [];
      entry.overTime = adj?.overTime ?? [];
      payrollData.push(entry);
    }

    req.log.info({
      rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId,
      employeeCount: payrollData.length,
      adjustmentsReceived: JSON.stringify(adjustments),
      payrollData: JSON.stringify(payrollData),
    }, "Rollfi importRegularPayrollData request (import)");

    const importBody = {
      // overwriteExistingLineItems: true — required for hourly employees to prevent comp
      // accumulation: explicit [] clears stale additionalCompensation/overTime only when this
      // flag is true. Decision confirmed with Rollfi 2026-07-22.
      // IMPORTANT — salaried employees must NOT be in this payrollData array. Sending them
      // here (even with correct basicPay.payHours) suppresses Rollfi's Per Year salary
      // auto-computation and zeroes baseTotal. Their comp is handled by the separate
      // injectSalariedCompensations call below, which uses overwriteExistingLineItems:false.
      method: "importRegularPayrollData",
      companyId: rollfiCompany.rollfiCompanyId,
      payPeriodId,
      overwriteExistingLineItems: true,
      payrollData,
    };
    req.log.info({ fullRollfiRequestBody: JSON.stringify(importBody) }, "outgoing importRegularPayrollData (import)");
    if (importBody.overwriteExistingLineItems !== true) {
      req.log.error({ overwriteExistingLineItems: importBody.overwriteExistingLineItems }, "FLAG MISSING FROM OUTGOING BODY");
    }
    const { warnings: compWipeWarnings } = await wipeAdditionalCompensations(
      rollfiCompany.rollfiCompanyId,
      payPeriodId,
      payrollData.map((e) => e.userId as string),
      req.log
    );
    const importResp = await axios.post(
      `${getBaseUrl()}/payroll#importRegularPayrollData`,
      importBody,
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: importResp.data }, "Rollfi importRegularPayrollData response (import)");
    const importRaw = importResp.data as Record<string, unknown>;
    assertNoRollfiError(importRaw, "importRegularPayrollData");
    const validationWarning = extractValidationWarning(importRaw);
    if (validationWarning) {
      req.log.warn({ validationWarning }, "importRegularPayrollData returned validationWarning (import)");
    }

    // Post-import: inject comp for salaried employees and wipe any stale comp.
    // Salaried employees were excluded from the main import above to preserve Rollfi's Per Year
    // auto-computation. Their comp is added here via overwriteExistingLineItems:false.
    const salariedEntriesImport: SalariedCompEntry[] = [];
    for (const item of enrolledItems) {
      const uid = String(item.userId ?? item.userID ?? "");
      if (!salariedRollfiUidsImport.has(uid.toUpperCase())) continue;
      const su = rollfiIdToUser.get(uid.toUpperCase());
      const a = (adjustments as AdjInput[]).find((x) => x.rollfiUserId?.toUpperCase() === uid.toUpperCase());
      salariedEntriesImport.push({
        rollfiUserId: uid,
        name: su?.name,
        additionalCompensation: a?.additionalCompensation ?? [],
        overTime: a?.overTime ?? [],
      });
    }
    const { warnings: salariedCompWarningsImport } = await injectSalariedCompensations(
      rollfiCompany.rollfiCompanyId, payPeriodId, salariedEntriesImport, req.log
    );

    // ── Post-import verification ─────────────────────────────────────────────
    // overwriteExistingLineItems:true makes Rollfi process asynchronously
    // ("Pending" status) instead of synchronously ("Ready"). For async imports
    // we poll getUnProcessedPayPeriod until the period leaves "importInProgress",
    // then fetch getPayPeriodDetails once. Fast path ("Ready") keeps the
    // original 3 × 2 s loop unchanged.
    const importStatus = ((importRaw?.importRegularPayrollLData as Record<string, unknown>)?.status as string) ?? "Ready";
    const isAsync = importStatus === "Pending";
    const maxAttempts = isAsync ? 15 : 3;
    const pollDelayMs = isAsync ? 3000 : 2000;
    req.log.info({ importStatus, isAsync, maxAttempts, pollDelayMs }, "Post-import verification: starting poll");
    let realTotals: { grossPay: number; netPay: number; employeeTax: number; employerTax: number; totalDebit: number } | null = null;
    const verifyMismatches: Array<{ rollfiUserId: string; sent: number; received: number }> = [];
    let lineItems: Array<Record<string, unknown>> = [];
    try {
      // FIX 3: filter out salaried entries (no basicPay key) before building the hours sentMap.
      // Salaried employees are intentionally omitted or sent without basicPay — attempting to
      // read e.basicPay.payHours on those entries would throw or produce NaN.
      const sentMap = new Map<string, number>(
        payrollData
          .filter((e) => e.basicPay !== undefined)
          .map((e) => [
            (e.userId as string).toUpperCase(),
            Math.round(((e.basicPay as { payHours: number }).payHours ?? 0) * 10000) / 10000,
          ])
      );
      // Track sent compensation so we can detect if Rollfi ignores an explicit empty array (STEP 4)
      const sentCompMap = new Map<string, Array<unknown>>(
        payrollData.map((e) => [(e.userId as string).toUpperCase(), (e.additionalCompensation as Array<unknown>) ?? []])
      );
      let verifyData: Record<string, unknown> | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise<void>((r) => setTimeout(r, pollDelayMs));
        if (isAsync) {
          // For async imports, check whether the period has left "importInProgress" before
          // fetching details — calling getPayPeriodDetails mid-import returns stale data.
          try {
            const statusResp = await axios.post(
              `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
              { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId },
              { headers: rollfiHeaders() }
            );
            const periods = ((statusResp.data as Record<string, unknown>)?.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
            const thisPeriod = periods.find((p) => p.payPeriodId === payPeriodId);
            const periodStatus = (thisPeriod?.payPeriodStatus ?? "unknown") as string;
            req.log.info({ attempt, maxAttempts, periodStatus }, "Post-import poll: period status");
            if (periodStatus === "importInProgress") continue;
          } catch (statusErr) {
            req.log.warn({ attempt, statusErr }, "Post-import poll: status check failed — retrying");
            continue;
          }
        }
        try {
          const vr = await axios.post(
            `${getBaseUrl()}/reports#getPayPeriodDetails`,
            { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
            { headers: rollfiHeaders() }
          );
          verifyData = vr.data as Record<string, unknown>;
          break;
        } catch (ve) {
          req.log.warn({ attempt, ve }, "Post-import getPayPeriodDetails attempt failed");
        }
      }
      if (!verifyData) {
        req.log.warn({ maxAttempts, pollDelayMs }, "Post-import verification: timed out waiting for Rollfi async import — realTotals unavailable");
      }
      if (verifyData) {
        const vArr = (verifyData.payPeriod ?? []) as Array<Record<string, unknown>>;
        const vPd = vArr[0] as Record<string, unknown> | undefined;
        if (vPd) {
          const vItems = (vPd.payrollLineItems ?? []) as Array<Record<string, unknown>>;
          lineItems = vItems;
          req.log.info({ verifyItemCount: vItems.length, sampleItem: JSON.stringify(vItems[0]) }, "Post-import verification: payrollLineItems sample");
          for (const vItem of vItems) {
            const uid = (vItem.userId ?? vItem.userID ?? vItem.employeeId ?? vItem.id) as string | undefined;
            if (!uid) continue;
            const sent = sentMap.get(uid.toUpperCase());
            if (sent === undefined) continue;
            const received = Math.round(Number(vItem.payHours ?? vItem.hours ?? vItem.regularHours ?? 0) * 10000) / 10000;
            if (Math.abs(sent - received) > 0.0001) {
              req.log.warn({ rollfiUserId: uid, sent, received }, "Post-import mismatch: Rollfi hours differ from what we sent");
              verifyMismatches.push({ rollfiUserId: uid, sent, received });
            }
            // STEP 4: always log comp state for every employee; ESCALATE on mismatch
            const sentComp = sentCompMap.get(uid.toUpperCase()) ?? [];
            const receivedComp = (vItem.additionalCompensations ?? vItem.additionalCompensation ?? []) as Array<unknown>;
            req.log.info(
              { rollfiUserId: uid, sentComp: JSON.stringify(sentComp), receivedComp: JSON.stringify(receivedComp) },
              "Post-import comp: sent vs received"
            );
            if (sentComp.length === 0 && Array.isArray(receivedComp) && receivedComp.length > 0) {
              // If this fires, overwriteExistingLineItems:true is not being honoured — escalate to Rollfi.
              req.log.warn({ rollfiUserId: uid, receivedComp: JSON.stringify(receivedComp) }, `ROLLFI RETAINED COMP DESPITE EMPTY ARRAY + overwriteExistingLineItems:true — ESCALATE: ${uid}`);
            }
          }
          const grossPay    = Math.round(vItems.reduce((s, e) => s + Number(e.grossTotal ?? 0), 0) * 100) / 100;
          const netPay      = Math.round(vItems.reduce((s, e) => s + Number(e.netTotal   ?? 0), 0) * 100) / 100;
          const employeeTax = Math.round(Number(vPd.employeeTaxSum ?? 0) * 100) / 100;
          const employerTax = Math.round(Number(vPd.employerTaxSum ?? 0) * 100) / 100;
          // totalDebit = grossPay + employerTax.
          // Rollfi's "Debit amount" = gross payroll + employer tax burden (what the employer
          // must fund to pay everyone). Using netPay was wrong — it understated the debit by
          // the employee withholding amount. Using vPd.total is also wrong — stale snapshot.
          realTotals = { grossPay, netPay, employeeTax, employerTax, totalDebit: Math.round((grossPay + employerTax) * 100) / 100 };
          // Flag employees whose gross > 0 but net = 0 — they won't receive payment.
          // Most common cause: bank account not verified in Rollfi.
          const zeroNetEmployees = vItems
            .filter((e) => Number(e.grossTotal ?? 0) > 0 && Number(e.netTotal ?? 0) === 0)
            .map((e) => ({ rollfiUserId: String(e.userId ?? ""), name: String(e.userName ?? "") }));
          if (zeroNetEmployees.length > 0) {
            req.log.warn({ zeroNetEmployees }, "Post-import: employees with gross>0 but netTotal=0 — likely missing verified bank account");
            (realTotals as Record<string, unknown>).zeroNetEmployees = zeroNetEmployees;
          }
        }
      }
    } catch (verifyErr) {
      req.log.warn({ verifyErr }, "Post-import verification failed — realTotals unavailable");
    }

    res.json({ success: true, payPeriodId, importResult: importRaw, skippedEmployees: skippedEmployees.length > 0 ? skippedEmployees : undefined, realTotals, lineItems, ...(newlyEnrolled > 0 ? { newlyEnrolledMidPeriod: newlyEnrolled } : {}), ...(notEnrolledEmployees.length > 0 ? { notEnrolled: notEnrolledEmployees } : {}), ...(validationWarning ? { warning: validationWarning } : {}), ...(verifyMismatches.length > 0 ? { verifyMismatches } : {}), ...(compWipeWarnings.length > 0 ? { compWipeWarnings } : {}), ...(salariedCompWarningsImport.length > 0 ? { salariedCompWarnings: salariedCompWarningsImport } : {}) });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi import step failed");
    const rollfiMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: rollfiMessage, details: e.response?.data });
  }
});

// ── Cancel payroll submission ─────────────────────────────────
// Calls Rollfi cancelPayrollSubmission so the period can be resubmitted.
// Rollfi's dashboard cancellation does not always clear the API-level submitted flag.

router.post("/rollfi/payroll/cancel-submission", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId, payPeriodId } = req.body as { companyId: string; payPeriodId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }
  try {
    const response = await axios.post(
      `${getBaseUrl()}/payroll#cancelPayrollSubmission`,
      { method: "cancelPayrollSubmission", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data }, "Rollfi cancelPayrollSubmission response");
    const raw = response.data as Record<string, unknown>;
    // Rollfi may return success in body even on HTTP 200 errors; check for error fields
    try { assertNoRollfiError(raw, "cancelPayrollSubmission"); } catch (assertErr) {
      const msg = assertErr instanceof Error ? assertErr.message : String(assertErr);
      req.log.warn({ msg, raw }, "cancelPayrollSubmission returned an error body");
      // Only surface as an error if message doesn't include "already cancelled" / "not submitted"
      if (!msg.toLowerCase().includes("not submitted") && !msg.toLowerCase().includes("not initiated")) {
        res.status(422).json({ error: msg });
        return;
      }
      // Otherwise treat as success — period is already in a cancellable state
    }
    res.json({ success: true, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "cancelPayrollSubmission failed");
    const rollfiMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: rollfiMessage, details: e.response?.data });
  }
});

// ── Submit payroll (Step 2 of 2-step payroll flow) ───────────

router.post("/rollfi/payroll/submit", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId, payPeriodId } = req.body as { companyId: string; payPeriodId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }
  try {
    const response = await axios.post(
      `${getBaseUrl()}/payroll#initiatePayroll`,
      { method: "initiatePayroll", companyId: rollfiCompany.rollfiCompanyId, payPeriodId, runNow: false },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data }, "Rollfi initiatePayroll (submit step)");
    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "initiatePayroll");
    // Guard: Rollfi returns HTTP 200 even for failures; check the nested payPeriod.status field.
    const ppResult = raw.payPeriod as { status?: string; message?: string } | undefined;
    if (ppResult?.status && ppResult.status !== "Success") {
      const reason = ppResult.message ?? `Rollfi payPeriod status: ${ppResult.status}`;
      req.log.error({ raw, reason }, "initiatePayroll (submit): non-Success payPeriod status — payroll did not run");
      res.status(422).json({ error: reason, payPeriod: ppResult });
      return;
    }
    const actorSub = req.session.userId ? store.getUserById(req.session.userId) : undefined;
    store.logActivity({
      companyId,
      type: "payroll.submitted",
      description: "Payroll submitted for processing",
      actorName: actorSub?.name,
      actorRole: actorSub?.role,
    });
    res.json({ success: true, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi submit step failed");
    const rollfiMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: rollfiMessage, details: e.response?.data });
  }
});

// ── Payroll overview (all companies, current period) ─────────

router.get("/rollfi/payroll/overview", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const daycareCompanies = store.getDaycareCompanies().filter((c) => store.getRollfiCompany(c.id));
  const results = await Promise.all(
    daycareCompanies.map(async (company) => {
      const rollfiCompany = store.getRollfiCompany(company.id)!;
      try {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getPayPeriod`,
          { method: "getPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
          { headers: rollfiHeaders() }
        );
        const raw = r.data as Record<string, unknown>;
        assertNoRollfiError(raw, "getPayPeriod");
        // getPayPeriod returns fields directly (not an array) — treat as a single period object
        const hasPeriod = !!(raw.payPeriodId || raw.payBeginDate);
        return {
          companyId: company.id, companyName: company.name, rollfiCompanyId: rollfiCompany.rollfiCompanyId,
          payPeriod: hasPeriod ? raw : null,
        };
      } catch (e) {
        return { companyId: company.id, companyName: company.name, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriod: null, error: String(e) };
      }
    })
  );
  res.json({ companies: results });
});

// ── Pay period history (processed periods) ───────────────────

router.get("/rollfi/payperiod/history", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

  const rawResponses: Record<string, unknown> = {};

  // ── 1. Confirmed/processed periods ───────────────────────────
  let processedPeriods: Array<Record<string, unknown>> = [];
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getProcessedPayperiodsDetails`,
      { method: "getProcessedPayperiodsDetails", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    rawResponses.getProcessedPayperiodsDetails = r.data;
    const raw = r.data as Record<string, unknown>;
    req.log.info({ raw, keys: Object.keys(raw) }, "Rollfi getProcessedPayperiodsDetails response");
    processedPeriods = (
      raw.processedPayPeriods ?? raw.processedPayperiods ?? raw.payPeriods ?? raw.periods ?? []
    ) as Array<Record<string, unknown>>;
  } catch (err) {
    req.log.warn({ err }, "getProcessedPayperiodsDetails failed — continuing with unprocessed only");
    rawResponses.getProcessedPayperiodsDetailsError = String(err);
  }

  // ── 2. Unprocessed periods that are NOT "new" ─────────────────
  // Catches submitted / inProcess / preProcess periods that exist before
  // Rollfi marks them as fully processed.
  let pendingPeriods: Array<Record<string, unknown>> = [];
  try {
    const r2 = await axios.post(
      `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
      { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    rawResponses.getUnProcessedPayPeriod = r2.data;
    const raw2 = r2.data as Record<string, unknown>;
    req.log.info({ raw: raw2, keys: Object.keys(raw2) }, "Rollfi getUnProcessedPayPeriod response (for history)");
    const allUnprocessed = (raw2.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
    // Keep only non-"new" periods — "new" is the current live period already shown in the UI
    const CURRENT_STATUSES = new Set(["new", ""]);
    pendingPeriods = allUnprocessed.filter(
      (p) => !CURRENT_STATUSES.has(String(p.payPeriodStatus ?? "").toLowerCase())
    );
  } catch (err) {
    req.log.warn({ err }, "getUnProcessedPayPeriod (for history) failed — continuing with processed only");
    rawResponses.getUnProcessedPayPeriodError = String(err);
  }

  // ── 3. Merge, deduplicate by payPeriodId, sort newest first ──
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const p of [...processedPeriods, ...pendingPeriods]) {
    const id = String(p.payPeriodId ?? p.payBeginDate ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(p);
  }
  const sorted = merged.sort((a, b) =>
    String(b.payBeginDate ?? b.payDate ?? "").localeCompare(String(a.payBeginDate ?? a.payDate ?? ""))
  );

  req.log.info(
    { processedCount: processedPeriods.length, pendingCount: pendingPeriods.length, mergedCount: sorted.length },
    "pay period history merged"
  );

  res.json({ periods: sorted.slice(0, 20), raw: rawResponses });
});

// ── Run all payroll (all onboarded companies in sequence) ─────

router.post("/rollfi/payroll/run-all", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const daycareCompanies = store.getDaycareCompanies().filter((c) => store.getRollfiCompany(c.id));
  const results: Array<Record<string, unknown>> = [];

  for (const company of daycareCompanies) {
    const rollfiCompany = store.getRollfiCompany(company.id)!;
    try {
      // Get current unprocessed period
      const ppResp = await axios.post(
        `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
        { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
        { headers: rollfiHeaders() }
      );
      const ppRaw = ppResp.data as Record<string, unknown>;
      assertNoRollfiError(ppRaw, "getUnProcessedPayPeriod");
      const periods = (ppRaw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
      if (periods.length === 0) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: "No unprocessed pay period" });
        continue;
      }
      const period = [...periods].sort((a, b) => String(b.payBeginDate ?? "").localeCompare(String(a.payBeginDate ?? "")))[0];
      const payPeriodId = period.payPeriodId as string;
      const payPeriodStatus = ((period.payPeriodStatus as string) ?? "").toLowerCase();
      if (!["new", "failed", "cancelled", ""].includes(payPeriodStatus)) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: `Already ${payPeriodStatus}` });
        continue;
      }

      const staffUsers = store.getAllStaffUsers().filter(
        (u) => u.employeeId && u.companyId === company.id && u.role === "employee"
      );
      const onboarded = staffUsers.filter((u) => store.getRollfiEmployee(u.employeeId!)?.rollfiUserId);
      if (onboarded.length === 0) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: "No onboarded employees" });
        continue;
      }

      // Build roster from Rollfi's enrolled employees — not from our store.
      // addUsersToRegularPayPeriod removed: Rollfi auto-enrolls on pay period creation.
      const ppDetailsResp = await axios.post(
        `${getBaseUrl()}/reports#getPayPeriodDetails`,
        { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
        { headers: rollfiHeaders() }
      );
      const pdRaw = ppDetailsResp.data as Record<string, unknown>;
      const pdArr = (pdRaw.payPeriod ?? []) as Array<Record<string, unknown>>;
      const pdPeriod = pdArr[0] as Record<string, unknown> | undefined;
      let enrolledForRunAll = pdPeriod ? (pdPeriod.payrollLineItems ?? []) as Array<Record<string, unknown>> : [];

      const runAllPeriodKey = `${String(period.payBeginDate ?? "")}/${String(period.payEndDate ?? "")}`;
      const runAllRollfiIdToUser = new Map<string, typeof onboarded[0]>();
      for (const u of onboarded) {
        const emp = store.getRollfiEmployee(u.employeeId!);
        if (emp?.rollfiUserId) runAllRollfiIdToUser.set(emp.rollfiUserId.toUpperCase(), u);
      }

      // Identify salaried employees — must be excluded from the main import.
      // Using employees.rollfiUserId directly is restart-safe (no store dependency).
      const runAllDbPayTypeRows = await db
        .select({ id: employeesTable.id, payType: employeesTable.payType, rollfiUserId: employeesTable.rollfiUserId })
        .from(employeesTable).where(eq(employeesTable.companyId, company.id));
      const runAllDbPayTypeByEmpId = new Map(runAllDbPayTypeRows.map((r) => [r.id, r.payType ?? "hourly"]));
      // Extend runAllRollfiIdToUser with DB employees not in testUsers, using DB column directly.
      for (const dbEmp of runAllDbPayTypeRows) {
        if (!dbEmp.rollfiUserId) continue;
        const uid = dbEmp.rollfiUserId.toUpperCase();
        if (!runAllRollfiIdToUser.has(uid)) {
          runAllRollfiIdToUser.set(uid, { id: dbEmp.id, name: "", email: "", role: "employee" as const,
            companyId: company.id, employeeId: dbEmp.id, position: "" } as typeof onboarded[0]);
        }
      }
      const runAllSalariedUids = new Set<string>();
      for (const [uid, su] of runAllRollfiIdToUser) {
        if (su.employeeId && runAllDbPayTypeByEmpId.get(su.employeeId) === "salary") runAllSalariedUids.add(uid);
      }
      for (const r of runAllDbPayTypeRows) {
        if (r.payType === "salary" && r.rollfiUserId) runAllSalariedUids.add(r.rollfiUserId.toUpperCase());
      }

      // Recovery: salaried employees at payHours=0 (freshly enrolled or previously zeroed).
      enrolledForRunAll = await recoverZeroedSalariedEmployees(
        rollfiCompany.rollfiCompanyId, payPeriodId, enrolledForRunAll, runAllSalariedUids, req.log
      );

      const runAllImportBody = {
        // overwriteExistingLineItems: true — required for hourly employees to prevent comp
        // accumulation: explicit [] clears stale comp only when this flag is true.
        // Decision confirmed with Rollfi 2026-07-22.
        // IMPORTANT — salaried employees must NOT be in this payrollData array. Their stale
        // comp is cleared by injectSalariedCompensations below (which uses overwrite=false).
        method: "importRegularPayrollData",
        companyId: rollfiCompany.rollfiCompanyId,
        payPeriodId,
        overwriteExistingLineItems: true,
        payrollData: enrolledForRunAll
          .filter((item) => {
            const uid = String(item.userId ?? item.userID ?? item.employeeId ?? item.id ?? "").toUpperCase();
            return !runAllSalariedUids.has(uid);
          })
          .map((item) => {
            const uid = ((item.userId ?? item.userID ?? item.employeeId ?? item.id) as string | undefined) ?? "";
            const storeUser = runAllRollfiIdToUser.get(uid.toUpperCase());
            const synced = storeUser?.employeeId ? store.getTimesheetEntry(storeUser.employeeId, runAllPeriodKey) : null;
            const payHours = Math.round((synced?.approvedHours ?? 0) * 10000) / 10000;
            return { userId: uid, basicPay: { payHours }, additionalCompensation: [], overTime: [] };
          }),
      };
      req.log.info({ fullRollfiRequestBody: JSON.stringify(runAllImportBody) }, "outgoing importRegularPayrollData (run-all)");
      if (runAllImportBody.overwriteExistingLineItems !== true) {
        req.log.error({ overwriteExistingLineItems: runAllImportBody.overwriteExistingLineItems }, "FLAG MISSING FROM OUTGOING BODY");
      }
      const { warnings: compWipeWarnings } = await wipeAdditionalCompensations(
        rollfiCompany.rollfiCompanyId,
        payPeriodId,
        runAllImportBody.payrollData.map((e) => e.userId as string),
        req.log
      );
      const importResp = await axios.post(
        `${getBaseUrl()}/payroll#importRegularPayrollData`,
        runAllImportBody,
        { headers: rollfiHeaders() }
      );
      assertNoRollfiError(importResp.data as Record<string, unknown>, "importRegularPayrollData");

      // Salaried comp injection: run-all carries no adjustments, so only stale-comp wipe fires.
      const runAllSalariedEntries: SalariedCompEntry[] = enrolledForRunAll
        .filter((item) => runAllSalariedUids.has(String(item.userId ?? item.userID ?? "").toUpperCase()))
        .map((item) => ({
          rollfiUserId: String(item.userId ?? item.userID ?? ""),
          name: String(item.userName ?? ""),
          additionalCompensation: [] as { description: string; amount: number }[],
          overTime: [] as { type: string; noOfHours: number; multiplier: number }[],
        }));
      const { warnings: salariedCompWarnings } = await injectSalariedCompensations(
        rollfiCompany.rollfiCompanyId, payPeriodId, runAllSalariedEntries, req.log
      );

      // Initiate
      const initiateResp = await axios.post(
        `${getBaseUrl()}/payroll#initiatePayroll`,
        { method: "initiatePayroll", companyId: rollfiCompany.rollfiCompanyId, payPeriodId, runNow: false },
        { headers: rollfiHeaders() }
      );
      assertNoRollfiError(initiateResp.data as Record<string, unknown>, "initiatePayroll");

      results.push({ companyId: company.id, companyName: company.name, success: true, payPeriodId, payPeriod: period, ...(compWipeWarnings.length > 0 ? { compWipeWarnings } : {}), ...(salariedCompWarnings.length > 0 ? { salariedCompWarnings } : {}) });
    } catch (err) {
      results.push({ companyId: company.id, companyName: company.name, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ results });
});

// ── Company task list (onboarding status) ────────────────────

router.get("/rollfi/company-tasks", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  try {
    const r = await axios.post(
      `${getBaseUrl()}/reports#getCompanyTask`,
      { method: "getCompanyTask", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "Rollfi getCompanyTask response");
    const raw = r.data as Record<string, unknown>;
    const tasks = (raw.tasks ?? []) as Array<{ task: string; description: string }>;
    const kybTask = tasks.find((t) => t.task === "KYB verification");
    const bankTask = tasks.find((t) => t.task === "Connect bank account");
    // kybStatus derivation:
    //   "approved" — no pending KYB task (Rollfi removes the task once approved), OR task description says approved/verified
    //   "pending"  — task exists and description contains "pending"
    //   "failed"   — task exists and description contains "failed"
    //   "issue"    — task exists with an unrecognised description
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
    res.json({ tasks, kybStatus, bankLinked: !bankTask });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    res.status(500).json({ error: String(err), rollfiErrorBody: e.response?.data });
  }
});

// ── Pay period details (real tax data from Rollfi after processing) ──────

router.get("/rollfi/payperiod/details", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId, payPeriodId } = req.query as { companyId: string; payPeriodId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded" }); return; }
  if (!payPeriodId) { res.status(400).json({ error: "payPeriodId required" }); return; }
  try {
    const response = await axios.post(
      `${getBaseUrl()}/reports#getPayPeriodDetails`,
      { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data }, "getPayPeriodDetails response");
    res.json(response.data);
  } catch (err) {
    req.log.error({ err }, "getPayPeriodDetails failed");
    res.status(500).json({ error: "Failed to get pay period details" });
  }
});

// ── Pay stubs (per-employee pay breakdown for a processed period) ─────────

router.get("/rollfi/paystubs", async (req, res) => {
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId, payPeriodId, payBeginDate: pbDate, payEndDate: peDate } = req.query as { companyId: string; payPeriodId?: string; payBeginDate?: string; payEndDate?: string };
  const stubPeriodKey = pbDate && peDate ? `${pbDate}/${peDate}` : null;
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded" }); return; }

  const staff = store.getAllStaffUsers().filter(
    (u) => u.companyId === companyId && u.employeeId && u.role === "employee"
  );

  let rollfiEmpDetails: Array<Record<string, unknown>> = [];
  let rollfiPeriod: Record<string, unknown> | null = null;
  let rollfiRaw: unknown = null;

  if (payPeriodId) {
    // Primary: getPayPeriodDetails — richer data with employeeTaxDetails, employerTaxDetails, netTotal, payDetails
    try {
      const r = await axios.post(
        `${getBaseUrl()}/reports#getPayPeriodDetails`,
        { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
        { headers: rollfiHeaders() }
      );
      rollfiRaw = r.data;
      const raw = r.data as Record<string, unknown>;
      const periodArr = (raw.payPeriod ?? []) as Array<Record<string, unknown>>;
      rollfiPeriod = periodArr[0] ?? null;
      const lineItems = ((rollfiPeriod?.payrollLineItems ?? []) as Array<Record<string, unknown>>);
      if (lineItems.length > 0) {
        rollfiEmpDetails = lineItems;
        req.log.info(
          {
            payPeriodId,
            periodTotal: rollfiPeriod?.total,
            isProcessed: rollfiPeriod?.isProcessed,
            PayPeriodStatus: rollfiPeriod?.PayPeriodStatus,
            employeeCount: lineItems.length,
            fieldMapping: lineItems.map((e) => ({
              userId: e.userId,
              employeeTaxDetailCount: (e.employeeTaxDetails as unknown[] | undefined)?.length ?? 0,
              employerTaxDetailCount: (e.employerTaxDetails as unknown[] | undefined)?.length ?? 0,
              taxNames: ((e.employeeTaxDetails ?? []) as Array<{ taxName?: unknown }>).map((t) => t.taxName),
              employerTaxNames: ((e.employerTaxDetails ?? []) as Array<{ taxName?: unknown }>).map((t) => t.taxName),
            })),
          },
          "ROLLFI PAYSTUB FIELD MAPPING DEBUG"
        );
      }
    } catch (e) {
      req.log.warn({ e }, "getPayPeriodDetails failed for paystubs — falling back to getProcessedPayperiodEmpDetails");
      // Fallback: getProcessedPayperiodEmpDetails
      try {
        const r = await axios.post(
          `${getBaseUrl()}/reports#getProcessedPayperiodEmpDetails`,
          { method: "getProcessedPayperiodEmpDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
          { headers: rollfiHeaders() }
        );
        rollfiRaw = r.data;
        const raw = r.data as Record<string, unknown>;
        rollfiEmpDetails = (
          raw.employeePayPeriodDetails ?? raw.employeeDetails ?? raw.payrollDetails ?? raw.employees ?? []
        ) as Array<Record<string, unknown>>;
        req.log.info({ rollfiEmpDetailsRaw: JSON.stringify(rollfiEmpDetails, null, 2) }, "ROLLFI RAW PAYSTUB DATA (fallback endpoint)");
      } catch (e2) {
        req.log.warn({ e2 }, "Both Rollfi paystub endpoints failed — building from local data");
      }
    }
  }

  const stubs = staff.map((u) => {
    const re = u.employeeId ? store.getRollfiEmployee(u.employeeId) : null;
    const rollfiDetail = re?.rollfiUserId
      ? rollfiEmpDetails.find((d) =>
          String(d.userId ?? d.rollfiUserId ?? "").toUpperCase() === re.rollfiUserId.toUpperCase()
        )
      : null;

    const synced = (stubPeriodKey && u.employeeId) ? store.getTimesheetEntry(u.employeeId, stubPeriodKey) : null;
    const payHours = synced ? synced.approvedHours : 75;

    const hourlyRateCents = u.hourlyWage ?? 1500;
    const hourlyRate = hourlyRateCents / 100;

    // Gross pay — prefer grossTotal (getPayPeriodDetails field) then legacy fallbacks
    const grossPay = rollfiDetail
      ? Number(rollfiDetail.grossTotal ?? rollfiDetail.grossPay ?? rollfiDetail.totalPay ?? rollfiDetail.totalPayAmount ?? payHours * hourlyRate)
      : payHours * hourlyRate;

    // Estimated fallback values (used when Rollfi tax details not available)
    const federalTax  = Math.round(grossPay * 0.12   * 100) / 100;
    const stateTax    = Math.round(grossPay * 0.05   * 100) / 100;
    const fica        = Math.round(grossPay * 0.0765 * 100) / 100;
    const defaultDed  = Math.round((federalTax + stateTax + fica) * 100) / 100;

    // Total deductions — prefer employeeTax.employeeTax (getPayPeriodDetails), then legacy fields
    const employeeTaxObj = rollfiDetail?.employeeTax as Record<string, unknown> | undefined;
    const deductions  = rollfiDetail
      ? Number(employeeTaxObj?.employeeTax ?? rollfiDetail.deductions ?? rollfiDetail.totalDeductions ?? rollfiDetail.totalTax ?? defaultDed)
      : defaultDed;

    // Net pay — prefer netTotal (getPayPeriodDetails field)
    const netPay = rollfiDetail
      ? Number(rollfiDetail.netTotal ?? rollfiDetail.netPay ?? rollfiDetail.takeHomePay ?? grossPay - deductions)
      : grossPay - deductions;

    // YTD gross
    const ytdGross = rollfiDetail
      ? Number(rollfiDetail.ytdGross ?? rollfiDetail.yearToDateGross ?? rollfiDetail.ytdTotalGross ?? grossPay)
      : grossPay;

    // Rich tax detail arrays from getPayPeriodDetails
    type RollfiTaxRow = { taxName: string; taxAmount: number; taxAmountYtd: number; isEmployerTax: boolean };
    const rawEmpTax = (rollfiDetail?.employeeTaxDetails ?? null) as Array<Record<string, unknown>> | null;
    const rawErTax  = (rollfiDetail?.employerTaxDetails ?? null) as Array<Record<string, unknown>> | null;

    const employeeTaxDetails: RollfiTaxRow[] | null = rawEmpTax
      ? rawEmpTax
          .filter((t) => Number(t.taxAmount ?? 0) > 0)
          .map((t) => ({
            taxName: String(t.taxName ?? ""),
            taxAmount: Math.round(Number(t.taxAmount ?? 0) * 100) / 100,
            taxAmountYtd: Math.round(Number(t.taxAmountYtd ?? 0) * 100) / 100,
            isEmployerTax: false,
          }))
      : null;

    const employerTaxDetails: RollfiTaxRow[] | null = rawErTax
      ? rawErTax
          .filter((t) => Number(t.taxAmount ?? 0) > 0)
          .map((t) => ({
            taxName: String(t.taxName ?? ""),
            taxAmount: Math.round(Number(t.taxAmount ?? 0) * 100) / 100,
            taxAmountYtd: Math.round(Number(t.taxAmountYtd ?? 0) * 100) / 100,
            isEmployerTax: true,
          }))
      : null;

    // Hours from getPayPeriodDetails payHours field, else timesheet, else estimate
    const hoursWorked = rollfiDetail?.payHours ? Number(rollfiDetail.payHours) : (synced ? synced.hoursWorked : payHours);

    return {
      employeeId: u.employeeId,
      rollfiUserId: re?.rollfiUserId ?? null,
      name: u.name,
      position: u.position,
      hourlyRate,
      hoursWorked,
      hoursSource: synced ? synced.source : "fallback",
      grossPay:   Math.round(grossPay   * 100) / 100,
      baseTotal:  rollfiDetail ? Math.round(Number(rollfiDetail.baseTotal ?? grossPay) * 100) / 100 : null,
      // Legacy flat fields (fallback display when rich arrays not available)
      federalTax: employeeTaxDetails
        ? (employeeTaxDetails.find((t) => t.taxName.toLowerCase().includes("federal"))?.taxAmount ?? federalTax)
        : (rollfiDetail ? Number(rollfiDetail.federalTax ?? rollfiDetail.federalIncomeTax ?? federalTax) : federalTax),
      stateTax: employeeTaxDetails
        ? (employeeTaxDetails.find((t) => t.taxName.toLowerCase().includes("state"))?.taxAmount ?? stateTax)
        : (rollfiDetail ? Number(rollfiDetail.stateTax ?? rollfiDetail.stateIncomeTax ?? stateTax) : stateTax),
      fica: employeeTaxDetails
        ? Math.round(((employeeTaxDetails.find((t) => t.taxName.toLowerCase().includes("social"))?.taxAmount ?? 0) + (employeeTaxDetails.find((t) => t.taxName.toLowerCase().includes("medicare"))?.taxAmount ?? 0)) * 100) / 100
        : (rollfiDetail ? Number(rollfiDetail.fica ?? rollfiDetail.socialSecurity ?? fica) : fica),
      deductions: Math.round(deductions * 100) / 100,
      netPay:     Math.round(netPay     * 100) / 100,
      ytdGross:   Math.round(ytdGross   * 100) / 100,
      fromRollfi: !!rollfiDetail,
      isProcessed: rollfiPeriod ? Boolean(rollfiPeriod.isProcessed) : false,
      employeeTaxDetails,
      employerTaxDetails,
      overTimes: (rollfiDetail?.overTimes ?? null) as Array<{ type: string; amount: number; numberOfHours: number }> | null,
      additionalCompensations: (rollfiDetail?.additionalCompensations ?? null) as Array<{
        payrollLineItemAdditionalCompensationVertexCompensationIdentifier: { compensationDescription: string };
        amount: number;
      }> | null,
      reimbursements: (rollfiDetail?.reimbursements ?? null) as Array<{ reimbursementType: string; amount: number }> | null,
      payDetails: (rollfiDetail?.payDetails ?? null) as Array<{
        payPercentage: number;
        amount: number;
        employeePayAccount: { accountName: string } | null;
      }> | null,
    };
  });

  res.json({
    payPeriodId: payPeriodId ?? null,
    companyId,
    stubs,
    rollfiRaw,
    periodTotal:    rollfiPeriod?.total    != null ? Math.round(Number(rollfiPeriod.total)    * 100) / 100 : null,
    employeeTaxSum: rollfiPeriod?.employeeTaxSum != null ? Number(rollfiPeriod.employeeTaxSum) : null,
    employerTaxSum: rollfiPeriod?.employerTaxSum != null ? Number(rollfiPeriod.employerTaxSum) : null,
    isProcessed: rollfiPeriod ? Boolean(rollfiPeriod.isProcessed) : false,
  });
});

// ── Rollfi Webhook Receiver ────────────────────────────────────────────────

type RollfiWebhookEvent = {
  id: string;
  eventType: string;
  companyId: string | null;
  rollfiCompanyId: string | null;
  payPeriodId: string | null;
  payload: string;
  receivedAt: string;
};

const rollfiEventCache: RollfiWebhookEvent[] = [];
let cacheLoadedFromDb = false;

async function loadEventsFromDb(log: { warn: (...a: unknown[]) => void }) {
  if (cacheLoadedFromDb) return;
  cacheLoadedFromDb = true;
  try {
    const rows = await db
      .select()
      .from(rollfiWebhookEvents)
      .orderBy(desc(rollfiWebhookEvents.id))
      .limit(50);
    rollfiEventCache.push(...rows.map((r) => ({ ...r, id: String(r.id) })));
  } catch (err) {
    log.warn({ err }, "Failed to load Rollfi webhook events from DB");
  }
}

/**
 * Resolve the internal company UUID from a Rollfi company ID.
 *
 * Searches the in-memory store first (fast path), then falls back to a DB
 * lookup so every company on the platform is covered — not just those whose
 * IDs are hard-coded.  Returns null when no match is found.
 */
async function resolveCompanyIdAsync(rollfiCompanyId: string | null): Promise<string | null> {
  if (!rollfiCompanyId) return null;
  // Fast path: in-memory store (populated during boot and on company register)
  const allCompanies = store.getCompanies();
  for (const c of allCompanies) {
    const rec = store.getRollfiCompany(c.id);
    if (rec?.rollfiCompanyId === rollfiCompanyId) return c.id;
  }
  // Slow path: DB lookup (handles companies not yet in the in-memory store)
  try {
    const [row] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.rollfiCompanyId, rollfiCompanyId))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// POST /rollfi/webhook — public endpoint called by Rollfi via Convoy.
// HMAC-SHA256 signature verification is enforced when CONVOY_WEBHOOK_SECRET is set.
router.post("/rollfi/webhook", async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signatureHeader = req.headers["x-convoy-signature"] as string | undefined;

  // ── HMAC signature verification ───────────────────────────────────────────
  // When ROLLFI_WEBHOOK_SECRET (or legacy CONVOY_WEBHOOK_SECRET) is set,
  // enforce full HMAC verification — missing or invalid signature → 401.
  // When neither secret is set, accept the event and emit a WARN on every
  // request (all environments, including production).  This matches Rollfi's
  // current behaviour: signing is disabled on their side, so no secret will
  // ever be present.  Setting ROLLFI_WEBHOOK_SECRET later re-enables strict
  // enforcement automatically with no code change.
  if (!CONVOY_WEBHOOK_SECRET) {
    req.log.warn(
      { path: req.path },
      "Rollfi webhook accepted without signature verification — ROLLFI_WEBHOOK_SECRET not set (Rollfi signing disabled for this account)",
    );
  } else {
    if (!signatureHeader) {
      req.log.warn({ path: req.path }, "Rollfi webhook rejected: missing x-convoy-signature header");
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }
    const valid = verifyConvoySignature(rawBody, signatureHeader, CONVOY_WEBHOOK_SECRET);
    if (valid) {
      req.log.info({ sig: signatureHeader.slice(0, 24) + "…" }, "Rollfi webhook signature verified OK");
    } else {
      req.log.warn({ signatureHeader }, "Rollfi webhook rejected: HMAC signature mismatch");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const body = req.body as Record<string, unknown>;

  // DEBUG: log the full raw payload so field names are visible in logs.
  // This is intentionally verbose — it helps diagnose mismatches when Rollfi
  // changes their payload structure without notice.
  req.log.debug({ rawWebhookBody: body }, "Rollfi webhook raw payload");

  // Rollfi nests the event type at body.trigger.eventType — check that first,
  // then fall back to legacy flat fields for older event shapes.
  const trigger = body.trigger as Record<string, unknown> | undefined;
  const eventType =
    (trigger?.eventType as string) ||
    (body.event as string) ||
    (body.type as string) ||
    (body.eventType as string) ||
    "unknown";

  // Rollfi's live payloads nest company/period IDs at multiple levels.
  // Priority order (most specific → least specific):
  //   1. body.trigger.companyId / body.trigger.payPeriodId  (nested trigger object)
  //   2. body.companyId / body.payPeriodId                  (flat top-level)
  //   3. body.company_id / body.pay_period_id               (snake_case variants)
  //   4. body.payload[0].companyId / body.payload[0].payPeriodId (first payload entry)
  const payloadArr = (body.payload as Array<Record<string, unknown>> | undefined) ?? [];
  const firstPayload = payloadArr[0] ?? {};
  const rollfiCompanyId: string | null =
    (trigger?.companyId as string | undefined) ||
    (trigger?.company_id as string | undefined) ||
    (body.companyId as string | undefined) ||
    (body.company_id as string | undefined) ||
    (firstPayload.companyId as string | undefined) ||
    (firstPayload.company_id as string | undefined) ||
    null;
  const payPeriodId: string | null =
    (trigger?.payPeriodId as string | undefined) ||
    (trigger?.pay_period_id as string | undefined) ||
    (body.payPeriodId as string | undefined) ||
    (body.pay_period_id as string | undefined) ||
    (firstPayload.payPeriodId as string | undefined) ||
    (firstPayload.pay_period_id as string | undefined) ||
    null;

  const resolvedCompanyId = await resolveCompanyIdAsync(rollfiCompanyId);

  const event: RollfiWebhookEvent = {
    id: Date.now().toString(),
    eventType,
    companyId: resolvedCompanyId,
    rollfiCompanyId,
    payPeriodId,
    payload: JSON.stringify(body),
    receivedAt: new Date().toISOString(),
  };

  rollfiEventCache.unshift(event);
  if (rollfiEventCache.length > 100) rollfiEventCache.pop();

  try {
    await db.insert(rollfiWebhookEvents).values({
      eventType: event.eventType,
      companyId: event.companyId ?? undefined,
      rollfiCompanyId: event.rollfiCompanyId ?? undefined,
      payPeriodId: event.payPeriodId ?? undefined,
      payload: event.payload,
      receivedAt: event.receivedAt,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to persist Rollfi webhook event");
  }

  // ── Write-back handlers ───────────────────────────────────────────────────
  // Any write failure returns 200 anyway — never crash the webhook endpoint.

  // Shared types for employee event payloads (same shape across all 4 types)
  type WebhookUser = {
    userId?: string;
    kycStatus?: string;
    status?: { userStatus?: string };
    bankAccounts?: Array<{ status?: string; accountPriority?: string }>;
  };
  type WebhookPayloadEntry = { user?: WebhookUser[]; Company?: WebhookCompany[] };
  type WebhookCompany = {
    companyID?: string;
    kycStatus?: string; // Rollfi names the company KYB field "kycStatus" in the payload
  };

  // employee.employeestatus.update / .insert
  // employee.kycstatus.update / .insert
  // All four use identical payload shape → one shared handler.
  const isEmployeeEvent = [
    "employee.employeestatus.update",
    "employee.employeestatus.insert",
    "employee.kycstatus.update",
    "employee.kycstatus.insert",
  ].includes(eventType);

  if (isEmployeeEvent) {
    try {
      const payloadArr = (body.payload as WebhookPayloadEntry[] | undefined) ?? [];
      const users: WebhookUser[] = payloadArr.flatMap((p) => p.user ?? []);

      for (const u of users) {
        if (!u.userId) continue;
        const [emp] = await db
          .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
          .from(employeesTable)
          .where(eq(employeesTable.rollfiUserId, u.userId));
        if (!emp) {
          req.log.warn({ rollfiUserId: u.userId, eventType }, "Rollfi webhook: no employee found for userId — skipping write-back");
          continue;
        }
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (u.kycStatus !== undefined) updates.kycStatus = u.kycStatus;
        if (u.status?.userStatus !== undefined) updates.rollfiAccountStatus = u.status.userStatus;
        // Bank account status — log it; no dedicated column, but surfaces in logs for debugging
        const primaryBank = u.bankAccounts?.find((b) => b.accountPriority === "Primary") ?? u.bankAccounts?.[0];
        const bankStatus = primaryBank?.status;
        await db.update(employeesTable).set(updates).where(eq(employeesTable.id, emp.id));
        req.log.info(
          { employeeId: emp.id, name: `${emp.firstName} ${emp.lastName}`, eventType, kycStatus: u.kycStatus, userStatus: u.status?.userStatus, bankAccountStatus: bankStatus ?? "none" },
          "Rollfi webhook: wrote back employee status"
        );
      }
    } catch (writeErr) {
      req.log.warn({ writeErr, eventType }, "Rollfi webhook employee write-back failed — returning 200 anyway");
    }
  }

  // company.kybstatus.update → write kybStatus to the companies table
  else if (eventType === "company.kybstatus.update") {
    try {
      const payloadArr = (body.payload as WebhookPayloadEntry[] | undefined) ?? [];
      const companies: WebhookCompany[] = payloadArr.flatMap((p) => p.Company ?? []);

      for (const c of companies) {
        if (!c.companyID) continue;
        const kybStatus = c.kycStatus; // Rollfi calls it kycStatus in the payload for company events
        if (!kybStatus) continue;
        const result = await db
          .update(companiesTable)
          .set({ kybStatus, updatedAt: new Date().toISOString() })
          .where(eq(companiesTable.rollfiCompanyId, c.companyID));
        req.log.info({ rollfiCompanyId: c.companyID, kybStatus, result }, "Rollfi webhook: wrote back company kybStatus");
      }
    } catch (writeErr) {
      req.log.warn({ writeErr }, "Rollfi webhook company write-back failed — returning 200 anyway");
    }
  }

  // payperiod.payperiodstatus.insert / .update — informational only, no write-back needed
  else if (eventType === "payperiod.payperiodstatus.insert" || eventType === "payperiod.payperiodstatus.update") {
    req.log.info({ eventType, rollfiCompanyId, payPeriodId }, "Rollfi webhook: pay period status event received — logged only, no write-back");
  }

  // Truly unrecognised events — still logged to the DB table above, just surfaced here
  else if (eventType !== "unknown") {
    req.log.info({ eventType, rollfiCompanyId }, "Rollfi webhook: unrecognised event type — stored but no write-back");
  }
  // ─────────────────────────────────────────────────────────────────────────

  req.log.info({ eventType, rollfiCompanyId, payPeriodId }, "Rollfi webhook received");
  res.json({ received: true });
});

// POST /rollfi/admin/seed-statuses — one-time sync: fetch live Rollfi status for all
// employees across all Rollfi-onboarded companies and write kycStatus + userStatus back.
// ADDITIVE only: never changes employee status, payroll_ready, or lifecycle fields.
router.post("/rollfi/admin/seed-statuses", async (req, res) => {
  if (!req.session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin required" }); return; }
  if (!getRollfiConfig().credentialsPresent) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }

  type RollfiUser = { userId: string; kycStatus?: string; status?: { userStatus?: string } };

  const allCompanies = await db.select().from(companiesTable);
  const rollfiCompanies = allCompanies.filter((c) => c.rollfiCompanyId);

  const report: Array<{
    company: string;
    companyId: string;
    employees: Array<{ name: string; rollfiUserId: string; kycBefore: string | null; kycAfter: string | null; statusBefore: string | null; statusAfter: string | null; result: string }>;
    error?: string;
  }> = [];

  for (const company of rollfiCompanies) {
    const companyReport: (typeof report)[0] = { company: company.name, companyId: company.id, employees: [] };
    try {
      const r = await axios.post(
        `${getBaseUrl()}/reports#getUsers`,
        { method: "getUsers", companyId: company.rollfiCompanyId },
        { headers: rollfiHeaders() }
      );
      const rollfiUsers: RollfiUser[] = ((r.data as { users?: RollfiUser[] }).users ?? []);
      req.log.info({ companyId: company.id, count: rollfiUsers.length }, "Seed: fetched Rollfi users");

      const localEmps = await db.select().from(employeesTable).where(eq(employeesTable.companyId, company.id));

      for (const emp of localEmps) {
        if (!emp.rollfiUserId) continue;
        const ru = rollfiUsers.find((u) => u.userId === emp.rollfiUserId);
        if (!ru) {
          companyReport.employees.push({ name: `${emp.firstName} ${emp.lastName}`, rollfiUserId: emp.rollfiUserId, kycBefore: emp.kycStatus, kycAfter: null, statusBefore: emp.rollfiAccountStatus ?? null, statusAfter: null, result: "not_found_in_rollfi" });
          continue;
        }
        const newKyc = ru.kycStatus ?? emp.kycStatus;
        const newUserStatus = ru.status?.userStatus ?? emp.rollfiAccountStatus;
        await db.update(employeesTable).set({
          kycStatus: newKyc ?? undefined,
          rollfiAccountStatus: newUserStatus ?? undefined,
          updatedAt: new Date().toISOString(),
        }).where(eq(employeesTable.id, emp.id));
        companyReport.employees.push({
          name: `${emp.firstName} ${emp.lastName}`,
          rollfiUserId: emp.rollfiUserId,
          kycBefore: emp.kycStatus,
          kycAfter: newKyc ?? null,
          statusBefore: emp.rollfiAccountStatus ?? null,
          statusAfter: newUserStatus ?? null,
          result: "updated",
        });
      }
    } catch (err) {
      const e = err as { response?: { data: unknown } };
      companyReport.error = String(e.response?.data ?? err);
      req.log.error({ err, companyId: company.id }, "Seed: getUsers failed for company");
    }
    report.push(companyReport);
  }

  res.json({ seeded: true, companiesProcessed: rollfiCompanies.length, report });
});

// ── Activity feed helpers ─────────────────────────────────────

function mapWebhookType(eventType: string): string {
  const labels: Record<string, string> = {
    "payroll.initiated":   "Payroll run started",
    "payroll.inProcess":   "Payroll processing",
    "payroll.calculated":  "Payroll calculated",
    "payroll.submitted":   "Payroll submitted for funding",
    "payroll.processed":   "Payroll completed",
    "payroll.approved":    "Payroll approved",
    "payroll.failed":      "Payroll failed",
    "payroll.cancelled":   "Payroll cancelled",
    "employee.added":      "Employee added",
    "employee.updated":    "Employee details updated",
    "employee.offboarded": "Employee offboarded",
    "company.updated":     "Company details updated",
    "tax.filed":           "Tax filing submitted",
    "document.uploaded":   "Document uploaded",
  };
  return labels[eventType] ?? eventType;
}

// GET /activity — app activities (DB-persisted) + Rollfi webhook events, merged by companyId
router.get("/activity", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { companyId, limit: limitStr } = req.query as { companyId?: string; limit?: string };
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  const limit = Math.min(parseInt(limitStr ?? "8", 10) || 8, 50);

  // Read app events from DB (persistent across restarts); fall back to in-memory on error
  let appEvents: Array<{ id: string; type: string; description: string; source: "app"; actorName?: string; actorRole?: string; createdAt: string }> = [];
  try {
    const rows = await db
      .select()
      .from(appActivityLog)
      .where(eq(appActivityLog.companyId, companyId))
      .orderBy(desc(appActivityLog.createdAt))
      .limit(limit);
    appEvents = rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      source: "app" as const,
      actorName: r.actorName ?? undefined,
      actorRole: r.actorRole ?? undefined,
      createdAt: r.createdAt,
    }));
  } catch {
    // Fallback to in-memory if DB unavailable
    appEvents = store.getActivity(companyId, limit).map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      source: "app" as const,
      actorName: e.actorName,
      actorRole: e.actorRole,
      createdAt: e.createdAt,
    }));
  }

  await loadEventsFromDb(req.log);
  const rollfiEvents = rollfiEventCache
    .filter((e) => e.companyId === companyId)
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      type: e.eventType,
      description: mapWebhookType(e.eventType),
      source: "rollfi" as const,
      actorName: undefined as string | undefined,
      actorRole: undefined as string | undefined,
      createdAt: e.receivedAt,
    }));

  const merged = [...appEvents, ...rollfiEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json({ events: merged });
});

// GET /unmatched-webhooks — webhook events with a rollfi_company_id but no matched company_id
// These events arrived before (or without) a company being registered in our DB.
router.get("/unmatched-webhooks", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await db
      .select({
        id:             rollfiWebhookEvents.id,
        eventType:      rollfiWebhookEvents.eventType,
        rollfiCompanyId: rollfiWebhookEvents.rollfiCompanyId,
        receivedAt:     rollfiWebhookEvents.receivedAt,
      })
      .from(rollfiWebhookEvents)
      .where(and(isNotNull(rollfiWebhookEvents.rollfiCompanyId), isNull(rollfiWebhookEvents.companyId)))
      .orderBy(desc(rollfiWebhookEvents.receivedAt))
      .limit(50);
    res.json({ count: rows.length, events: rows });
  } catch (err) {
    req.log.error({ err }, "GET /unmatched-webhooks failed");
    res.status(500).json({ error: "Failed to load unmatched webhook events" });
  }
});

// GET /rollfi/webhook/events — return stored events (requires session)
router.get("/rollfi/webhook/events", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await loadEventsFromDb(req.log);
  res.json({ events: rollfiEventCache.slice(0, 50) });
});

// DELETE /rollfi/webhook/events — clear all stored events
router.delete("/rollfi/webhook/events", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  rollfiEventCache.length = 0;
  cacheLoadedFromDb = false;
  try {
    await db.delete(rollfiWebhookEvents);
  } catch (err) {
    req.log.warn({ err }, "Failed to clear Rollfi webhook events from DB");
  }
  res.json({ cleared: true });
});

// POST /rollfi/webhook/simulate — inject a fake event (for demos)
router.post("/rollfi/webhook/simulate", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { eventType = "payroll.processed", companyId } = req.body as {
    eventType?: string;
    companyId?: string;
  };

  const rollfiRec = companyId ? store.getRollfiCompany(companyId) : undefined;
  const rollfiCompanyId = rollfiRec?.rollfiCompanyId ?? null;

  const fakePayload = {
    event: eventType,
    companyId: rollfiCompanyId ?? companyId ?? "DEMO",
    payPeriodId: `PP-SIM-${Date.now()}`,
    amount: 4250.0,
    employeeCount: 3,
    processedAt: new Date().toISOString(),
    simulated: true,
  };

  const event: RollfiWebhookEvent = {
    id: Date.now().toString(),
    eventType,
    companyId: companyId ?? null,
    rollfiCompanyId,
    payPeriodId: fakePayload.payPeriodId,
    payload: JSON.stringify(fakePayload),
    receivedAt: new Date().toISOString(),
  };

  rollfiEventCache.unshift(event);
  if (rollfiEventCache.length > 100) rollfiEventCache.pop();

  try {
    await db.insert(rollfiWebhookEvents).values({
      eventType: event.eventType,
      companyId: event.companyId ?? undefined,
      rollfiCompanyId: event.rollfiCompanyId ?? undefined,
      payPeriodId: event.payPeriodId ?? undefined,
      payload: event.payload,
      receivedAt: event.receivedAt,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to persist simulated Rollfi webhook event");
  }

  req.log.info({ eventType, companyId }, "Rollfi webhook simulated");
  res.json({ received: true, event });
});

export default router;
