/**
 * import-brightbridge-assist.ts
 *
 * One-off script: imports BrightbridgeAssist LLC and its 4 employees from
 * PRODUCTION Rollfi into our local database.
 *
 * SAFETY RULES (enforced in this script):
 *   - SSNs are NEVER stored, logged, or printed.  The ssn field returned by
 *     getUser is silently discarded immediately after the response arrives.
 *   - No full getUser response is ever passed to console.log / JSON.stringify.
 *     Every Rollfi response is filtered through safeLog() before printing.
 *   - DRY_RUN=1 (the default) prints every row that would be inserted without
 *     touching the database.  Pass DRY_RUN=0 only after reviewing the output.
 *
 * Usage:
 *   # Dry run (default — no DB writes):
 *   cd artifacts/api-server
 *   DRY_RUN=1 npx tsx scripts/import-brightbridge-assist.ts
 *
 *   # Live insert (after approval):
 *   DRY_RUN=0 npx tsx scripts/import-brightbridge-assist.ts
 *
 * Environment required (production credentials):
 *   ROLLFI_PROD_API_URL, ROLLFI_PROD_CLIENT_ID, ROLLFI_PROD_SECRET_KEY
 *   DATABASE_URL
 */

import axios from "axios";
import { db } from "@workspace/db";
import {
  companies as companiesTable,
  employees as employeesTable,
  userAccounts as userAccountsTable,
  rollfiCompanyRecords as rollfiCompanyRecordsTable,
  rollfiEmployeeRecords as rollfiEmployeeRecordsTable,
  onboardingTasks as onboardingTasksTable,
  complianceItems as complianceItemsTable,
  peopleActivityLog as peopleActivityLogTable,
} from "@workspace/db/schema";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN !== "0";   // default: dry run
const NOW      = new Date().toISOString();
const TODAY    = NOW.split("T")[0]!;

// Production Rollfi base URL — strip trailing slash (same guard as rollfi-config.ts)
const PROD_BASE_URL = (process.env.ROLLFI_PROD_API_URL?.trim() ?? "https://api.rollfi.xyz").replace(/\/+$/, "");
const PROD_CLIENT_ID  = process.env.ROLLFI_PROD_CLIENT_ID?.trim();
const PROD_SECRET_KEY = process.env.ROLLFI_PROD_SECRET_KEY?.trim();

if (!PROD_CLIENT_ID || !PROD_SECRET_KEY) {
  console.error("❌  ROLLFI_PROD_CLIENT_ID or ROLLFI_PROD_SECRET_KEY not set — aborting.");
  process.exit(1);
}

const ROLLFI_HEADERS = {
  Authorization: `Basic ${Buffer.from(`${PROD_CLIENT_ID}:${PROD_SECRET_KEY}`).toString("base64")}`,
  "Content-Type": "application/json",
};

// Rollfi production company ID discovered via getCompanies
const ROLLFI_CO_ID = "1F78ADC2-5E7B-4D6A-88A8-1DDABEC4352F";

// We re-use the canonical internal ID for BrightBridge Assist HQ so all
// existing admin user_accounts rows (companyId: "ORG-BRIGHTBRIDGE") continue
// to resolve.
const INTERNAL_CO_ID = "ORG-BRIGHTBRIDGE";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string { return NOW; }

function addDays(dateStr: string | undefined, days: number): string {
  const base = dateStr ? new Date(dateStr) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString().split("T")[0]!;
}

/**
 * Strips every field that could contain PII or sensitive financial data before
 * the object is passed to console.log.  SSN is the critical one — never print it.
 */
function safeLog(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(safeLog);
  const d = data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    // Redact sensitive keys entirely
    const lower = k.toLowerCase();
    if (
      lower === "ssn" ||
      lower === "dateofbirth" ||
      lower === "w4informations" ||
      lower === "statew4informations" ||
      lower === "bankaccounts" ||
      lower === "recurringpayitems" ||
      lower === "employeegarnishments" ||
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

function pp(label: string, obj: unknown): void {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(70));
  console.log(JSON.stringify(safeLog(obj), null, 2));
}

function section(title: string): void {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(70));
}

