/**
 * /api/admin — super_admin-only corrective operations.
 *
 * These routes fix data contradictions that cannot be handled through the normal
 * edit path without triggering unintended provider side-effects. They are NOT a
 * general-purpose wage editor: they correct DB state only, never touch Rollfi.
 */
import { Router } from "express";
import { db, employees } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store } from "../store.js";

const adminRouter = Router();

// ── POST /api/admin/clear-stale-wage ─────────────────────────────────────────
//
// Clears the contradictory wage column when pay_type and the stored values are
// out of sync (e.g. an employee is "hourly" but still has a non-zero annual_salary
// from a previous salary record, or is "salary" but still has a non-zero hourly_wage).
//
// Constraints:
//  • super_admin only.
//  • Body: { employeeId: string } — no wage values accepted.
//  • Only fixes contradictions; refuses if the DB is already consistent.
//  • Never calls Rollfi or any external provider.
//  • Every use is logged: caller, employee, field changed, before/after, timestamp.
//
adminRouter.post("/api/admin/clear-stale-wage", async (req, res) => {
  // ── Auth: super_admin only ───────────────────────────────────────────────
  const session = req.session as { userId?: string };
  const caller  = session?.userId ? store.getUserById(session.userId) : null;
  if (!caller || caller.role !== "super_admin") {
    res.status(401).json({ error: "super_admin access required" });
    return;
  }

  const { employeeId } = req.body as { employeeId?: string };
  if (!employeeId || typeof employeeId !== "string") {
    res.status(400).json({ error: "employeeId is required" });
    return;
  }

  // ── Fetch employee ───────────────────────────────────────────────────────
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) {
    res.status(404).json({ error: `Employee not found: ${employeeId}` });
    return;
  }

  const { payType, hourlyWage, annualSalary } = emp;

  // ── Detect contradiction ─────────────────────────────────────────────────
  const hourlyHasStaleAnnual  = payType === "hourly"  && annualSalary != null && annualSalary > 0;
  const salaryHasStaleHourly  = payType === "salary"  && hourlyWage   != null && hourlyWage  > 0;

  if (!hourlyHasStaleAnnual && !salaryHasStaleHourly) {
    res.status(400).json({
      error: "No contradiction found — pay_type and wage columns are already consistent.",
      employeeId,
      payType,
      hourlyWage,
      annualSalary,
    });
    return;
  }

  // ── Apply correction (DB only, no provider call) ─────────────────────────
  let update: Partial<typeof emp>;
  let description: string;

  if (hourlyHasStaleAnnual) {
    update      = { annualSalary: null };
    description = `annual_salary ${annualSalary} → null  (pay_type is "hourly"; stale salary cleared)`;
  } else {
    update      = { hourlyWage: 0 };
    description = `hourly_wage ${hourlyWage} → 0  (pay_type is "salary"; stale hourly rate cleared)`;
  }

  await db.update(employees).set(update).where(eq(employees.id, employeeId));

  const [updated] = await db.select().from(employees).where(eq(employees.id, employeeId));

  // ── Audit log ────────────────────────────────────────────────────────────
  req.log.info({
    audit: "clear-stale-wage",
    callerUserId:   caller.id,
    callerEmail:    caller.email,
    employeeId:     emp.id,
    employeeName:   `${emp.firstName} ${emp.lastName}`,
    payType:        emp.payType,
    change:         description,
    ts:             new Date().toISOString(),
  }, `[AUDIT] clear-stale-wage: ${caller.email} cleared stale wage for ${emp.firstName} ${emp.lastName}`);

  res.json({
    ok: true,
    employeeId,
    change: description,
    employee: {
      id:            updated.id,
      firstName:     updated.firstName,
      lastName:      updated.lastName,
      payType:       updated.payType,
      hourlyWage:    updated.hourlyWage,
      annualSalary:  updated.annualSalary,
    },
  });
});

export default adminRouter;
