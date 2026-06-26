import { eq } from "drizzle-orm";
import { db, companies as companiesTable } from "@workspace/db";
import { store } from "../store.js";

/**
 * The single canonical resolver for a company's EasyTeam / Rollfi location id.
 *
 * Resolution order:
 *   1. In-memory store company.locationId  (seeded Sunshine → LOC-SUNSHINE, Rainbow → LOC-RAINBOW)
 *   2. DB companies.rollfiLocationId        (wizard-created companies)
 *   3. Derived `LOC-${companyId}`           (stable fallback so a location always exists)
 *
 * This replaces the scattered store → DB → `LOC-${id}` chains that previously lived in
 * auth.ts, easyteam.ts, rollfi.ts and companies.ts.
 */
export async function resolveCompanyLocationId(companyId: string): Promise<string> {
  if (!companyId) return "";

  const storeLocationId = store.getCompany(companyId)?.locationId;
  if (storeLocationId) return storeLocationId;

  try {
    const [dbCo] = await db
      .select({ rollfiLocationId: companiesTable.rollfiLocationId })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    if (dbCo?.rollfiLocationId) return dbCo.rollfiLocationId;
  } catch {
    /* DB unavailable — fall through to derived id */
  }

  return `LOC-${companyId}`;
}