// ─── ROLLFI API CALLS ─────────────────────────────────────────────────────────

async function rollfiPost<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const r = await axios.post(`${PROD_BASE_URL}/${endpoint}`, body, {
    headers: ROLLFI_HEADERS,
    timeout: 20_000,
  });
  return r.data as T;
}

interface RollfiUser {
  user: string;
  userId: string;
  firstName: string;
  lastName: string;
  middleName: string;
  phoneNumber: string;
  kycStatus: string;
  jobTitle: string;
  dateOfJoin: string;
  email: string;
  WorkerType: { WorkerType: string };
  status: { userStatus: string };
  userWages: Array<{
    WageRate: number;
    WageBasis: { WageBasis: string };
    paymentMethod: { PaymentMethod: string };
  }>;
  userAddress: {
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
  } | null;
}

interface RollfiUserDetail extends RollfiUser {
  isTermsAccepted?: boolean;
  userWages: Array<{
    userWageId: string;
    standardWorkingHours: number;
    WageRate: number;
    WageBasis: { WageBasis: string };
    paymentMethod: { PaymentMethod: string };
    employeeRefTaxExempt: string;
    employeeType: string;
    differentialPay: string;
    employmentStatus: string;
  }>;
  stateCode?: string;
  companyLocationCategory?: { companyLocationCategory: string };
  // SSN: intentionally NOT typed here so it never gets accidentally used
  dateOfBirth?: string;  // read but not stored
  W4Informations?: Array<{
    W4FilingStatus: { W4FilingStatus: string };
    HaveMultipleJob: boolean;
    Dependents: number;
    ExtraWithholding: number;
  }>;
  stateW4Informations?: Array<Record<string, string>>;
  bankAccounts?: Array<{ bankName?: string; accountNumber?: string; accountType?: string }>;
}

interface RollfiCompanyInfo {
  company: string;
  companyID: string;
  businessWebsite?: string;
  CompanyLocations?: Array<{
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    companyLocation: string;
  }>;
  KYBInformations?: Array<{
    ein?: string;
    email?: string;
    phoneNumber?: string;
    dateOfIncorporation?: string;
  }>;
  kycStatus?: string;
  BankAccounts?: Array<{
    bankName?: string;
    accountNumber?: string;
    accountType?: string;
    status?: string;
    bankBalance?: number;
  }>;
  PaySchedules?: Array<{
    payScheduleId?: string;
    payBeginDate?: string;
    payEndDate?: string;
    payDate?: string;
    compensationFrequency?: string;
  }>;
}

