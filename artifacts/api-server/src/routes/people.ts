import { Router, type Request, type Response, type IRouter } from "express";
import {
  db, companies, employees,
  rollfiCompanyRecords, rollfiEmployeeRecords,
  onboardingTasks as onboardingTasksTable,
  complianceItems as complianceItemsTable,
  employeeDocuments as employeeDocumentsTable,
  emergencyContacts as emergencyContactsTable,
  peopleActivityLog as peopleActivityLogTable,
  taskNotes as taskNotesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { store, type Department } from "../store.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";

const ROLLFI_BASE_URL  = process.env.ROLLFI_BASE_URL  ?? "https://sandbox.rollfi.xyz";
const ROLLFI_CLIENT_ID = process.env.ROLLFI_CLIENT_ID;
const ROLLFI_SECRET_KEY = process.env.ROLLFI_SECRET_KEY;
function rollfiHeaders() {
  const encoded = Buffer.from(`${ROLLFI_CLIENT_ID ?? ""}:${ROLLFI_SECRET_KEY ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)) cb(null, true);
    else cb(null, false);
  },
});

const router: IRouter = Router();

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function nowIso() { return new Date().toISOString(); }
function addDays(dateStr: string | undefined, days: number): string {
  const base = dateStr ? new Date(dateStr) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split("T")[0]!;
}

// ─── DB ROW TYPES ─────────────────────────────────────────────

type TaskRow       = typeof onboardingTasksTable.$inferSelect;
type CompRow       = typeof complianceItemsTable.$inferSelect;
type DocRow        = typeof employeeDocumentsTable.$inferSelect;
type ContactRow    = typeof emergencyContactsTable.$inferSelect;

// ─── ONBOARDING TASK TEMPLATES ────────────────────────────────

type TaskTemplate = {
  taskName: string;
  category: string;
  stage: string;
  assignedToRole: string;
  dueDaysAfterHire: number;
  isRequired: boolean;
};

const STANDARD_HR_PAYROLL_TASKS: TaskTemplate[] = [
  { taskName: "Complete Personal Information",      category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Emergency Contact",                  category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Federal W-4",                        category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "State Tax Form",                     category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "I-9 Section 1",                      category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "I-9 Section 2 Verification",         category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Direct Deposit Setup",               category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Employee Handbook Acknowledgment",   category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Company Policy Acknowledgment",      category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Confidentiality/NDA",               category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: false },
  { taskName: "Code of Conduct Acknowledgment",     category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "IT Acceptable Use Policy",           category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Benefit Enrollment",                 category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Retirement Plan Enrollment",         category: "hr_payroll", stage: "preboarding",    assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Assign Pay Schedule",                category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Department",                  category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Manager",                     category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Job Title",                   category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Work Location",               category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Issue Employee ID",                  category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Time & Attendance Profile",   category: "hr_payroll", stage: "preboarding",    assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Upload Required Documents",          category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "E-Sign All Required Forms",          category: "hr_payroll", stage: "documents",      assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
];

const MANAGER_TASKS: TaskTemplate[] = [
  { taskName: "Schedule Orientation",     category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Schedule First Day Meeting", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Mentor/Buddy",      category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 3,  isRequired: false },
  { taskName: "Assign Training Plan",     category: "manager", stage: "training",      assignedToRole: "manager", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Assign Learning Courses",  category: "manager", stage: "training",      assignedToRole: "manager", dueDaysAfterHire: 7,  isRequired: false },
  { taskName: "Set 30/60/90 Day Goals",   category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Schedule 30-Day Review",   category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "Schedule 60-Day Review",   category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 60, isRequired: true  },
  { taskName: "Schedule 90-Day Review",   category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 90, isRequired: true  },
];

const IT_TASKS: TaskTemplate[] = [
  { taskName: "Create Company Email",         category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Create System Login",          category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: true  },
  { taskName: "Assign Software Access",       category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Assign Security Roles",        category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: true  },
  { taskName: "Enable MFA",                   category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 3, isRequired: false },
  { taskName: "Issue Laptop/Desktop",         category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Issue Phone",                  category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Issue Key Card/Badge",         category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Assign Equipment",             category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Collect Equipment Signature",  category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 3, isRequired: false },
];

const COMPLIANCE_TASKS: TaskTemplate[] = [
  { taskName: "Background Check",                       category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Drug Screening",                         category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 7,  isRequired: false },
  { taskName: "Employment Eligibility Verification",    category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Professional License Verification",      category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Driver's License Verification",          category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Certification Uploads",                  category: "compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Work Authorization Expiration Tracking", category: "compliance", stage: "compliance", assignedToRole: "hr",       dueDaysAfterHire: 7,  isRequired: false },
];

const DAYCARE_COMPLIANCE_TASKS: TaskTemplate[] = [
  { taskName: "Fingerprint Clearance",             category: "daycare_compliance", stage: "compliance",    assignedToRole: "hr",       dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "State Central Registry Verification", category: "daycare_compliance", stage: "compliance",  assignedToRole: "hr",       dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Child Abuse Training",              category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "Health & Safety Training",          category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "CPR Certification",                 category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "First Aid Certification",           category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "Medication Administration Training", category: "daycare_compliance", stage: "training",     assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "Physical Examination",              category: "daycare_compliance", stage: "compliance",    assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "TB Test",                           category: "daycare_compliance", stage: "compliance",    assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "Immunization Records",              category: "daycare_compliance", stage: "compliance",    assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "Identification Upload",             category: "daycare_compliance", stage: "documents",     assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Education Verification",            category: "daycare_compliance", stage: "compliance",    assignedToRole: "hr",       dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "Professional References",           category: "daycare_compliance", stage: "compliance",    assignedToRole: "hr",       dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "Staff Health Statement",            category: "daycare_compliance", stage: "compliance",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Mandated Reporter Training",        category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true  },
  { taskName: "OCFS Training Hours",               category: "daycare_compliance", stage: "training",      assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "Group Assignment",                  category: "daycare_compliance", stage: "manager_tasks", assignedToRole: "manager",  dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Classroom Assignment",              category: "daycare_compliance", stage: "manager_tasks", assignedToRole: "manager",  dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Ratio Verification",                category: "daycare_compliance", stage: "compliance",    assignedToRole: "manager",  dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Staff File Completion",             category: "daycare_compliance", stage: "ready_to_start", assignedToRole: "hr",      dueDaysAfterHire: 14, isRequired: true  },
];

// ─── HELPER: DISPLAY ID ───────────────────────────────────────

export function generateDisplayIdFromExisting(existingIds: string[]): string {
  const nums = existingIds
    .filter(Boolean)
    .map((id) => parseInt(id.replace("E", ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 1000;
  return `E${max + 1}`;
}

// ─── HELPER: CREATE ONBOARDING TASKS ─────────────────────────

export async function createOnboardingTasksInDb(
  employeeId: string,
  companyId: string,
  startDate: string,
  isDaycare: boolean,
  managerUserId?: string,
  adminUserId?: string,
): Promise<void> {
  const now = nowIso();
  let template: TaskTemplate[] = [
    ...STANDARD_HR_PAYROLL_TASKS,
    ...MANAGER_TASKS,
    ...IT_TASKS,
    ...COMPLIANCE_TASKS,
  ];
  if (isDaycare) template = [...template, ...DAYCARE_COMPLIANCE_TASKS];

  const rows = template.map((t) => {
    let assignedToUserId: string | undefined;
    if (t.assignedToRole === "employee") assignedToUserId = employeeId;
    else if (t.assignedToRole === "manager") assignedToUserId = managerUserId;
    else if (["hr", "admin", "it"].includes(t.assignedToRole)) assignedToUserId = adminUserId;

    return {
      id: `task-${uid()}`,
      employeeId,
      companyId,
      taskName: t.taskName,
      category: t.category,
      stage: t.stage,
      assignedToRole: t.assignedToRole,
      assignedToUserId: assignedToUserId ?? null,
      status: "pending",
      isRequired: t.isRequired,
      dueDaysAfterHire: t.dueDaysAfterHire,
      dueDate: addDays(startDate, t.dueDaysAfterHire),
      autoGenerated: true,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Insert in chunks of 50 to avoid large param lists
  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(onboardingTasksTable).values(rows.slice(i, i + 50));
  }
}

// ─── HELPER: CREATE COMPLIANCE ITEMS ─────────────────────────

export async function createComplianceItemsInDb(
  employeeId: string,
  companyId: string,
  isDaycare: boolean,
  flags?: { w4Submitted?: boolean; bankAccountAdded?: boolean; kycStatus?: string | null },
): Promise<void> {
  const now = nowIso();

  const mk = (type: string, name: string, isRequired: boolean, preCompleted = false) => ({
    id: `ci-${uid()}`,
    employeeId,
    companyId,
    type,
    name,
    status: preCompleted ? "completed" : "not_started",
    isRequired,
    completedAt: preCompleted ? now : null,
    createdAt: now,
    updatedAt: now,
  });

  const items = [
    mk("i9",               "I-9 Employment Eligibility",          true,  flags?.kycStatus === "verified"),
    mk("w4",               "Federal W-4",                          true,  flags?.w4Submitted ?? false),
    mk("state_w4",         "State Tax Form",                        true),
    mk("direct_deposit",   "Direct Deposit",                        true,  flags?.bankAccountAdded ?? false),
    mk("background_check", "Background Check",                      true),
    mk("handbook",         "Employee Handbook Acknowledgment",      true),
    mk("policy",           "Company Policies Acknowledgment",       true),
  ];

  if (isDaycare) {
    items.push(
      mk("fingerprint",   "Fingerprint Clearance",     true),
      mk("certification", "CPR Certification",          true),
      mk("certification", "First Aid Certification",    true),
      mk("training",      "TB Test",                    true),
      mk("training",      "Physical Examination",       true),
      mk("training",      "Child Abuse Training",       true),
      mk("training",      "Mandated Reporter Training", true),
    );
  }

  await db.insert(complianceItemsTable).values(items);
}

// ─── HELPER: COMPLIANCE SCORE ─────────────────────────────────

export async function calculateComplianceScore(employeeId: string): Promise<number> {
  const items = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.employeeId, employeeId));
  const required = items.filter((i) => i.isRequired);
  if (required.length === 0) return 100;
  const completed = required.filter((i) => i.status === "completed");
  return Math.round((completed.length / required.length) * 100);
}

export async function calculateReadinessFlags(employeeId: string) {
  const items = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.employeeId, employeeId));
  const done = (type: string) => items.some((i) => i.type === type && i.status === "completed");
  const payrollReady   = done("w4") && done("direct_deposit");
  const hrReady        = done("i9") && done("handbook") && done("policy");
  const complianceReady = done("background_check");
  const firstPayrollReady = payrollReady && hrReady;
  return { payrollReady, hrReady, complianceReady, firstPayrollReady };
}

// ─── HELPER: LOG ACTIVITY ─────────────────────────────────────

export async function logPeopleActivity(params: {
  companyId: string; employeeId?: string; action: string;
  description: string; category: string; performedBy: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(peopleActivityLogTable).values({
    id: `pal-${uid()}`,
    companyId: params.companyId,
    employeeId: params.employeeId ?? null,
    action: params.action,
    description: params.description,
    category: params.category,
    performedBy: params.performedBy,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    timestamp: nowIso(),
  });
}

// ─── DEFAULT DEPARTMENTS (in-memory — small, static) ─────────

const STANDARD_DEPTS = ["Operations","Finance","Human Resources","Sales","Marketing","IT","Customer Service","Administration"];
const DAYCARE_DEPTS  = ["Infant Room","Toddler Room","Preschool","Pre-K","Kitchen","Front Desk"];

export function seedDepartmentsForCompany(companyId: string, isDaycare: boolean): void {
  if (store.hasDepartmentsForCompany(companyId)) return;
  const now = nowIso();
  for (const name of STANDARD_DEPTS) {
    store.addDepartment({ id: `dept-${uid()}`, companyId, name, type: "standard", isDefault: true, isActive: true, createdAt: now });
  }
  if (isDaycare) {
    for (const name of DAYCARE_DEPTS) {
      store.addDepartment({ id: `dept-${uid()}`, companyId, name, type: "daycare", isDefault: true, isActive: true, createdAt: now });
    }
  }
}

// ─── STARTUP BACKFILL ─────────────────────────────────────────

export async function backfillEmployeeScores(): Promise<void> {
  const allEmployees = await db.select({
    id: employees.id,
    complianceScore: employees.complianceScore,
    onboardingProgress: employees.onboardingProgress,
    bankAccountAdded: employees.bankAccountAdded,
    w4Submitted: employees.w4Submitted,
    homeState: employees.homeState,
    easyteamSynced: employees.easyteamSynced,
  }).from(employees);

  let updatedScores = 0;
  let autoCompletedTasks = 0;

  for (const emp of allEmployees) {
    // ── Step 1: Auto-complete tasks whose data is already on the employee row ──
    // This catches employees created before the wizard auto-completion fix was deployed.
    const pendingTasks = await db.select({
      id: onboardingTasksTable.id,
      taskName: onboardingTasksTable.taskName,
      status: onboardingTasksTable.status,
    }).from(onboardingTasksTable)
      .where(eq(onboardingTasksTable.employeeId, emp.id));

    const seedNow = nowIso();
    const completeTask = async (name: string) => {
      const task = pendingTasks.find(t => t.taskName === name && t.status === "pending");
      if (!task) return;
      await db.update(onboardingTasksTable)
        .set({ status: "completed", completedAt: seedNow, completedBy: "system", completionMethod: "auto", completionNote: "Auto-completed: collected during employee creation wizard", updatedAt: seedNow } as Record<string, unknown>)
        .where(eq(onboardingTasksTable.id, task.id));
      autoCompletedTasks++;
    };

    // Always auto-complete tasks whose data is satisfied at wizard creation time
    await completeTask("Complete Personal Information");
    await completeTask("Assign Pay Schedule");
    await completeTask("Create System Login");
    if (emp.easyteamSynced) await completeTask("Assign Time & Attendance Profile");
    if (emp.bankAccountAdded) await completeTask("Direct Deposit Setup");
    if (emp.w4Submitted)      await completeTask("Federal W-4");
    if (emp.w4Submitted && emp.homeState) await completeTask("State Tax Form");

    // Also fix compliance items to match
    if (emp.bankAccountAdded) {
      await db.update(complianceItemsTable)
        .set({ status: "completed", completedAt: seedNow, updatedAt: seedNow })
        .where(and(eq(complianceItemsTable.employeeId, emp.id), eq(complianceItemsTable.type, "direct_deposit")));
    }
    if (emp.w4Submitted) {
      await db.update(complianceItemsTable)
        .set({ status: "completed", completedAt: seedNow, updatedAt: seedNow })
        .where(and(eq(complianceItemsTable.employeeId, emp.id), eq(complianceItemsTable.type, "w4")));
    }
    if (emp.w4Submitted && emp.homeState) {
      await db.update(complianceItemsTable)
        .set({ status: "completed", completedAt: seedNow, updatedAt: seedNow })
        .where(and(eq(complianceItemsTable.employeeId, emp.id), eq(complianceItemsTable.type, "state_w4")));
    }

    // ── Step 2: Recalculate scores for employees with stale (0) scores ──
    const [taskRows, complianceRows] = await Promise.all([
      db.select({ status: onboardingTasksTable.status }).from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, emp.id)),
      db.select({ id: complianceItemsTable.id }).from(complianceItemsTable).where(eq(complianceItemsTable.employeeId, emp.id)),
    ]);

    if (taskRows.length === 0 && complianceRows.length === 0) continue;

    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    let needsUpdate = false;

    if (taskRows.length > 0) {
      const prog = Math.round(taskRows.filter(t => t.status === "completed" || t.status === "skipped").length / taskRows.length * 100);
      // Always recalculate progress (may have changed from step 1 above)
      updates.onboardingProgress = prog;
      needsUpdate = true;
    }

    if (complianceRows.length > 0) {
      const score = await calculateComplianceScore(emp.id);
      const flags = await calculateReadinessFlags(emp.id);
      updates.complianceScore = score;
      updates.payrollReady = flags.payrollReady;
      updates.hrReady = flags.hrReady;
      updates.complianceReady = flags.complianceReady;
      updates.firstPayrollReady = flags.firstPayrollReady;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await db.update(employees).set(updates as Record<string, unknown>).where(eq(employees.id, emp.id)).catch(() => {});
      updatedScores++;
    }
  }

  if (updatedScores > 0 || autoCompletedTasks > 0) {
    console.info(`backfillEmployeeScores: updated ${updatedScores} employees, auto-completed ${autoCompletedTasks} tasks`);
  }
}

export async function backfillPeopleModule(): Promise<void> {
  const allCompanies = await db.select().from(companies);

  // Seed departments for every existing company
  for (const company of allCompanies) {
    const isDaycare = company.industry === "daycare" || company.package === "full_daycare";
    seedDepartmentsForCompany(company.id, isDaycare);
  }

  const allEmployees = await db.select().from(employees);

  // Group employees by company for sequential display ID generation
  const byCompany = new Map<string, typeof allEmployees>();
  for (const emp of allEmployees) {
    const arr = byCompany.get(emp.companyId) ?? [];
    arr.push(emp);
    byCompany.set(emp.companyId, arr);
  }

  for (const [companyId, emps] of byCompany) {
    const company = allCompanies.find((c) => c.id === companyId);
    const isDaycare = company ? (company.industry === "daycare" || company.package === "full_daycare") : false;
    const existingDisplayIds = emps.map((e) => e.employeeDisplayId ?? "").filter(Boolean);

    for (const emp of emps) {
      const updates: Record<string, unknown> = {};

      // 1. Assign display ID if missing
      if (!emp.employeeDisplayId) {
        const newId = generateDisplayIdFromExisting(existingDisplayIds);
        updates.employeeDisplayId = newId;
        existingDisplayIds.push(newId);
      }

      // 2. Create compliance items if not yet created for this employee
      const existingCI = await db.select({ id: complianceItemsTable.id })
        .from(complianceItemsTable).where(eq(complianceItemsTable.employeeId, emp.id));
      if (existingCI.length === 0) {
        await createComplianceItemsInDb(emp.id, companyId, isDaycare, {
          w4Submitted: emp.w4Submitted,
          bankAccountAdded: emp.bankAccountAdded,
          kycStatus: emp.kycStatus,
        });
        const score = await calculateComplianceScore(emp.id);
        updates.complianceScore = score;
        updates.onboardingProgress = score;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = nowIso();
        await db.update(employees).set(updates as Record<string, unknown>).where(eq(employees.id, emp.id)).catch(() => {});
      }
    }
  }
}

// ─── PATCH EMPLOYEE BY ID ───────────────────────────────────────

// ─── Rollfi sync helper ────────────────────────────────────────

interface RollfiCallResult { success: boolean; error?: string; status?: number }
interface RollfiSyncResult {
  skipped?: boolean; reason?: string;
  updateUser?: RollfiCallResult | null;
  updateKycInfo?: RollfiCallResult | null;
  updateWage?: RollfiCallResult | null;
}

type EmpRow = typeof employees.$inferSelect;

async function syncEmployeeToRollfi(emp: EmpRow, changed: Set<string>): Promise<RollfiSyncResult> {
  const rollfiUserId = emp.rollfiUserId;
  if (!rollfiUserId) return { skipped: true, reason: "no_rollfi_account" };
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) return { skipped: true, reason: "not_configured" };

  const result: RollfiSyncResult = { skipped: false, updateUser: null, updateKycInfo: null, updateWage: null };

  // updateUser — syncs: email, phoneNumber, dateOfJoin, workerType, jobTitle
  const userFields = ["email","phone","startDate","workerType","jobTitle"];
  if (userFields.some(f => changed.has(f))) {
    try {
      const user: Record<string, unknown> = { userId: rollfiUserId };
      if (changed.has("email"))      user.email         = emp.email;
      if (changed.has("phone"))      user.phoneNumber   = emp.phone;
      if (changed.has("startDate"))  user.dateOfJoin    = emp.startDate;
      if (changed.has("workerType")) user.workerType    = emp.workerType;
      if (changed.has("jobTitle"))   user.jobTitle      = emp.jobTitle;
      const r = await axios.put(
        `${ROLLFI_BASE_URL}/adminPortal/updateUser`,
        { method: "updateUser", user },
        { headers: rollfiHeaders() },
      );
      result.updateUser = { success: true, status: r.status as number };
    } catch (e) {
      result.updateUser = { success: false, error: String(e) };
    }
  }

  // updateKycInformation — syncs: address1, city, state, zipcode, phoneNumber
  const kycFields = ["homeAddress","homeCity","homeState","homeZip","phone"];
  if (kycFields.some(f => changed.has(f))) {
    try {
      const kycInfo: Record<string, unknown> = { userId: rollfiUserId };
      if (changed.has("homeAddress")) kycInfo.address1     = emp.homeAddress;
      if (changed.has("homeCity"))    kycInfo.city         = emp.homeCity;
      if (changed.has("homeState"))   kycInfo.state        = emp.homeState;
      if (changed.has("homeZip"))     kycInfo.zipcode      = emp.homeZip;
      if (changed.has("phone"))       kycInfo.phoneNumber  = emp.phone;
      const r = await axios.put(
        `${ROLLFI_BASE_URL}/userPortal/updateKycInformation`,
        { method: "updateKycInformation", kycInformation: kycInfo },
        { headers: rollfiHeaders() },
      );
      result.updateKycInfo = { success: true, status: r.status as number };
    } catch (e) {
      result.updateKycInfo = { success: false, error: String(e) };
    }
  }

  // updateUserWage — syncs hourlyWage (stored as cents, Rollfi wants dollars)
  if (changed.has("hourlyWage")) {
    try {
      const [companyRec] = await db.select().from(rollfiCompanyRecords).where(eq(rollfiCompanyRecords.companyId, emp.companyId));
      const [empRec]     = await db.select().from(rollfiEmployeeRecords).where(eq(rollfiEmployeeRecords.employeeId, emp.id));
      const storeRollfiEmp = !empRec  ? store.getRollfiEmployee(emp.id)       : null;
      const storeRollfiCo  = !companyRec ? store.getRollfiCompany(emp.companyId) : null;
      const rollfiCompanyId = companyRec?.rollfiCompanyId ?? storeRollfiCo?.rollfiCompanyId;
      const rollfiWageId    = empRec?.rollfiWageId        ?? storeRollfiEmp?.rollfiWageId ?? "";
      if (rollfiCompanyId) {
        const wageInDollars = (emp.hourlyWage ?? 0) / 100;
        const r = await axios.post(
          `${ROLLFI_BASE_URL}/adminPortal#updateUserWage`,
          {
            method: "updateUserWage",
            userWage: {
              companyId: rollfiCompanyId,
              userId: rollfiUserId,
              userWageId: rollfiWageId,
              wageRate: wageInDollars,
              paymentType: "Regular",
              wageBasis: "Per Hour",
              workerType: emp.workerType ?? "W2",
              paymentMethod: emp.paymentMethod ?? "Direct Deposit",
            },
          },
          { headers: rollfiHeaders() },
        );
        result.updateWage = { success: true, status: r.status as number };
      } else {
        result.updateWage = { success: false, error: "Missing Rollfi company or wage record" };
      }
    } catch (e) {
      result.updateWage = { success: false, error: String(e) };
    }
  }

  return result;
}

