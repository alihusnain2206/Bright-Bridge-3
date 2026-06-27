import { db, timesheetApprovals } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface TimesheetApproval {
  employeeId:          string;
  rollfiUserId:        string | null;
  companyId:           string;
  periodKey:           string;
  hoursWorked:         number;
  breakDeduction:      number;
  approvedHours:       number;
  approvedAt:          string;
  approvedByManagerId: string;
  source:              "easyteam_sync" | "manager_edit";
  managerEdited:       boolean;
  managerEditNote?:    string | null;
}

function rowToApproval(row: typeof timesheetApprovals.$inferSelect): TimesheetApproval {
  return {
    employeeId:          row.employeeId,
    rollfiUserId:        row.rollfiUserId ?? null,
    companyId:           row.companyId,
    periodKey:           row.periodKey,
    hoursWorked:         row.hoursWorked,
    breakDeduction:      row.breakDeduction,
    approvedHours:       row.approvedHours,
    approvedAt:          row.approvedAt,
    approvedByManagerId: row.approvedByManagerId,
    source:              (row.source as TimesheetApproval["source"]) ?? "easyteam_sync",
    managerEdited:       row.managerEdited,
    managerEditNote:     row.managerEditNote ?? null,
  };
}

export async function upsertTimesheetApproval(a: TimesheetApproval): Promise<void> {
  const existing = await db
    .select({ id: timesheetApprovals.id, managerEdited: timesheetApprovals.managerEdited })
    .from(timesheetApprovals)
    .where(and(
      eq(timesheetApprovals.employeeId, a.employeeId),
      eq(timesheetApprovals.periodKey,  a.periodKey),
    ))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(timesheetApprovals).values({
      employeeId:          a.employeeId,
      rollfiUserId:        a.rollfiUserId ?? null,
      companyId:           a.companyId,
      periodKey:           a.periodKey,
      hoursWorked:         a.hoursWorked,
      breakDeduction:      a.breakDeduction,
      approvedHours:       a.approvedHours,
      approvedAt:          a.approvedAt,
      approvedByManagerId: a.approvedByManagerId,
      source:              a.source,
      managerEdited:       a.managerEdited,
      managerEditNote:     a.managerEditNote ?? null,
    });
  } else {
    // Never overwrite a manager-edited record with a lower-trust sync source
    if (existing[0]!.managerEdited && !a.managerEdited) return;
    await db
      .update(timesheetApprovals)
      .set({
        rollfiUserId:        a.rollfiUserId ?? null,
        hoursWorked:         a.hoursWorked,
        breakDeduction:      a.breakDeduction,
        approvedHours:       a.approvedHours,
        approvedAt:          a.approvedAt,
        approvedByManagerId: a.approvedByManagerId,
        source:              a.source,
        managerEdited:       a.managerEdited,
        managerEditNote:     a.managerEditNote ?? null,
      })
      .where(and(
        eq(timesheetApprovals.employeeId, a.employeeId),
        eq(timesheetApprovals.periodKey,  a.periodKey),
      ));
  }
}

export async function getTimesheetApprovalsByCompanyPeriod(
  companyId: string,
  periodKey:  string,
): Promise<TimesheetApproval[]> {
  const rows = await db
    .select()
    .from(timesheetApprovals)
    .where(and(
      eq(timesheetApprovals.companyId, companyId),
      eq(timesheetApprovals.periodKey, periodKey),
    ));
  return rows.map(rowToApproval);
}

export async function getTimesheetApprovalByEmployee(
  employeeId: string,
  periodKey:  string,
): Promise<TimesheetApproval | null> {
  const rows = await db
    .select()
    .from(timesheetApprovals)
    .where(and(
      eq(timesheetApprovals.employeeId, employeeId),
      eq(timesheetApprovals.periodKey,  periodKey),
    ))
    .limit(1);
  return rows[0] ? rowToApproval(rows[0]) : null;
}
