import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";

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
