import { db } from "@workspace/db";
import { clientEmployeeRecords } from "@workspace/db/schema";
import { store, type ClientEmployee, type EmployeeStatus } from "../store.js";

export async function persistClientEmployee(emp: ClientEmployee): Promise<void> {
  await db
    .insert(clientEmployeeRecords)
    .values({
      id:                  emp.id,
      clientId:            emp.clientId,
      name:                emp.name,
      email:               emp.email ?? null,
      role:                emp.role,
      roleName:            emp.roleName,
      wage:                emp.wage,
      wageType:            emp.wageType,
      timeTrackingEnabled: emp.timeTrackingEnabled,
      status:              emp.status,
      easyteamSynced:      emp.easyteamSynced,
      rollfiSynced:        emp.rollfiSynced,
      rollfiUserId:        emp.rollfiUserId ?? null,
      syncError:           emp.syncError ?? null,
      createdAt:           emp.createdAt,
    })
    .onConflictDoUpdate({
      target: clientEmployeeRecords.id,
      set: {
        name:                emp.name,
        email:               emp.email ?? null,
        role:                emp.role,
        roleName:            emp.roleName,
        wage:                emp.wage,
        wageType:            emp.wageType,
        timeTrackingEnabled: emp.timeTrackingEnabled,
        status:              emp.status,
        easyteamSynced:      emp.easyteamSynced,
        rollfiSynced:        emp.rollfiSynced,
        rollfiUserId:        emp.rollfiUserId ?? null,
        syncError:           emp.syncError ?? null,
      },
    });
}

export async function loadClientEmployeesFromDb(): Promise<{ count: number }> {
  const rows = await db.select().from(clientEmployeeRecords);

  for (const row of rows) {
    const existing = store.getEmployee(row.id);
    const emp: ClientEmployee = {
      id:                  row.id,
      clientId:            row.clientId,
      name:                row.name,
      email:               row.email ?? undefined,
      role:                row.role,
      roleName:            row.roleName,
      wage:                row.wage,
      wageType:            (row.wageType as ClientEmployee["wageType"]) ?? "hourly",
      timeTrackingEnabled: row.timeTrackingEnabled,
      status:              (row.status as EmployeeStatus) ?? "hired",
      easyteamSynced:      row.easyteamSynced,
      rollfiSynced:        row.rollfiSynced,
      rollfiUserId:        row.rollfiUserId ?? undefined,
      syncError:           row.syncError ?? undefined,
      createdAt:           row.createdAt,
    };
    if (existing) {
      store.updateEmployee(row.id, emp);
    } else {
      store.insertEmployee(emp);
    }
  }

  return { count: rows.length };
}
