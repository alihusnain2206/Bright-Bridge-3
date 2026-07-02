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
  /** Stored in cents (e.g. 1800 = $18.00/hr). */
  hourlyWageCents: number;
  /** Employee's home state — used for state W-4 submission. Defaults to "NJ". */
  homeState?: string;
  w4FilingStatus?: string;
  w4MultipleJobs?: boolean;
  w4Dependents?: number;
  w4ExtraWithholding?: number;
}

export interface EmployeeSyncResult {
  easyteamSynced: boolean;
  rollfiSynced: boolean;
  rollfiUserId?: string;
  syncError?: string;
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
        id: emp.id, name: emp.name, email: emp.email, roleName: emp.position, wage: emp.hourlyWageCents,
        homeState: emp.homeState, w4FilingStatus: emp.w4FilingStatus, w4MultipleJobs: emp.w4MultipleJobs,
        w4Dependents: emp.w4Dependents, w4ExtraWithholding: emp.w4ExtraWithholding,
      },
      rollfiCompany,
      log
    );
    rollfiSynced = r.success;
    rollfiUserId = r.rollfiUserId;
    syncError = r.error;
  } else {
    syncError = "Company not yet onboarded to Rollfi";
  }

  return { easyteamSynced: etResult.success, rollfiSynced, rollfiUserId, syncError };
}
