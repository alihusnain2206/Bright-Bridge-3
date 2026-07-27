/**
 * ONE-TIME cleanup endpoint — removes the 4 duplicate ORG-BRIGHTBRIDGE
 * employee rows that were created by an accidental second import run.
 *
 * DELETE after the single use; never re-deploy.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import {
  db,
  employees,
  userAccounts,
  rollfiEmployeeRecords,
  onboardingTasks as onboardingTasksTable,
  complianceItems as complianceItemsTable,
  peopleActivityLog as peopleActivityLogTable,
} from "@workspace/db";
import { inArray, and, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

// ─── Hard-coded duplicate IDs — the ONLY rows this endpoint can touch ──────
const DUPLICATE_IDS = [
  "EMP-MS3JQD3D-8UFKD1",
  "EMP-MS3JQD3E-5ROJ6P",
  "EMP-MS3JQD3E-1OHIG5",
  "EMP-MS3JQD3E-DNZTMP",
] as const;

const REQUIRED_CONFIRM = "DELETE_DUPLICATE_EMPLOYEES";

router.post("/api/admin/cleanup-duplicate-employees", async (req: Request, res: Response) => {
  // ── Guard 1: bearer token ────────────────────────────────────────────────
  const secret = process.env.IMPORT_ADMIN_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "IMPORT_ADMIN_SECRET not configured" });
  }
  const authHeader = req.headers.authorization ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  // ── Guard 2: explicit confirmation flag in body ──────────────────────────
  const { confirm } = req.body ?? {};
  if (confirm !== REQUIRED_CONFIRM) {
    return res.status(400).json({
      ok: false,
      error: `Body must contain { "confirm": "${REQUIRED_CONFIRM}" }. Got: ${JSON.stringify(confirm)}`,
    });
  }

  // ── Pre-flight SELECT: verify exactly 4 duplicate rows exist ─────────────
  const foundEmployees = await db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(inArray(employees.id, [...DUPLICATE_IDS]));

  if (foundEmployees.length !== 4) {
    return res.status(409).json({
      ok: false,
      error: `Pre-flight check failed: expected 4 duplicate employee rows, found ${foundEmployees.length}. Aborting — no rows deleted.`,
      found: foundEmployees,
    });
  }

  const [palCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(peopleActivityLogTable)
    .where(
      and(
        eq(peopleActivityLogTable.companyId, "ORG-BRIGHTBRIDGE"),
        inArray(peopleActivityLogTable.employeeId, [...DUPLICATE_IDS])
      )
    );

  const [taskCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(onboardingTasksTable)
    .where(inArray(onboardingTasksTable.employeeId, [...DUPLICATE_IDS]));

  const [compCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(complianceItemsTable)
    .where(inArray(complianceItemsTable.employeeId, [...DUPLICATE_IDS]));

  const [rollfiCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rollfiEmployeeRecords)
    .where(inArray(rollfiEmployeeRecords.employeeId, [...DUPLICATE_IDS]));

  const [uaCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userAccounts)
    .where(inArray(userAccounts.employeeId, [...DUPLICATE_IDS]));

  const preview = {
    employees:             foundEmployees.length,
    people_activity_log:   palCount?.count ?? 0,
    onboarding_tasks:      taskCount?.count ?? 0,
    compliance_items:      compCount?.count ?? 0,
    rollfi_employee_records: rollfiCount?.count ?? 0,
    user_accounts:         uaCount?.count ?? 0,
  };

  // ── Deletes — dependency order (children first, employees last) ──────────
  const palDeleted = await db
    .delete(peopleActivityLogTable)
    .where(
      and(
        eq(peopleActivityLogTable.companyId, "ORG-BRIGHTBRIDGE"),
        inArray(peopleActivityLogTable.employeeId, [...DUPLICATE_IDS])
      )
    )
    .returning({ id: peopleActivityLogTable.id });

  const tasksDeleted = await db
    .delete(onboardingTasksTable)
    .where(inArray(onboardingTasksTable.employeeId, [...DUPLICATE_IDS]))
    .returning({ id: onboardingTasksTable.id });

  const compDeleted = await db
    .delete(complianceItemsTable)
    .where(inArray(complianceItemsTable.employeeId, [...DUPLICATE_IDS]))
    .returning({ id: complianceItemsTable.id });

  const rollfiDeleted = await db
    .delete(rollfiEmployeeRecords)
    .where(inArray(rollfiEmployeeRecords.employeeId, [...DUPLICATE_IDS]))
    .returning({ employeeId: rollfiEmployeeRecords.employeeId });

  const uaDeleted = await db
    .delete(userAccounts)
    .where(inArray(userAccounts.employeeId, [...DUPLICATE_IDS]))
    .returning({ id: userAccounts.id });

  const empDeleted = await db
    .delete(employees)
    .where(inArray(employees.id, [...DUPLICATE_IDS]))
    .returning({ id: employees.id });

  return res.json({
    ok: true,
    message: "Duplicate employee rows deleted successfully.",
    preview,
    deleted: {
      employees:               empDeleted.length,
      people_activity_log:     palDeleted.length,
      onboarding_tasks:        tasksDeleted.length,
      compliance_items:        compDeleted.length,
      rollfi_employee_records: rollfiDeleted.length,
      user_accounts:           uaDeleted.length,
    },
    duplicateIds: DUPLICATE_IDS,
  });
});

export default router;
