import axios from "axios";
import { store, type ClientEmployee, type RollfiCompanyRecord } from "../store.js";
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

export async function runEmployeeKycOnboarding(
  rollfiUserId: string,
  rollfiCompanyId: string,
  log: Logger
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

  try {
    const r = await axios.post(`${ROLLFI_BASE_URL}/userOnboarding#addW4Information`, {
      method: "addW4Information",
      w4Information: { userId: rollfiUserId, w4FilingStatus: "Single", haveMultipleJob: false, dependents: 0, dependentsAbove18: 0, otherIncome: 0, otherDeduction: 0, extraWithholding: 0 },
    }, { headers });
    log.info({ rollfiResponse: r.data }, "Rollfi addW4Information response");
  } catch (e) { log.warn({ e }, "addW4Information failed (ignoring)"); }

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

export async function onboardClientEmployeeToRollfi(
  emp: ClientEmployee,
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

  const nameParts = emp.name.split(" ");
  const firstName = nameParts[0];
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

    await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, log);

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
