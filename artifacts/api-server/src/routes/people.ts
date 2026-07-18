import { Router, type Request, type Response, type IRouter } from "express";
import { db, companies, employees } from "@workspace/db";
import { eq } from "drizzle-orm";
import { store, type OnboardingTask, type ComplianceItem, type Department } from "../store.js";

const router: IRouter = Router();

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function nowIso() { return new Date().toISOString(); }
function addDays(dateStr: string | undefined, days: number): string {
  const base = dateStr ? new Date(dateStr) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split("T")[0]!;
}

// ─── ONBOARDING TASK TEMPLATES ────────────────────────────────

type TaskTemplate = {
  taskName: string;
  category: OnboardingTask["category"];
  stage: OnboardingTask["stage"];
  assignedToRole: OnboardingTask["assignedToRole"];
  dueDaysAfterHire: number;
  isRequired: boolean;
};

const STANDARD_HR_PAYROLL_TASKS: TaskTemplate[] = [
  { taskName: "Complete Personal Information", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Emergency Contact", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Federal W-4", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "State Tax Form", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "I-9 Section 1", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "I-9 Section 2 Verification", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Direct Deposit Setup", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Employee Handbook Acknowledgment", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Company Policy Acknowledgment", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Confidentiality/NDA", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: false },
  { taskName: "Code of Conduct Acknowledgment", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "IT Acceptable Use Policy", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Benefit Enrollment", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Retirement Plan Enrollment", category: "hr_payroll", stage: "preboarding", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Assign Pay Schedule", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Department", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Manager", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Job Title", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Work Location", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Issue Employee ID", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Time & Attendance Profile", category: "hr_payroll", stage: "preboarding", assignedToRole: "hr", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Upload Required Documents", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "E-Sign All Required Forms", category: "hr_payroll", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
];

const MANAGER_TASKS: TaskTemplate[] = [
  { taskName: "Schedule Orientation", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Schedule First Day Meeting", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Mentor/Buddy", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 3, isRequired: false },
  { taskName: "Assign Training Plan", category: "manager", stage: "training", assignedToRole: "manager", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Assign Learning Courses", category: "manager", stage: "training", assignedToRole: "manager", dueDaysAfterHire: 7, isRequired: false },
  { taskName: "Set 30/60/90 Day Goals", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Schedule 30-Day Review", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 30, isRequired: true },
  { taskName: "Schedule 60-Day Review", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 60, isRequired: true },
  { taskName: "Schedule 90-Day Review", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 90, isRequired: true },
];

const IT_TASKS: TaskTemplate[] = [
  { taskName: "Create Company Email", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Create System Login", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Assign Software Access", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Assign Security Roles", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Enable MFA", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 3, isRequired: false },
  { taskName: "Issue Laptop/Desktop", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Issue Phone", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Issue Key Card/Badge", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Assign Equipment", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 1, isRequired: false },
  { taskName: "Collect Equipment Signature", category: "it", stage: "equipment", assignedToRole: "it", dueDaysAfterHire: 3, isRequired: false },
];

const COMPLIANCE_TASKS: TaskTemplate[] = [
  { taskName: "Background Check", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Drug Screening", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 7, isRequired: false },
  { taskName: "Employment Eligibility Verification", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Professional License Verification", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Driver's License Verification", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Certification Uploads", category: "compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Work Authorization Expiration Tracking", category: "compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 7, isRequired: false },
];

const DAYCARE_COMPLIANCE_TASKS: TaskTemplate[] = [
  { taskName: "Fingerprint Clearance", category: "daycare_compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "State Central Registry Verification", category: "daycare_compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Child Abuse Training", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "Health & Safety Training", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "CPR Certification", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true },
  { taskName: "First Aid Certification", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true },
  { taskName: "Medication Administration Training", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true },
  { taskName: "Physical Examination", category: "daycare_compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "TB Test", category: "daycare_compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "Immunization Records", category: "daycare_compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "Identification Upload", category: "daycare_compliance", stage: "documents", assignedToRole: "employee", dueDaysAfterHire: 3, isRequired: true },
  { taskName: "Education Verification", category: "daycare_compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "Professional References", category: "daycare_compliance", stage: "compliance", assignedToRole: "hr", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "Staff Health Statement", category: "daycare_compliance", stage: "compliance", assignedToRole: "employee", dueDaysAfterHire: 7, isRequired: true },
  { taskName: "Mandated Reporter Training", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: true },
  { taskName: "OCFS Training Hours", category: "daycare_compliance", stage: "training", assignedToRole: "employee", dueDaysAfterHire: 30, isRequired: true },
  { taskName: "Group Assignment", category: "daycare_compliance", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Classroom Assignment", category: "daycare_compliance", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Ratio Verification", category: "daycare_compliance", stage: "compliance", assignedToRole: "manager", dueDaysAfterHire: 1, isRequired: true },
  { taskName: "Staff File Completion", category: "daycare_compliance", stage: "ready_to_start", assignedToRole: "hr", dueDaysAfterHire: 14, isRequired: true },
];

// ─── HELPER FUNCTIONS ─────────────────────────────────────────

export function generateEmployeeDisplayId(companyId: string): string {
  const existing = store.getDepartments(companyId); // just to use store — actual logic below
  void existing;
  const all = store.getOnboardingTasks({ companyId }); // not the right source — use employees from DB
  void all;
  // This function is called after DB fetch — see generateDisplayIdFromExisting
  return "E1001";
}

export function generateDisplayIdFromExisting(companyId: string, existingIds: string[]): string {
  const nums = existingIds
    .filter(Boolean)
    .map((id) => parseInt(id.replace("E", ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 1000;
  return `E${max + 1}`;
}

export function createOnboardingTasks(
  employeeId: string,
  companyId: string,
  startDate: string,
  isDaycare: boolean,
  managerUserId?: string,
  adminUserId?: string,
): OnboardingTask[] {
  const now = nowIso();
  let template: TaskTemplate[] = [
    ...STANDARD_HR_PAYROLL_TASKS,
    ...MANAGER_TASKS,
    ...IT_TASKS,
    ...COMPLIANCE_TASKS,
  ];
  if (isDaycare) template = [...template, ...DAYCARE_COMPLIANCE_TASKS];

  return template.map((t): OnboardingTask => {
    let assignedToUserId: string | undefined;
    if (t.assignedToRole === "employee") assignedToUserId = employeeId;
    else if (t.assignedToRole === "manager") assignedToUserId = managerUserId;
    else if (t.assignedToRole === "hr" || t.assignedToRole === "admin" || t.assignedToRole === "it") assignedToUserId = adminUserId;

    return {
      id: `task-${uid()}`,
      employeeId,
      companyId,
      taskName: t.taskName,
      category: t.category,
      stage: t.stage,
      assignedToRole: t.assignedToRole,
      assignedToUserId,
      status: "pending",
      isRequired: t.isRequired,
      dueDaysAfterHire: t.dueDaysAfterHire,
      dueDate: addDays(startDate, t.dueDaysAfterHire),
      autoGenerated: true,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function createComplianceItems(
  employeeId: string,
  companyId: string,
  isDaycare: boolean,
  existingFlags?: { w4Submitted?: boolean; bankAccountAdded?: boolean; kycStatus?: string | null },
): ComplianceItem[] {
  const now = nowIso();
  const mk = (
    type: ComplianceItem["type"],
    name: string,
    isRequired: boolean,
    preStatus?: ComplianceItem["status"],
  ): ComplianceItem => ({
    id: `ci-${uid()}`,
    employeeId,
    companyId,
    type,
    name,
    status: preStatus ?? "not_started",
    isRequired,
    completedAt: preStatus === "completed" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });

  const w4Status: ComplianceItem["status"] = existingFlags?.w4Submitted ? "completed" : "not_started";
  const ddStatus: ComplianceItem["status"] = existingFlags?.bankAccountAdded ? "completed" : "not_started";
  const i9Status: ComplianceItem["status"] = existingFlags?.kycStatus === "verified" ? "completed" : "not_started";

  const items: ComplianceItem[] = [
    mk("i9", "I-9 Employment Eligibility", true, i9Status),
    mk("w4", "Federal W-4", true, w4Status),
    mk("state_w4", "State Tax Form", true),
    mk("direct_deposit", "Direct Deposit", true, ddStatus),
    mk("background_check", "Background Check", true),
    mk("handbook", "Employee Handbook Acknowledgment", true),
    mk("policy", "Company Policies Acknowledgment", true),
  ];

  if (isDaycare) {
    items.push(
      mk("fingerprint", "Fingerprint Clearance", true),
      mk("certification", "CPR Certification", true),
      mk("certification", "First Aid Certification", true),
      mk("training", "TB Test", true),
      mk("training", "Physical Examination", true),
      mk("training", "Child Abuse Training", true),
      mk("training", "Mandated Reporter Training", true),
    );
  }

  return items;
}

function calculateComplianceScore(employeeId: string): number {
  const items = store.getComplianceItems({ employeeId });
  const required = items.filter((i) => i.isRequired);
  if (required.length === 0) return 100;
  const completed = required.filter((i) => i.status === "completed");
  return Math.round((completed.length / required.length) * 100);
}

function calculateReadinessFlags(employeeId: string): { payrollReady: boolean; hrReady: boolean; complianceReady: boolean; firstPayrollReady: boolean } {
  const items = store.getComplianceItems({ employeeId });
  const getStatus = (type: ComplianceItem["type"], name?: string) =>
    items.find((i) => i.type === type && (!name || i.name === name))?.status === "completed";

  const payrollReady = getStatus("w4") && getStatus("direct_deposit");
  const hrReady = getStatus("i9") && getStatus("handbook") && getStatus("policy");
  const complianceReady = getStatus("background_check");
  const firstPayrollReady = payrollReady && hrReady;

  return { payrollReady, hrReady, complianceReady, firstPayrollReady };
}

// ─── DEFAULT DEPARTMENTS ──────────────────────────────────────

const STANDARD_DEPARTMENTS = ["Operations", "Finance", "Human Resources", "Sales", "Marketing", "IT", "Customer Service", "Administration"];
const DAYCARE_DEPARTMENTS = ["Infant Room", "Toddler Room", "Preschool", "Pre-K", "Kitchen", "Front Desk"];

export function seedDepartmentsForCompany(companyId: string, isDaycare: boolean): void {
  if (store.hasDepartmentsForCompany(companyId)) return;
  const now = nowIso();
  for (const name of STANDARD_DEPARTMENTS) {
    store.addDepartment({ id: `dept-${uid()}`, companyId, name, type: "standard", isDefault: true, isActive: true, createdAt: now });
  }
  if (isDaycare) {
    for (const name of DAYCARE_DEPARTMENTS) {
      store.addDepartment({ id: `dept-${uid()}`, companyId, name, type: "daycare", isDefault: true, isActive: true, createdAt: now });
    }
  }
}

// ─── STARTUP BACKFILL ─────────────────────────────────────────

export async function backfillPeopleModule(): Promise<void> {
  // 1. Seed departments for existing companies
  const allCompanies = await db.select().from(companies);
  for (const company of allCompanies) {
    const isDaycare = company.industry === "daycare" || company.package === "full_daycare" || company.type === "daycare";
    seedDepartmentsForCompany(company.id, isDaycare);
  }

  // 2. Backfill existing employees: assign display IDs + compliance items
  const allEmployees = await db.select().from(employees);

  // Group by company to generate sequential IDs
  const byCompany = new Map<string, typeof allEmployees>();
  for (const emp of allEmployees) {
    const arr = byCompany.get(emp.companyId) ?? [];
    arr.push(emp);
    byCompany.set(emp.companyId, arr);
  }

  for (const [companyId, emps] of byCompany) {
    const existingDisplayIds = emps.map((e) => e.employeeDisplayId ?? "").filter(Boolean);
    const company = allCompanies.find((c) => c.id === companyId);
    const isDaycare = company ? (company.industry === "daycare" || company.package === "full_daycare" || company.type === "daycare") : false;

    for (const emp of emps) {
      const updates: Record<string, unknown> = { updatedAt: nowIso() };

      // Generate display ID if missing
      if (!emp.employeeDisplayId) {
        const newId = generateDisplayIdFromExisting(companyId, existingDisplayIds);
        updates.employeeDisplayId = newId;
        existingDisplayIds.push(newId);
      }

      // Create compliance items if not yet created for this employee
      const existing = store.getComplianceItems({ employeeId: emp.id });
      if (existing.length === 0) {
        const items = createComplianceItems(emp.id, companyId, isDaycare, {
          w4Submitted: emp.w4Submitted,
          bankAccountAdded: emp.bankAccountAdded,
          kycStatus: emp.kycStatus,
        });
        store.addComplianceItems(items);

        // Calculate and store compliance score
        const score = calculateComplianceScore(emp.id);
        updates.complianceScore = score;
        updates.onboardingProgress = score; // proxy
      }

      if (Object.keys(updates).length > 1) {
        await db.update(employees).set(updates as Parameters<typeof db.update>[0] extends infer T ? T : never).where(eq(employees.id, emp.id)).catch(() => {});
      }
    }
  }
}

// ─── DEPARTMENTS ──────────────────────────────────────────────

router.get("/departments", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const depts = store.getDepartments(companyId);
  const tasks = store.getOnboardingTasks({ companyId });
  const empTasks = new Map<string, number>();
  for (const t of tasks) {
    const key = t.companyId;
    empTasks.set(key, (empTasks.get(key) ?? 0) + 1);
  }

  const allEmployees = store.getUsersForCompany(companyId);
  const result = depts.map((d) => ({
    ...d,
    employeeCount: allEmployees.filter((e) => (e as unknown as Record<string, unknown>).department === d.name).length,
  }));

  res.json({ departments: result });
});

router.post("/departments", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { companyId, name } = req.body as { companyId?: string; name?: string };
  if (!companyId || !name) { res.status(400).json({ error: "companyId and name required" }); return; }

  const dept: Department = {
    id: `dept-${uid()}`,
    companyId,
    name: name.trim(),
    type: "custom",
    isDefault: false,
    isActive: true,
    createdAt: nowIso(),
  };
  store.addDepartment(dept);
  res.status(201).json({ department: dept });
});

router.put("/departments/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  const dept = store.getDepartmentById(id);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  if (dept.isDefault) { res.status(400).json({ error: "Cannot rename a default department" }); return; }

  store.updateDepartment(id, { name: name.trim() });
  res.json({ department: { ...dept, name: name.trim() } });
});

router.delete("/departments/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;

  const dept = store.getDepartmentById(id);
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  if (dept.isDefault) { res.status(400).json({ error: "Cannot delete a default department" }); return; }

  store.deleteDepartment(id);
  res.json({ success: true });
});

// ─── ONBOARDING TASKS ─────────────────────────────────────────

router.get("/onboarding-tasks", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { employeeId, companyId, status, userId } = req.query as Record<string, string | undefined>;

  if (userId) {
    const tasks = store.getOnboardingTasks({ assignedToUserId: userId });
    res.json({ tasks });
    return;
  }

  if (employeeId) {
    const tasks = store.getOnboardingTasks({ employeeId });
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed" || t.status === "skipped").length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const stages: Record<string, OnboardingTask[]> = {};
    for (const t of tasks) {
      if (!stages[t.stage]) stages[t.stage] = [];
      stages[t.stage]!.push(t);
    }
    res.json({ tasks, byStage: stages, completionPercentage: pct, total, completed });
    return;
  }

  if (companyId) {
    const filter: Parameters<typeof store.getOnboardingTasks>[0] = { companyId };
    if (status) filter.status = status;
    const tasks = store.getOnboardingTasks(filter);
    res.json({ tasks, count: tasks.length });
    return;
  }

  res.status(400).json({ error: "employeeId, companyId, or userId required" });
});

router.get("/onboarding-tasks/pipeline", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const all = store.getOnboardingTasks({ companyId });
  const STAGES: OnboardingTask["stage"][] = ["preboarding", "documents", "training", "equipment", "manager_tasks", "compliance", "ready_to_start"];

  const pipeline = STAGES.map((stage) => {
    const stageTasks = all.filter((t) => t.stage === stage);
    const completed = stageTasks.filter((t) => t.status === "completed").length;
    const inProgress = stageTasks.filter((t) => t.status === "in_progress").length;
    const pending = stageTasks.filter((t) => t.status === "pending").length;
    const total = stageTasks.length;
    return { stage, totalTasks: total, completed, inProgress, pending, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
  });

  res.json({ pipeline, totalTasks: all.length, completedTasks: all.filter((t) => t.status === "completed").length });
});

router.post("/onboarding-tasks/:id/complete", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const task = store.getOnboardingTaskById(id);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const now = nowIso();
  store.updateOnboardingTask(id, { status: "completed", completedAt: now, completedBy: req.session.userId });

  // Update linked compliance item if applicable
  const complianceMap: Record<string, ComplianceItem["type"]> = {
    "Federal W-4": "w4", "I-9 Section 1": "i9", "I-9 Section 2 Verification": "i9",
    "Direct Deposit Setup": "direct_deposit", "Background Check": "background_check",
    "Employee Handbook Acknowledgment": "handbook", "Company Policy Acknowledgment": "policy",
    "Fingerprint Clearance": "fingerprint",
  };
  const ciType = complianceMap[task.taskName];
  if (ciType) {
    const ci = store.getComplianceItems({ employeeId: task.employeeId }).find((c) => c.type === ciType && c.status !== "completed");
    if (ci) store.updateComplianceItem(ci.id, { status: "completed", completedAt: now });
  }

  // Check if all required tasks for this employee are done
  const allTasks = store.getOnboardingTasks({ employeeId: task.employeeId });
  const required = allTasks.filter((t) => t.isRequired);
  const allRequiredDone = required.every((t) => t.status === "completed" || t.status === "skipped" || t.id === id);
  const progress = Math.round((allTasks.filter((t) => t.status === "completed" || t.status === "skipped").length / allTasks.length) * 100);
  const flags = calculateReadinessFlags(task.employeeId);

  const dbUpdates: Record<string, unknown> = {
    onboardingProgress: progress,
    payrollReady: flags.payrollReady,
    hrReady: flags.hrReady,
    complianceReady: flags.complianceReady,
    firstPayrollReady: flags.firstPayrollReady,
    complianceScore: calculateComplianceScore(task.employeeId),
    updatedAt: now,
  };
  if (allRequiredDone) {
    dbUpdates.status = "active";
    dbUpdates.onboardingCompletedAt = now;
  }

  await db.update(employees).set(dbUpdates as Parameters<typeof db.update>[0] extends infer T ? T : never).where(eq(employees.id, task.employeeId)).catch(() => {});

  store.logPeopleActivity({
    companyId: task.companyId,
    employeeId: task.employeeId,
    action: "task.completed",
    description: `Task "${task.taskName}" completed`,
    category: "onboarding",
    performedBy: req.session.userId,
  });

  res.json({ success: true, task: store.getOnboardingTaskById(id), allRequiredDone, progress });
});

router.post("/onboarding-tasks/:id/skip", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const task = store.getOnboardingTaskById(id);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.isRequired) { res.status(400).json({ error: "Cannot skip a required task" }); return; }

  store.updateOnboardingTask(id, { status: "skipped" });
  res.json({ success: true });
});

// ─── COMPLIANCE ───────────────────────────────────────────────

router.get("/compliance", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }

  const items = store.getComplianceItems({ employeeId });
  const score = calculateComplianceScore(employeeId);
  res.json({ items, score });
});

router.get("/compliance/company-overview", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.query.companyId ?? "");
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const all = store.getComplianceItems({ companyId });
  const categories: ComplianceItem["type"][] = ["i9", "w4", "direct_deposit", "background_check", "handbook", "policy", "fingerprint", "certification", "training"];
  const overview = categories.map((cat) => {
    const items = all.filter((i) => i.type === cat);
    const completed = items.filter((i) => i.status === "completed").length;
    return { category: cat, total: items.length, completed, percentage: items.length > 0 ? Math.round((completed / items.length) * 100) : 0 };
  }).filter((o) => o.total > 0);

  const required = all.filter((i) => i.isRequired);
  const completedRequired = required.filter((i) => i.status === "completed");
  const overallScore = required.length > 0 ? Math.round((completedRequired.length / required.length) * 100) : 100;

  res.json({ overview, overallScore, totalItems: all.length, completedItems: completedRequired.length });
});

router.post("/compliance/:id/complete", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const item = store.getComplianceItemById(id);
  if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }

  const now = nowIso();
  store.updateComplianceItem(id, { status: "completed", completedAt: now });

  // Update i9Status / backgroundCheckStatus on employee record
  const dbField: Record<ComplianceItem["type"], string | null> = {
    i9: "i9Status", background_check: "backgroundCheckStatus", w4: null,
    state_w4: null, direct_deposit: null, handbook: null, policy: null,
    training: null, certification: null, fingerprint: null, custom: null,
  };
  const field = dbField[item.type];
  const updates: Record<string, unknown> = { updatedAt: now, complianceScore: calculateComplianceScore(item.employeeId) };
  if (field === "i9Status") updates.i9Status = "verified";
  if (field === "backgroundCheckStatus") updates.backgroundCheckStatus = "completed";

  const flags = calculateReadinessFlags(item.employeeId);
  updates.payrollReady = flags.payrollReady;
  updates.hrReady = flags.hrReady;
  updates.complianceReady = flags.complianceReady;
  updates.firstPayrollReady = flags.firstPayrollReady;

  await db.update(employees).set(updates as Parameters<typeof db.update>[0] extends infer T ? T : never).where(eq(employees.id, item.employeeId)).catch(() => {});

  store.logPeopleActivity({
    companyId: item.companyId,
    employeeId: item.employeeId,
    action: "compliance.item_completed",
    description: `Compliance item "${item.name}" marked complete`,
    category: "compliance",
    performedBy: req.session.userId,
  });

  res.json({ success: true, item: store.getComplianceItemById(id), score: calculateComplianceScore(item.employeeId) });
});

router.post("/compliance/:id/waive", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const item = store.getComplianceItemById(id);
  if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }
  if (item.isRequired) { res.status(400).json({ error: "Cannot waive a required compliance item" }); return; }

  store.updateComplianceItem(id, { status: "waived" });
  res.json({ success: true });
});

