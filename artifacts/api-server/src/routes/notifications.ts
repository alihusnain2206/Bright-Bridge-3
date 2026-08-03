/**
 * GET /notifications
 *
 * Derives notifications live from existing data — no stored notification rows.
 * Company scoping enforced via session user (same pattern as assertCompanyAccess).
 * Role-aware: employee role receives no payroll-related items.
 *
 * Items returned:
 *   RED  — payroll deadline within 48 h, payroll failed
 *   YELLOW — hours awaiting approval, employees blocked from payroll,
 *            compliance expiring within 30 days
 */
import { Router, type Request, type Response, type IRouter } from "express";
import {
  db,
  employees,
  complianceItems,
  timesheetShifts,
  companies as companiesTable,
  companySignedForms,
  rollfiCompanyRecords,
} from "@workspace/db";
import { eq, and, lt, gt, isNotNull, isNull, sql } from "drizzle-orm";
import axios from "axios";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";

const router: IRouter = Router();

export interface NotificationItem {
  id: string;
  level: "red" | "yellow";
  title: string;
  detail: string;
  link?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rollfiHeaders() {
  const { clientId, secretKey } = getRollfiConfig();
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function nowMs() { return Date.now(); }

/** ISO date string → milliseconds */
function toMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

/** Days from now (negative = past) */
function daysFromNow(iso: string): number {
  return (new Date(iso).getTime() - nowMs()) / 86_400_000;
}

// ── Main handler ─────────────────────────────────────────────────────────────

router.get("/notifications", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const user = store.getUserById(userId);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const { companyId, role } = user;
  const isEmployee = role === "employee" || role === "parent";
  const canSeePayroll = !isEmployee; // owner, manager, super_admin

  const items: NotificationItem[] = [];

  // ── 1. Payroll deadline / failed (owner + manager only) ─────────────────
  if (canSeePayroll && companyId) {
    try {
      // Look up the Rollfi company ID for this company
      const [company] = await db
        .select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId));

      const rollfiCompanyId = company?.rollfiCompanyId;

      if (rollfiCompanyId) {
        const cfg = getRollfiConfig();
        if (cfg.credentialsPresent) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);

          try {
            const response = await axios.post(
              `${cfg.baseUrl}/reports#getUnProcessedPayPeriod`,
              { method: "getUnProcessedPayPeriod", companyId: rollfiCompanyId, workerType: "W2" },
              {
                headers: {
                  "Content-Type": "application/json",
                  "client-id": cfg.clientId ?? "",
                  "secret-key": cfg.secretKey ?? "",
                },
                timeout: 4000,
              },
            );

            const raw = response.data as Record<string, unknown>;
            const periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;

            for (const period of periods) {
              const status = String(period.payPeriodStatus ?? "").toLowerCase();

              // Payroll failed
              if (status === "failed") {
                items.push({
                  id: `payroll-failed-${String(period.payPeriodId ?? period.payBeginDate)}`,
                  level: "red",
                  title: "Payroll failed",
                  detail: `Pay period ${String(period.payBeginDate ?? "")} – ${String(period.payEndDate ?? "")} failed to process.`,
                  link: "/manager-payroll?tab=offcycle",
                });
                continue;
              }

              // Payroll deadline within 48h
              const deadlineRaw = period.deadLineToRunPayroll ?? period.deadlineToRunPayroll ?? period.deadline;
              const deadlineMs = toMs(String(deadlineRaw ?? ""));
              if (deadlineMs !== null) {
                const hoursLeft = (deadlineMs - nowMs()) / 3_600_000;
                if (hoursLeft > 0 && hoursLeft <= 48) {
                  const deadlineDate = new Date(deadlineMs);
                  const fmt = deadlineDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  items.push({
                    id: `payroll-deadline-${String(period.payPeriodId ?? period.payBeginDate)}`,
                    level: "red",
                    title: "Payroll deadline approaching",
                    detail: `Submit by ${fmt} at 12:00 PM ET — ${Math.round(hoursLeft)}h left.`,
                    link: "/manager-payroll/submit",
                  });
                }
              }
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      }
    } catch {
      // Rollfi unavailable — skip payroll notifications silently
    }
  }

  // ── 2. Employees blocked from payroll (active but not payroll-ready) ─────
  if (canSeePayroll && companyId) {
    try {
      const blocked = await db
        .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            eq(employees.status, "active"),
            eq(employees.payrollReady, false),
          ),
        );

      if (blocked.length > 0) {
        const names = blocked.slice(0, 3).map(e => `${e.firstName} ${e.lastName}`).join(", ");
        const extra = blocked.length > 3 ? ` +${blocked.length - 3} more` : "";
        items.push({
          id: "blocked-from-payroll",
          level: "yellow",
          title: `${blocked.length} employee${blocked.length > 1 ? "s" : ""} can't be paid`,
          detail: `${names}${extra} — payroll account not yet active in provider.`,
          link: "/people/directory",
        });
      }
    } catch { /* non-fatal */ }
  }

  // ── 3. Hours awaiting approval — unlocked completed shifts in current period ─
  if (companyId) {
    try {
      // Current period: shifts in the last 14 days that are complete but not locked
      const cutoff = new Date(nowMs() - 14 * 86_400_000).toISOString();
      const pendingShifts = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(timesheetShifts)
        .where(
          and(
            eq(timesheetShifts.companyId, companyId),
            eq(timesheetShifts.locked, false),
            eq(timesheetShifts.active, false), // clocked out (not currently clocked in)
            isNotNull(timesheetShifts.utcEndTime),
            isNull(timesheetShifts.deletedAt),
            gt(timesheetShifts.utcStartTime, cutoff),
          ),
        );

      const count = pendingShifts[0]?.count ?? 0;
      if (count > 0) {
        items.push({
          id: "hours-awaiting-approval",
          level: "yellow",
          title: `${count} shift${count > 1 ? "s" : ""} awaiting approval`,
          detail: "Completed shifts from the current period have not been locked yet.",
          link: "/timesheets",
        });
      }
    } catch { /* non-fatal */ }
  }

  // ── 4. Compliance expiring within 30 days ─────────────────────────────────
  if (companyId) {
    try {
      const now = new Date().toISOString().split("T")[0]!;
      const in30 = new Date(nowMs() + 30 * 86_400_000).toISOString().split("T")[0]!;

      const expiring = await db
        .select({ id: complianceItems.id, name: complianceItems.name, expiryDate: complianceItems.expiryDate, employeeId: complianceItems.employeeId })
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.companyId, companyId),
            isNotNull(complianceItems.expiryDate),
            gt(complianceItems.expiryDate, now),    // not yet expired
            lt(complianceItems.expiryDate, in30),   // within 30 days
          ),
        );

      if (expiring.length > 0) {
        // Find the soonest
        const sorted = [...expiring].sort((a, b) =>
          (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""),
        );
        const soonest = sorted[0]!;
        const days = Math.ceil(daysFromNow(soonest.expiryDate!));
        items.push({
          id: "compliance-expiring",
          level: "yellow",
          title: `${expiring.length} compliance item${expiring.length > 1 ? "s" : ""} expiring soon`,
          detail: `${soonest.name} expires in ${days} day${days === 1 ? "" : "s"}.`,
          link: "/people/compliance",
        });
      }
    } catch { /* non-fatal */ }
  }

  // ── 5. Payroll provider tasks + Form 8655 status ─────────────────────────────
  // Fetches ALL open tasks from the payroll provider and surfaces each as a
  // notification. Also shows local upload-failed / pending states for Form 8655
  // (driven from the local DB, always shown regardless of provider reachability).
  if (canSeePayroll && companyId) {
    try {
      // 5a. Local 8655 record — upload-failed / pending shown unconditionally
      const [form8655] = await db
        .select({ uploadStatus: companySignedForms.uploadStatus, uploadError: companySignedForms.uploadError })
        .from(companySignedForms)
        .where(and(eq(companySignedForms.companyId, companyId), eq(companySignedForms.formType, "8655")))
        .limit(1);

      if (form8655?.uploadStatus === "failed") {
        items.push({
          id: "form-8655-upload-failed", level: "red",
          title: "Form 8655 upload to IRS filing service failed",
          detail: form8655.uploadError
            ? `Error: ${form8655.uploadError}. Retry in Company Settings.`
            : "Upload failed. Retry in Company Settings → Signatures.",
          link: "/settings?tab=signatures",
        });
      } else if (form8655?.uploadStatus === "pending") {
        items.push({
          id: "form-8655-upload-pending", level: "yellow",
          title: "Form 8655 upload still pending",
          detail: "The form was signed but hasn't been confirmed by the filing service yet.",
          link: "/settings?tab=signatures",
        });
      }

      // 5b. Resolve rollfiCompanyId (companies table → rollfi_company_records fallback)
      const [coDB] = await db
        .select({ rollfiCompanyId: companiesTable.rollfiCompanyId })
        .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      let rid: string | null = coDB?.rollfiCompanyId ?? null;
      if (!rid) {
        const [rcr] = await db
          .select({ rollfiCompanyId: rollfiCompanyRecords.rollfiCompanyId })
          .from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, companyId)).limit(1);
        rid = rcr?.rollfiCompanyId ?? null;
      }

      // 5c. Fetch all open tasks from the payroll provider and map to notifications
      if (rid) {
        const cfg = getRollfiConfig();
        if (cfg.credentialsPresent) {
          const tr = await axios.post(
            `${cfg.baseUrl}/reports#getCompanyTask`,
            { method: "getCompanyTask", companyId: rid },
            { headers: rollfiHeaders(), timeout: 5000 },
          );
          const tasks = ((tr.data as Record<string, unknown>).tasks ?? []) as Array<{ task: string; description?: string }>;

          for (const t of tasks) {
            const taskStr = `${t.task} ${t.description ?? ""}`;

            if (/8655/i.test(taskStr)) {
              // Only show if not already signed+uploaded through BrightBridge
              if (!form8655 || form8655.uploadStatus !== "uploaded") {
                items.push({
                  id: "form-8655-unsigned", level: "red",
                  title: "IRS Form 8655 needs your signature",
                  detail: "Required before payroll can run. Sign it in Company Settings.",
                  link: "/settings?tab=signatures",
                });
              }
            } else if (/TR-?2000/i.test(taskStr)) {
              items.push({
                id: "form-tr2000-signature", level: "yellow",
                title: "Form TR-2000 signature required",
                detail: t.description ?? "Required to file and pay taxes on your behalf. Sign it in Company Settings.",
                link: "/settings?tab=signatures",
              });
            } else if (/state.*tax|state.*reg|registration.*detail/i.test(taskStr)) {
              // Extract two-letter state code from description if present ("for NJ", "Details for NJ")
              const stateMatch = taskStr.match(/\bfor\s+([A-Z]{2})\b/);
              const stateLabel = stateMatch ? ` for ${stateMatch[1]}` : "";
              items.push({
                id: `payroll-state-reg${stateMatch ? `-${stateMatch[1]}` : ""}`,
                level: "yellow",
                title: `Complete state tax registration${stateLabel}`,
                detail: t.description ?? "A state payroll tax registration is pending in your payroll account.",
                link: "/settings/state-tax",
              });
            } else {
              // Generic payroll provider task
              const safeId = `payroll-task-${t.task.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40)}`;
              items.push({
                id: safeId, level: "yellow",
                title: t.task,
                detail: t.description ?? "Action required in your payroll account.",
              });
            }
          }

          // If Rollfi is reachable but doesn't list 8655, it's not required — nothing to do.
        }
      } else if (!form8655) {
        // No rollfiCompanyId and no local 8655 record — can't check, show conservative warning
        items.push({
          id: "form-8655-unsigned", level: "red",
          title: "IRS Form 8655 needs your signature",
          detail: "Required before payroll can run. Sign it in Company Settings.",
          link: "/settings?tab=signatures",
        });
      }
    } catch { /* non-fatal — skip payroll task notifications if provider unreachable */ }
  }

  // Sort: red items first, then yellow
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));

  const redCount = items.filter(i => i.level === "red").length;

  res.json({ items, redCount });
});

export default router;
