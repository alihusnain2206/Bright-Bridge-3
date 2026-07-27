/**
 * POST /api/admin/import-brightbridge
 *
 * One-time import endpoint: reads BrightbridgeAssist LLC and its 4 employees
 * from PRODUCTION Rollfi (read-only) and writes all DB rows directly.
 *
 * SAFETY CONSTRAINTS (enforced):
 *   - ZERO write calls to Rollfi — permitted reads only:
 *       getCompanyInfo, getCompanyLocationInfo, getUsers, getUser
 *   - Does NOT reuse onboardEmployeeToRollfi, syncEmployeeToIntegrations,
 *     runEmployeeKycOnboarding, or registerEmployeeInEasyTeam.
 *     All DB inserts are written inline in this file.
 *   - SSN and dateOfBirth are deleted from getUser response immediately on
 *     receipt and are never stored, logged, or printed.
 *   - Idempotent: onConflictDoUpdate / onConflictDoNothing on every insert.
 *   - Auth: Authorization: Bearer <IMPORT_ADMIN_SECRET> (env var, never hardcoded).
 */

import { Router, type Request, type Response, type IRouter } from "express";
import axios from "axios";
import {
  db,
  companies,
  employees,
  rollfiCompanyRecords,
  rollfiEmployeeRecords,
  userAccounts,
  onboardingTasks as onboardingTasksTable,
  complianceItems as complianceItemsTable,
  peopleActivityLog as peopleActivityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getRollfiConfig } from "../lib/rollfi-config.js";
import { store } from "../store.js";
import { seedDepartmentsForCompany } from "./people.js";

const router: IRouter = Router();

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Rollfi production company ID — confirmed via getCompanies in prior dry-run. */
const ROLLFI_CO_ID = "1F78ADC2-5E7B-4D6A-88A8-1DDABEC4352F";

/** Our canonical internal ID — must match store.ts USER-001.companyId. */
const INTERNAL_CO_ID = "ORG-BRIGHTBRIDGE";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function addDays(dateStr: string | undefined, days: number): string {
  const base = dateStr ? new Date(dateStr) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split("T")[0]!;
}

/**
 * Strips every field that could contain PII before the object is logged.
 * SSN is the critical field — must never appear in logs.
 */