// ─── PATCH EMPLOYEE ────────────────────────────────────────────

router.patch("/employees/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = String(req.params.id);

  // String fields (stored as-is)
  const stringFields = [
    "firstName","lastName","email","phone",
    "position","jobTitle","employmentType","workerType",
    "department","managerId","managerName","startDate","status",
    "payType","paymentMethod","ssn","dateOfBirth",
    "homeAddress","homeCity","homeState","homeZip",
    "w4FilingStatus","notes",
  ] as const;

  // Integer fields
  const intFields = ["hourlyWage","w4Dependents","w4ExtraWithholding"] as const;

  // Boolean fields
  const boolFields = ["overtimeEligible","w4MultipleJobs","taxExempt"] as const;

  const dbUpdates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const changed = new Set<string>();

  for (const k of stringFields) {
    if (k in req.body) { dbUpdates[k] = req.body[k] as string | null; changed.add(k); }
  }
  for (const k of intFields) {
    if (k in req.body) {
      const v = req.body[k] as unknown;
      dbUpdates[k] = (v === null || v === "") ? null : Number(v);
      changed.add(k);
    }
  }
  for (const k of boolFields) {
    if (k in req.body) {
      const v = req.body[k] as unknown;
      dbUpdates[k] = v === null ? null : Boolean(v);
      changed.add(k);
    }
  }

  if (changed.size === 0) {
    res.status(400).json({ error: "No updatable fields provided" }); return;
  }

  try {
    const [existing] = await db.select().from(employees).where(eq(employees.id, id));
    if (!existing) { res.status(404).json({ error: "Employee not found" }); return; }

    await db.update(employees).set(dbUpdates).where(eq(employees.id, id));

    // Re-fetch updated employee
    const [updated] = await db.select().from(employees).where(eq(employees.id, id));

    // Rollfi sync (best-effort — DB update already succeeded)
    const rollfiSync = await syncEmployeeToRollfi(updated, changed);

    res.json({ employee: updated, rollfiSync });
  } catch (err) {
    req.log.error({ err }, "Failed to update employee");
    res.status(500).json({ error: "Failed to update employee" });
  }
});

