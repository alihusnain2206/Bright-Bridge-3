import { eq, and } from "drizzle-orm";
import { db, companies as companiesTable, locations as locationsTable, employees as employeesTable } from "@workspace/db";
import { store } from "../store.js";

/**
 * The single canonical resolver for a company's EasyTeam / Rollfi location id.
 *
 * Resolution order:
 *   1. In-memory store company.locationId  (seeded Sunshine → LOC-SUNSHINE, Rainbow → LOC-RAINBOW)
 *   2. DB locations table easyteamLocationId  (wizard-created companies + all companies after Phase 1 boot migration)
 *   3. DB companies.rollfiLocationId           (legacy fallback for companies not yet in locations table)
 *   4. Derived `LOC-${companyId}`              (stable fallback so a location always exists)
 */
export async function resolveCompanyLocationId(companyId: string): Promise<string> {
  if (!companyId) return "";

  // 1. In-memory store (seed companies: Sunshine, Rainbow — avoids a DB round-trip for hot path)
  const storeLocationId = store.getCompany(companyId)?.locationId;
  if (storeLocationId) return storeLocationId;

  try {
    // 2. Locations table — authoritative for wizard companies after Phase 1 boot migration
    const [loc] = await db
      .select({ easyteamLocationId: locationsTable.easyteamLocationId })
      .from(locationsTable)
      .where(and(eq(locationsTable.companyId, companyId), eq(locationsTable.isActive, true)));
    if (loc?.easyteamLocationId) return loc.easyteamLocationId;

    // 3. Legacy fallback: companies.rollfiLocationId (pre-Phase 1 companies)
    const [dbCo] = await db
      .select({ rollfiLocationId: companiesTable.rollfiLocationId })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    if (dbCo?.rollfiLocationId) return dbCo.rollfiLocationId;
  } catch {
    /* DB unavailable — fall through to derived id */
  }

  // 4. Stable derived fallback — always returns a non-empty string
  return `LOC-${companyId}`;
}

/**
 * Resolve the EasyTeam/Rollfi location id for a specific employee.
 * Returns the employee's assigned locationId if set; otherwise falls back to
 * resolveCompanyLocationId for their company.
 */
export async function resolveEmployeeLocationId(employeeId: string): Promise<string | null> {
  try {
    const [emp] = await db
      .select({ locationId: employeesTable.locationId, companyId: employeesTable.companyId })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId));
    if (!emp) return null;
    if (emp.locationId) return emp.locationId;
    if (emp.companyId) return resolveCompanyLocationId(emp.companyId);
  } catch {
    /* DB unavailable */
  }
  return null;
}
