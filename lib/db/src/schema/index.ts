import { pgTable, text, serial, integer, boolean, real } from "drizzle-orm/pg-core";

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
