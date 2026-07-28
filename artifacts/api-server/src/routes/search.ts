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
 *
 * Fuzzy fallback:
 *   When the exact ILIKE search returns no employees we try two strategies in order:
 *   1. pg_trgm similarity (if the extension is available)
 *   2. Token-split ILIKE — search each word in the query independently
 *   Results are returned in a `suggestions` array so the frontend can render
 *   "Did you mean …?" without mixing them with exact matches.
 */
import { Router, type Request, type Response, type IRouter } from "express";
import {
  db,
  employees,
  employeeDocuments,
  onboardingTasks,
  companies,
} from "@workspace/db";
import { ilike, or, and, eq, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";

const router: IRouter = Router();

const MAX_PER_GROUP = 5;

// Try to enable pg_trgm once at startup. Failure is silent — we fall back to
// token-split search instead.
let trgmAvailable: boolean | null = null;
async function ensureTrgm(): Promise<boolean> {
  if (trgmAvailable !== null) return trgmAvailable;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    trgmAvailable = true;
  } catch {
    trgmAvailable = false;
  }
  return trgmAvailable;
}

interface EmpSuggestion {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  position: string | null;
  employeeDisplayId: string | null;
  companyId: string;
  status: string;
}

router.get("/search", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json({ employees: [], documents: [], tasks: [], companies: [], suggestions: [] });
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
      .where(inArray(employees.id, docEmployeeIds));
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
      .where(inArray(employees.id, taskEmployeeIds));
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

  // ── Fuzzy suggestions (only when exact search found no employees) ──────────
  let suggestions: EmpSuggestion[] = [];

  if (empRows.length === 0 && q.length >= 3) {
    const scopeFilter = isSuperAdmin
      ? sql`TRUE`
      : sql`company_id = ${companyId}`;

    const trgm = await ensureTrgm();

    if (trgm) {
      // pg_trgm path — similarity over full name
      try {
        const fuzzyRows = await db.execute<{
          id: string; first_name: string; last_name: string;
          job_title: string | null; position: string | null;
          employee_display_id: string | null; company_id: string; status: string;
        }>(sql`
          SELECT id, first_name, last_name, job_title, position,
                 employee_display_id, company_id, status
          FROM employees
          WHERE ${scopeFilter}
            AND (
              similarity(CONCAT(first_name, ' ', last_name), ${q}) > 0.15
              OR similarity(first_name, ${q}) > 0.25
              OR similarity(last_name,  ${q}) > 0.25
            )
          ORDER BY similarity(CONCAT(first_name, ' ', last_name), ${q}) DESC
          LIMIT 3
        `);
        suggestions = fuzzyRows.rows.map(r => ({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          jobTitle: r.job_title,
          position: r.position,
          employeeDisplayId: r.employee_display_id,
          companyId: r.company_id,
          status: r.status,
        }));
      } catch {
        trgmAvailable = false; // extension present but query failed — fall through
      }
    }

    // Token-split fallback — each word in the query searched independently
    if (!trgm || suggestions.length === 0) {
      const tokens = q.split(/\s+/).filter(t => t.length >= 2);
      if (tokens.length > 0) {
        const tokenConditions = tokens.map(tok => {
          const tp = `%${tok}%`;
          return or(
            ilike(employees.firstName, tp),
            ilike(employees.lastName, tp),
            sql`CONCAT(${employees.firstName}, ' ', ${employees.lastName}) ILIKE ${tp}`,
          )!;
        });
        const tokenSearch = or(...tokenConditions)!;
        const tokenWhere = isSuperAdmin
          ? tokenSearch
          : and(tokenSearch, eq(employees.companyId, companyId));

        const tokenRows = await db
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
          .where(tokenWhere)
          .limit(3);

        suggestions = tokenRows;
      }
    }
  }

  res.json({
    employees: empRows,
    documents: docResults,
    tasks: taskResults,
    companies: companyResults,
    suggestions,
  });
});

export default router;
