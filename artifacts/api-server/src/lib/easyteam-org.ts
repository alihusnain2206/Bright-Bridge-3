/**
 * Per-company EasyTeam organization ID resolver — data-driven via the DB.
 *
 * EasyTeam's data model: Organization = a business, Locations = its physical sites.
 * One org per company is the correct model. Each company row stores its assigned
 * EasyTeam org ID in `companies.easyteam_org_id`. New companies have this set at
 * creation time; existing companies that were on the shared ORG-BRIGHTBRIDGE org
 * have the column left NULL and fall back to the shared org.
 *
 * IMPORTANT — EasyTeam auto-creates a new org for every unrecognised organizationId
 * it receives. Never pass speculative or placeholder strings. This resolver guarantees
 * only known, explicitly stored org IDs or the stable shared-org fallback are emitted.
 *
 * The resolved value is cached in-process per companyId (org assignments are stable;
 * they never change without a deployment that also resets the process).
 */
import { db, companies as companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// In-process cache: companyId → resolved org ID.
// Org assignments are stable for the life of the process — no TTL needed.
const orgIdCache = new Map<string, string>();

export async function resolveEasyTeamOrgId(companyId?: string | null): Promise<string> {
  if (!companyId) return "ORG-BRIGHTBRIDGE";

  const cached = orgIdCache.get(companyId);
  if (cached !== undefined) return cached;

  try {
    const [row] = await db
      .select({ easyteamOrgId: companiesTable.easyteamOrgId })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);

    // Use the stored org ID when present; otherwise fall back to the shared legacy org.
    const orgId = row?.easyteamOrgId ?? "ORG-BRIGHTBRIDGE";
    orgIdCache.set(companyId, orgId);
    return orgId;
  } catch {
    // DB temporarily unavailable — do not cache so next call retries.
    return "ORG-BRIGHTBRIDGE";
  }
}
