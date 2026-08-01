// Shared types for dashboard widgets extracted from PayrollWidgets.tsx and manager-payroll.tsx

export interface ProcessedPeriod {
  payPeriodId?: string;
  payBeginDate?: string;
  payEndDate?: string;
  payDate?: string;
  payPeriodStatus?: string;
  payrollAmount?: number;
  [key: string]: unknown;
}

export interface PayPeriod {
  payPeriodId: string;
  payDate: string;
  payrollAmount?: number;
}

export interface PeriodDetailItem {
  payPeriodId: string;
  total: number;
  employeeTaxSum: number;
  employerTaxSum: number;
  payDate: string;
  payrollLineItems: Array<{ grossTotal: number; netTotal: number; userId: string }>;
}

export interface PeriodDetailsResponse {
  payPeriod: PeriodDetailItem[];
}

export interface CompanyState {
  id: string;
  name: string;
  rollfi: { rollfiCompanyId: string } | null;
}

export interface ActivityFeedEvent {
  id: string;
  type: string;
  description: string;
  source: "app" | "rollfi";
  actorName?: string;
  actorRole?: string;
  createdAt: string;
}
