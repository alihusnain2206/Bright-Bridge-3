import axios from "axios";
import { store, type RollfiCompanyRecord } from "../store.js";
import { persistRollfiEmployee } from "./rollfi-persist.js";
import { getRollfiConfig } from "./rollfi-config.js";
import { getRollfiWageFields } from "./rollfi-wage.js";

type Logger = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

function makeRollfiHeaders(clientId: string | undefined, secretKey: string | undefined) {
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function randomNineDigits(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

// ── Shared body-error helper ─────────────────────────────────────────────────
// Rollfi returns HTTP 200 with {"error":{...}} for logical failures.
// extractRollfiError returns the message string, or null when the step succeeded.
export function extractRollfiError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const err = d.error;
  if (!err) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    return typeof e.message === "string" ? e.message : JSON.stringify(e);
  }
  return String(err);
}

// ── Step-failure types ───────────────────────────────────────────────────────
export interface OnboardingStepError {
  step: string;
  message: string;
}

// ── W4 filing status normalisation ──────────────────────────────────────────
// Rollfi-accepted values (confirmed by live rejection when submitting unknown values):
//   "Single" | "Married" | "Head of Household"
// Legacy / mis-cased values are mapped to the nearest canonical form.
// IMPORTANT: if a value is unrecognised it is passed through AS-IS so Rollfi surfaces an
// explicit rejection — we do NOT silently fall back to "Single".  A silent fallback would
// attach the wrong filing status to an employee's tax record without any visible error.
const VALID_W4_STATUSES = ["Single", "Married", "Head of Household"] as const;
const W4_LEGACY_MAP: Record<string, string> = {
  "Married Filing Jointly": "Married",
  "Married Filing Jointly or Qualifying Widow(er)": "Married",
  "Qualifying Widow(er)": "Married",
  "Married Filing Separately": "Single",
  "single": "Single",
  "married": "Married",
  "head of household": "Head of Household",
};

export function normalizeW4FilingStatus(status: string | undefined | null): string {
  if (!status) return "Single";
  if ((VALID_W4_STATUSES as readonly string[]).includes(status)) return status;
  // Mapped legacy variant → canonical value (e.g. "Married Filing Jointly" → "Married")
  const mapped = W4_LEGACY_MAP[status] ?? W4_LEGACY_MAP[status.toLowerCase()];
  if (mapped) return mapped;
  // Unrecognised value: pass through so Rollfi rejects it explicitly.
  // Never silently substitute "Single" — that would corrupt the employee's tax record.
  return status;
}

// ── Data interfaces ──────────────────────────────────────────────────────────
export interface W4Data {
  filingStatus: string;
  multipleJobs: boolean;
  dependents: number;
  extraWithholding: number;
  homeState: string;
  stateW4Fields?: Record<string, string>;
}

const DEFAULT_W4: W4Data = {
  filingStatus: "Single",
  multipleJobs: false,
  dependents: 0,
  extraWithholding: 0,
  homeState: "NJ",
};

interface KycIdentity {
  address1?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  ssn?: string;
  dateOfBirth?: string;
}

function safeRollfiLog(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const d = data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const k of ["status", "success", "message", "error", "code", "id", "userId", "companyId", "referenceId", "taskId", "result"]) {
    if (k in d) safe[k] = d[k];
  }
  return safe;
}

// ── KYC onboarding chain ─────────────────────────────────────────────────────
/**
 * Runs acceptTerms → addKyc → addW4 → addStateW4 → initiateKyc → addBank.
 *
 * HARD steps (employee cannot be paid without these):
 *   addW4Information, addUserBankAccount
 *
 * SOFT steps (warn + continue):
 *   acceptTermsAndCondition, addKycInformation, addStateW4Information, initiateUserKyc
 *
 * Returns { hardErrors, softWarnings }. Never throws.
 */