// ─── EMPLOYEE PHOTO ───────────────────────────────────────────

const PHOTOS_DIR = path.join(process.cwd(), "uploads", "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg","image/jpg","image/png","image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type. JPG, PNG, or WebP only."));
  },
});

router.post("/employees/:id/photo", photoUpload.single("photo"), async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const empId = String(req.params.id);
  try {
    const [emp] = await db.select().from(employees).where(eq(employees.id, empId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
    const filename = `${empId}.${ext}`;
    const filepath = path.join(PHOTOS_DIR, filename);
    // Remove old files for this employee (any extension)
    for (const f of fs.readdirSync(PHOTOS_DIR)) {
      if (f.startsWith(`${empId}.`)) fs.unlinkSync(path.join(PHOTOS_DIR, f));
    }
    fs.writeFileSync(filepath, req.file.buffer);
    const photoUrl = `/api/employees/${empId}/photo`;
    await db.update(employees).set({ photoUrl, updatedAt: new Date().toISOString() }).where(eq(employees.id, empId));
    void logPeopleActivity({ companyId: emp.companyId, employeeId: empId, action: "employee.photo_updated", description: `Profile photo updated for ${emp.firstName} ${emp.lastName}`, category: "profile", performedBy: req.session.userId });
    const [updated] = await db.select().from(employees).where(eq(employees.id, empId));
    res.json({ employee: updated, photoUrl });
  } catch (err) {
    req.log.error({ err }, "Failed to upload photo");
    res.status(500).json({ error: "Failed to upload photo" });
  }
});

router.get("/employees/:id/photo", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const empId = String(req.params.id);
  // Find file (any extension)
  let found: string | null = null;
  try {
    for (const f of fs.readdirSync(PHOTOS_DIR)) {
      if (f.startsWith(`${empId}.`)) { found = path.join(PHOTOS_DIR, f); break; }
    }
  } catch { /* no photos dir yet */ }
  if (!found) { res.status(404).json({ error: "No photo" }); return; }
  const ext = path.extname(found).slice(1);
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(found).pipe(res);
});

