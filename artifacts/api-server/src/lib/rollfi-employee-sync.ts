import axios from "axios";
import { store, type RollfiCompanyRecord } from "../store.js";
import { persistRollfiEmployee } from "./rollfi-persist.js";

const ROLLFI_BASE_URL = process.env.ROLLFI_BASE_URL ?? "https://sandbox.rollfi.xyz";
const ROLLFI_CLIENT_ID = process.env.ROLLFI_CLIENT_ID;
const ROLLFI_SECRET_KEY = process.env.ROLLFI_SECRET_KEY;

type Logger = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

function rollfiHeaders() {
  const clientId = ROLLFI_CLIENT_ID ?? "";
  const secretKey = ROLLFI_SECRET_KEY ?? "";
  const encoded = Buffer.from(`${clientId}:${secretKey}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function randomNineDigits(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

export interface W4Data {
  filingStatus: string;
  multipleJobs: boolean;
  dependents: number;
  extraWithholding: number;
  homeState: string;
}

const DEFAULT_W4: W4Data = {
  filingStatus: "Single",
  multipleJobs: false,
  dependents: 0,
  extraWithholding: 0,
  homeState: "NJ",
};

export async function runEmployeeKycOnboarding(
  rollfiUserId: string,
  rollfiCompanyId: string,
  log: Logger,
  w4: W4Data = DEFAULT_W4
): Promise<void> {
  const headers = rollfiHeaders();
  const ssn = randomNineDigits();

  try {
    const r = await axios.put(`${ROLLFI_BASE_URL}/userOnboarding#acceptTermsAndCondition`, { method: "acceptTermsAndCondition", userId: rollfiUserId }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi acceptTermsAndCondition response");
  } catch (e) { log.warn({ e }, "acceptTermsAndCondition failed (ignoring)"); }

  let kycAdded = false;
  try {
    const r = await axios.post(`${ROLLFI_BASE_URL}/userOnboarding#addKycInformation`, {
      method: "addKycInformation",
      kycInformation: { userId: rollfiUserId, ssn, dateOfBirth: "1990-01-15", address1: "123 Main St", address2: "", city: "Newark", state: "NJ", zipcode: "07101" },
    }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi addKycInformation response");
    const raw = r.data as Record<string, unknown>;
    const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
    kycAdded = !raw.error || errMsg.toLowerCase().includes("already exists");
  } catch (e) { log.warn({ e }, "addKycInformation failed (ignoring)"); }

  // Federal W-4 — use actual form data, not hardcoded defaults
  try {
    const r = await axios.post(`${ROLLFI_BASE_URL}/userOnboarding#addW4Information`, {
      method: "addW4Information",
      w4Information: {
        userId: rollfiUserId,
        w4FilingStatus: w4.filingStatus,
        haveMultipleJob: w4.multipleJobs,
        dependents: w4.dependents,
        dependentsAbove18: 0,
        otherIncome: 0,
        otherDeduction: 0,
        extraWithholding: w4.extraWithholding,
      },
    }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi addW4Information response");
  } catch (e) { log.warn({ e }, "addW4Information failed (ignoring)"); }

  // State W-4 — only for states that issue their own withholding certificate.
  // States using the federal W-4 (ND, PA, UT) or with no income tax (AK, FL, NV, NH, SD, TN, TX, WA, WY) are skipped.
  const stateW4Payload = buildStateW4Payload(w4.homeState, w4.filingStatus, w4.dependents, w4.extraWithholding);
  if (stateW4Payload) {
    try {
      const r = await axios.post(`${ROLLFI_BASE_URL}/userOnboarding#addStateW4Information`, {
        method: "addStateW4Information",
        userId: rollfiUserId,
        stateW4Information: stateW4Payload,
      }, { headers });
      log.info({ rollfiResponse: r.data, homeState: w4.homeState }, "Rollfi addStateW4Information response");
    } catch (e) { log.warn({ e }, "addStateW4Information failed (ignoring)"); }
  } else {
    log.info({ homeState: w4.homeState }, "Skipping addStateW4Information — state uses federal W-4 or has no income tax");
  }

  if (!kycAdded) {
    log.warn({ rollfiUserId }, "Skipping initiateUserKyc — addKycInformation did not succeed");
  } else {
    try {
      const r = await axios.post(`${ROLLFI_BASE_URL}/userOnboarding#initiateUserKyc`, { method: "initiateUserKyc", userId: rollfiUserId }, { headers });
      log.info({ rollfiResponse: r.data }, "Rollfi initiateUserKyc response");
    } catch (e) { log.warn({ e }, "initiateUserKyc failed (ignoring)"); }
  }

  try {
    const r = await axios.post(`${ROLLFI_BASE_URL}/userPortal#addUserBankAccount`, {
      method: "addUserBankAccount",
      linkType: "Manual",
      userPayAccountEntity: { companyId: rollfiCompanyId, userId: rollfiUserId, accountNumber: "9889890989", routingNumber: "122238242", bankName: "Chase Bank", accountType: "savings", accountName: "default" },
    }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi addUserBankAccount response");
  } catch (e) { log.warn({ e }, "addUserBankAccount failed (ignoring)"); }
}

export interface OnboardResult {
  success: boolean;
  rollfiUserId?: string;
  rollfiWageId?: string;
  error?: string;
}

export interface RollfiEmployeeInput {
  id: string;
  name: string;
  email?: string;
  roleName: string;
  /** wageRate passed to Rollfi addUserWage (preserves the existing unit per call site). */
  wage: number;
  /** Employee's home state — drives which state W-4 fields are submitted. Defaults to "NJ". */
  homeState?: string;
  w4FilingStatus?: string;
  w4MultipleJobs?: boolean;
  w4Dependents?: number;
  w4ExtraWithholding?: number;
}

/**
 * States that issue their own employee withholding certificate (state W-4).
 * All other states either have no income tax or instruct employees to use
 * the federal W-4 — for those, addStateW4Information must NOT be called.
 *
 * No income tax (skip): AK, FL, NV, NH, SD, TN, TX, WA, WY
 * Use federal W-4 (skip): ND, PA, UT
 */
const STATES_WITH_OWN_W4 = new Set([
  "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NJ", "NM", "NY", "NC",
  "OH", "OK", "OR", "RI", "SC", "VT", "VA", "WI",
]);

/**
 * Build the stateW4Information payload for addStateW4Information.
 * Returns null when the state uses the federal W-4 or has no income tax
 * — the caller must skip the API call in that case.
 * Field names match the labels on the actual state W-4 form.
 */
function buildStateW4Payload(
  homeState: string,
  filingStatus: string,
  dependents: number,
  additionalWithholding: number
): Record<string, string> | null {
  if (!STATES_WITH_OWN_W4.has(homeState.toUpperCase())) return null;

  const fields: Record<string, string> = {
    "Filing Status": filingStatus,
    "Withholding Allowance": String(dependents),
    "Additional Withholding": additionalWithholding.toFixed(2),
  };
  // NY residents in NYC / Yonkers have extra local-tax fields — default to 0 in sandbox.
  if (homeState === "NY") {
    fields["NYC Withholding Allowance"] = "0";
    fields["NYC Additional Withholding"] = "0.00";
  }
  return fields;
}

export async function onboardEmployeeToRollfi(
  emp: RollfiEmployeeInput,
  rollfiCompany: RollfiCompanyRecord,
  log: Logger
): Promise<OnboardResult> {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    return { success: false, error: "Rollfi credentials not configured" };
  }

  const existing = store.getRollfiEmployee(emp.id);
  if (existing) {
    return { success: true, rollfiUserId: existing.rollfiUserId, rollfiWageId: existing.rollfiWageId };
  }

  const nameParts = emp.name.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ") || "Staff";

  try {
    let rollfiUserId: string | undefined;

    const addUserResp = await axios.post(`${ROLLFI_BASE_URL}/adminPortal#addUser`, {
      method: "addUser",
      user: {
        companyId: rollfiCompany.rollfiCompanyId,
        firstName,
        middleName: "",
        lastName,
        email: emp.email ?? `${emp.id}@brightbridge.sandbox`,
        phoneNumber: "9733330001",
        dateOfJoin: "2024-01-01",
        workerType: "W2",
        jobTitle: emp.roleName,
        companyLocationCategory: "Office",
        stateCode: "NJ",
        companyLocationId: rollfiCompany.rollfiLocationId,
      },
    }, { headers: rollfiHeaders() });

    const addUserRaw = addUserResp.data as Record<string, unknown>;

    // Check if Rollfi says the email is already in use — look up the existing user
    const errMsg = ((addUserRaw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
    if (errMsg.toLowerCase().includes("email already in use") || errMsg.toLowerCase().includes("already in use")) {
      log.warn({ empId: emp.id, email: emp.email }, "Rollfi email already in use — looking up existing user");
      try {
        const getUsersResp = await axios.post(
          `${ROLLFI_BASE_URL}/reports#getUsers`,
          { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        type RollfiUser = { userId: string; firstName?: string; lastName?: string; email?: string };
        const users = ((getUsersResp.data as { users?: RollfiUser[] }).users ?? []);
        const targetEmail = (emp.email ?? "").toLowerCase();
        const targetName = emp.name.toLowerCase();
        const match = users.find((u) =>
          (u.email && u.email.toLowerCase() === targetEmail) ||
          (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim().toLowerCase() === targetName)
        );
        if (match) {
          rollfiUserId = match.userId;
          log.info({ rollfiUserId, empId: emp.id }, "Resolved existing Rollfi user for re-sync");
        }
      } catch (lookupErr) {
        log.warn({ lookupErr }, "getUsers lookup failed");
      }
      if (!rollfiUserId) {
        return { success: false, error: `Rollfi email already in use and could not resolve existing user` };
      }
    } else {
      const userObj = (addUserRaw.user ?? addUserRaw) as Record<string, unknown>;
      rollfiUserId = (userObj.userId ?? userObj.id) as string | undefined;
      if (!rollfiUserId) {
        return { success: false, error: `Rollfi addUser returned unexpected shape: ${JSON.stringify(addUserRaw).slice(0, 200)}` };
      }
    }

    await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, log, {
      filingStatus: emp.w4FilingStatus ?? DEFAULT_W4.filingStatus,
      multipleJobs: emp.w4MultipleJobs ?? DEFAULT_W4.multipleJobs,
      dependents: emp.w4Dependents ?? DEFAULT_W4.dependents,
      extraWithholding: emp.w4ExtraWithholding ?? DEFAULT_W4.extraWithholding,
      homeState: emp.homeState ?? DEFAULT_W4.homeState,
    });

    const addWageResp = await axios.post(`${ROLLFI_BASE_URL}/adminPortal#addUserWage`, {
      method: "addUserWage",
      userWage: {
        companyId: rollfiCompany.rollfiCompanyId,
        userId: rollfiUserId,
        differentialPay: "No",
        wageRate: emp.wage,
        workerType: "W2",
        wageBasis: "Per Hour",
        userType: "Paid by the hour",
        employmentStatus: "Full Time (30+ Hours per week)",
        userRefTaxExempt: "No, this employee is not tax exempt",
        startDate: "2024-01-01",
        paymentMethod: "Direct Deposit",
      },
    }, { headers: rollfiHeaders() });

    const addWageRaw = addWageResp.data as Record<string, unknown>;
    const wageObj = (addWageRaw.userWage ?? addWageRaw) as Record<string, unknown>;
    const rollfiWageId = (wageObj.userWageId ?? wageObj.id) as string | undefined;

    await persistRollfiEmployee(emp.id, {
      rollfiUserId,
      rollfiWageId,
      onboardedAt: new Date().toISOString(),
    });

    return { success: true, rollfiUserId, rollfiWageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, employeeId: emp.id }, "Rollfi employee onboard failed");
    return { success: false, error: msg };
  }
}
