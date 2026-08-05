/**
 * /api/admin — super_admin / owner corrective and management operations.
 *
 * POST /api/admin/clear-stale-wage          — fix wage-column contradictions (super_admin only)
 * GET  /api/admin/users                     — list employees with login account status
 * POST /api/admin/users/:employeeId/set-password — admin sets a password (no current password required)
 * GET  /api/admin/stale-8655-uploads        — list companies whose Form 8655 upload is stuck (super_admin only)
 * POST /api/admin/easyteam/register-company — register all unregistered employees for a company in EasyTeam (super_admin only)
 */
import { Router } from "express";
import * as bcrypt from "bcryptjs";
import { db, employees, userAccounts, companySignedForms, companies } from "@workspace/db";
import { eq, and, isNotNull, inArray, isNull } from "drizzle-orm";
import { store } from "../store.js";
import { FORM_8655_STALE_THRESHOLD_MS } from "../lib/form8655-constants.js";
import { registerEmployeeInEasyTeam } from "../lib/easyteam-employee-sync.js";
import { resolveCompanyLocationId } from "../lib/location.js";

const adminRouter = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
function getCaller(req: { session: { userId?: string } }) {
  const userId = req.session?.userId;
  return userId ? store.getUserById(userId) : null;
}

// ── POST /api/admin/clear-stale-wage ─────────────────────────────────────────
adminRouter.post("/admin/clear-stale-wage", async (req, res) => {
  const caller = getCaller(req as Parameters<typeof getCaller>[0]);
  if (!caller || caller.role !== "super_admin") {
    res.status(401).json({ error: "super_admin access required" });
    return;
  }

  const { employeeId } = req.body as { employeeId?: string };
  if (!employeeId || typeof employeeId !== "string") {
    res.status(400).json({ error: "employeeId is required" });
    return;
  }

  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) { res.status(404).json({ error: `Employee not found: ${employeeId}` }); return; }

  const { payType, hourlyWage, annualSalary } = emp;
  const hourlyHasStaleAnnual = payType === "hourly" && annualSalary != null && annualSalary > 0;
  const salaryHasStaleHourly = payType === "salary" && hourlyWage != null && hourlyWage > 0;

  if (!hourlyHasStaleAnnual && !salaryHasStaleHourly) {
    res.status(400).json({
      error: "No contradiction found — pay_type and wage columns are already consistent.",
      employeeId, payType, hourlyWage, annualSalary,
    });
    return;
  }

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

  req.log.info({
    audit: "clear-stale-wage",
    callerUserId: caller.id, callerEmail: caller.email,
    employeeId: emp.id, employeeName: `${emp.firstName} ${emp.lastName}`,
    payType: emp.payType, change: description, ts: new Date().toISOString(),
  }, `[AUDIT] clear-stale-wage: ${caller.email} cleared stale wage for ${emp.firstName} ${emp.lastName}`);

  res.json({
    ok: true, employeeId, change: description,
    employee: {
      id: updated.id, firstName: updated.firstName, lastName: updated.lastName,
      payType: updated.payType, hourlyWage: updated.hourlyWage, annualSalary: updated.annualSalary,
    },
  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Returns all employees alongside their login-account status.
// super_admin: all companies. owner: their company only.
adminRouter.get("/admin/users", async (req, res) => {
  const caller = getCaller(req as Parameters<typeof getCaller>[0]);
  if (!caller || !["super_admin", "owner"].includes(caller.role)) {
    res.status(401).json({ error: "Not authorized" }); return;
  }

  const allEmps = caller.role === "super_admin"
    ? await db.select().from(employees)
    : await db.select().from(employees).where(eq(employees.companyId, caller.companyId));

  const allAccounts = await db.select().from(userAccounts);

  // Index accounts by employeeId AND by email for fallback matching
  const byEmpId  = new Map(allAccounts.filter(a => a.employeeId).map(a => [a.employeeId!, a]));
  const byEmail  = new Map(allAccounts.map(a => [a.email.toLowerCase(), a]));

  const users = allEmps.map(emp => {
    const acct = byEmpId.get(emp.id) ?? byEmail.get(emp.email.toLowerCase());
    return {
      employeeId: emp.id,
      firstName:  emp.firstName,
      lastName:   emp.lastName,
      email:      emp.email,
      position:   emp.position,
      companyId:  emp.companyId,
      status:     emp.status,
      hasAccount: !!acct,
      accountId:  acct?.id  ?? null,
      role:       acct?.role ?? null,
    };
  });

  res.json({ users });
});

// ── POST /api/admin/users/:employeeId/set-password ────────────────────────────
// Resets a user's password without requiring their current password.
// super_admin: any employee. owner: their company only.
adminRouter.post("/admin/users/:employeeId/set-password", async (req, res) => {
  const caller = getCaller(req as Parameters<typeof getCaller>[0]);
  if (!caller || !["super_admin", "owner"].includes(caller.role)) {
    res.status(401).json({ error: "Not authorized" }); return;
  }

  const employeeId = String(req.params.employeeId);
  const { newPassword } = req.body as { newPassword?: string };

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }

  // Fetch employee
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  // Scope guard: owners can only reset within their company
  if (caller.role === "owner" && emp.companyId !== caller.companyId) {
    res.status(403).json({ error: "Not authorized for this employee" }); return;
  }

  // Locate the user account
  const allAccounts = await db.select().from(userAccounts);
  const acct = allAccounts.find(
    a => a.employeeId === employeeId || a.email.toLowerCase() === emp.email.toLowerCase()
  );

  if (!acct) {
    res.status(404).json({
      error: "No login account found for this employee. They may need to complete onboarding first.",
    });
    return;
  }

  // Privilege-escalation guard: owners may only reset employee/manager accounts.
  // They must never be able to overwrite a super_admin's or another owner's password,
  // even if that person's employee record happens to share the same companyId.
  const OWNER_RESETTABLE_ROLES = ["employee", "manager"];
  if (caller.role === "owner" && acct.role && !OWNER_RESETTABLE_ROLES.includes(acct.role)) {
    res.status(403).json({
      error: `You cannot reset the password of a ${acct.role} account.`,
    });
    return;
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  await db.update(userAccounts).set({ password: hashed }).where(eq(userAccounts.id, acct.id));

  // Sync in-memory store so the next login attempt uses the new password
  const rawUser = store.getRawUser(acct.id);
  if (rawUser) rawUser.password = hashed;

  req.log.info({
    audit: "admin-set-password",
    callerUserId:    caller.id,
    callerEmail:     caller.email,
    targetEmployeeId: emp.id,
    targetAccountId:  acct.id,
    targetEmail:      emp.email,
    ts: new Date().toISOString(),
  }, `[AUDIT] admin-set-password: ${caller.email} reset password for ${emp.firstName} ${emp.lastName}`);

  res.json({ ok: true, accountId: acct.id, employeeId: emp.id });
});

// ── GET /api/admin/stale-8655-uploads ────────────────────────────────────────
// Returns all companies whose Form 8655 upload has been pending longer than
// STALE_THRESHOLD_MS. super_admin only.
adminRouter.get("/admin/stale-8655-uploads", async (req, res) => {
  const caller = getCaller(req as Parameters<typeof getCaller>[0]);
  if (!caller || caller.role !== "super_admin") {
    res.status(403).json({ error: "super_admin access required" });
    return;
  }

  try {
    // Pull all pending Form 8655 rows that have an upload attempt timestamp
    const pendingRows = await db
      .select({
        id:               companySignedForms.id,
        companyId:        companySignedForms.companyId,
        signerName:       companySignedForms.signerName,
        uploadAttemptedAt: companySignedForms.uploadAttemptedAt,
        uploadStatus:     companySignedForms.uploadStatus,
      })
      .from(companySignedForms)
      .where(
        and(
          eq(companySignedForms.formType, "8655"),
          eq(companySignedForms.uploadStatus, "pending"),
          isNotNull(companySignedForms.uploadAttemptedAt),
        ),
      );

    // Filter to only rows older than the staleness threshold.
    // The JS guards mirror the DB WHERE clause as a defensive double-check.
    const nowMs = Date.now();
    const staleRows = pendingRows.filter(row => {
      if (row.uploadStatus !== "pending") return false;
      const attemptedAt = row.uploadAttemptedAt;
      if (!attemptedAt) return false;
      return (nowMs - new Date(attemptedAt).getTime()) > FORM_8655_STALE_THRESHOLD_MS;
    });

    if (staleRows.length === 0) {
      res.json({ staleUploads: [], thresholdMs: FORM_8655_STALE_THRESHOLD_MS });
      return;
    }

    // Fetch only the companies that actually appear in the stale rows
    const uniqueCompanyIds = [...new Set(staleRows.map(r => r.companyId))];
    const companyRows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(inArray(companies.id, uniqueCompanyIds));
    const companyNameById = new Map(companyRows.map(c => [c.id, c.name]));

    const staleUploads = staleRows.map(row => ({
      companyId:         row.companyId,
      companyName:       companyNameById.get(row.companyId) ?? row.companyId,
      signerName:        row.signerName,
      uploadAttemptedAt: row.uploadAttemptedAt,
      staleForMs:        nowMs - new Date(row.uploadAttemptedAt!).getTime(),
    }));

    // Sort by most stale first
    staleUploads.sort((a, b) => b.staleForMs - a.staleForMs);

    res.json({ staleUploads, thresholdMs: FORM_8655_STALE_THRESHOLD_MS });
  } catch (err) {
    req.log.error({ err }, "GET /admin/stale-8655-uploads failed");
    res.status(500).json({ error: "Failed to query stale uploads" });
  }
});

// ── POST /api/admin/easyteam/register-company ─────────────────────────────────
// Re-run EasyTeam registration for every employee in a company that has no UUID yet.
// Safe to call multiple times — only processes employees where easyteam_uuid IS NULL.
adminRouter.post("/admin/easyteam/register-company", async (req, res) => {
  const caller = getCaller(req as Parameters<typeof getCaller>[0]);
  if (!caller || caller.role !== "super_admin") {
    res.status(401).json({ error: "super_admin access required" });
    return;
  }

  const { companyId } = req.body as { companyId?: string };
  if (!companyId) {
    res.status(400).json({ error: "companyId is required" });
    return;
  }

  try {
    const locationId = await resolveCompanyLocationId(companyId);
    const unregistered = await db
      .select()
      .from(employees)
      .where(and(eq(employees.companyId, companyId), isNull(employees.easyteamUuid)));

    const results: Array<{ employeeId: string; name: string; success: boolean; easyteamUuid?: string; error?: string }> = [];

    for (const emp of unregistered) {
      const result = await registerEmployeeInEasyTeam(
        {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          email: emp.email,
          roleName: emp.position ?? "Staff",
          wage: (emp.hourlyWage ?? 1500) / 100,
          wageType: "hourly",
        },
        locationId,
        req.log
      );
      results.push({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        success: result.success,
        easyteamUuid: result.easyteamEmployeeId,
        error: result.error,
      });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed    = results.filter((r) => !r.success).length;
    req.log.info({ companyId, locationId, succeeded, failed }, "admin: EasyTeam company registration complete");
    res.json({ companyId, locationId, succeeded, failed, results });
  } catch (err) {
    req.log.error({ err }, "POST /admin/easyteam/register-company failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

export default adminRouter;
