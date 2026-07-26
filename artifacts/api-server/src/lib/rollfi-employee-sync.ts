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
  const ssn = identity.ssn ?? randomNineDigits();
  const dateOfBirth = identity.dateOfBirth ?? "1990-01-15";
  const address1 = identity.address1 ?? "123 Main St";
  const city = identity.city ?? "Newark";
  const state = identity.state ?? "NJ";
  const zipcode = identity.zipcode ?? "07101";

  log.info({ hasRealAddress: !!identity.address1, hasRealDob: !!identity.dateOfBirth, hasRealSsn: !!identity.ssn }, "runEmployeeKycOnboarding: identity source");

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
  const isProduction = _cfg.env === "production";
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
        userPayAccountEntity: { companyId: rollfiCompanyId, userId: rollfiUserId, accountNumber: bank.accountNumber, routingNumber: bank.routingNumber, bankName: bank.bankName, accountType: bank.accountType, accountName: bank.accountName },
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
        phoneNumber: "9733330001",
        dateOfJoin: "2024-01-01",
        workerType: "W2",
        jobTitle: emp.roleName,
        companyLocationCategory: "Office",
        stateCode: "NJ",
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
        startDate: "2024-01-01",
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