router.delete("/employees/:id/photo", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const empId = String(req.params.id);
  try {
    const [emp] = await db.select().from(employees).where(eq(employees.id, empId));
    if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }
    // Delete file(s)
    try {
      for (const f of fs.readdirSync(PHOTOS_DIR)) {
        if (f.startsWith(`${empId}.`)) fs.unlinkSync(path.join(PHOTOS_DIR, f));
      }
    } catch { /* ok */ }
    await db.update(employees).set({ photoUrl: null, updatedAt: new Date().toISOString() }).where(eq(employees.id, empId));
    void logPeopleActivity({ companyId: emp.companyId, employeeId: empId, action: "employee.photo_removed", description: `Profile photo removed for ${emp.firstName} ${emp.lastName}`, category: "profile", performedBy: req.session.userId });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete photo");
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

// ─── DEPARTMENTS ──────────────────────────────────────────────

router.get("/departments", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const depts = store.getDepartments(companyId);
  const empRows = await db.select({ id: employees.id, dept: employees.department })
    .from(employees).where(eq(employees.companyId, companyId));

  const result = depts.map((d) => ({
    ...d,
    employeeCount: empRows.filter((e) => e.dept === d.name).length,
  }));
  res.json({ departments: result });
});

router.post("/departments", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { companyId, name } = req.body as { companyId?: string; name?: string };
  if (!companyId || !name) { res.status(400).json({ error: "companyId and name required" }); return; }

  const dept: Department = { id: `dept-${uid()}`, companyId, name: name.trim(), type: "custom", isDefault: false, isActive: true, createdAt: nowIso() };
  store.addDepartment(dept);
  res.status(201).json({ department: dept });
});

router.put("/departments/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const dept = store.getDepartmentById(req.params.id as string);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  if (dept.isDefault) { res.status(400).json({ error: "Cannot rename a default department" }); return; }
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  store.updateDepartment(dept.id, { name: name.trim() });
  res.json({ department: { ...dept, name: name.trim() } });
});

router.delete("/departments/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const dept = store.getDepartmentById(req.params.id as string);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  if (dept.isDefault) { res.status(400).json({ error: "Cannot delete a default department" }); return; }
  store.deleteDepartment(dept.id);
  res.json({ success: true });
});

