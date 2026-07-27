/**
 * GET /search?q=<query>
 *
 * Company scoping is enforced server-side:
 *   - super_admin: searches across all companies (no WHERE companyId filter)
 *   - owner / manager / employee: WHERE companyId = user.companyId
 *
 * The companyId is never taken from the query string — it is always read from
 * the session user record (store.getUserById), so a client cannot widen scope
 * by passing a different companyId.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import {
  db,
  employees,
  employeeDocuments,
  onboardingTasks,
  companies,
} from "@workspace/db";
import { ilike, or, and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";

const router: IRouter = Router();

const MAX_PER_GROUP = 5;

router.get("/search", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json({ employees: [], documents: [], tasks: [], companies: [] });
    return;
  }

  const pattern = `%${q}%`;
  const isSuperAdmin = user.role === "super_admin";
  const companyId = user.companyId;

  // ── Employees ────────────────────────────────────────────────────────────
  const empSearch = or(
    ilike(employees.firstName, pattern),
    ilike(employees.lastName, pattern),
    ilike(employees.email, pattern),
    ilike(employees.position, pattern),
    ilike(employees.employeeDisplayId, pattern),
    ilike(employees.jobTitle, pattern),
    sql`CONCAT(${employees.firstName}, ' ', ${employees.lastName}) ILIKE ${pattern}`,
  )!;

  const empWhere = isSuperAdmin ? empSearch : and(empSearch, eq(employees.companyId, companyId));

  const empRows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      position: employees.position,
      jobTitle: employees.jobTitle,
      employeeDisplayId: employees.employeeDisplayId,
      companyId: employees.companyId,
      status: employees.status,
    })
    .from(employees)
    .where(empWhere)
    .limit(MAX_PER_GROUP);

  // ── Documents ─────────────────────────────────────────────────────────────
  const docSearch = or(
    ilike(employeeDocuments.documentName, pattern),
    ilike(employeeDocuments.documentType, pattern),
    ilike(employeeDocuments.customTypeName, pattern),
  )!;

  const docWhere = isSuperAdmin ? docSearch : and(docSearch, eq(employeeDocuments.companyId, companyId));

  const docRows = await db
    .select({
      id: employeeDocuments.id,
      documentName: employeeDocuments.documentName,
      documentType: employeeDocuments.documentType,
      employeeId: employeeDocuments.employeeId,
      companyId: employeeDocuments.companyId,
      status: employeeDocuments.status,
    })
    .from(employeeDocuments)
    .where(docWhere)
    .limit(MAX_PER_GROUP);

  // Enrich documents with employee names
  const docEmployeeIds = [...new Set(docRows.map(d => d.employeeId))];
  let docEmployeeMap: Record<string, string> = {};
  if (docEmployeeIds.length > 0) {
    const empLookup = await db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(sql`${employees.id} = ANY(${docEmployeeIds})`);
    docEmployeeMap = Object.fromEntries(empLookup.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
  }

  const docResults = docRows.map(d => ({
    ...d,
    employeeName: docEmployeeMap[d.employeeId] ?? "",
  }));

  // ── Onboarding Tasks ───────────────────────────────────────────────────────
  const taskSearch = ilike(onboardingTasks.taskName, pattern)!;
  const taskWhere = isSuperAdmin ? taskSearch : and(taskSearch, eq(onboardingTasks.companyId, companyId));

  const taskRows = await db
    .select({
      id: onboardingTasks.id,
      taskName: onboardingTasks.taskName,
      status: onboardingTasks.status,
      employeeId: onboardingTasks.employeeId,
      companyId: onboardingTasks.companyId,
      category: onboardingTasks.category,
    })
    .from(onboardingTasks)
    .where(taskWhere)
    .limit(MAX_PER_GROUP);

  // Enrich tasks with employee names
  const taskEmployeeIds = [...new Set(taskRows.map(t => t.employeeId))];
  let taskEmployeeMap: Record<string, string> = {};
  if (taskEmployeeIds.length > 0) {
    const empLookup2 = await db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(sql`${employees.id} = ANY(${taskEmployeeIds})`);
    taskEmployeeMap = Object.fromEntries(empLookup2.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
  }

  const taskResults = taskRows.map(t => ({
    ...t,
    employeeName: taskEmployeeMap[t.employeeId] ?? "",
  }));

  // ── Companies (super_admin only) ───────────────────────────────────────────
  let companyResults: Array<{ id: string; name: string; status: string }> = [];
  if (isSuperAdmin) {
    const companySearch = or(
      ilike(companies.name, pattern),
      ilike(companies.id, pattern),
    )!;
    const compRows = await db
      .select({ id: companies.id, name: companies.name, status: companies.status })
      .from(companies)
      .where(companySearch)
      .limit(MAX_PER_GROUP);
    companyResults = compRows;
  }

  res.json({
    employees: empRows,
    documents: docResults,
    tasks: taskResults,
    companies: companyResults,
  });
});

export default router;
