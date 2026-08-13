/**
 * Per-company EasyTeam organization resolver — frontend mirror of the backend helper.
 *
 * The organization object passed to the EasyTeam SDK constructor must match the
 * organizationId in the JWT. Keep this in sync with the backend resolveEasyTeamOrgId.
 *
 * Priority:
 *   1. orgId (explicit value from companies.easyteam_org_id via the API) — data-driven path
 *      for companies created with per-company org support. Takes precedence over everything.
 *   2. Hardcoded ORG-SUNSHINE branch — legacy; kept for backward compat while Sunshine's
 *      easyteamOrgId propagates through all API responses.
 *   3. ORG-BRIGHTBRIDGE fallback — shared legacy org for companies with no explicit org ID.
 *
 * IMPORTANT: EasyTeam auto-creates a new org for every unrecognised organizationId it
 * receives. Never pass speculative or placeholder strings.
 */
export function resolveEasyTeamOrg(
  companyId?: string | null,
  companyName?: string | null,
  orgId?: string | null,   // explicit org ID from companies.easyteam_org_id; takes priority
): { id: string; name: string } {
  // Data-driven path: backend has resolved the org ID from the DB — trust it.
  if (orgId) return { id: orgId, name: companyName ?? orgId };
  // Legacy hardcoded branch for Sunshine (kept until easyteamOrgId flows through all paths).
  if (companyId === "ORG-SUNSHINE") {
    return { id: "ORG-SUNSHINE", name: companyName ?? "Sunshine Daycare Centre" };
  }
  return { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" };
}