// ─── ONBOARDING TASKS ─────────────────────────────────────────

router.get("/onboarding-tasks", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { employeeId, companyId, status } = req.query as Record<string, string | undefined>;

  try {
    if (employeeId) {
      const tasks = await db.select().from(onboardingTasksTable)
        .where(eq(onboardingTasksTable.employeeId, employeeId));
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === "completed" || t.status === "skipped").length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const byStage: Record<string, TaskRow[]> = {};
      for (const t of tasks) {
        if (!byStage[t.stage]) byStage[t.stage] = [];
        byStage[t.stage]!.push(t);
      }
      res.json({ tasks, byStage, completionPercentage: pct, total, completed });
      return;
    }

    if (companyId) {
      const conds = [eq(onboardingTasksTable.companyId, companyId)];
      if (status) conds.push(eq(onboardingTasksTable.status, status));
      const tasks = await db.select().from(onboardingTasksTable).where(and(...conds));
      res.json({ tasks, count: tasks.length });
      return;
    }

    res.status(400).json({ error: "employeeId or companyId required" });
  } catch (err) {
    req.log.error({ err }, "Failed to get onboarding tasks");
    res.status(500).json({ error: "Failed to get onboarding tasks" });
  }
});

router.get("/onboarding-tasks/pipeline", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const all = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.companyId, companyId));
    const STAGES = ["preboarding","documents","training","equipment","manager_tasks","compliance","ready_to_start"];
    const pipeline = STAGES.map((stage) => {
      const s = all.filter((t) => t.stage === stage);
      const completed = s.filter((t) => t.status === "completed").length;
      return { stage, totalTasks: s.length, completed, inProgress: s.filter((t) => t.status === "in_progress").length, pending: s.filter((t) => t.status === "pending").length, percentage: s.length > 0 ? Math.round((completed / s.length) * 100) : 0 };
    });
    res.json({ pipeline, totalTasks: all.length, completedTasks: all.filter((t) => t.status === "completed").length });
  } catch (err) {
    req.log.error({ err }, "Failed to get pipeline");
    res.status(500).json({ error: "Failed to get pipeline" });
  }
});

router.post("/onboarding-tasks/:id/complete", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;

  try {
    const [task] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const now = nowIso();
    const { completionMethod, completionNote, acknowledgedBy, acknowledgedAt, linkedDocumentId } = req.body as Record<string, string>;

    // Idempotent: if already completed, just update metadata fields without touching status/timestamp
    if (task.status === "completed") {
      let ldIds = task.linkedDocumentIds ?? null;
      if (linkedDocumentId) {
        const arr: string[] = ldIds ? JSON.parse(ldIds) as string[] : [];
        if (!arr.includes(linkedDocumentId)) { arr.push(linkedDocumentId); ldIds = JSON.stringify(arr); }
      }
      await db.update(onboardingTasksTable).set({
        ...(completionMethod ? { completionMethod } : {}),
        ...(completionNote !== undefined ? { completionNote: completionNote ?? null } : {}),
        ...(ldIds !== null ? { linkedDocumentIds: ldIds } : {}),
        updatedAt: now,
      } as Record<string, unknown>).where(eq(onboardingTasksTable.id, id));
      const [already] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
      res.json({ success: true, task: already, allRequiredDone: false, progress: 0 });
      return;
    }

    let ldIds = task.linkedDocumentIds ?? null;
    if (linkedDocumentId) {
      const arr: string[] = ldIds ? JSON.parse(ldIds) as string[] : [];
      if (!arr.includes(linkedDocumentId)) { arr.push(linkedDocumentId); ldIds = JSON.stringify(arr); }
    }
    await db.update(onboardingTasksTable).set({
      status: "completed", completedAt: now, completedBy: req.session.userId, updatedAt: now,
      completionMethod: completionMethod ?? "manual",
      completionNote: completionNote ?? null,
      acknowledgedBy: acknowledgedBy ?? null,
      acknowledgedAt: acknowledgedAt ?? null,
      ...(ldIds !== null ? { linkedDocumentIds: ldIds } : {}),
    } as Record<string, unknown>).where(eq(onboardingTasksTable.id, id));

    // Update linked compliance item if applicable.
    // Pass 1: type-keyed map for tasks whose name doesn't match the compliance item name.
    const complianceMap: Record<string, string> = {
      "Federal W-4": "w4", "I-9 Section 1": "i9", "I-9 Section 2 Verification": "i9",
      "Direct Deposit Setup": "direct_deposit", "Background Check": "background_check",
      "Employee Handbook Acknowledgment": "handbook", "Company Policy Acknowledgment": "policy",
      "Fingerprint Clearance": "fingerprint",
    };
    const ciType = complianceMap[task.taskName];
    if (ciType) {
      const [ci] = await db.select().from(complianceItemsTable)
        .where(and(eq(complianceItemsTable.employeeId, task.employeeId), eq(complianceItemsTable.type, ciType)));
      if (ci && ci.status !== "completed") {
        await db.update(complianceItemsTable).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(complianceItemsTable.id, ci.id));
      }
    } else {
      // Pass 2: name-match for certification/training/custom compliance items
      // (e.g. "Physical Examination", "First Aid Certification", "CPR Certification", "TB Test", …)
      const [ciByName] = await db.select().from(complianceItemsTable)
        .where(and(
          eq(complianceItemsTable.employeeId, task.employeeId),
          eq(complianceItemsTable.name, task.taskName),
        ));
      if (ciByName && ciByName.status !== "completed") {
        await db.update(complianceItemsTable)
          .set({ status: "completed", completedAt: now, updatedAt: now } as Record<string, unknown>)
          .where(eq(complianceItemsTable.id, ciByName.id));
        req.log.info({ taskName: task.taskName, ciId: ciByName.id }, "Auto-completed linked compliance item by name");
      }
    }

    // Check completion, update readiness + progress
    const allTasks = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, task.employeeId));
    const progress = Math.round((allTasks.filter((t) => t.status === "completed" || t.status === "skipped").length / allTasks.length) * 100);
    const allRequiredDone = allTasks.filter((t) => t.isRequired).every((t) => t.status === "completed" || t.status === "skipped");
    const flags = await calculateReadinessFlags(task.employeeId);
    const score = await calculateComplianceScore(task.employeeId);

    const empUpdates: Record<string, unknown> = { onboardingProgress: progress, complianceScore: score, updatedAt: now, ...flags };
    if (allRequiredDone) { empUpdates.status = "active"; empUpdates.onboardingCompletedAt = now; }
    await db.update(employees).set(empUpdates as Record<string, unknown>).where(eq(employees.id, task.employeeId));

    void logPeopleActivity({ companyId: task.companyId, employeeId: task.employeeId, action: "task.completed", description: `Task "${task.taskName}" completed`, category: "onboarding", performedBy: req.session.userId });

    const [updated] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    res.json({ success: true, task: updated, allRequiredDone, progress });
  } catch (err) {
    req.log.error({ err }, "Failed to complete task");
    res.status(500).json({ error: "Failed to complete task" });
  }
});

router.post("/onboarding-tasks/:id/skip", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [task] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.isRequired) { res.status(400).json({ error: "Cannot skip a required task" }); return; }
    await db.update(onboardingTasksTable).set({ status: "skipped", updatedAt: nowIso() }).where(eq(onboardingTasksTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to skip task");
    res.status(500).json({ error: "Failed to skip task" });
  }
});

