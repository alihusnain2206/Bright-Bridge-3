import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { userAccounts, employees } from "@workspace/db/schema";
import { store, type TestUser } from "../store.js";

export async function deleteUserAccount(userId: string): Promise<void> {
  await db.delete(userAccounts).where(eq(userAccounts.id, userId));
}

export async function persistUserAccount(user: TestUser): Promise<void> {
  await db
    .insert(userAccounts)
    .values({
      id:         user.id,
      name:       user.name,
      email:      user.email,
      password:   user.password,
      role:       user.role,
      companyId:  user.companyId ?? "",
      locationId: user.locationId ?? null,
      employeeId: user.employeeId ?? null,
      position:   user.position ?? null,
      createdAt:  new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: userAccounts.id,
      set: {
        name:       user.name,
        password:   user.password,
        role:       user.role,
        companyId:  user.companyId ?? "",
        locationId: user.locationId ?? null,
        employeeId: user.employeeId ?? null,
        position:   user.position ?? null,
      },
    });
}

/**
 * Boot migration: upgrade any remaining "manager" role accounts to "owner".
 * Safe to run on every boot — no-op when no manager accounts exist.
 */
export async function migrateManagerAccountsToOwner(): Promise<{ upgraded: number }> {
  const result = await db
    .update(userAccounts)
    .set({ role: "owner" })
    .where(eq(userAccounts.role, "manager"))
    .returning({ id: userAccounts.id });
  // Sync in-memory store for any already-loaded accounts
  for (const row of result) {
    const u = store.getAllStaffUsers().find((u) => u.id === row.id);
    if (u) (u as { role: string }).role = "owner";
  }
  return { upgraded: result.length };
}

export async function loadUserAccountsFromDb(): Promise<{ count: number }> {
  const rows = await db.select().from(userAccounts);

  for (const row of rows) {
    const user: TestUser = {
      id:         row.id,
      name:       row.name,
      email:      row.email,
      password:   row.password,
      role:       row.role as TestUser["role"],
      companyId:  row.companyId,
      locationId: row.locationId ?? undefined,
      employeeId: row.employeeId ?? null,
      position:   row.position ?? "",
    };
    store.addTestUser(user);
  }

  return { count: rows.length };
}

/**
 * Reconcile: for every employee in the DB, ensure a user_accounts login exists.
 * Fixes employees created before the persist-on-create fix was deployed.
 * Safe to run on every boot — uses ON CONFLICT DO NOTHING via insert.
 */
export async function reconcileEmployeeLoginAccounts(): Promise<{ created: number }> {
  const allEmployees = await db.select().from(employees);
  const existingAccounts = await db.select({ email: userAccounts.email }).from(userAccounts);
  const existingEmails = new Set(existingAccounts.map((a) => a.email.toLowerCase()));

  let created = 0;
  for (const emp of allEmployees) {
    if (existingEmails.has(emp.email.toLowerCase())) continue;

    const newUser: TestUser = {
      id:         `USER-DYN-${emp.id}`,
      name:       `${emp.firstName} ${emp.lastName}`,
      email:      emp.email,
      password:   "Staff123!",
      role:       "employee",
      companyId:  emp.companyId,
      employeeId: emp.id,
      position:   emp.position,
      hourlyWage: emp.hourlyWage ?? undefined,
    };

    // Add to in-memory store
    store.addTestUser(newUser);

    // Persist to DB
    await db.insert(userAccounts).values({
      id:         newUser.id,
      name:       newUser.name,
      email:      newUser.email,
      password:   newUser.password,
      role:       newUser.role,
      companyId:  newUser.companyId ?? "",
      employeeId: newUser.employeeId ?? null,
      position:   newUser.position ?? null,
      createdAt:  new Date().toISOString(),
    }).onConflictDoNothing();

    existingEmails.add(emp.email.toLowerCase());
    created++;
  }

  return { created };
}