// ─── EMERGENCY CONTACTS ───────────────────────────────────────

router.get("/emergency-contacts", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId required" }); return; }
  res.json({ contacts: store.getEmergencyContacts(employeeId) });
});

router.post("/emergency-contacts", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as {
    employeeId?: string; companyId?: string; contactType?: "primary" | "secondary";
    name?: string; relationship?: string; phoneNumber?: string;
    alternatePhone?: string; email?: string; address?: string;
    physicianName?: string; physicianPhone?: string; insuranceProvider?: string; insurancePolicyNumber?: string;
  };
  if (!body.employeeId || !body.companyId || !body.name || !body.relationship || !body.phoneNumber) {
    res.status(400).json({ error: "employeeId, companyId, name, relationship, and phoneNumber required" });
    return;
  }
  const now = nowIso();
  const contact = {
    id: `ec-${uid()}`,
    employeeId: body.employeeId,
    companyId: body.companyId,
    contactType: body.contactType ?? "primary",
    name: body.name,
    relationship: body.relationship,
    phoneNumber: body.phoneNumber,
    alternatePhone: body.alternatePhone,
    email: body.email,
    address: body.address,
    physicianName: body.physicianName,
    physicianPhone: body.physicianPhone,
    insuranceProvider: body.insuranceProvider,
    insurancePolicyNumber: body.insurancePolicyNumber,
    createdAt: now,
    updatedAt: now,
  };
  store.addEmergencyContact(contact);
  res.status(201).json({ contact });
});

