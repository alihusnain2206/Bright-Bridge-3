import { store } from "../store.js";
import { registerEmployeeInEasyTeam } from "./easyteam-employee-sync.js";
import { onboardEmployeeToRollfi } from "./rollfi-employee-sync.js";
import { resolveCompanyLocationId } from "./location.js";
import type { Logger } from "pino";

export interface EmployeeSyncInput {
  /** Canonical employee id — also the EasyTeam employeeId used in JWTs. */
  id: string;
  companyId: string;
  name: string;
  email: string;
  position: string;
  /** Stored in cents (e.g. 1800 = $18.00/hr). Only meaningful when payType = 'hourly'. */
  hourlyWageCents: number;
  /** 'hourly' | 'salary'. Defaults to 'hourly'. */
  payType?: string;
  /** Annual salary in cents — only meaningful when payType = 'salary'. */
  annualSalaryCents?: number | null;
  /** Whether the employee qualifies for overtime (affects Rollfi userType for salary). */
  overtimeEligible?: boolean;
  /** Employee's home state — used for state W-4 submission. Defaults to "NJ". */
  homeState?: string;
  /** Real home address fields — forwarded to Rollfi addKycInformation. */
  homeAddress?: string;
  homeCity?: string;
  homeZip?: string;
  /** Raw 9-digit SSN (no dashes). */
  ssn?: string;
  /** ISO date YYYY-MM-DD. */
  dateOfBirth?: string;
  w4FilingStatus?: string;
  w4MultipleJobs?: boolean;
  w4Dependents?: number;
  w4ExtraWithholding?: number;
  /** State-specific W-4 field values from the UI form (built via getStateW4FormFields).
   *  When provided, used directly in addStateW4Information instead of the hardcoded fallback. */
  stateW4Fields?: Record<string, string>;
  /** Employee phone number as entered in the wizard (e.g. "(973) 555-0142"). Forwarded to Rollfi; digits stripped there. */
  phone?: string;
  /** Employee start date ISO YYYY-MM-DD. Sent to Rollfi addUser.dateOfJoin and addUserWage.startDate. */
  startDate?: string;
  /** Direct deposit bank details — only present when bankSetupMethod === "manual".
   *  In sandbox, test values are substituted automatically regardless of these fields. */
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
}

export interface EmployeeSyncResult {
  easyteamSynced: boolean;
  rollfiSynced: boolean;
  rollfiUserId?: string;
  syncError?: string;
  /** Hard-failure onboarding steps — employee cannot be paid until resolved. */
  rollfiFailedSteps?: { step: string; message: string }[];
  /** Soft-failure warnings — logged but onboarding continues. */
  rollfiSoftWarnings?: { step: string; message: string }[];
}

/**
 * Register a single employee in EasyTeam (via token exchange) and onboard them to
 * Rollfi when their company is Rollfi-onboarded. Shared by the full company-employee
 * wizard (`POST /api/employees`) and the quick-add flow (`POST /api/clients/:id/employees`)
 * so both go through the exact same integration path against the unified employee model.
 */
export async function syncEmployeeToIntegrations(
  emp: EmployeeSyncInput,
  log: Logger
): Promise<EmployeeSyncResult> {
  const locationId = await resolveCompanyLocationId(emp.companyId);

  // EasyTeam registration — EasyTeam upserts the employee on token exchange.
  const etResult = await registerEmployeeInEasyTeam(
    {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      roleName: emp.position,
      wage: emp.hourlyWageCents / 100,
      wageType: "hourly",
    },
    locationId,
    log
  );
  if (etResult.easyteamEmployeeId) {
    store.setEasyTeamUuidMapping(etResult.easyteamEmployeeId, emp.id);
  }

  // Rollfi onboarding — only when the company has completed Rollfi onboarding.
  let rollfiSynced = false;
  let rollfiUserId: string | undefined;
  let syncError: string | undefined;

  const rollfiCompany = store.getRollfiCompany(emp.companyId);
  if (rollfiCompany) {
    const r = await onboardEmployeeToRollfi(
      {
        id: emp.id, name: emp.name, email: emp.email, roleName: emp.position, wage: emp.hourlyWageCents / 100,
        payType: emp.payType,
        annualSalaryCents: emp.annualSalaryCents,
        overtimeEligible: emp.overtimeEligible,
        homeState: emp.homeState, homeAddress: emp.homeAddress, homeCity: emp.homeCity, homeZip: emp.homeZip,
        ssn: emp.ssn, dateOfBirth: emp.dateOfBirth,
        w4FilingStatus: emp.w4FilingStatus, w4MultipleJobs: emp.w4MultipleJobs,
        w4Dependents: emp.w4Dependents, w4ExtraWithholding: emp.w4ExtraWithholding,
        stateW4Fields: emp.stateW4Fields,
        phone: emp.phone, startDate: emp.startDate,
        bankName: emp.bankName, routingNumber: emp.routingNumber,
        accountNumber: emp.accountNumber, accountType: emp.accountType,
      },
      rollfiCompany,
      log
    );
    rollfiSynced = r.success;
    rollfiUserId = r.rollfiUserId;
    syncError = r.error;
    return {
      easyteamSynced: etResult.success,
      rollfiSynced,
      rollfiUserId,
      syncError,
      rollfiFailedSteps: r.hardErrors,
      rollfiSoftWarnings: r.softWarnings,
    };
  } else {
    syncError = "Company not yet onboarded to Rollfi";
  }

  return { easyteamSynced: etResult.success, rollfiSynced, rollfiUserId, syncError };
}