function safeLog(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return (data as unknown[]).map(safeLog);
  const d = data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    const lower = k.toLowerCase();
    if (
      lower === "ssn" || lower === "dateofbirth" || lower === "w4informations" ||
      lower === "statew4informations" || lower === "bankaccounts" ||
      lower === "recurringpayitems" || lower === "employeegarnishments" ||
      lower === "authorization"
    ) {
      safe[k] = "[REDACTED]";
    } else if (typeof v === "object") {
      safe[k] = safeLog(v);
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

// ─── ROLLFI TYPES (read-only responses) ──────────────────────────────────────

interface RollfiUser {
  userId: string; firstName: string; lastName: string;
  middleName: string; phoneNumber: string; kycStatus: string;
  jobTitle: string; dateOfJoin: string; email: string;
  WorkerType: { WorkerType: string };
  status: { userStatus: string };
  userWages: Array<{
    WageRate: number;
    WageBasis: { WageBasis: string };
    paymentMethod: { PaymentMethod: string };
  }>;
  userAddress: {
    address1: string; address2?: string; city: string;
    state: string; zipcode: string; country: string;
  } | null;
}

interface RollfiUserDetail extends RollfiUser {
  isTermsAccepted?: boolean;
  userWages: Array<{
    userWageId: string; standardWorkingHours: number; WageRate: number;
    WageBasis: { WageBasis: string };
    paymentMethod: { PaymentMethod: string };
    employeeRefTaxExempt: string; employeeType: string;
    differentialPay: string; employmentStatus: string;
  }>;
  stateCode?: string;
  companyLocationCategory?: { companyLocationCategory: string };
  // SSN: intentionally NOT typed — deleted immediately on receipt
  // dateOfBirth: read but not stored — deleted immediately on receipt
  W4Informations?: Array<{
    W4FilingStatus: { W4FilingStatus: string };
    HaveMultipleJob: boolean; Dependents: number; ExtraWithholding: number;
  }>;
  stateW4Informations?: Array<Record<string, string>>;
  bankAccounts?: Array<{ bankName?: string; accountNumber?: string; accountType?: string }>;
}

interface RollfiCompanyInfo {
  company: string; companyID: string; businessWebsite?: string;
  CompanyLocations?: Array<{
    address1: string; address2?: string; city: string; state: string;
    zipcode: string; country: string; companyLocation: string;
  }>;
  KYBInformations?: Array<{
    ein?: string; email?: string; phoneNumber?: string; dateOfIncorporation?: string;
  }>;
  kycStatus?: string;
  BankAccounts?: Array<{ bankName?: string; accountNumber?: string; accountType?: string; status?: string }>;
  PaySchedules?: Array<{
    payScheduleId?: string; payBeginDate?: string; payEndDate?: string;
    payDate?: string; compensationFrequency?: string;
  }>;
}

// ─── W4 NORMALISATION (mirrors rollfi-employee-sync.ts) ──────────────────────

const VALID_W4_STATUSES = ["Single", "Married", "Head of Household"] as const;
const W4_LEGACY_MAP: Record<string, string> = {
  "Head of household": "Head of Household",
  "head of household": "Head of Household",
  "Married Filing Jointly": "Married",
  "married": "Married",
  "single": "Single",
};

function normalizeW4(status: string | undefined | null): string {
  if (!status) return "Single";
  if ((VALID_W4_STATUSES as readonly string[]).includes(status)) return status;
  return W4_LEGACY_MAP[status] ?? W4_LEGACY_MAP[status.toLowerCase()] ?? status;
}

// ─── ONBOARDING TASK TEMPLATES (verbatim copy from people.ts) ────────────────

type TaskTemplate = {
  taskName: string; category: string; stage: string;
  assignedToRole: string; dueDaysAfterHire: number; isRequired: boolean;
};

const STANDARD_HR_PAYROLL_TASKS: TaskTemplate[] = [
  { taskName: "Complete Personal Information",      category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Emergency Contact",                  category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Federal W-4",                        category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "State Tax Form",                     category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "I-9 Section 1",                      category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "I-9 Section 2 Verification",         category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Direct Deposit Setup",               category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Employee Handbook Acknowledgment",   category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Company Policy Acknowledgment",      category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Confidentiality/NDA",                category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: false },
  { taskName: "Code of Conduct Acknowledgment",     category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "IT Acceptable Use Policy",           category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Benefit Enrollment",                 category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Retirement Plan Enrollment",         category: "hr_payroll", stage: "preboarding",  assignedToRole: "employee", dueDaysAfterHire: 14, isRequired: false },
  { taskName: "Assign Pay Schedule",                category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Department",                  category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Manager",                     category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Job Title",                   category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Work Location",               category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Issue Employee ID",                  category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Time & Attendance Profile",   category: "hr_payroll", stage: "preboarding",  assignedToRole: "hr",       dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Upload Required Documents",          category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "E-Sign All Required Forms",          category: "hr_payroll", stage: "documents",    assignedToRole: "employee", dueDaysAfterHire: 7,  isRequired: true  },
];
const MANAGER_TASKS: TaskTemplate[] = [
  { taskName: "Schedule Orientation",       category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Schedule First Day Meeting", category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 1,  isRequired: true  },
  { taskName: "Assign Mentor/Buddy",        category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 3,  isRequired: false },
  { taskName: "Assign Training Plan",       category: "manager", stage: "training",      assignedToRole: "manager", dueDaysAfterHire: 3,  isRequired: true  },
  { taskName: "Assign Learning Courses",    category: "manager", stage: "training",      assignedToRole: "manager", dueDaysAfterHire: 7,  isRequired: false },
  { taskName: "Set 30/60/90 Day Goals",     category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 7,  isRequired: true  },
  { taskName: "Schedule 30-Day Review",     category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 30, isRequired: true  },
  { taskName: "Schedule 60-Day Review",     category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 60, isRequired: true  },
  { taskName: "Schedule 90-Day Review",     category: "manager", stage: "manager_tasks", assignedToRole: "manager", dueDaysAfterHire: 90, isRequired: true  },
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

const ALL_TASKS_TEMPLATE: TaskTemplate[] = [
  ...STANDARD_HR_PAYROLL_TASKS,
  ...MANAGER_TASKS,
  ...IT_TASKS,
  ...COMPLIANCE_TASKS,
];

// ─── ROW BUILDER ─────────────────────────────────────────────────────────────

interface BuiltEmployee {
  emp:        typeof employees.$inferInsert;
  account:    typeof userAccounts.$inferInsert;
  rollfiRec:  typeof rollfiEmployeeRecords.$inferInsert;
  compliance: Array<typeof complianceItemsTable.$inferInsert>;
  tasks:      Array<typeof onboardingTasksTable.$inferInsert>;
  activity:   typeof peopleActivityLogTable.$inferInsert;
}

function buildEmployeeRows(
  detail: RollfiUserDetail,
  companyId: string,
  displayId: string,
  w4Submitted: boolean,
  bankAccountAdded: boolean,
  now: string,
): BuiltEmployee {
  const today   = now.split("T")[0]!;
  const empId   = `EMP-${uid().toUpperCase()}`;
  const userId  = `USER-DYN-${empId}`;

  const wageBasis = detail.userWages[0]?.WageBasis?.WageBasis ?? "Per Hour";
  const payType   = wageBasis === "Per Hour" ? "hourly" : "salary";
  const wageRate  = detail.userWages[0]?.WageRate ?? 0;
  const kycStatus = detail.kycStatus ?? "new";
  const status    = kycStatus === "passed" ? "active" : "onboarding";

  const hourlyWage   = payType === "hourly" ? Math.round(wageRate * 100) : 0;
  const annualSalary = payType === "salary" ? Math.round(wageRate * 100) : null;

  const w4 = detail.W4Informations?.[0];

  const emp: typeof employees.$inferInsert = {
    id:             empId,
    companyId,
    firstName:      detail.firstName,
    lastName:       detail.lastName,
    email:          detail.email,
    phone:          detail.phoneNumber ?? "",
    position:       detail.jobTitle ?? "Staff",
    employmentType: detail.userWages[0]?.employmentStatus ?? "Full Time (30+ Hours per week)",
    workerType:     detail.WorkerType?.WorkerType ?? "W2",
    startDate:      detail.dateOfJoin ?? today,
    payType,
    hourlyWage,
    annualSalary,
    overtimeEligible: detail.userWages[0]?.employeeType
      ? detail.userWages[0].employeeType.toLowerCase().includes("eligible for overtime")
      : true,
    paymentMethod:  detail.userWages[0]?.paymentMethod?.PaymentMethod ?? "Direct Deposit",
    taxExempt:      detail.userWages[0]?.employeeRefTaxExempt
      ? !detail.userWages[0].employeeRefTaxExempt.toLowerCase().includes("not tax exempt")
      : false,
    homeAddress:    detail.userAddress?.address1 ?? null,
    homeCity:       detail.userAddress?.city ?? null,
    homeState:      detail.stateCode ?? detail.userAddress?.state ?? null,
    homeZip:        detail.userAddress?.zipcode ?? null,
    ssn:            null,          // ← NEVER stored
    dateOfBirth:    null,          // ← NEVER stored
    w4FilingStatus:     w4 ? normalizeW4(w4.W4FilingStatus?.W4FilingStatus) : null,
    w4MultipleJobs:     w4?.HaveMultipleJob ?? false,
    w4Dependents:       w4?.Dependents ?? 0,
    w4ExtraWithholding: w4?.ExtraWithholding ?? 0,
    w4Submitted,
    rollfiUserId:        detail.userId,
    rollfiWageId:        detail.userWages[0]?.userWageId ?? null,
    rollfiOnboardedAt:   now,
    rollfiAccountStatus: detail.status?.userStatus ?? null,
    kycStatus,
    bankAccountAdded,
    status,
    employeeDisplayId: displayId,
    syncStatus:        "synced",
    department:   null,
    managerId:    null,
    managerName:  null,
    jobTitle:     detail.jobTitle ?? null,
    employeeType: detail.userWages[0]?.employeeType ?? null,
    workLocation: detail.companyLocationCategory?.companyLocationCategory ?? null,
    complianceScore:   0,
    i9Status:          kycStatus === "verified" ? "completed" : "not_started",
    backgroundCheckStatus: "not_started",
    onboardingProgress:    0,
    onboardingStartedAt:   now,
    payrollReady:      false,
    hrReady:           false,
    complianceReady:   false,
    firstPayrollReady: false,
    createdAt: now,
    updatedAt: now,
  };

  const account: typeof userAccounts.$inferInsert = {
    id:         userId,
    name:       `${detail.firstName} ${detail.lastName}`,
    email:      detail.email,
    password:   "Staff123!",
    role:       "employee",
    companyId,
    locationId: null,
    employeeId: empId,
    position:   detail.jobTitle ?? "Staff",
    createdAt:  now,
  };

  const rollfiRec: typeof rollfiEmployeeRecords.$inferInsert = {
    employeeId:   empId,
    rollfiUserId: detail.userId,
    rollfiWageId: detail.userWages[0]?.userWageId ?? "",
    onboardedAt:  now,
  };

  const mk = (type: string, name: string, isRequired: boolean, preCompleted = false) => ({
    id:          `ci-${uid()}`,
    employeeId:  empId,
    companyId,
    type,
    name,
    status:      preCompleted ? "completed" : "not_started",
    isRequired,
    completedAt: preCompleted ? now : null,
    createdAt:   now,
    updatedAt:   now,
  });

  const compliance = [
    mk("i9",               "I-9 Employment Eligibility",          true,  kycStatus === "verified"),
    mk("w4",               "Federal W-4",                         true,  w4Submitted),
    mk("state_w4",         "State Tax Form",                       true),
    mk("direct_deposit",   "Direct Deposit",                       true,  bankAccountAdded),
    mk("background_check", "Background Check",                     true),
    mk("handbook",         "Employee Handbook Acknowledgment",     true),
    mk("policy",           "Company Policies Acknowledgment",      true),
  ];

  const tasks = ALL_TASKS_TEMPLATE.map((t) => ({
    id:               `task-${uid()}`,
    employeeId:       empId,
    companyId,
    taskName:         t.taskName,
    category:         t.category,
    stage:            t.stage,
    assignedToRole:   t.assignedToRole,
    assignedToUserId: null,
    status:           "pending",
    isRequired:       t.isRequired,
    dueDaysAfterHire: t.dueDaysAfterHire,
    dueDate:          addDays(detail.dateOfJoin, t.dueDaysAfterHire),
    autoGenerated:    true,
    createdAt:        now,
    updatedAt:        now,
  }));

  const activity: typeof peopleActivityLogTable.$inferInsert = {
    id:          `pal-${uid()}`,
    companyId,
    employeeId:  empId,
    action:      "employee.imported",
    description: `${detail.firstName} ${detail.lastName} imported from PRODUCTION Rollfi (userId: ${detail.userId})`,
    category:    "system",
    performedBy: "admin-import-endpoint",
    metadata:    JSON.stringify({
      rollfiUserId: detail.userId,
      rollfiWageId: detail.userWages[0]?.userWageId ?? null,
      source: "admin-import-brightbridge",
    }),
    timestamp:   now,
  };

  return { emp, account, rollfiRec, compliance, tasks, activity };
}

// ─── ENDPOINT ────────────────────────────────────────────────────────────────

router.post("/admin/import-brightbridge", async (req: Request, res: Response) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.IMPORT_ADMIN_SECRET;
  if (!secret) {
    res.status(503).json({ error: "IMPORT_ADMIN_SECRET env var is not set on this server." });
    return;
  }
  const authHeader = req.headers.authorization ?? "";
  const provided   = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!provided || provided !== secret) {
    res.status(401).json({ error: "Unauthorized — invalid or missing Bearer token." });
    return;
  }

  // ── Rollfi credentials check ──────────────────────────────────────────────
  const { baseUrl, clientId, secretKey, credentialsPresent, env } = getRollfiConfig();
  if (!credentialsPresent) {
    res.status(503).json({ error: `Rollfi credentials not present (env=${env}). Cannot read from Rollfi.` });
    return;
  }

  const rollfiHeaders = {
    Authorization: `Basic ${Buffer.from(`${clientId}:${secretKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  async function rollfiPost<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const r = await axios.post(`${baseUrl}/${endpoint}`, body, {
      headers: rollfiHeaders,
      timeout: 25_000,
    });
    return r.data as T;
  }

  const now = new Date().toISOString();
  req.log.info({ env, rollfiCoId: ROLLFI_CO_ID, internalCoId: INTERNAL_CO_ID }, "admin-import-brightbridge: starting");

  try {
    // ── STEP 1: getCompanyInfo (READ ONLY) ─────────────────────────────────
    req.log.info("admin-import: calling getCompanyInfo (read-only)");
    const companyInfoResp = await rollfiPost<{ Company: RollfiCompanyInfo[] }>(
      "reports#getCompanyInfo",
      { method: "getCompanyInfo", companyId: ROLLFI_CO_ID },
    );
    const companyInfo = companyInfoResp.Company[0];
    if (!companyInfo) {
      res.status(502).json({ error: "getCompanyInfo returned no company data." });
      return;
    }
    req.log.info({ company: companyInfo.company, kycStatus: companyInfo.kycStatus }, "admin-import: getCompanyInfo OK");

    // ── STEP 2: getCompanyLocationInfo (READ ONLY) ─────────────────────────
    req.log.info("admin-import: calling getCompanyLocationInfo (read-only)");
    let rollfiLocationId = "";
    try {
      const locResp = await rollfiPost<{ CompanyLocation?: Array<{ companyLocationID: string; isWorkLocation?: boolean }> }>(
        "reports#getCompanyLocationInfo",
        { method: "getCompanyLocationInfo", companyId: ROLLFI_CO_ID },
      );
      const locs = locResp.CompanyLocation ?? [];
      const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
      rollfiLocationId = work?.companyLocationID ?? "";
      req.log.info({ rollfiLocationId, locationCount: locs.length }, "admin-import: getCompanyLocationInfo OK");
    } catch (locErr) {
      req.log.warn({ locErr }, "admin-import: getCompanyLocationInfo failed — rollfiLocationId will be empty");
    }

    // ── STEP 3: getUsers (READ ONLY) ───────────────────────────────────────
    req.log.info("admin-import: calling getUsers (read-only)");
    const getUsersResp = await rollfiPost<{ users: RollfiUser[] }>(
      "reports#getUsers",
      { method: "getUsers", companyId: ROLLFI_CO_ID },
    );
    const users = getUsersResp.users ?? [];
    req.log.info({ count: users.length }, "admin-import: getUsers OK");

    // ── STEP 4: getUser for each employee (READ ONLY) ──────────────────────
    req.log.info("admin-import: calling getUser for each employee (read-only)");
    const details: RollfiUserDetail[] = [];
    for (const u of users) {
      const resp = await rollfiPost<{ user: RollfiUserDetail[] }>(
        "reports#getUser",
        { method: "getUser", companyId: ROLLFI_CO_ID, userId: u.userId },
      );
      const detail = resp.user[0];
      if (!detail) continue;

      // ══ SSN GUARD ══
      // Delete SSN immediately before ANY other use of `detail`.
      // Never log, never store, never pass to safeLog (in case safeLog misses it).
      delete (detail as unknown as Record<string, unknown>)["ssn"];
      // dateOfBirth: available but not stored — delete immediately.
      delete (detail as unknown as Record<string, unknown>)["dateOfBirth"];

      details.push(detail);
      req.log.info(
        { userId: detail.userId, name: `${detail.firstName} ${detail.lastName}`, kycStatus: detail.kycStatus, wageId: detail.userWages[0]?.userWageId ?? "none", w4Count: detail.W4Informations?.length ?? 0 },
        "admin-import: getUser OK (ssn+dob deleted)",
      );
    }

    // ── STEP 5: Build all rows ─────────────────────────────────────────────
    const loc   = companyInfo.CompanyLocations?.[0];
    const kyb   = companyInfo.KYBInformations?.[0];
    const bank  = companyInfo.BankAccounts?.[0];
    const sched = companyInfo.PaySchedules?.[0];

    const bankAccountAdded = !!(bank && bank.status && bank.status !== "notfound");

    const companyRow: typeof companies.$inferInsert = {
      id:               INTERNAL_CO_ID,
      name:             companyInfo.company,
      doingBusinessAs:  null,
      businessWebsite:  companyInfo.businessWebsite ?? null,
      phone:            kyb?.phoneNumber ?? "",
      industry:         "staffing",
      package:          "full_daycare",
      status:           companyInfo.kycStatus === "passed" ? "active" : "pending",
      address1:         loc?.address1 ?? "",
      address2:         loc?.address2 ?? null,
      city:             loc?.city ?? "",
      state:            loc?.state ?? "NJ",
      zipcode:          loc?.zipcode ?? "",
      locationName:     loc?.companyLocation ?? null,
      rollfiCompanyId:  ROLLFI_CO_ID,
      rollfiLocationId: rollfiLocationId || null,
      rollfiOnboardedAt: now,
      ein:              kyb?.ein ?? null,
      fundingBankName:       bank?.bankName ?? null,
      fundingAccountLast4:   bank?.accountNumber?.replace(/X/g, "").slice(-4) ?? null,
      fundingAccountType:    bank?.accountType ?? null,
      kybStatus:             companyInfo.kycStatus === "passed" ? "approved" : "not_started",
      bankAccountAdded,
      payScheduleAdded:      !!(sched),
      payFrequency:          sched?.compensationFrequency ?? null,
      firstPayDate:          sched?.payDate ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const rollfiCompanyRow: typeof rollfiCompanyRecords.$inferInsert = {
      companyId:        INTERNAL_CO_ID,
      rollfiCompanyId:  ROLLFI_CO_ID,
      rollfiLocationId: rollfiLocationId,
      onboardedAt:      now,
      ein:              kyb?.ein ?? null,
      ownerSsn:         null,   // never stored
    };

    const builtEmployees: BuiltEmployee[] = details.map((d, i) => {
      const displayId      = `E${1001 + i}`;
      const w4Submitted    = !!(d.W4Informations && d.W4Informations.length > 0);
      const empBankAdded   = !!(d.bankAccounts && d.bankAccounts.length > 0);
      return buildEmployeeRows(d, INTERNAL_CO_ID, displayId, w4Submitted, empBankAdded, now);
    });

    // ── STEP 6: Write to DB (idempotent) ───────────────────────────────────

    // 6a. companies
    await db.insert(companies)
      .values(companyRow)
      .onConflictDoUpdate({
        target: companies.id,
        set: {
          rollfiCompanyId:  companyRow.rollfiCompanyId,
          rollfiLocationId: companyRow.rollfiLocationId,
          rollfiOnboardedAt: companyRow.rollfiOnboardedAt,
          kybStatus:         companyRow.kybStatus,
          bankAccountAdded:  companyRow.bankAccountAdded,
          payScheduleAdded:  companyRow.payScheduleAdded,
          payFrequency:      companyRow.payFrequency,
          ein:               companyRow.ein,
          fundingBankName:   companyRow.fundingBankName,
          fundingAccountLast4: companyRow.fundingAccountLast4,
          fundingAccountType: companyRow.fundingAccountType,
          updatedAt:         now,
        },
      });
    req.log.info("admin-import: companies row upserted");

    // 6b. rollfi_company_records
    await db.insert(rollfiCompanyRecords)
      .values(rollfiCompanyRow)
      .onConflictDoUpdate({
        target: rollfiCompanyRecords.companyId,
        set: {
          rollfiCompanyId:  rollfiCompanyRow.rollfiCompanyId,
          rollfiLocationId: rollfiCompanyRow.rollfiLocationId,
          ein:              rollfiCompanyRow.ein,
        },
      });
    req.log.info("admin-import: rollfi_company_records row upserted");

    // 6c. Update in-memory store for company
    store.setRollfiCompany(INTERNAL_CO_ID, {
      rollfiCompanyId:  ROLLFI_CO_ID,
      rollfiLocationId: rollfiLocationId,
      onboardedAt:      now,
      ein:              kyb?.ein ?? undefined,
      ownerSsn:         undefined,
    });

    // 6d. Seed departments (in-memory, idempotent)
    seedDepartmentsForCompany(INTERNAL_CO_ID, false);

    // 6e. Per-employee inserts
    const employeeSummary: Array<Record<string, unknown>> = [];

    for (const { emp, account, rollfiRec, compliance, tasks, activity } of builtEmployees) {
      const name = `${emp.firstName} ${emp.lastName}`;

      // employees — skip if already exists (idempotent on email collision)
      await db.insert(employees).values(emp).onConflictDoNothing();
      req.log.info({ empId: emp.id, name, rollfiUserId: emp.rollfiUserId }, "admin-import: employees row inserted (or skipped)");

      // user_accounts — skip if email already in DB
      await db.insert(userAccounts).values(account).onConflictDoNothing();
      req.log.info({ accountId: account.id, email: account.email }, "admin-import: user_accounts row inserted (or skipped)");

      // rollfi_employee_records
      await db.insert(rollfiEmployeeRecords).values(rollfiRec).onConflictDoNothing();
      req.log.info({ empId: rollfiRec.employeeId, rollfiUserId: rollfiRec.rollfiUserId }, "admin-import: rollfi_employee_records row inserted (or skipped)");

      // compliance_items — only insert if none exist yet for this employee
      const existingCompliance = await db.select({ id: complianceItemsTable.id })
        .from(complianceItemsTable)
        .where(eq(complianceItemsTable.employeeId, emp.id));
      if (existingCompliance.length === 0) {
        await db.insert(complianceItemsTable).values(compliance);
        req.log.info({ empId: emp.id, count: compliance.length }, "admin-import: compliance_items inserted");
      } else {
        req.log.info({ empId: emp.id, existing: existingCompliance.length }, "admin-import: compliance_items already exist — skipped");
      }

      // onboarding_tasks — only insert if none exist yet for this employee
      const existingTasks = await db.select({ id: onboardingTasksTable.id })
        .from(onboardingTasksTable)
        .where(eq(onboardingTasksTable.employeeId, emp.id));
      if (existingTasks.length === 0) {
        for (let i = 0; i < tasks.length; i += 50) {
          await db.insert(onboardingTasksTable).values(tasks.slice(i, i + 50));
        }
        req.log.info({ empId: emp.id, count: tasks.length }, "admin-import: onboarding_tasks inserted");
      } else {
        req.log.info({ empId: emp.id, existing: existingTasks.length }, "admin-import: onboarding_tasks already exist — skipped");
      }

      // people_activity_log
      await db.insert(peopleActivityLogTable).values(activity);
      req.log.info({ empId: emp.id }, "admin-import: people_activity_log inserted");

      // Update in-memory store
      store.setRollfiEmployee(emp.id, {
        rollfiUserId: rollfiRec.rollfiUserId,
        rollfiWageId: rollfiRec.rollfiWageId ?? undefined,
        onboardedAt:  now,
      });
      // Add login account to in-memory store (skip if email already registered)
      if (!store.getUserByEmail(account.email)) {
        store.addTestUser({
          id:         account.id,
          name:       account.name,
          email:      account.email,
          password:   account.password,
          role:       "employee",
          companyId:  account.companyId ?? "",
          locationId: account.locationId ?? undefined,
          employeeId: account.employeeId ?? null,
          position:   account.position ?? "",
          hourlyWage: emp.hourlyWage,
          payType:    emp.payType,
        });
      }

      employeeSummary.push({
        name,
        employeeId:   emp.id,
        displayId:    emp.employeeDisplayId,
        email:        emp.email,
        payType:      emp.payType,
        hourlyWage:   emp.hourlyWage,
        annualSalary: emp.annualSalary,
        status:       emp.status,
        kycStatus:    emp.kycStatus,
        rollfiUserId: emp.rollfiUserId,
        rollfiWageId: emp.rollfiWageId,
        w4Submitted:  emp.w4Submitted,
        bankAccountAdded: emp.bankAccountAdded,
        taskCount:    tasks.length,
        complianceCount: compliance.length,
        userAccountId: account.id,
        ssnStored:    false,   // never
        dobStored:    false,   // never
      });
    }

    // ── STEP 7: Return summary ─────────────────────────────────────────────
    const [savedCompany] = await db.select().from(companies).where(eq(companies.id, INTERNAL_CO_ID));
    const savedEmployees = await db.select({
      id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
      email: employees.email, rollfiUserId: employees.rollfiUserId,
      rollfiWageId: employees.rollfiWageId, hourlyWage: employees.hourlyWage,
      annualSalary: employees.annualSalary, payType: employees.payType,
      kycStatus: employees.kycStatus, status: employees.status,
      ssn: employees.ssn, dateOfBirth: employees.dateOfBirth,
    }).from(employees).where(eq(employees.companyId, INTERNAL_CO_ID));

    req.log.info({ employeeCount: savedEmployees.length }, "admin-import-brightbridge: COMPLETE");

    res.json({
      ok: true,
      message: "BrightbridgeAssist LLC import complete.",
      company: {
        id:              savedCompany?.id,
        name:            savedCompany?.name,
        rollfiCompanyId: savedCompany?.rollfiCompanyId,
        kybStatus:       savedCompany?.kybStatus,
        bankAccountAdded: savedCompany?.bankAccountAdded,
        payScheduleAdded: savedCompany?.payScheduleAdded,
      },
      employees: savedEmployees.map((e) => ({
        id:           e.id,
        name:         `${e.firstName} ${e.lastName}`,
        email:        e.email,
        payType:      e.payType,
        hourlyWage:   e.hourlyWage,
        annualSalary: e.annualSalary,
        kycStatus:    e.kycStatus,
        status:       e.status,
        rollfiUserId: e.rollfiUserId,
        rollfiWageId: e.rollfiWageId,
        ssnStored:    e.ssn !== null,     // must be false
        dobStored:    e.dateOfBirth !== null, // must be false
      })),
      importedBy: employeeSummary,
      rollfiEnv:  env,
    });
  } catch (err) {
    req.log.error({ err }, "admin-import-brightbridge: FAILED");
    res.status(500).json({ error: "Import failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