router.get("/onboarding-tasks/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [task] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    const notes = await db.select().from(taskNotesTable).where(eq(taskNotesTable.taskId, id));
    let linkedDocuments: DocRow[] = [];
    if (task.linkedDocumentIds) {
      const ids = JSON.parse(task.linkedDocumentIds) as string[];
      if (ids.length > 0) linkedDocuments = await db.select().from(employeeDocumentsTable).where(inArray(employeeDocumentsTable.id, ids));
    }
    res.json({ task, notes, linkedDocuments });
  } catch (err) {
    req.log.error({ err }, "Failed to get task detail");
    res.status(500).json({ error: "Failed to get task detail" });
  }
});

router.post("/onboarding-tasks/:id/reopen", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [task] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.status === "pending") { res.status(400).json({ error: "Task is already pending" }); return; }

    const now = nowIso();
    await db.update(onboardingTasksTable).set({
      status: "pending", completedAt: null, completedBy: null, updatedAt: now,
      reopenedCount: (task.reopenedCount ?? 0) + 1,
      lastReopenedAt: now, lastReopenedBy: req.session.userId,
    } as Record<string, unknown>).where(eq(onboardingTasksTable.id, id));

    // Revert linked compliance item if applicable
    const complianceMap: Record<string, string> = {
      "Federal W-4": "w4", "I-9 Section 1": "i9", "I-9 Section 2 Verification": "i9",
      "Direct Deposit Setup": "direct_deposit", "Background Check": "background_check",
      "Employee Handbook Acknowledgment": "handbook", "Company Policy Acknowledgment": "policy",
      "Fingerprint Clearance": "fingerprint",
    };
    const ciType = complianceMap[task.taskName];
    if (ciType) {
      const [ci] = await db.select().from(complianceItemsTable)
        .where(and(eq(complianceItemsTable.employeeId, task.employeeId), eq(complianceItemsTable.type, ciType)));
      if (ci && ci.status === "completed") {
        await db.update(complianceItemsTable).set({ status: "not_started", completedAt: null, updatedAt: now } as Record<string, unknown>).where(eq(complianceItemsTable.id, ci.id));
      }
    }

    // Recalculate scores (spec rule 5: do NOT revert active status)
    const allTasks = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, task.employeeId));
    const progress = Math.round((allTasks.filter(t => t.status === "completed" || t.status === "skipped").length / allTasks.length) * 100);
    const flags = await calculateReadinessFlags(task.employeeId);
    const score = await calculateComplianceScore(task.employeeId);
    await db.update(employees).set({ onboardingProgress: progress, complianceScore: score, updatedAt: now, ...flags } as Record<string, unknown>).where(eq(employees.id, task.employeeId));

    void logPeopleActivity({ companyId: task.companyId, employeeId: task.employeeId, action: "task.reopened", description: `Task "${task.taskName}" reopened`, category: "onboarding", performedBy: req.session.userId });

    const [updated] = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.id, id));
    res.json({ success: true, task: updated, progress });
  } catch (err) {
    req.log.error({ err }, "Failed to reopen task");
    res.status(500).json({ error: "Failed to reopen task" });
  }
});

router.post("/onboarding-tasks/:id/notes", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const taskId = req.params.id as string;
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "Note text is required" }); return; }
  try {
    const [task] = await db.select({ id: onboardingTasksTable.id, employeeId: onboardingTasksTable.employeeId, companyId: onboardingTasksTable.companyId, taskName: onboardingTasksTable.taskName }).from(onboardingTasksTable).where(eq(onboardingTasksTable.id, taskId));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    const storeUser = store.getUserById(req.session.userId);
    const authorName = storeUser?.name ?? req.session.userId;
    const now = nowIso();
    const [note] = await db.insert(taskNotesTable).values({
      id: `tnote-${uid()}`, taskId, employeeId: task.employeeId, companyId: task.companyId,
      text: text.trim(), authorId: req.session.userId, authorName, createdAt: now,
    }).returning();
    void logPeopleActivity({ companyId: task.companyId, employeeId: task.employeeId, action: "task.note_added", description: `Note added to "${task.taskName}"`, category: "onboarding", performedBy: req.session.userId });
    res.status(201).json({ note });
  } catch (err) {
    req.log.error({ err }, "Failed to add task note");
    res.status(500).json({ error: "Failed to add task note" });
  }
});

// ─── COMPLIANCE ───────────────────────────────────────────────

// Maps a compliance item type+name → the onboarding task names that link to it
function getLinkedTaskNames(type: string, name: string): string[] {
  if (type === "certification" || type === "training") return [name];
  const MAP: Record<string, string[]> = {
    i9:               ["I-9 Section 1", "I-9 Section 2 Verification"],
    w4:               ["Federal W-4"],
    direct_deposit:   ["Direct Deposit Setup"],
    background_check: ["Background Check"],
    handbook:         ["Employee Handbook Acknowledgment"],
    policy:           ["Company Policy Acknowledgment"],
    fingerprint:      ["Fingerprint Clearance"],
    state_w4:         [],
  };
  return MAP[type] ?? [];
}

router.get("/compliance", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  try {
    const items = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.employeeId, employeeId));
    const allTasks = await db.select({
      id: onboardingTasksTable.id,
      taskName: onboardingTasksTable.taskName,
      status: onboardingTasksTable.status,
      isRequired: onboardingTasksTable.isRequired,
    }).from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, employeeId));

    const itemsWithTasks = items.map(item => {
      const linkedNames = getLinkedTaskNames(item.type, item.name);
      const linkedTasks = allTasks.filter(t => linkedNames.includes(t.taskName));
      return { ...item, linkedTasks };
    });

    const score = await calculateComplianceScore(employeeId);
    res.json({ items: itemsWithTasks, score });
  } catch (err) {
    req.log.error({ err }, "Failed to get compliance");
    res.status(500).json({ error: "Failed to get compliance" });
  }
});

router.get("/compliance/company-overview", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const all = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.companyId, companyId));
    const types = ["i9","w4","direct_deposit","background_check","handbook","policy","fingerprint","certification","training"];
    const overview = types.map((cat) => {
      const items = all.filter((i) => i.type === cat);
      const completed = items.filter((i) => i.status === "completed").length;
      return { category: cat, total: items.length, completed, percentage: items.length > 0 ? Math.round((completed / items.length) * 100) : 0 };
    }).filter((o) => o.total > 0);

    const required = all.filter((i) => i.isRequired);
    const completedRequired = required.filter((i) => i.status === "completed");
    const overallScore = required.length > 0 ? Math.round((completedRequired.length / required.length) * 100) : 100;
    res.json({ overview, overallScore, totalItems: all.length, completedItems: completedRequired.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get company compliance overview");
    res.status(500).json({ error: "Failed to get company compliance overview" });
  }
});

