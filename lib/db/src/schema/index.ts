import { pgTable, text, serial, integer, boolean, real, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const clientEmployeeRecords = pgTable("client_employee_records", {
  id:                  text("id").primaryKey(),
  clientId:            text("client_id").notNull(),
  name:                text("name").notNull(),
  email:               text("email"),
  role:                text("role").notNull(),
  roleName:            text("role_name").notNull(),
  wage:                integer("wage").notNull().default(1500),
  wageType:            text("wage_type").notNull().default("hourly"),
  timeTrackingEnabled: boolean("time_tracking_enabled").notNull().default(true),
  status:              text("status").notNull().default("hired"),
  easyteamSynced:      boolean("easyteam_synced").notNull().default(false),
  rollfiSynced:        boolean("rollfi_synced").notNull().default(false),
  rollfiUserId:        text("rollfi_user_id"),
  syncError:           text("sync_error"),
  createdAt:           text("created_at").notNull(),
});

export const rollfiCompanyRecords = pgTable("rollfi_company_records", {
  companyId:        text("company_id").primaryKey(),
  rollfiCompanyId:  text("rollfi_company_id").notNull(),
  rollfiLocationId: text("rollfi_location_id").notNull().default(""),
  onboardedAt:      text("onboarded_at").notNull(),
  ein:              text("ein"),
  ownerSsn:         text("owner_ssn"),
});

export const rollfiEmployeeRecords = pgTable("rollfi_employee_records", {
  employeeId:   text("employee_id").primaryKey(),
  rollfiUserId: text("rollfi_user_id").notNull(),
  rollfiWageId: text("rollfi_wage_id").default(""),
  onboardedAt:  text("onboarded_at").notNull(),
});

export const rollfiWebhookEvents = pgTable("rollfi_webhook_events", {
  id:              serial("id").primaryKey(),
  eventType:       text("event_type").notNull().default("unknown"),
  companyId:       text("company_id"),
  rollfiCompanyId: text("rollfi_company_id"),
  payPeriodId:     text("pay_period_id"),
  payload:         text("payload").notNull(),
  receivedAt:      text("received_at").notNull(),
});

export const userAccounts = pgTable("user_accounts", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  email:       text("email").notNull().unique(),
  password:    text("password").notNull(),
  role:        text("role").notNull().default("employee"),
  companyId:   text("company_id").default(""),
  locationId:  text("location_id"),
  employeeId:  text("employee_id"),
  position:    text("position"),
  photoUrl:    text("photo_url"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   text("created_at").notNull(),
});

export const timesheetEntries = pgTable("timesheet_entries", {
  id:              serial("id").primaryKey(),
  employeeId:      text("employee_id").notNull(),
  companyId:       text("company_id").notNull(),
  periodKey:       text("period_key").notNull(),
  hoursWorked:     real("hours_worked").notNull(),
  breakDeduction:  real("break_deduction").notNull().default(0),
  approvedHours:   real("approved_hours").notNull(),
  source:          text("source").notNull().default("easyteam"),
  syncedAt:        text("synced_at").notNull(),
  managerApproved: boolean("manager_approved").default(false),
  approvedAt:      text("approved_at"),
  approvedByUserId: text("approved_by_user_id"),
});

export const timesheetApprovals = pgTable("timesheet_approvals", {
  id:                  serial("id").primaryKey(),
  employeeId:          text("employee_id").notNull(),
  rollfiUserId:        text("rollfi_user_id"),
  companyId:           text("company_id").notNull(),
  periodKey:           text("period_key").notNull(),
  hoursWorked:         real("hours_worked").notNull(),
  breakDeduction:      real("break_deduction").notNull().default(0),
  approvedHours:       real("approved_hours").notNull(),
  approvedAt:          text("approved_at").notNull(),
  approvedByManagerId: text("approved_by_manager_id").notNull(),
  source:              text("source").notNull().default("easyteam_sync"),
  managerEdited:       boolean("manager_edited").notNull().default(false),
  managerEditNote:     text("manager_edit_note"),
}, (t) => ({
  uniqueEmpPeriod: uniqueIndex("ta_emp_period_unique").on(t.employeeId, t.periodKey),
}));

// ── Company & Employee Master Data ───────────────────────────

export const companies = pgTable("companies", {
  id:                text("id").primaryKey(),
  name:              text("name").notNull(),
  doingBusinessAs:   text("doing_business_as"),
  businessWebsite:   text("business_website"),
  phone:             text("phone").notNull().default(""),
  industry:          text("industry").notNull().default("daycare"),
  package:           text("package").notNull().default("full_daycare"),
  status:            text("status").notNull().default("pending"),
  // Location
  address1:          text("address1").notNull().default(""),
  address2:          text("address2"),
  city:              text("city").notNull().default(""),
  state:             text("state").notNull().default("NJ"),
  zipcode:           text("zipcode").notNull().default(""),
  locationName:      text("location_name"),
  // Rollfi
  rollfiCompanyId:   text("rollfi_company_id"),
  rollfiLocationId:  text("rollfi_location_id"),
  rollfiOnboardedAt: text("rollfi_onboarded_at"),
  ein:               text("ein"),
  // Funding bank account (env-aware: production stores real data, sandbox uses built-in test values)
  fundingBankName:       text("funding_bank_name"),
  fundingAccountLast4:   text("funding_account_last4"),
  fundingAccountType:    text("funding_account_type"),
  bankLinkMethod:        text("bank_link_method"),          // "Manual" | "Plaid"
  bankLinkGeneratedAt:   text("bank_link_generated_at"),    // ISO-8601; Plaid links expire ~72 h
  // EasyTeam — one org per company. Set at creation time; resolver falls back to
  // "ORG-BRIGHTBRIDGE" (shared legacy org) when null. Never send placeholder strings:
  // EasyTeam auto-creates a new org for every unrecognised organizationId it receives.
  easyteamOrgId:      text("easyteam_org_id"),
  // Onboarding
  kybStatus:          text("kyb_status").notNull().default("not_started"),
  bankAccountAdded:   boolean("bank_account_added").notNull().default(false),
  bankAccountVerified: boolean("bank_account_verified").notNull().default(false),
  payScheduleAdded:   boolean("pay_schedule_added").notNull().default(false),
  // Pay schedule
  payFrequency:      text("pay_frequency"),
  firstPayDate:      text("first_pay_date"),
  createdAt:         text("created_at").notNull(),
  updatedAt:         text("updated_at").notNull(),
});

export const employees = pgTable("employees", {
  id:                text("id").primaryKey(),
  companyId:         text("company_id").notNull(),
  firstName:         text("first_name").notNull(),
  lastName:          text("last_name").notNull(),
  email:             text("email").notNull(),
  phone:             text("phone").notNull().default(""),
  position:          text("position").notNull(),
  employmentType:    text("employment_type").notNull().default("Full Time (30+ Hours per week)"),
  workerType:        text("worker_type").notNull().default("W2"),
  startDate:         text("start_date").notNull(),
  // Pay
  payType:           text("pay_type").notNull().default("hourly"),
  // hourlyWage is only meaningful when payType = 'hourly'; do not store salary here
  hourlyWage:        integer("hourly_wage").notNull().default(1500),
  // annualSalary is only meaningful when payType = 'salary' (cents, e.g. 5200000 = $52,000/yr)
  annualSalary:      integer("annual_salary"),
  overtimeEligible:  boolean("overtime_eligible").notNull().default(true),
  paymentMethod:     text("payment_method").notNull().default("Direct Deposit"),
  taxExempt:         boolean("tax_exempt").notNull().default(false),
  // Personal
  ssn:               text("ssn"),
  dateOfBirth:       text("date_of_birth"),
  homeAddress:       text("home_address"),
  homeCity:          text("home_city"),
  homeState:         text("home_state"),
  homeZip:           text("home_zip"),
  // W4 — dependents/dependentsAbove18 are COUNTS (not dollar amounts); extraWithholding is dollars
  w4FilingStatus:           text("w4_filing_status"),
  w4MultipleJobs:           boolean("w4_multiple_jobs").default(false),
  w4Dependents:             integer("w4_dependents").default(0),       // count of qualifying children under 17
  w4DependentsAbove18:      integer("w4_dependents_above18").default(0), // count of other dependents
  w4ExtraWithholding:       integer("w4_extra_withholding").default(0),
  w4OtherIncome:            integer("w4_other_income").default(0),
  w4OtherDeduction:         integer("w4_other_deduction").default(0),
  w4MilitarySpouseExemption: boolean("w4_military_spouse_exemption").default(false),
  w4IsNonResident:          boolean("w4_is_non_resident").default(false),
  w4AzDeductionPercent:     integer("w4_az_deduction_percent"),
  // Status
  status:            text("status").notNull().default("onboarding"),
  // Rollfi
  rollfiUserId:      text("rollfi_user_id"),
  rollfiWageId:      text("rollfi_wage_id"),
  rollfiOnboardedAt: text("rollfi_onboarded_at"),
  kycStatus:         text("kyc_status").default("not_started"),
  rollfiAccountStatus: text("rollfi_account_status"),
  bankAccountAdded:  boolean("bank_account_added").notNull().default(false),
  bankName:          text("bank_name"),
  accountLast4:      text("account_last4"),
  accountType:       text("account_type"),
  w4Submitted:       boolean("w4_submitted").notNull().default(false),
  // EasyTeam
  easyteamId:        text("easyteam_id"),
  easyteamSynced:    boolean("easyteam_synced").notNull().default(false),
  easyteamUuid:      text("easyteam_uuid"),
  // Sync
  syncStatus:        text("sync_status").notNull().default("pending"),
  lastSyncError:     text("last_sync_error"),
  // People Module — display ID
  employeeDisplayId: text("employee_display_id"),
  // People Module — org
  department:        text("department"),
  managerId:         text("manager_id"),
  managerName:       text("manager_name"),
  jobTitle:          text("job_title"),
  employeeType:      text("employee_type"),
  workLocation:      text("work_location"),
  locationId:        text("location_id"),             // FK to locations.id (nullable; backfilled at boot for existing employees)
  // People Module — compliance
  complianceScore:   integer("compliance_score"),
  i9Status:          text("i9_status").default("not_started"),
  backgroundCheckStatus: text("background_check_status").default("not_started"),
  // People Module — onboarding
  onboardingProgress:    integer("onboarding_progress").default(0),
  onboardingStartedAt:   text("onboarding_started_at"),
  onboardingCompletedAt: text("onboarding_completed_at"),
  payrollReady:      boolean("payroll_ready").default(false),
  hrReady:           boolean("hr_ready").default(false),
  complianceReady:   boolean("compliance_ready").default(false),
  firstPayrollReady: boolean("first_payroll_ready").default(false),
  // People Module — profile
  photoUrl:          text("photo_url"),
  notes:             text("notes"),
  createdAt:         text("created_at").notNull(),
  updatedAt:         text("updated_at").notNull(),
}, (t) => ({
  uniqueCompanyEmail: uniqueIndex("emp_company_email_unique").on(t.companyId, t.email),
}));

export const stateRegistrations = pgTable("state_registrations", {
  id:               text("id").primaryKey(),
  companyId:        text("company_id").notNull(),
  rollfiCompanyId:  text("rollfi_company_id").notNull(),
  stateCode:        text("state_code").notNull(),
  stateName:        text("state_name").notNull(),
  stateEmployerId:  text("state_employer_id"),
  suiAccountNumber: text("sui_account_number"),
  suiRate:          real("sui_rate"),
  fieldValuesJson:  text("field_values_json"),
  status:           text("status").notNull().default("pending"),
  rollfiResponse:   text("rollfi_response"),
  registeredAt:     text("registered_at").notNull(),
  updatedAt:        text("updated_at").notNull(),
}, (t) => ({
  uniqueCompanyState: uniqueIndex("sr_company_state_unique").on(t.companyId, t.stateCode),
}));

// ── People Module Tables ──────────────────────────────────────

export const onboardingTasks = pgTable("onboarding_tasks", {
  id:               text("id").primaryKey(),
  employeeId:       text("employee_id").notNull(),
  companyId:        text("company_id").notNull(),
  taskName:         text("task_name").notNull(),
  description:      text("description"),
  category:         text("category").notNull(),
  stage:            text("stage").notNull(),
  assignedToRole:   text("assigned_to_role").notNull(),
  assignedToUserId: text("assigned_to_user_id"),
  status:           text("status").notNull().default("pending"),
  isRequired:       boolean("is_required").notNull().default(true),
  dueDate:          text("due_date"),
  dueDaysAfterHire: integer("due_days_after_hire").notNull().default(0),
  completedAt:      text("completed_at"),
  completedBy:      text("completed_by"),
  autoGenerated:    boolean("auto_generated").notNull().default(true),
  createdAt:        text("created_at").notNull(),
  updatedAt:        text("updated_at").notNull(),
  completionMethod:  text("completion_method"),
  completionNote:    text("completion_note"),
  acknowledgedBy:    text("acknowledged_by"),
  acknowledgedAt:    text("acknowledged_at"),
  reopenedCount:     integer("reopened_count").notNull().default(0),
  lastReopenedAt:    text("last_reopened_at"),
  lastReopenedBy:    text("last_reopened_by"),
  linkedDocumentIds: text("linked_document_ids"),
});

export const complianceItems = pgTable("compliance_items", {
  id:                text("id").primaryKey(),
  employeeId:        text("employee_id").notNull(),
  companyId:         text("company_id").notNull(),
  type:              text("type").notNull(),
  name:              text("name").notNull(),
  status:            text("status").notNull().default("not_started"),
  isRequired:        boolean("is_required").notNull().default(true),
  completedAt:       text("completed_at"),
  expiryDate:        text("expiry_date"),
  linkedDocumentId:  text("linked_document_id"),
  linkedTaskId:      text("linked_task_id"),
  notes:             text("notes"),
  createdAt:         text("created_at").notNull(),
  updatedAt:         text("updated_at").notNull(),
});

export const employeeDocuments = pgTable("employee_documents", {
  id:               text("id").primaryKey(),
  employeeId:       text("employee_id").notNull(),
  companyId:        text("company_id").notNull(),
  documentName:     text("document_name").notNull(),
  documentType:     text("document_type").notNull(),
  customTypeName:   text("custom_type_name"),
  fileName:         text("file_name").notNull(),
  fileUrl:          text("file_url").notNull(),
  fileSize:         integer("file_size"),
  mimeType:         text("mime_type"),
  status:           text("status").notNull().default("uploaded"),
  uploadedAt:       text("uploaded_at").notNull(),
  uploadedBy:       text("uploaded_by").notNull(),
  verifiedAt:       text("verified_at"),
  verifiedBy:       text("verified_by"),
  expiryDate:       text("expiry_date"),
  requiresSignature: boolean("requires_signature").notNull().default(false),
  signedAt:         text("signed_at"),
  signedBy:         text("signed_by"),
  notes:            text("notes"),
  createdAt:        text("created_at").notNull(),
  updatedAt:        text("updated_at").notNull(),
});

export const emergencyContacts = pgTable("emergency_contacts", {
  id:                    text("id").primaryKey(),
  employeeId:            text("employee_id").notNull(),
  companyId:             text("company_id").notNull(),
  contactType:           text("contact_type").notNull().default("primary"),
  name:                  text("name").notNull(),
  relationship:          text("relationship").notNull(),
  phoneNumber:           text("phone_number").notNull(),
  alternatePhone:        text("alternate_phone"),
  email:                 text("email"),
  address:               text("address"),
  physicianName:         text("physician_name"),
  physicianPhone:        text("physician_phone"),
  insuranceProvider:     text("insurance_provider"),
  insurancePolicyNumber: text("insurance_policy_number"),
  createdAt:             text("created_at").notNull(),
  updatedAt:             text("updated_at").notNull(),
});

export const taskNotes = pgTable("task_notes", {
  id:         text("id").primaryKey(),
  taskId:     text("task_id").notNull(),
  employeeId: text("employee_id").notNull(),
  companyId:  text("company_id").notNull(),
  text:       text("text").notNull(),
  authorId:   text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  createdAt:  text("created_at").notNull(),
});

export const peopleActivityLog = pgTable("people_activity_log", {
  id:          text("id").primaryKey(),
  companyId:   text("company_id").notNull(),
  employeeId:  text("employee_id"),
  action:      text("action").notNull(),
  description: text("description").notNull(),
  category:    text("category").notNull(),
  performedBy: text("performed_by").notNull(),
  metadata:    text("metadata"),
  timestamp:   text("timestamp").notNull(),
});

export const beneficialOwners = pgTable("beneficial_owners", {
  id:                  serial("id").primaryKey(),
  companyId:           text("company_id").notNull(),
  firstName:           text("first_name").notNull(),
  lastName:            text("last_name").notNull(),
  email:               text("email").notNull(),
  phone:               text("phone").notNull(),
  dateOfBirth:         text("date_of_birth").notNull(),
  ssn:                 text("ssn").notNull(),
  address1:            text("address1").notNull(),
  city:                text("city").notNull(),
  state:               text("state").notNull(),
  zipcode:             text("zipcode").notNull(),
  ownershipPercentage: integer("ownership_percentage").notNull().default(100),
  isPayrollAdmin:      boolean("is_payroll_admin").notNull().default(true),
});

// ── Company Signed Forms ──────────────────────────────────────
// One row per company+form_type.  uploadStatus tracks whether the PDF has been
// pushed to Rollfi's uploadDocument API (happens on next sandbox→prod switch).
export const companySignedForms = pgTable("company_signed_forms", {
  id:                  text("id").primaryKey(),
  companyId:           text("company_id").notNull(),
  formType:            text("form_type").notNull().default("8655"),   // "8655" | "TR-2000"
  signerName:          text("signer_name").notNull(),
  signerTitle:         text("signer_title").notNull(),
  signedAt:            text("signed_at").notNull(),
  uploadStatus:        text("upload_status").notNull().default("pending"), // "pending" | "uploaded" | "failed"
  uploadError:         text("upload_error"),
  rollfiDocumentId:    text("rollfi_document_id"),
  /** ISO timestamp of the most recent upload attempt (set whenever uploadStatus is forced to "pending"). */
  uploadAttemptedAt:   text("upload_attempted_at"),
  /** Base64-encoded PNG of the owner's drawn signature (data: prefix stripped). Null when only a typed name was supplied. */
  signatureImage:      text("signature_image"),
  createdAt:           text("created_at").notNull(),
}, (t) => ({
  uniqueCompanyForm: uniqueIndex("csf_company_form_unique").on(t.companyId, t.formType),
}));

// ── EasyTeam Shift Store ──────────────────────────────────────
// Raw shifts from GET /embed/api/timesheets — upserted on every Pull Hours sync.
// employeeId is our internal ID resolved via EasyTeam-UUID→employee mapping;
// null + WARN logged when the UUID is not in our registry.
// Thresholds (missedPunch / extendedBreak / longShift) are computed at read time
// by GET /api/timesheets/shifts and will become configurable later.
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  token:     text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt:    text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const appActivityLog = pgTable("app_activity_log", {
  id:          text("id").primaryKey(),
  companyId:   text("company_id").notNull(),
  type:        text("type").notNull(),
  description: text("description").notNull(),
  actorName:   text("actor_name"),
  actorRole:   text("actor_role"),
  createdAt:   text("created_at").notNull(),
});

// ─── LOCATIONS ────────────────────────────────────────────────
// One row per physical company location. Phase 1: one location per company.
// easyteamLocationId is the string used in all EasyTeam and Rollfi API calls.
// rollfiLocationId stores the Rollfi-assigned location string (may differ).
export const locations = pgTable("locations", {
  id:                 text("id").primaryKey(),
  companyId:          text("company_id").notNull(),
  code:               text("code").notNull().default("100"),
  name:               text("name").notNull(),
  address1:           text("address1").notNull().default(""),
  address2:           text("address2"),
  city:               text("city").notNull().default(""),
  state:              text("state").notNull().default(""),
  zipcode:            text("zipcode").notNull().default(""),
  easyteamLocationId:  text("easyteam_location_id"),
  // Mutable external key sent in JWT locationId claims.  Defaults to locations.id for all
  // rows created before this column was added (resolver falls back to id when null).
  // Repair-without-delete: set this to a fresh UUID to re-register the location under the
  // correct EasyTeam org without changing the PK or any employee FK.
  easyteamExternalKey: text("easyteam_external_key"),
  rollfiLocationId:    text("rollfi_location_id"),
  isPrimary:          boolean("is_primary").notNull().default(false),
  latitude:           real("latitude"),
  longitude:          real("longitude"),
  isActive:           boolean("is_active").notNull().default(true),
  createdAt:          text("created_at").notNull(),
});

// ─── DEPARTMENTS ──────────────────────────────────────────────
// Persistent department rows (migrated from the in-memory store.departments array).
// type: "standard" | "daycare" | "custom"; isDefault = seeded at company creation.
export const departments = pgTable("departments", {
  id:        text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name:      text("name").notNull(),
  type:      text("type").notNull().default("standard"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const timesheetShifts = pgTable("timesheet_shifts", {
  easyteamShiftId:     text("easyteam_shift_id").primaryKey(),
  employeeId:          text("employee_id"),
  companyId:           text("company_id").notNull(),
  easyteamLocationId:  text("easyteam_location_id").notNull(),
  roleId:              text("role_id"),
  utcStartTime:        text("utc_start_time").notNull(),
  utcEndTime:          text("utc_end_time"),
  utcOffset:           integer("utc_offset").notNull().default(0),
  durationMs:          integer("duration_ms").notNull().default(0),
  payableDurationMs:   integer("payable_duration_ms").notNull().default(0),
  totalPaidBreakMin:   real("total_paid_break_min"),
  totalUnpaidBreakMin: real("total_unpaid_break_min"),
  breaks:              jsonb("breaks"),
  active:              boolean("active").notNull().default(false),
  locked:              boolean("locked").notNull().default(false),
  manualEntry:         boolean("manual_entry").notNull().default(false),
  scheduleShiftId:     text("schedule_shift_id"),
  localDate:           text("local_date"),      // YYYY-MM-DD derived from utcStartTime + utcOffset (employee's local timezone); backfilled for existing rows
  deletedAt:           text("deleted_at"),
  syncedAt:            text("synced_at").notNull(),
});
