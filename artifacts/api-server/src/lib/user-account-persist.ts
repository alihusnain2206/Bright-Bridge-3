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

// migrateManagerAccountsToOwner() was removed.
//
// History: added July 2026 (commit fc456b6) to promote legacy "manager" accounts
// (e.g. David Brown) to "owner" at a time when the system had no distinct manager
// access tier and all operator accounts were expected to behave as owners.
//
// Why removed: createManagerUser() now stores role:"manager" correctly (the bug it
// was masking is fixed). The migration ran WHERE role='manager' with no ID filter,
// so it would have promoted every newly created manager to owner on the next boot —
// directly undoing the fix. No manager accounts existed in production at the time
// of removal, so the migration was already a no-op and is now dead code.

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
