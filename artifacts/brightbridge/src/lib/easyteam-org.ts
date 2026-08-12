/**
 * Per-company EasyTeam organization resolver — frontend mirror of the backend helper.
 *
 * The organization object passed to the EasyTeam SDK constructor must match the
 * organizationId in the JWT.  Keep this in sync with the backend resolveEasyTeamOrgId.
 *
 * To revert: change the ORG-SUNSHINE branch to return the shared-org object.
 */
export function resolveEasyTeamOrg(
  companyId?: string | null,
  companyName?: string | null,
): { id: string; name: string } {
  if (companyId === "ORG-SUNSHINE") {
    return { id: "ORG-SUNSHINE", name: companyName ?? "Sunshine Daycare Centre" };
  }
  return { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" };
}
