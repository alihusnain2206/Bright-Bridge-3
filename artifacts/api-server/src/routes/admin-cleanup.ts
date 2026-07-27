/**
 * ONE-TIME cleanup endpoint — removes the 4 duplicate ORG-BRIGHTBRIDGE
 * employee rows created by an accidental second import run.
 *
 * DELETE this file after the single use; never re-deploy.
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

// Hard-coded duplicate IDs — the ONLY rows this endpoint can ever touch.
const DUPLICATE_IDS = [
  "EMP-MS3JQD3D-8UFKD1",
  "EMP-MS3JQD3E-5ROJ6P",
  "EMP-MS3JQD3E-1OHIG5",
  "EMP-MS3JQD3E-DNZTMP",
] as const;

const REQUIRED_CONFIRM = "DELETE_DUPLICATE_EMPLOYEES";

router.post("/admin/cleanup-duplicate-employees", async (req: Request, res: Response) => {
  // ── Guard 1: bearer token ────────────────────────────────────────────────
  const secret = process.env.IMPORT_ADMIN_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "IMPORT_ADMIN_SECRET not configured" });
  }
  const authHeader = req.headers.authorization ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  // ── Guard 2: explicit confirmation flag — wrong/missing → 400, nothing deleted
  const { confirm } = req.body ?? {};
  if (confirm !== REQUIRED_CONFIRM) {
    return res.status(400).json({
      ok: false,
      error: `Body must contain { "confirm": "${REQUIRED_CONFIRM}" }. Got: ${JSON.stringify(confirm)}`,
    });
  }

  // ── Pre-flight SELECT (outside transaction) — abort if count ≠ 4 ─────────
  const foundEmployees = await db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(inArray(employees.id, [...DUPLICATE_IDS]));

  if (foundEmployees.length !== 4) {
    return res.status(409).json({
      ok: false,
      error: `Pre-flight failed: expected 4 duplicate employee rows, found ${foundEmployees.length}. Nothing deleted.`,
      found: foundEmployees,
    });
  }

  // Pre-flight counts (preview — also outside transaction)
  const [palCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(peopleActivityLogTable)
    .where(and(
      eq(peopleActivityLogTable.companyId, "ORG-BRIGHTBRIDGE"),
      inArray(peopleActivityLogTable.employeeId, [...DUPLICATE_IDS])
    ));

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

  // ── Transactional deletes — strictly sequential, children before employees.
  // Any failure rolls back the entire transaction; no orphaned rows.
  const deleted = await db.transaction(async (tx) => {
    // 1. people_activity_log
    const palDel = await tx
      .delete(peopleActivityLogTable)
      .where(and(
        eq(peopleActivityLogTable.companyId, "ORG-BRIGHTBRIDGE"),
        inArray(peopleActivityLogTable.employeeId, [...DUPLICATE_IDS])
      ))
      .returning({ id: peopleActivityLogTable.id });

    // 2. onboarding_tasks
    const tasksDel = await tx
      .delete(onboardingTasksTable)
      .where(inArray(onboardingTasksTable.employeeId, [...DUPLICATE_IDS]))
      .returning({ id: onboardingTasksTable.id });

    // 3. compliance_items
    const compDel = await tx
      .delete(complianceItemsTable)
      .where(inArray(complianceItemsTable.employeeId, [...DUPLICATE_IDS]))
      .returning({ id: complianceItemsTable.id });

    // 4. rollfi_employee_records
    const rollfiDel = await tx
      .delete(rollfiEmployeeRecords)
      .where(inArray(rollfiEmployeeRecords.employeeId, [...DUPLICATE_IDS]))
      .returning({ employeeId: rollfiEmployeeRecords.employeeId });

    // 5. user_accounts
    const uaDel = await tx
      .delete(userAccounts)
      .where(inArray(userAccounts.employeeId, [...DUPLICATE_IDS]))
      .returning({ id: userAccounts.id });

    // 6. employees — last, after all children are gone
    const empDel = await tx
      .delete(employees)
      .where(inArray(employees.id, [...DUPLICATE_IDS]))
      .returning({ id: employees.id });

    return {
      people_activity_log:     palDel.length,
      onboarding_tasks:        tasksDel.length,
      compliance_items:        compDel.length,
      rollfi_employee_records: rollfiDel.length,
      user_accounts:           uaDel.length,
      employees:               empDel.length,
    };
  });

  return res.json({
    ok: true,
    message: "Duplicate employee rows deleted successfully.",
    preview: {
      employees:               foundEmployees.length,
      people_activity_log:     palCount?.count ?? 0,
      onboarding_tasks:        taskCount?.count ?? 0,
      compliance_items:        compCount?.count ?? 0,
      rollfi_employee_records: rollfiCount?.count ?? 0,
      user_accounts:           uaCount?.count ?? 0,
    },
    deleted,
    duplicateIds: DUPLICATE_IDS,
  });
});

export default router;
