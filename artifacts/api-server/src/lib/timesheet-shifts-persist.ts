import { db, timesheetShifts } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Derive the local calendar date (YYYY-MM-DD) for a shift.
 * utcStartTime is an ISO 8601 UTC string; utcOffsetMinutes is the
 * EasyTeam-provided offset in minutes (e.g. -300 for EST).
 * We apply the offset arithmetically — never rely on the server's own timezone.
 */
export function shiftLocalDate(utcStartTime: string, utcOffsetMinutes: number): string {
  const localMs = new Date(utcStartTime).getTime() + utcOffsetMinutes * 60_000;
  const d = new Date(localMs);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export interface ShiftUpsertRow {
  easyteamShiftId:     string;
  employeeId:          string | null;
  companyId:           string;
  easyteamLocationId:  string;
  roleId:              string | null;
  utcStartTime:        string;
  utcEndTime:          string | null;
  utcOffset:           number;
  localDate:           string;    // YYYY-MM-DD in the employee's local timezone
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
        localDate:           row.localDate,
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
  // from/to come from the request's YYYY-MM-DD params (local calendar dates).
  // Compare against localDate column — never raw UTC — so shifts near period
  // boundaries are included/excluded based on where the clock read locally.
  const fromStr = from.toISOString().split("T")[0]!;   // YYYY-MM-DD
  const toStr   = to.toISOString().split("T")[0]!;

  const rows = await db
    .select()
    .from(timesheetShifts)
    .where(eq(timesheetShifts.companyId, companyId));

  return rows.filter((r) => {
    if (r.localDate) return r.localDate >= fromStr && r.localDate <= toStr;
    // Fallback for pre-backfill rows (should not occur after migration)
    const start = new Date(r.utcStartTime);
    return start >= from && start <= to;
  });
}