router.post("/compliance/:id/complete", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [item] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }

    // Guard: reject if any required pending linked tasks exist
    const linkedNames = getLinkedTaskNames(item.type, item.name);
    if (linkedNames.length > 0) {
      const linked = await db.select({
        id: onboardingTasksTable.id,
        taskName: onboardingTasksTable.taskName,
        status: onboardingTasksTable.status,
        isRequired: onboardingTasksTable.isRequired,
      }).from(onboardingTasksTable)
        .where(and(eq(onboardingTasksTable.employeeId, item.employeeId), inArray(onboardingTasksTable.taskName, linkedNames)));
      const pendingRequired = linked.filter(t => t.isRequired && t.status !== "completed" && t.status !== "skipped");
      if (pendingRequired.length > 0) {
        res.status(409).json({
          error: "Complete the linked onboarding task(s) first",
          blockedByTaskIds: pendingRequired.map(t => t.id),
          blockedByTaskNames: pendingRequired.map(t => t.taskName),
        });
        return;
      }
    }

    const { notes, linkedDocumentId } = req.body as { notes?: string; linkedDocumentId?: string };
    const now = nowIso();
    await db.update(complianceItemsTable).set({
      status: "completed", completedAt: now, updatedAt: now,
      notes: notes ?? null,
      linkedDocumentId: linkedDocumentId ?? null,
    } as Record<string, unknown>).where(eq(complianceItemsTable.id, id));

    const i9Up   = item.type === "i9"               ? { i9Status: "verified" }               : {};
    const bgUp   = item.type === "background_check"  ? { backgroundCheckStatus: "completed" } : {};
    const flags  = await calculateReadinessFlags(item.employeeId);
    const score  = await calculateComplianceScore(item.employeeId);
    await db.update(employees).set({ ...i9Up, ...bgUp, ...flags, complianceScore: score, updatedAt: now } as Record<string, unknown>).where(eq(employees.id, item.employeeId));

    void logPeopleActivity({ companyId: item.companyId, employeeId: item.employeeId, action: "compliance.completed", description: `"${item.name}" marked complete`, category: "compliance", performedBy: req.session.userId });

    const [updated] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
    res.json({ success: true, item: updated, score });
  } catch (err) {
    req.log.error({ err }, "Failed to complete compliance item");
    res.status(500).json({ error: "Failed to complete compliance item" });
  }
});

router.post("/compliance/:id/reopen", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [item] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }
    if (item.status !== "completed") { res.status(400).json({ error: "Item is not completed" }); return; }

    const now = nowIso();
    await db.update(complianceItemsTable).set({
      status: "not_started", completedAt: null, notes: null, linkedDocumentId: null, updatedAt: now,
    } as Record<string, unknown>).where(eq(complianceItemsTable.id, id));

    const flags = await calculateReadinessFlags(item.employeeId);
    const score = await calculateComplianceScore(item.employeeId);
    await db.update(employees).set({ complianceScore: score, updatedAt: now, ...flags } as Record<string, unknown>).where(eq(employees.id, item.employeeId));

    void logPeopleActivity({ companyId: item.companyId, employeeId: item.employeeId, action: "compliance.reopened", description: `"${item.name}" reopened`, category: "compliance", performedBy: req.session.userId });

    const [updated] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
    res.json({ success: true, item: updated, score });
  } catch (err) {
    req.log.error({ err }, "Failed to reopen compliance item");
    res.status(500).json({ error: "Failed to reopen compliance item" });
  }
});

router.post("/compliance/:id/waive", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  try {
    const [item] = await db.select().from(complianceItemsTable).where(eq(complianceItemsTable.id, id));
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }
    if (item.isRequired) { res.status(400).json({ error: "Cannot waive a required compliance item" }); return; }
    await db.update(complianceItemsTable).set({ status: "waived", updatedAt: nowIso() }).where(eq(complianceItemsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to waive compliance item");
    res.status(500).json({ error: "Failed to waive compliance item" });
  }
});

// ─── EMERGENCY CONTACTS ───────────────────────────────────────

router.get("/emergency-contacts", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }
  try {
    const contacts = await db.select().from(emergencyContactsTable).where(eq(emergencyContactsTable.employeeId, employeeId));
    res.json({ contacts });
  } catch (err) {
    req.log.error({ err }, "Failed to get emergency contacts");
    res.status(500).json({ error: "Failed to get emergency contacts" });
  }
});

router.post("/emergency-contacts", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as Partial<ContactRow> & { employeeId?: string; companyId?: string };
  if (!body.employeeId || !body.companyId || !body.name || !body.relationship || !body.phoneNumber) {
    res.status(400).json({ error: "employeeId, companyId, name, relationship, and phoneNumber required" }); return;
  }
  try {
    const now = nowIso();
    const [created] = await db.insert(emergencyContactsTable).values({
      id: `ec-${uid()}`, employeeId: body.employeeId, companyId: body.companyId,
      contactType: body.contactType ?? "primary", name: body.name, relationship: body.relationship,
      phoneNumber: body.phoneNumber, alternatePhone: body.alternatePhone ?? null, email: body.email ?? null,
      address: body.address ?? null, physicianName: body.physicianName ?? null, physicianPhone: body.physicianPhone ?? null,
      insuranceProvider: body.insuranceProvider ?? null, insurancePolicyNumber: body.insurancePolicyNumber ?? null,
      createdAt: now, updatedAt: now,
    }).returning();

    // Auto-complete "Emergency Contact" onboarding task on first contact save (idempotent)
    const existingContacts = await db.select({ id: emergencyContactsTable.id })
      .from(emergencyContactsTable).where(eq(emergencyContactsTable.employeeId, body.employeeId!));
    if (existingContacts.length === 1) {
      const [ecTask] = await db.select().from(onboardingTasksTable)
        .where(and(eq(onboardingTasksTable.employeeId, body.employeeId!), eq(onboardingTasksTable.taskName, "Emergency Contact")));
      if (ecTask && ecTask.status !== "completed") {
        await db.update(onboardingTasksTable)
          .set({ status: "completed", completedAt: now, completedBy: req.session.userId, updatedAt: now })
          .where(eq(onboardingTasksTable.id, ecTask.id));
        const allTaskRows = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, body.employeeId!));
        const prog = allTaskRows.length > 0
          ? Math.round(allTaskRows.filter(t => t.status === "completed" || t.status === "skipped").length / allTaskRows.length * 100)
          : 0;
        await db.update(employees).set({ onboardingProgress: prog, updatedAt: now }).where(eq(employees.id, body.employeeId!));
      }
    }
    void logPeopleActivity({ companyId: body.companyId!, employeeId: body.employeeId, action: "emergency_contact.added", description: `Emergency contact "${body.name}" added`, category: "onboarding", performedBy: req.session.userId });
    res.status(201).json({ contact: created });
  } catch (err) {
    req.log.error({ err }, "Failed to create emergency contact");
    res.status(500).json({ error: "Failed to create emergency contact" });
  }
});

router.put("/emergency-contacts/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [updated] = await db.update(emergencyContactsTable)
      .set({ ...(req.body as Record<string, unknown>), updatedAt: nowIso() })
      .where(eq(emergencyContactsTable.id, req.params.id as string)).returning();
    if (!updated) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json({ contact: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to update emergency contact");
    res.status(500).json({ error: "Failed to update emergency contact" });
  }
});

router.delete("/emergency-contacts/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await db.delete(emergencyContactsTable).where(eq(emergencyContactsTable.id, req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete emergency contact");
    res.status(500).json({ error: "Failed to delete emergency contact" });
  }
});

// ─── DOCUMENTS ────────────────────────────────────────────────

router.get("/documents", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { employeeId, companyId } = req.query as Record<string, string | undefined>;
  if (!employeeId && !companyId) { res.status(400).json({ error: "employeeId or companyId required" }); return; }
  try {
    const cond = employeeId
      ? eq(employeeDocumentsTable.employeeId, employeeId)
      : eq(employeeDocumentsTable.companyId, companyId!);
    const docs = await db.select().from(employeeDocumentsTable).where(cond);
    res.json({ documents: docs });
  } catch (err) {
    req.log.error({ err }, "Failed to get documents");
    res.status(500).json({ error: "Failed to get documents" });
  }
});