router.put("/emergency-contacts/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const contact = store.getEmergencyContactById(id);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
  store.updateEmergencyContact(id, req.body as Record<string, unknown>);
  res.json({ contact: store.getEmergencyContactById(id) });
});

router.delete("/emergency-contacts/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  store.deleteEmergencyContact(id);
  res.json({ success: true });
});

// ─── DOCUMENTS ────────────────────────────────────────────────

router.get("/documents", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { employeeId, companyId } = req.query as Record<string, string | undefined>;
  if (!employeeId && !companyId) { res.status(400).json({ error: "employeeId or companyId required" }); return; }
  res.json({ documents: store.getDocuments({ employeeId, companyId }) });
});

router.post("/documents", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as {
    employeeId?: string; companyId?: string; documentName?: string;
    documentType?: "i9" | "w4" | "handbook" | "policy" | "offer_letter" | "nda" | "license" | "certification" | "background_check" | "tax_form" | "custom";
    customTypeName?: string; fileName?: string; fileUrl?: string; fileSize?: number; mimeType?: string;
    requiresSignature?: boolean; expiryDate?: string; notes?: string;
  };
  if (!body.employeeId || !body.companyId || !body.documentName || !body.documentType || !body.fileName) {
    res.status(400).json({ error: "employeeId, companyId, documentName, documentType, fileName required" });
    return;
  }
  const now = nowIso();
  const doc = {
    id: `doc-${uid()}`,
    employeeId: body.employeeId,
    companyId: body.companyId,
    documentName: body.documentName,
    documentType: body.documentType,
    customTypeName: body.customTypeName,
    fileName: body.fileName,
    fileUrl: body.fileUrl ?? `/api/documents/placeholder/${body.fileName}`,
    fileSize: body.fileSize,
    mimeType: body.mimeType,
    status: "uploaded" as const,
    uploadedAt: now,
    uploadedBy: req.session.userId,
    expiryDate: body.expiryDate,
    requiresSignature: body.requiresSignature ?? false,
    notes: body.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.addDocument(doc);

  store.logPeopleActivity({
    companyId: body.companyId,
    employeeId: body.employeeId,
    action: "document.uploaded",
    description: `Document "${body.documentName}" uploaded`,
    category: "document",
    performedBy: req.session.userId,
  });

  res.status(201).json({ document: doc });
});