interface RollfiLocation {
  companyLocationID: string;
  isWorkLocation?: boolean;
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

// ─── WAGE MAPPING ─────────────────────────────────────────────────────────────

function mapWageBasis(wb: string): "hourly" | "salary" {
  return wb === "Per Hour" ? "hourly" : "salary";
}

function mapOvertimeEligible(employeeType: string): boolean {
  return employeeType.toLowerCase().includes("eligible for overtime");
}

function mapTaxExempt(refTaxExempt: string): boolean {
  return !refTaxExempt.toLowerCase().includes("not tax exempt");
}

// ─── ONBOARDING TASK TEMPLATES (mirrored from people.ts) ─────────────────────

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

const ALL_TASKS_TEMPLATE = [
  ...STANDARD_HR_PAYROLL_TASKS,
  ...MANAGER_TASKS,
  ...IT_TASKS,
  ...COMPLIANCE_TASKS,
];

// ─── ROW BUILDERS ─────────────────────────────────────────────────────────────

interface BuiltEmployee {
  // employees row
  emp: typeof employeesTable.$inferInsert;
  // user_accounts row
  account: typeof userAccountsTable.$inferInsert;
  // rollfi_employee_records row
  rollfiRec: typeof rollfiEmployeeRecordsTable.$inferInsert;
  // compliance items
  compliance: Array<typeof complianceItemsTable.$inferInsert>;
  // onboarding tasks
  tasks: Array<typeof onboardingTasksTable.$inferInsert>;
  // activity log entry
  activity: typeof peopleActivityLogTable.$inferInsert;
}

function buildEmployeeRows(
  detail: RollfiUserDetail,
  companyId: string,
  displayId: string,
  w4Submitted: boolean,
  bankAccountAdded: boolean,
): BuiltEmployee {
  const empId     = `EMP-${uid().toUpperCase()}`;
  const userId    = `USER-DYN-${empId}`;
  const wageBasis = detail.userWages[0]?.WageBasis?.WageBasis ?? "Per Hour";
  const payType   = mapWageBasis(wageBasis);
  const wageRate  = detail.userWages[0]?.WageRate ?? 0;
  const kycStatus = detail.kycStatus ?? "new";

  // Derive status: active only when KYC passed
  const status = kycStatus === "passed" ? "active" : "onboarding";

  // Wage in cents
  const hourlyWage   = payType === "hourly"  ? Math.round(wageRate * 100) : 1500;
  const annualSalary = payType === "salary"  ? Math.round(wageRate * 100) : null;

  const w4 = detail.W4Informations?.[0];

  const emp: typeof employeesTable.$inferInsert = {
    id:             empId,
    companyId,
    firstName:      detail.firstName,
    lastName:       detail.lastName,
    email:          detail.email,
    phone:          detail.phoneNumber ?? "",
    position:       detail.jobTitle ?? "Staff",
    employmentType: detail.userWages[0]?.employmentStatus ?? "Full Time (30+ Hours per week)",
    workerType:     detail.WorkerType?.WorkerType ?? "W2",
    startDate:      detail.dateOfJoin ?? TODAY,
    payType,
    hourlyWage,
    annualSalary,
    overtimeEligible: detail.userWages[0]?.employeeType
      ? mapOvertimeEligible(detail.userWages[0].employeeType)
      : true,
    paymentMethod:  detail.userWages[0]?.paymentMethod?.PaymentMethod ?? "Direct Deposit",
    taxExempt:      detail.userWages[0]?.employeeRefTaxExempt
      ? mapTaxExempt(detail.userWages[0].employeeRefTaxExempt)
      : false,
    // ── Address ──
    homeAddress:    detail.userAddress?.address1 ?? null,
    homeCity:       detail.userAddress?.city ?? null,
    homeState:      detail.stateCode ?? detail.userAddress?.state ?? null,
    homeZip:        detail.userAddress?.zipcode ?? null,
    // ── SSN: intentionally omitted per decision #1 ──
    ssn:            null,
    // ── DOB: available in getUser but not stored per decision #1 ──
    dateOfBirth:    null,
    // ── W-4 ──
    w4FilingStatus:     w4 ? normalizeW4(w4.W4FilingStatus?.W4FilingStatus) : null,
    w4MultipleJobs:     w4?.HaveMultipleJob ?? false,
    w4Dependents:       w4?.Dependents ?? 0,
    w4ExtraWithholding: w4?.ExtraWithholding ?? 0,
    w4Submitted,
    // ── Rollfi ──
    rollfiUserId:        detail.userId,
    rollfiWageId:        detail.userWages[0]?.userWageId ?? null,
    rollfiOnboardedAt:   NOW,
    rollfiAccountStatus: detail.status?.userStatus ?? null,
    kycStatus,
    bankAccountAdded,
    // ── Status ──
    status,
    employeeDisplayId: displayId,
    syncStatus:        "synced",
    // ── People module defaults ──
    department:   null,
    managerId:    null,
    managerName:  null,
    jobTitle:     detail.jobTitle ?? null,
    employeeType: detail.userWages[0]?.employeeType ?? null,
    workLocation: detail.companyLocationCategory?.companyLocationCategory ?? null,
    // ── Compliance readiness (computed from flags) ──
    complianceScore:   0,  // updated after compliance items inserted
    i9Status:          kycStatus === "passed" ? "completed" : "not_started",
    backgroundCheckStatus: "not_started",
    onboardingProgress: 0,
    onboardingStartedAt: NOW,
    payrollReady:    kycStatus === "passed" && w4Submitted,
    hrReady:         false,
    complianceReady: false,
    firstPayrollReady: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const account: typeof userAccountsTable.$inferInsert = {
    id:         userId,
    name:       `${detail.firstName} ${detail.lastName}`,
    email:      detail.email,
    password:   "Staff123!",
    role:       "employee",
    companyId,
    locationId: null,
    employeeId: empId,
    position:   detail.jobTitle ?? "Staff",
    createdAt:  NOW,
  };

  const rollfiRec: typeof rollfiEmployeeRecordsTable.$inferInsert = {
    employeeId:   empId,
    rollfiUserId: detail.userId,
    rollfiWageId: detail.userWages[0]?.userWageId ?? "",
    onboardedAt:  NOW,
  };

  // ── Compliance items (7 standard, non-daycare) ──
  const mk = (type: string, name: string, isRequired: boolean, preCompleted = false) => ({
    id:          `ci-${uid()}`,
    employeeId:  empId,
    companyId,
    type,
    name,
    status:      preCompleted ? "completed" : "not_started",
    isRequired,
    completedAt: preCompleted ? NOW : null,
    createdAt:   NOW,
    updatedAt:   NOW,
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

  // ── Onboarding tasks ──
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
    createdAt:        NOW,
    updatedAt:        NOW,
  }));

  const activity: typeof peopleActivityLogTable.$inferInsert = {
    id:          `pal-${uid()}`,
    companyId,
    employeeId:  empId,
    action:      "employee.imported",
    description: `${detail.firstName} ${detail.lastName} imported from PRODUCTION Rollfi (userId: ${detail.userId})`,
    category:    "system",
    performedBy: "import-script",
    metadata:    JSON.stringify({ rollfiUserId: detail.userId, rollfiWageId: detail.userWages[0]?.userWageId ?? null, source: "import-brightbridge-assist" }),
    timestamp:   NOW,
  };

  return { emp, account, rollfiRec, compliance, tasks, activity };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  BrightBridge Assist — Rollfi Production Import                      ║");
  console.log(`║  Mode: ${DRY_RUN ? "DRY RUN  (no DB writes)                              " : "LIVE INSERT ⚠️  — writing to database              "}  ║`);
  console.log(`║  Target DB: ${process.env.DATABASE_URL ? "connected" : "NO DATABASE_URL SET ❌"}                                        ║`);
  console.log(`║  Production Rollfi URL: ${PROD_BASE_URL.slice(0, 40).padEnd(40)} ║`);
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  if (!DRY_RUN) {
    console.log("⚠️  LIVE INSERT MODE — this will write to the database.");
    console.log("    Proceeding in 3 seconds (Ctrl-C to abort)...\n");
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ── 1. Fetch company info ──────────────────────────────────────────────────
  section("STEP 1 — Fetch getCompanyInfo (PRODUCTION Rollfi)");
  const companyInfoResp = await rollfiPost<{ Company: RollfiCompanyInfo[] }>(
    "reports#getCompanyInfo",
    { method: "getCompanyInfo", companyId: ROLLFI_CO_ID },
  );
  const companyInfo = companyInfoResp.Company[0]!;
  console.log("getCompanyInfo (safe):");
  console.log(JSON.stringify(safeLog(companyInfo), null, 2));

  // ── 2. Fetch location ID ───────────────────────────────────────────────────
  section("STEP 2 — Fetch getCompanyLocationInfo (PRODUCTION Rollfi)");
  let rollfiLocationId = "";
  try {
    const locResp = await rollfiPost<{ CompanyLocation?: RollfiLocation[] }>(
      "reports#getCompanyLocationInfo",
      { method: "getCompanyLocationInfo", companyId: ROLLFI_CO_ID },
    );
    const locs = locResp.CompanyLocation ?? [];
    const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
    rollfiLocationId = work?.companyLocationID ?? "";
    console.log("Locations found:", locs.map((l) => `${l.companyLocationID} isWork=${l.isWorkLocation}`));
    console.log("Using rollfiLocationId:", rollfiLocationId || "(none — will be empty)");
  } catch (e) {
    console.warn("getCompanyLocationInfo failed — rollfiLocationId will be empty:", (e as Error).message);
  }

  // ── 3. Fetch getUsers ──────────────────────────────────────────────────────
  section("STEP 3 — Fetch getUsers (PRODUCTION Rollfi)");
  const getUsersResp = await rollfiPost<{ users: RollfiUser[] }>(
    "reports#getUsers",
    { method: "getUsers", companyId: ROLLFI_CO_ID },
  );
  const users = getUsersResp.users;
  console.log(`getUsers returned ${users.length} employee(s):`);
  for (const u of users) {
    console.log(`  • ${u.firstName} ${u.lastName} <${u.email}> kycStatus=${u.kycStatus} userId=${u.userId}`);
  }

  // ── 4. Fetch getUser for each employee ────────────────────────────────────
  section("STEP 4 — Fetch getUser for each employee (PRODUCTION Rollfi)");
  const details: RollfiUserDetail[] = [];
  for (const u of users) {
    process.stdout.write(`  Calling getUser for ${u.firstName} ${u.lastName}...`);
    const resp = await rollfiPost<{ user: RollfiUserDetail[] }>(
      "reports#getUser",
      { method: "getUser", companyId: ROLLFI_CO_ID, userId: u.userId },
    );
    const detail = resp.user[0]!;
    // ══ SSN GUARD ══
    // Extract ssn existence flag BEFORE the object is used anywhere, then
    // delete the field so it can never accidentally appear in output or storage.
    const hasSsn = !!(detail as Record<string, unknown>)["ssn"];
    delete (detail as Record<string, unknown>)["ssn"];
    // dateOfBirth: available but per decision #1 we don't store it — delete immediately
    delete (detail as Record<string, unknown>)["dateOfBirth"];
    details.push(detail);
    console.log(` ✓  (wageId=${detail.userWages[0]?.userWageId ?? "none"}, hasSsn=${hasSsn} [not stored], w4=${detail.W4Informations?.length ?? 0} record(s))`);
    // Safe log for verification — ssn and dateOfBirth already deleted above
    console.log(`     Safe detail (redacted):`);
    console.log(JSON.stringify(safeLog(detail), null, 2));
  }

  // ── 5. Build all rows ──────────────────────────────────────────────────────
  section("STEP 5 — Build rows");

  // Company row
  const loc    = companyInfo.CompanyLocations?.[0];
  const kyb    = companyInfo.KYBInformations?.[0];
  const bank   = companyInfo.BankAccounts?.[0];
  const sched  = companyInfo.PaySchedules?.[0];

  // Bank status: "notfound" means the account exists in Rollfi but is not verified
  const bankAccountAdded = !!(bank && bank.status && bank.status !== "notfound");

  const companyRow: typeof companiesTable.$inferInsert = {
    id:               INTERNAL_CO_ID,
    name:             companyInfo.company,
    doingBusinessAs:  null,
    businessWebsite:  companyInfo.businessWebsite ?? null,
    phone:            kyb?.phoneNumber ?? "",
    industry:         "staffing",        // BrightBridge is not a daycare
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
    rollfiOnboardedAt: NOW,
    ein:              kyb?.ein ?? null,
    fundingBankName:       bank?.bankName ?? null,
    fundingAccountLast4:   bank?.accountNumber?.replace(/X/g, "").slice(-4) ?? null,
    fundingAccountType:    bank?.accountType ?? null,
    kybStatus:             companyInfo.kycStatus === "passed" ? "approved" : "not_started",
    bankAccountAdded:      bankAccountAdded,   // false: Mercury account exists but status="notfound"
    payScheduleAdded:      !!(sched),
    payFrequency:          sched?.compensationFrequency ?? null,
    firstPayDate:          sched?.payDate ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const rollfiCompanyRow: typeof rollfiCompanyRecordsTable.$inferInsert = {
    companyId:        INTERNAL_CO_ID,
    rollfiCompanyId:  ROLLFI_CO_ID,
    rollfiLocationId: rollfiLocationId,
    onboardedAt:      NOW,
    ein:              kyb?.ein ?? null,
    ownerSsn:         null,   // never stored
  };

  // Employee display IDs — sequential E1001, E1002 …
  const builtEmployees: BuiltEmployee[] = details.map((d, i) => {
    const displayId = `E${1001 + i}`;
    // w4Submitted: true if W4Informations is populated
    const w4Submitted = !!(d.W4Informations && d.W4Informations.length > 0);
    // bankAccountAdded per employee: check bankAccounts array
    const empBankAdded = !!(d.bankAccounts && d.bankAccounts.length > 0);
    return buildEmployeeRows(d, INTERNAL_CO_ID, displayId, w4Submitted, empBankAdded);
  });

  // ── 6. Print dry-run preview ───────────────────────────────────────────────
  section("STEP 6 — ROW PREVIEW (every field that would be written to the DB)");

  // ── Company ──
  pp("companies — 1 row", companyRow);

  // ── rollfi_company_records ──
  pp("rollfi_company_records — 1 row", rollfiCompanyRow);

  // ── Employees ──
  for (const { emp, account, rollfiRec, compliance, tasks, activity } of builtEmployees) {
    const name = `${emp.firstName} ${emp.lastName}`;
    pp(`employees — ${name}  [id: ${emp.id}]`, emp);
    pp(`user_accounts — ${name}  [id: ${account.id}]  [password: Staff123!]`, {
      ...account, password: "[Staff123! — default employee password]",
    });
    pp(`rollfi_employee_records — ${name}`, rollfiRec);
    pp(`compliance_items — ${name}  (${compliance.length} items)`, compliance);
    console.log(`\n  onboarding_tasks — ${name}  (${tasks.length} tasks, showing task names only):`);
    for (const t of tasks) {
      console.log(`    [${t.status}]  ${t.taskName}  (${t.category} / due +${t.dueDaysAfterHire}d)`);
    }
    pp(`people_activity_log — ${name}`, activity);
  }

  // ── Summary ──
  section("SUMMARY");
  const totalTasks       = builtEmployees.reduce((s, e) => s + e.tasks.length, 0);
  const totalCompliance  = builtEmployees.reduce((s, e) => s + e.compliance.length, 0);

  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │  WHAT WOULD BE INSERTED                                 │
  ├─────────────────────────────────────────────────────────┤
  │  companies                  1 row  (id: ${INTERNAL_CO_ID.padEnd(16)}) │
  │  rollfi_company_records     1 row                       │
  │  employees                  ${String(builtEmployees.length).padEnd(2)} rows                      │
  │  user_accounts              ${String(builtEmployees.length).padEnd(2)} rows                      │
  │  rollfi_employee_records    ${String(builtEmployees.length).padEnd(2)} rows                      │
  │  compliance_items           ${String(totalCompliance).padEnd(2)} rows (${totalCompliance / builtEmployees.length} per employee)     │
  │  onboarding_tasks           ${String(totalTasks).padEnd(3)} rows (${totalTasks / builtEmployees.length} per employee)    │
  │  people_activity_log        ${String(builtEmployees.length).padEnd(2)} rows                      │
  ├─────────────────────────────────────────────────────────┤
  │  SSN:         NOT STORED (by design)                    │
  │  Date of birth: NOT STORED (by design)                  │
  │  Company bank: bankAccountAdded=${String(bankAccountAdded).padEnd(5)} (Mercury/"notfound") │
  └─────────────────────────────────────────────────────────┘

  Employees and their login accounts:
${builtEmployees.map((e) => {
    const emp = e.emp;
    const acct = e.account;
    return `    • ${emp.firstName} ${emp.lastName}
        employees.id:     ${emp.id}
        user_accounts.id: ${acct.id}
        login email:      ${acct.email}          (role: employee)
        kycStatus:        ${emp.kycStatus}
        status:           ${emp.status}
        payType:          ${emp.payType}${emp.payType === "salary" ? `  annualSalary: $${((emp.annualSalary ?? 0) / 100).toLocaleString()}` : `  hourlyWage: $${((emp.hourlyWage ?? 0) / 100).toFixed(2)}/hr`}
        rollfiUserId:     ${emp.rollfiUserId}
        rollfiWageId:     ${emp.rollfiWageId ?? "(none)"}`;
  }).join("\n\n")}

  NOTE — JOANNE INDVIGLIO:
    Her Rollfi email (joanne.indiviglio@gmail.com) differs from the existing
    admin account (joanne@brightbridgeassist.com — USER-001).  No collision.
    Two coexisting accounts after import:
      USER-001           joanne@brightbridgeassist.com  role=super_admin  (existing)
      USER-DYN-${builtEmployees.find((e) => e.emp.firstName === "Joanne")?.emp.id?.slice(0,16) ?? "EMP-..."}  joanne.indiviglio@gmail.com  role=employee   (new)
`);

  if (DRY_RUN) {
    console.log("🔵  DRY RUN COMPLETE — nothing was written to the database.");
    console.log("    Review the output above, then re-run with DRY_RUN=0 to insert.\n");
    return;
  }

  // ── 7. LIVE INSERT ─────────────────────────────────────────────────────────
  section("STEP 7 — LIVE INSERT (PRODUCTION Rollfi data → database)");

  // 7a. Company
  console.log("Inserting companies row...");
  await db.insert(companiesTable)
    .values(companyRow)
    .onConflictDoUpdate({
      target: companiesTable.id,
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
        updatedAt:         NOW,
      },
    });
  console.log("  ✓ companies");

  // 7b. rollfi_company_records
  console.log("Inserting rollfi_company_records row...");
  await db.insert(rollfiCompanyRecordsTable)
    .values(rollfiCompanyRow)
    .onConflictDoUpdate({
      target: rollfiCompanyRecordsTable.companyId,
      set: {
        rollfiCompanyId:  rollfiCompanyRow.rollfiCompanyId,
        rollfiLocationId: rollfiCompanyRow.rollfiLocationId,
        ein:              rollfiCompanyRow.ein,
      },
    });
  console.log("  ✓ rollfi_company_records");

  // 7c. Per-employee inserts
  for (const { emp, account, rollfiRec, compliance, tasks, activity } of builtEmployees) {
    const name = `${emp.firstName} ${emp.lastName}`;
    console.log(`\nInserting ${name}...`);

    await db.insert(employeesTable).values(emp).onConflictDoNothing();
    console.log(`  ✓ employees (${emp.id})`);

    await db.insert(userAccountsTable).values(account).onConflictDoNothing();
    console.log(`  ✓ user_accounts (${account.id})`);

    await db.insert(rollfiEmployeeRecordsTable).values(rollfiRec).onConflictDoNothing();
    console.log(`  ✓ rollfi_employee_records`);

    await db.insert(complianceItemsTable).values(compliance);
    console.log(`  ✓ compliance_items (${compliance.length})`);

    // Tasks in chunks of 50
    for (let i = 0; i < tasks.length; i += 50) {
      await db.insert(onboardingTasksTable).values(tasks.slice(i, i + 50));
    }
    console.log(`  ✓ onboarding_tasks (${tasks.length})`);

    await db.insert(peopleActivityLogTable).values(activity);
    console.log(`  ✓ people_activity_log`);
  }

  section("IMPORT COMPLETE");
  console.log("✅  All rows inserted successfully.");
  console.log(`   Restart the API server to pick up the new in-memory store state.\n`);
}

main().catch((err) => {
  console.error("\n❌  Fatal error during import:", err);
  process.exit(1);
});
