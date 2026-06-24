import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { userAccounts } from "@workspace/db/schema";
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
      hourlyWage: user.hourlyWage ?? null,
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
        hourlyWage: user.hourlyWage ?? null,
      },
    });
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
      hourlyWage: row.hourlyWage ?? undefined,
    };
    store.addTestUser(user);
  }

  return { count: rows.length };
}
