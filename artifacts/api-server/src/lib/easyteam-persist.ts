import { db, timesheetEntries } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { store, type TimesheetEntry } from "../store.js";

export async function persistTimesheetEntry(entry: TimesheetEntry): Promise<void> {
  store.setTimesheetEntry(entry);
  await db
    .insert(timesheetEntries)
    .values({
      employeeId:       entry.employeeId,
      companyId:        entry.companyId,
      periodKey:        entry.periodKey,
      hoursWorked:      entry.hoursWorked,
      breakDeduction:   entry.breakDeduction,
      approvedHours:    entry.approvedHours,
      source:           entry.source,
      syncedAt:         entry.syncedAt,
      managerApproved:  entry.managerApproved ?? false,
      approvedAt:       entry.approvedAt ?? null,
      approvedByUserId: entry.approvedByUserId ?? null,
    })
    .onConflictDoNothing();
}

export async function upsertTimesheetEntry(entry: TimesheetEntry): Promise<void> {
  store.setTimesheetEntry(entry);
  const existing = await db
    .select()
    .from(timesheetEntries)
    .where(and(
      eq(timesheetEntries.employeeId, entry.employeeId),
      eq(timesheetEntries.periodKey,  entry.periodKey),
    ))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(timesheetEntries).values({
      employeeId:       entry.employeeId,
      companyId:        entry.companyId,
      periodKey:        entry.periodKey,
      hoursWorked:      entry.hoursWorked,
      breakDeduction:   entry.breakDeduction,
      approvedHours:    entry.approvedHours,
      source:           entry.source,
      syncedAt:         entry.syncedAt,
      managerApproved:  entry.managerApproved ?? false,
      approvedAt:       entry.approvedAt ?? null,
      approvedByUserId: entry.approvedByUserId ?? null,
    });
  } else {
    await db
      .update(timesheetEntries)
      .set({
        hoursWorked:      entry.hoursWorked,
        breakDeduction:   entry.breakDeduction,
        approvedHours:    entry.approvedHours,
        source:           entry.source,
        syncedAt:         entry.syncedAt,
        managerApproved:  entry.managerApproved ?? false,
        approvedAt:       entry.approvedAt ?? null,
        approvedByUserId: entry.approvedByUserId ?? null,
      })
      .where(and(
        eq(timesheetEntries.employeeId, entry.employeeId),
        eq(timesheetEntries.periodKey,  entry.periodKey),
      ));
  }
}

export async function loadTimesheetEntriesFromDb(): Promise<number> {
  const rows = await db.select().from(timesheetEntries);
  for (const row of rows) {
    store.setTimesheetEntry({
      employeeId:       row.employeeId,
      companyId:        row.companyId,
      periodKey:        row.periodKey,
      hoursWorked:      row.hoursWorked,
      breakDeduction:   row.breakDeduction,
      approvedHours:    row.approvedHours,
      source:           (row.source as TimesheetEntry["source"]) ?? "easyteam",
      syncedAt:         row.syncedAt,
      managerApproved:  row.managerApproved ?? false,
      approvedAt:       row.approvedAt ?? undefined,
      approvedByUserId: row.approvedByUserId ?? undefined,
    });
  }
  return rows.length;
}