export async function runEmployeeKycOnboarding(
  rollfiUserId: string,
  rollfiCompanyId: string,
  log: Logger,
  w4: W4Data = DEFAULT_W4,
  identity: KycIdentity = {},
  bankInput?: { bankName?: string; routingNumber?: string; accountNumber?: string; accountType?: string }
): Promise<{ hardErrors: OnboardingStepError[]; softWarnings: OnboardingStepError[] }> {
  const _cfg = getRollfiConfig();
  const baseUrl = _cfg.baseUrl;
  const headers = makeRollfiHeaders(_cfg.clientId, _cfg.secretKey);
  const isProduction = _cfg.env === "production";

  // SSN: use the real value when provided.
  // In production, fabricating an SSN is never acceptable — surfaces as a hard error so
  // the employee is NOT submitted to Rollfi with false identity data.
  // In sandbox, a random 9-digit placeholder is used for testing (never reaches a real payroll system).
  const ssn: string | null = (() => {
    if (identity.ssn) return identity.ssn;
    if (isProduction) {
      log.error({ rollfiUserId }, "SSN required for production onboarding but was not provided — KYC will be skipped");
      return null;
    }
    log.warn({ rollfiUserId }, "SSN not provided — using random test value (SANDBOX ONLY, never sent to production Rollfi)");
    return randomNineDigits();
  })();

  const dateOfBirth = identity.dateOfBirth ?? "1990-01-15";
  const address1 = identity.address1 ?? "123 Main St";
  const city = identity.city ?? "Newark";
  const state = identity.state ?? "NJ";
  const zipcode = identity.zipcode ?? "07101";

  log.info({ hasRealAddress: !!identity.address1, hasRealDob: !!identity.dateOfBirth, hasRealSsn: !!identity.ssn, isSandboxSsn: !identity.ssn && !isProduction }, "runEmployeeKycOnboarding: identity source");

  const hardErrors: OnboardingStepError[] = [];
  const softWarnings: OnboardingStepError[] = [];

  // ── acceptTermsAndCondition — SOFT ────────────────────────────────────────
  try {
    const r = await axios.put(`${baseUrl}/userOnboarding#acceptTermsAndCondition`, { method: "acceptTermsAndCondition", userId: rollfiUserId }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi acceptTermsAndCondition response");
    const errMsg = extractRollfiError(r.data);
    if (errMsg) softWarnings.push({ step: "acceptTermsAndCondition", message: errMsg });
  } catch (e) {
    softWarnings.push({ step: "acceptTermsAndCondition", message: e instanceof Error ? e.message : String(e) });
  }

  // ── addKycInformation — SOFT (gates initiateUserKyc) ─────────────────────
  let kycAdded = false;
  if (!ssn) {
    // Production guard: SSN was not provided — push a hard error, skip KYC entirely.
    // The employee will NOT be marked onboarded until SSN is collected and re-submitted.
    hardErrors.push({ step: "addKycInformation", message: "SSN is required for onboarding and was not collected for this employee. Gather the SSN before retrying." });
  } else {
    try {
      const r = await axios.post(`${baseUrl}/userOnboarding#addKycInformation`, {
        method: "addKycInformation",
        kycInformation: { userId: rollfiUserId, ssn, dateOfBirth, address1, address2: "", city, state, zipcode },
      }, { headers });
      log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addKycInformation response");
      const raw = r.data as Record<string, unknown>;
      const errMsg = extractRollfiError(raw);
      const isAlreadyExists = errMsg?.toLowerCase().includes("already exists") ?? false;
      kycAdded = !errMsg || isAlreadyExists;
      if (errMsg && !isAlreadyExists) softWarnings.push({ step: "addKycInformation", message: errMsg });
    } catch (e) {
      softWarnings.push({ step: "addKycInformation", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── addW4Information — HARD ───────────────────────────────────────────────
  const normalizedFilingStatus = normalizeW4FilingStatus(w4.filingStatus);
  log.info({ originalStatus: w4.filingStatus, normalizedStatus: normalizedFilingStatus }, "addW4Information: normalised filing status");
  try {
    const r = await axios.post(`${baseUrl}/userOnboarding#addW4Information`, {
      method: "addW4Information",
      w4Information: {
        userId: rollfiUserId,
        w4FilingStatus: normalizedFilingStatus,
        haveMultipleJob: w4.multipleJobs,
        dependents: w4.dependents,
        dependentsAbove18: 0,
        otherIncome: 0,
        otherDeduction: 0,
        extraWithholding: w4.extraWithholding,
      },
    }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi addW4Information response");
    const errMsg = extractRollfiError(r.data);
    if (errMsg && !errMsg.toLowerCase().includes("already exists")) {
      hardErrors.push({ step: "addW4Information", message: `Tax withholding rejected: ${errMsg}` });
    }
  } catch (e) {
    hardErrors.push({ step: "addW4Information", message: `Tax withholding network error: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ── addStateW4Information — SOFT ──────────────────────────────────────────
  const stateW4Payload = (w4.stateW4Fields && Object.keys(w4.stateW4Fields).length > 0)
    ? w4.stateW4Fields
    : buildStateW4Payload(w4.homeState, normalizedFilingStatus, w4.dependents, w4.extraWithholding);
  if (stateW4Payload) {
    try {
      const r = await axios.post(`${baseUrl}/userOnboarding#addStateW4Information`, {
        method: "addStateW4Information",
        userId: rollfiUserId,
        stateW4Information: stateW4Payload,
      }, { headers });
      log.info({ rollfiResponse: r.data, homeState: w4.homeState, source: w4.stateW4Fields ? "ui-form" : "fallback" }, "Rollfi addStateW4Information response");
      const errMsg = extractRollfiError(r.data);
      if (errMsg && !errMsg.toLowerCase().includes("already exists")) {
        softWarnings.push({ step: "addStateW4Information", message: errMsg });
      }
    } catch (e) {
      softWarnings.push({ step: "addStateW4Information", message: e instanceof Error ? e.message : String(e) });
    }
  } else {
    log.info({ homeState: w4.homeState }, "Skipping addStateW4Information — state uses federal W-4 or has no income tax");
  }

  // ── initiateUserKyc — SOFT ────────────────────────────────────────────────
  if (!kycAdded) {
    log.warn({ rollfiUserId }, "Skipping initiateUserKyc — addKycInformation did not succeed");
    softWarnings.push({ step: "initiateUserKyc", message: "Skipped — KYC information was not accepted" });
  } else {
    try {
      const r = await axios.post(`${baseUrl}/userOnboarding#initiateUserKyc`, { method: "initiateUserKyc", userId: rollfiUserId }, { headers });
      log.info({ rollfiResponse: r.data }, "Rollfi initiateUserKyc response");
      const errMsg = extractRollfiError(r.data);
      if (errMsg) softWarnings.push({ step: "initiateUserKyc", message: errMsg });
    } catch (e) {
      softWarnings.push({ step: "initiateUserKyc", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── addUserBankAccount — HARD ─────────────────────────────────────────────
  if (isProduction && !bankInput?.accountNumber) {
    log.info({}, "addUserBankAccount: production retry — Rollfi already holds account, skipping bank step");
  } else {
    try {
      const bank = (isProduction && bankInput?.routingNumber && bankInput?.accountNumber)
        ? { accountNumber: bankInput.accountNumber, routingNumber: bankInput.routingNumber, bankName: bankInput.bankName ?? "Direct Deposit", accountType: bankInput.accountType ?? "checking", accountName: "default" }
        : { accountNumber: "9889890989", routingNumber: "122238242", bankName: "Chase Bank", accountType: "savings", accountName: "default" };
      log.info({ env: _cfg.env, bankName: bank.bankName, maskedAcct: `****${bank.accountNumber.slice(-4)}` }, "addUserBankAccount: submitting bank details");
      const r = await axios.post(`${baseUrl}/userPortal#addUserBankAccount`, {
        method: "addUserBankAccount",
        linkType: "Manual",
        userPayAccountEntity: { companyId: rollfiCompanyId, userId: rollfiUserId, accountNumber: bank.accountNumber, routingNumber: bank.routingNumber, bankName: bank.bankName, accountType: bank.accountType, accountName: bank.accountName, payPercentage: 100, isPrimary: true },
      }, { headers });
      log.info({ rollfiResult: safeRollfiLog(r.data) }, "Rollfi addUserBankAccount response");
      const errMsg = extractRollfiError(r.data);
      if (errMsg && !errMsg.toLowerCase().includes("already exists")) {
        hardErrors.push({ step: "addUserBankAccount", message: `Bank account rejected: ${errMsg}` });
      }
    } catch (e) {
      hardErrors.push({ step: "addUserBankAccount", message: `Bank account network error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return { hardErrors, softWarnings };
}

// ── Main onboarding entry point ──────────────────────────────────────────────
export interface OnboardResult {
  success: boolean;
  rollfiUserId?: string;
  rollfiWageId?: string;
  error?: string;
  hardErrors?: OnboardingStepError[];
  softWarnings?: OnboardingStepError[];
}

export interface RollfiEmployeeInput {
  id: string;
  name: string;
  email: string;
  roleName: string;
  wage: number;
  payType?: string;
  annualSalaryCents?: number | null;
  overtimeEligible?: boolean;
  /** Employee phone number as stored in DB (e.g. "(973) 555-0142"). Digits are stripped before sending to Rollfi. */
  phone?: string;
  /** ISO start date YYYY-MM-DD sent to Rollfi addUser.dateOfJoin and addUserWage.startDate. */
  startDate?: string;
  homeState?: string;
  homeAddress?: string;
  homeCity?: string;
  homeZip?: string;
  ssn?: string;
  dateOfBirth?: string;
  w4FilingStatus?: string;
  w4MultipleJobs?: boolean;
  w4Dependents?: number;
  w4ExtraWithholding?: number;
  stateW4Fields?: Record<string, string>;
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
}

export async function onboardEmployeeToRollfi(
  emp: RollfiEmployeeInput,
  rollfiCompany: RollfiCompanyRecord,
  log: Logger
): Promise<OnboardResult> {
  const _cfg = getRollfiConfig();
  const baseUrl = _cfg.baseUrl;
  const headers = makeRollfiHeaders(_cfg.clientId, _cfg.secretKey);

  const nameParts = emp.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ") || "Staff";

  try {
    let rollfiUserId: string | undefined;

    // ── addUser ───────────────────────────────────────────────────────────────
    const addUserResp = await axios.post(`${baseUrl}/adminPortal#addUser`, {
      method: "addUser",
      user: {
        companyId: rollfiCompany.rollfiCompanyId,
        firstName, middleName: "", lastName,
        email: emp.email ?? `${emp.id}@brightbridge.sandbox`,
        phoneNumber: (() => {
          // Rollfi expects raw 10 digits (no dashes/parens/spaces)
          const digits = (emp.phone ?? "").replace(/\D/g, "");
          return digits.length >= 10 ? digits.slice(-10) : "9733330001";
        })(),
        dateOfJoin: emp.startDate ?? new Date().toISOString().slice(0, 10),
        workerType: "W2",
        jobTitle: emp.roleName,
        companyLocationCategory: "Office",
        stateCode: emp.homeState ?? "NJ",
        companyLocationId: rollfiCompany.rollfiLocationId,
      },
    }, { headers });

    const addUserRaw = addUserResp.data as Record<string, unknown>;
    const addUserErr = ((addUserRaw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
    if (addUserErr.toLowerCase().includes("email already in use") || addUserErr.toLowerCase().includes("already in use")) {
      log.warn({ empId: emp.id, email: emp.email }, "Rollfi email already in use — looking up existing user");
      try {
        const getUsersResp = await axios.post(`${baseUrl}/reports#getUsers`, { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId }, { headers });
        type RollfiUser = { userId: string; firstName?: string; lastName?: string; email?: string };
        const users = ((getUsersResp.data as { users?: RollfiUser[] }).users ?? []);
        const targetEmail = (emp.email ?? "").toLowerCase();
        const targetName = emp.name.toLowerCase();
        const match = users.find((u) =>
          (u.email && u.email.toLowerCase() === targetEmail) ||
          (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim().toLowerCase() === targetName)
        );
        if (match) { rollfiUserId = match.userId; log.info({ rollfiUserId, empId: emp.id }, "Resolved existing Rollfi user for re-sync"); }
      } catch (lookupErr) { log.warn({ lookupErr }, "getUsers lookup failed"); }
      if (!rollfiUserId) return { success: false, error: `Rollfi email already in use and could not resolve existing user` };
    } else {
      const userObj = (addUserRaw.user ?? addUserRaw) as Record<string, unknown>;
      rollfiUserId = (userObj.userId ?? userObj.id) as string | undefined;
      if (!rollfiUserId) return { success: false, error: `Rollfi addUser returned unexpected shape: ${JSON.stringify(addUserRaw).slice(0, 200)}` };
    }

    // ── addUserWage — HARD ────────────────────────────────────────────────────
    const wageFields = getRollfiWageFields({
      payType: emp.payType,
      hourlyWage: Math.round(emp.wage * 100),
      annualSalary: emp.annualSalaryCents ?? null,
      overtimeEligible: emp.overtimeEligible,
    });
    const addWageResp = await axios.post(`${baseUrl}/adminPortal#addUserWage`, {
      method: "addUserWage",
      userWage: {
        companyId: rollfiCompany.rollfiCompanyId,
        userId: rollfiUserId,
        differentialPay: "No",
        wageRate: wageFields.wageRate,
        workerType: "W2",
        wageBasis: wageFields.wageBasis,
        userType: wageFields.userType,
        employmentStatus: "Full Time (30+ Hours per week)",
        userRefTaxExempt: "No, this employee is not tax exempt",
        startDate: emp.startDate ?? new Date().toISOString().slice(0, 10),
        paymentMethod: "Direct Deposit",
      },
    }, { headers });
    log.info({ rollfiResponse: addWageResp.data }, "Rollfi addUserWage response");

    const addWageRaw = addWageResp.data as Record<string, unknown>;
    const wageErrMsg = extractRollfiError(addWageRaw);
    const wageObj = (addWageRaw.userWage ?? addWageRaw) as Record<string, unknown>;
    const rollfiWageId = wageErrMsg ? undefined : ((wageObj.userWageId ?? wageObj.id) as string | undefined);

    // ── KYC / W4 / bank chain ─────────────────────────────────────────────────
    const kycResult = await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, log, {
      filingStatus: emp.w4FilingStatus ?? DEFAULT_W4.filingStatus,
      multipleJobs: emp.w4MultipleJobs ?? DEFAULT_W4.multipleJobs,
      dependents: emp.w4Dependents ?? DEFAULT_W4.dependents,
      extraWithholding: emp.w4ExtraWithholding ?? DEFAULT_W4.extraWithholding,
      homeState: emp.homeState ?? DEFAULT_W4.homeState,
      stateW4Fields: emp.stateW4Fields,
    }, {
      address1: emp.homeAddress, city: emp.homeCity, state: emp.homeState,
      zipcode: emp.homeZip, ssn: emp.ssn, dateOfBirth: emp.dateOfBirth,
    }, {
      bankName: emp.bankName, routingNumber: emp.routingNumber,
      accountNumber: emp.accountNumber, accountType: emp.accountType,
    });

    // Always persist rollfiUserId so repair routes can find the user later
    await persistRollfiEmployee(emp.id, { rollfiUserId, rollfiWageId, onboardedAt: new Date().toISOString() });

    // ── Aggregate hard failures ───────────────────────────────────────────────
    const allHardErrors: OnboardingStepError[] = [
      ...(wageErrMsg ? [{ step: "addUserWage", message: `Wage rejected: ${wageErrMsg}` }] : []),
      ...kycResult.hardErrors,
    ];

    if (allHardErrors.length > 0) {
      log.error({ hardErrors: allHardErrors, softWarnings: kycResult.softWarnings, employeeId: emp.id }, "Rollfi onboarding completed with hard failures");
      return {
        success: false,
        rollfiUserId, rollfiWageId,
        error: allHardErrors.map((e) => `${e.step}: ${e.message}`).join("; "),
        hardErrors: allHardErrors,
        softWarnings: kycResult.softWarnings,
      };
    }

    if (kycResult.softWarnings.length > 0) {
      log.warn({ softWarnings: kycResult.softWarnings, employeeId: emp.id }, "Rollfi onboarding completed with soft warnings");
    }
    return { success: true, rollfiUserId, rollfiWageId, softWarnings: kycResult.softWarnings };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, employeeId: emp.id }, "Rollfi employee onboard failed");
    return { success: false, error: msg };
  }
}

// ── FIX 1a helper: enrol a newly-onboarded employee into open pay periods ────
// Rollfi snapshots its pay-period roster at PERIOD CREATION TIME. Any employee
// added afterwards is absent and must be explicitly enrolled via
// addUsersToRegularPayPeriod. (Rollfi support confirmed this is the intended API.)
//
// Guardrails (spec):
//   1. NEVER call blindly — caller has confirmed the employee is absent from the roster.
//   2. Treat "already has a payroll line item" as SUCCESS (desired state reached; log INFO).
//   3. Only enrol into "new" or "cancelled" periods (both are Rollfi editable states).
//      "cancelled" = a submitted payroll cancelled to allow corrections; imports succeed against it.
//      EXCLUDED: submitted, inProcess, processed, failed — those are locked states.
export async function enrollEmployeeInNewPayPeriods(
  rollfiCompanyId: string,
  rollfiUserId: string,
  log: Logger
): Promise<{ enrolled: number; periodsChecked: number }> {
  const cfg = getRollfiConfig();
  const headers = makeRollfiHeaders(cfg.clientId, cfg.secretKey);

  let periods: Array<Record<string, unknown>> = [];
  try {
    const resp = await axios.post(
      `${cfg.baseUrl}/reports#getUnProcessedPayPeriod`,
      { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId, workerType: "W2" },
      { headers }
    );
    const raw = resp.data as Record<string, unknown>;
    periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
  } catch (err) {
    log.warn({ rollfiCompanyId, rollfiUserId, err }, "enrollEmployeeInNewPayPeriods: could not fetch pay periods — skipping enrollment");
    return { enrolled: 0, periodsChecked: 0 };
  }

  // Guardrail 3: only "new" periods
  // "new" = freshly opened period; "cancelled" = editable state (submitted payroll cancelled for corrections)
  const ENROLLABLE_STATUSES = ["new", "cancelled"];
  const newPeriods = periods.filter((p) => ENROLLABLE_STATUSES.includes(String(p.payPeriodStatus ?? "").toLowerCase()));
  log.info({ rollfiUserId, totalPeriods: periods.length, enrollablePeriods: newPeriods.length }, "enrollEmployeeInNewPayPeriods: periods available");

  let enrolled = 0;
  for (const period of newPeriods) {
    const payPeriodId = period.payPeriodId as string;
    if (!payPeriodId) continue;
    try {
      const enrollResp = await axios.post(
        `${cfg.baseUrl}/payroll#addUsersToRegularPayPeriod`,
        {
          method: "addUsersToRegularPayPeriod",
          companyId: rollfiCompanyId,
          payPeriodId,
          payrollLineItems: [{ userId: rollfiUserId, paymentMethod: "Direct Deposit" }],
        },
        { headers }
      );
      const enrollRaw = enrollResp.data as Record<string, unknown>;
      const errMsg = extractRollfiError(enrollRaw);
      if (!errMsg) {
        log.info({ rollfiUserId, payPeriodId, response: JSON.stringify(enrollResp.data) }, "enrollEmployeeInNewPayPeriods: enrolled successfully");
        enrolled++;
      } else if (errMsg.toLowerCase().includes("already has a payroll line item")) {
        // Guardrail 2: race — desired state already reached
        log.info({ rollfiUserId, payPeriodId }, "enrollEmployeeInNewPayPeriods: already enrolled (desired state — success)");
        enrolled++;
      } else if (errMsg.toLowerCase().includes("invalid status") || errMsg.toLowerCase().includes("employee validation failed")) {
        // Employee not yet payroll-eligible (not fully onboarded / Active) — non-fatal.
        log.warn({ rollfiUserId, payPeriodId, reason: errMsg }, "enrollEmployeeInNewPayPeriods: employee not payroll-eligible — skipping");
      } else {
        log.warn({ rollfiUserId, payPeriodId, errMsg }, "enrollEmployeeInNewPayPeriods: enrollment returned error (non-fatal)");
      }
    } catch (err) {
      log.warn({ rollfiUserId, payPeriodId, err }, "enrollEmployeeInNewPayPeriods: request failed (non-fatal)");
    }
  }

  return { enrolled, periodsChecked: newPeriods.length };
}

// ── State W-4 payload builder ────────────────────────────────────────────────
export interface StateW4Payload { [key: string]: string | number | boolean; }

const STATES_USING_FEDERAL_W4 = new Set(["ND", "PA", "UT"]);
const STATES_NO_INCOME_TAX   = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);

export function buildStateW4Payload(
  state: string,
  filingStatus: string,
  dependents: number,
  extraWithholding: number
): StateW4Payload | null {
  if (!state || STATES_USING_FEDERAL_W4.has(state) || STATES_NO_INCOME_TAX.has(state)) return null;
  const base = { state, filingStatus, dependents, extraWithholding };
  switch (state) {
    case "NJ": return { ...base, "Filing Status": filingStatus === "Married" ? "Married" : "Single", "Total Allowances": String(dependents), "Additional Withholding": String(extraWithholding) };
    case "NY": return { ...base, "Filing Status": filingStatus === "Married" ? "Married" : "Single", "Withholding Allowance": String(dependents), "Additional Withholding": String(extraWithholding) };
    case "CA": return { ...base, "Filing Status": filingStatus, "Withholding Allowances": String(dependents), "Additional Withholding": String(extraWithholding) };
    case "MD": return { ...base, "Filing Status": filingStatus, "Total Exemptions": String(dependents), "Additional Withholding": String(extraWithholding) };
    case "VA": return { ...base, "Filing Status": filingStatus, "Total Exemptions": String(dependents), "Additional Withholding": String(extraWithholding) };
    default:   return { ...base, "Filing Status": filingStatus, "Total Allowances": String(dependents), "Additional Withholding": String(extraWithholding) };
  }
}
