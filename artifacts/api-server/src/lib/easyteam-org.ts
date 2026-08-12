/**
 * Per-company EasyTeam organization ID resolver.
 *
 * EasyTeam's data model: Organization = a business, Locations = its physical sites.
 * We experimented with a shared platform org ("ORG-BRIGHTBRIDGE") where every
 * client company is a location.  EasyTeam support suspects this shared-org
 * architecture breaks the timesheets summary.
 *
 * Experiment (ORG-SUNSHINE only): give Sunshine its own EasyTeam org ID.
 * All other companies remain on the shared platform org until confirmed working.
 *
 * To revert: change the ORG-SUNSHINE branch to return "ORG-BRIGHTBRIDGE".
 * To extend to more companies: add more branches before the default.
 */
export function resolveEasyTeamOrgId(companyId?: string | null): string {
  if (companyId === "ORG-SUNSHINE") return "ORG-SUNSHINE";
  return "ORG-BRIGHTBRIDGE";
}
