import { db, timesheetShifts } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ShiftUpsertRow {
  easyteamShiftId:     string;
  employeeId:          string | null;
  companyId:           string;
  easyteamLocationId:  string;
  roleId:              string | null;
  utcStartTime:        string;
  utcEndTime:          string | null;
  utcOffset:           number;
  durationMs:          number;
  payableDurationMs:   number;
  totalPaidBreakMin:   number | null;
  totalUnpaidBreakMin: number | null;
  breaks:              unknown;
  active:              boolean;
  locked:              boolean;
  manualEntry:         boolean;
  scheduleShiftId:     string | null;
  deletedAt:           string | null;
  syncedAt:            string;
}

export async function upsertTimesheetShift(row: ShiftUpsertRow): Promise<void> {
  await db
    .insert(timesheetShifts)
    .values(row)
    .onConflictDoUpdate({
      target: timesheetShifts.easyteamShiftId,
      set: {
        employeeId:          row.employeeId,
        companyId:           row.companyId,
        easyteamLocationId:  row.easyteamLocationId,
        roleId:              row.roleId,
        utcStartTime:        row.utcStartTime,
        utcEndTime:          row.utcEndTime,
        utcOffset:           row.utcOffset,
        durationMs:          row.durationMs,
        payableDurationMs:   row.payableDurationMs,
        totalPaidBreakMin:   row.totalPaidBreakMin,
        totalUnpaidBreakMin: row.totalUnpaidBreakMin,
        breaks:              row.breaks,
        active:              row.active,
        locked:              row.locked,
        manualEntry:         row.manualEntry,
        scheduleShiftId:     row.scheduleShiftId,
        deletedAt:           row.deletedAt,
        syncedAt:            row.syncedAt,
      },
    });
}

export async function getTimesheetShiftsByCompanyAndRange(
  companyId: string,
  from: Date,
  to: Date,
): Promise<(typeof timesheetShifts.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(timesheetShifts)
    .where(eq(timesheetShifts.companyId, companyId));

  return rows.filter((r) => {
    const start = new Date(r.utcStartTime);
    return start >= from && start <= to;
  });
}