router.put("/documents/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  const doc = store.getDocumentById(id);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  store.updateDocument(id, req.body as Record<string, unknown>);
  res.json({ document: store.getDocumentById(id) });
});

router.delete("/documents/:id", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = req.params.id as string;
  store.updateDocument(id, { status: "rejected" });
  res.json({ success: true });
});

// ─── ACTIVITY LOG ─────────────────────────────────────────────

router.get("/activity-log", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { companyId, employeeId, category, limit } = req.query as Record<string, string | undefined>;
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const entries = store.getPeopleActivity({
    companyId,
    employeeId,
    category,
    limit: limit ? parseInt(limit, 10) : 20,
  });
  res.json({ entries });
});

router.post("/activity-log", (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as {
    companyId?: string; employeeId?: string; action?: string;
    description?: string; category?: "employee" | "onboarding" | "compliance" | "payroll" | "document" | "system";
    performedBy?: string; metadata?: Record<string, unknown>;
  };
  if (!body.companyId || !body.action || !body.description || !body.category) {
    res.status(400).json({ error: "companyId, action, description, category required" });
    return;
  }
  store.logPeopleActivity({
    companyId: body.companyId,
    employeeId: body.employeeId,
    action: body.action,
    description: body.description,
    category: body.category,
    performedBy: body.performedBy ?? req.session.userId,
    metadata: body.metadata,
  });
  res.status(201).json({ success: true });
});

export default router;
