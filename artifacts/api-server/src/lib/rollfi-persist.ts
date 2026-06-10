import { db, rollfiCompanyRecords, rollfiEmployeeRecords } from "@workspace/db";
import { store, type RollfiCompanyRecord, type RollfiEmployeeRecord } from "../store.js";

export async function persistRollfiCompany(companyId: string, record: RollfiCompanyRecord): Promise<void> {
  store.setRollfiCompany(companyId, record);
  await db
    .insert(rollfiCompanyRecords)
    .values({
      companyId,
      rollfiCompanyId:  record.rollfiCompanyId,
      rollfiLocationId: record.rollfiLocationId,
      onboardedAt:      record.onboardedAt,
      ein:              record.ein ?? null,
      ownerSsn:         record.ownerSsn ?? null,
    })
    .onConflictDoUpdate({
      target: rollfiCompanyRecords.companyId,
      set: {
        rollfiCompanyId:  record.rollfiCompanyId,
        rollfiLocationId: record.rollfiLocationId,
        onboardedAt:      record.onboardedAt,
        ein:              record.ein ?? null,
        ownerSsn:         record.ownerSsn ?? null,
      },
    });
}

export async function persistRollfiEmployee(employeeId: string, record: RollfiEmployeeRecord): Promise<void> {
  store.setRollfiEmployee(employeeId, record);
  await db
    .insert(rollfiEmployeeRecords)
    .values({
      employeeId,
      rollfiUserId: record.rollfiUserId,
      rollfiWageId: record.rollfiWageId ?? "",
      onboardedAt:  record.onboardedAt,
    })
    .onConflictDoUpdate({
      target: rollfiEmployeeRecords.employeeId,
      set: {
        rollfiUserId: record.rollfiUserId,
        rollfiWageId: record.rollfiWageId ?? "",
        onboardedAt:  record.onboardedAt,
      },
    });
}

export async function loadRollfiStateFromDb(): Promise<{ companies: number; employees: number }> {
  const [companies, employees] = await Promise.all([
    db.select().from(rollfiCompanyRecords),
    db.select().from(rollfiEmployeeRecords),
  ]);

  for (const row of companies) {
    store.setRollfiCompany(row.companyId, {
      rollfiCompanyId:  row.rollfiCompanyId,
      rollfiLocationId: row.rollfiLocationId,
      onboardedAt:      row.onboardedAt,
      ein:              row.ein ?? undefined,
      ownerSsn:         row.ownerSsn ?? undefined,
    });
  }

  for (const row of employees) {
    store.setRollfiEmployee(row.employeeId, {
      rollfiUserId: row.rollfiUserId,
      rollfiWageId: row.rollfiWageId ?? undefined,
      onboardedAt:  row.onboardedAt,
    });
  }

  return { companies: companies.length, employees: employees.length };
}