router.get("/documents/:id/download", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [doc] = await db.select().from(employeeDocumentsTable).where(eq(employeeDocumentsTable.id, req.params.id as string));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    if (!doc.fileUrl || !fs.existsSync(doc.fileUrl)) { res.status(404).json({ error: "File not found on server" }); return; }
    res.download(doc.fileUrl, doc.fileName);
  } catch (err) {
    req.log.error({ err }, "Failed to download document");
    res.status(500).json({ error: "Failed to download document" });
  }
});

router.post("/documents/upload", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file provided or file type not allowed (PDF, JPG, PNG only)" }); return; }
  const body = req.body as Record<string, string>;
  const { employeeId, companyId, documentType, documentName, customTypeName, expiryDate, notes } = body;
  if (!employeeId || !companyId || !documentType || !documentName) {
    res.status(400).json({ error: "employeeId, companyId, documentType, documentName required" }); return;
  }
  try {
    const now = nowIso();
    const docId = `doc-${uid()}`;
    const [created] = await db.insert(employeeDocumentsTable).values({
      id: docId, employeeId, companyId,
      documentName, documentType, customTypeName: customTypeName ?? null,
      fileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size, mimeType: req.file.mimetype,
      status: "uploaded", uploadedAt: now, uploadedBy: req.session.userId,
      expiryDate: expiryDate || null, notes: notes || null,
      createdAt: now, updatedAt: now,
    }).returning();

    // Link to matching compliance item
    const DOC_TO_CI: Record<string, string> = {
      i9: "i9", identification: "i9", w4: "w4",
      background_check: "background_check", handbook: "handbook", policy: "policy",
      certification: "certification", license: "certification",
      physical_exam: "training", tb_test: "training", immunization: "training",
    };
    const ciType = DOC_TO_CI[documentType];
    if (ciType) {
      const cis = await db.select().from(complianceItemsTable)
        .where(and(eq(complianceItemsTable.employeeId, employeeId), eq(complianceItemsTable.type, ciType)));
      const ci = cis.find(c => c.status !== "completed");
      if (ci) {
        await db.update(complianceItemsTable).set({
          status: "completed", completedAt: now, linkedDocumentId: docId,
          expiryDate: expiryDate || null, updatedAt: now,
        } as Record<string, unknown>).where(eq(complianceItemsTable.id, ci.id));
      }
    }

    // Auto-complete matching onboarding task
    const TASK_KW: Record<string, string> = {
      i9: "I-9", identification: "Identification Upload",
      immunization: "Immunization Records", physical_exam: "Physical Examination",
      tb_test: "TB Test", certification: "Certification", background_check: "Background Check",
    };
    const kw = TASK_KW[documentType];
    if (kw) {
      const allTasks = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, employeeId));
      const task = allTasks.find(t => t.taskName.includes(kw) && t.status !== "completed");
      if (task && task.status !== "completed") {
        const existIds: string[] = task.linkedDocumentIds ? JSON.parse(task.linkedDocumentIds) as string[] : [];
        if (!existIds.includes(docId)) existIds.push(docId);
        await db.update(onboardingTasksTable)
          .set({ status: "completed", completedAt: now, completedBy: req.session.userId, completionMethod: "upload", linkedDocumentIds: JSON.stringify(existIds), updatedAt: now } as Record<string, unknown>)
          .where(eq(onboardingTasksTable.id, task.id));
      }
    }

    // Recalculate compliance score + onboarding progress
    const score = await calculateComplianceScore(employeeId);
    const flags = await calculateReadinessFlags(employeeId);
    const allTasks = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, employeeId));
    const prog = allTasks.length > 0
      ? Math.round(allTasks.filter(t => t.status === "completed" || t.status === "skipped").length / allTasks.length * 100)
      : 0;
    await db.update(employees)
      .set({ complianceScore: score, onboardingProgress: prog, ...flags, updatedAt: now } as Record<string, unknown>)
      .where(eq(employees.id, employeeId));

    void logPeopleActivity({ companyId, employeeId, action: "document.uploaded", description: `Document "${documentName}" uploaded`, category: "document", performedBy: req.session.userId });
    res.status(201).json({ document: created });
  } catch (err) {
    req.log.error({ err }, "Failed to upload document");
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.post("/documents", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as Partial<DocRow>;
  if (!body.employeeId || !body.companyId || !body.documentName || !body.documentType || !body.fileName) {
    res.status(400).json({ error: "employeeId, companyId, documentName, documentType, fileName required" }); return;
  }
  try {
    const now = nowIso();
    const [created] = await db.insert(employeeDocumentsTable).values({
      id: `doc-${uid()}`, employeeId: body.employeeId, companyId: body.companyId,
      documentName: body.documentName, documentType: body.documentType,
      customTypeName: body.customTypeName ?? null, fileName: body.fileName,
      fileUrl: body.fileUrl ?? `/api/documents/placeholder/${body.fileName}`,
      fileSize: body.fileSize ?? null, mimeType: body.mimeType ?? null,
      status: "uploaded", uploadedAt: now, uploadedBy: req.session.userId,
      requiresSignature: body.requiresSignature ?? false,
      expiryDate: body.expiryDate ?? null, notes: body.notes ?? null,
      createdAt: now, updatedAt: now,
    }).returning();
    void logPeopleActivity({ companyId: body.companyId, employeeId: body.employeeId, action: "document.uploaded", description: `Document "${body.documentName}" uploaded`, category: "document", performedBy: req.session.userId });
    res.status(201).json({ document: created });
  } catch (err) {
    req.log.error({ err }, "Failed to create document");
    res.status(500).json({ error: "Failed to create document" });
  }
});

router.put("/documents/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [updated] = await db.update(employeeDocumentsTable)
      .set({ ...(req.body as Record<string, unknown>), updatedAt: nowIso() })
      .where(eq(employeeDocumentsTable.id, req.params.id as string)).returning();
    if (!updated) { res.status(404).json({ error: "Document not found" }); return; }
    res.json({ document: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to update document");
    res.status(500).json({ error: "Failed to update document" });
  }
});

router.delete("/documents/:id", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await db.update(employeeDocumentsTable).set({ status: "rejected", updatedAt: nowIso() }).where(eq(employeeDocumentsTable.id, req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── ACTIVITY LOG ─────────────────────────────────────────────

router.get("/activity-log", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { companyId, employeeId, category, limit } = req.query as Record<string, string | undefined>;
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const conds = [eq(peopleActivityLogTable.companyId, companyId)];
    if (employeeId) conds.push(eq(peopleActivityLogTable.employeeId, employeeId));
    if (category) conds.push(eq(peopleActivityLogTable.category, category));

    const rows = await db.select().from(peopleActivityLogTable)
      .where(and(...conds))
      .orderBy(peopleActivityLogTable.timestamp)
      .limit(limit ? parseInt(limit, 10) : 20);

    // DB returns oldest-first; reverse for newest-first
    res.json({ entries: rows.reverse() });
  } catch (err) {
    req.log.error({ err }, "Failed to get activity log");
    res.status(500).json({ error: "Failed to get activity log" });
  }
});

router.post("/activity-log", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as { companyId?: string; employeeId?: string; action?: string; description?: string; category?: string; performedBy?: string; metadata?: Record<string, unknown> };
  if (!body.companyId || !body.action || !body.description || !body.category) {
    res.status(400).json({ error: "companyId, action, description, category required" }); return;
  }
  try {
    await logPeopleActivity({ companyId: body.companyId, employeeId: body.employeeId, action: body.action, description: body.description, category: body.category, performedBy: body.performedBy ?? req.session.userId, metadata: body.metadata });
    res.status(201).json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to log activity");
    res.status(500).json({ error: "Failed to log activity" });
  }
});

export default router;
