/**
 * Pure helper — builds the 10-step configuration-progress array for the
 * /api/dashboard endpoint.  Extracted so it can be unit-tested without any
 * DB or HTTP dependencies.
 */

export interface DashboardStepsParams {
  resolvedRollfiCompanyId: string | null;
  kybApproved: boolean;
  kybStatus: string | null;
  bankLinked: boolean;
  /** true only when payScheduleAdded===true AND payFrequency is set */
  payScheduleSet: boolean;
  /** raw DB flag — used for missingText on the pay_schedule step */
  payScheduleAdded: boolean | null;
  /** raw DB value — used for missingText on the pay_schedule step */
  payFrequency: string | null | undefined;
  /** states that have active employees but no active state-tax registration */
  gaps: Array<{ state: string }>;
  employeeCount: number;
  notReadyEmpsCount: number;
  form8655Signed: boolean;
  /** "pending" | "uploaded" | "failed" | null */
  form8655UploadStatus: string | null;
}

export interface DashboardStep {
  id: string;
  number: number;
  label: string;
  done: boolean;
  missingText: string;
  linkTo: string | null;
}

export interface DashboardStepsResult {
  steps: DashboardStep[];
  stepsAllDone: boolean;
  completedCount: number;
  totalCount: number;
}

export function buildDashboardSteps(p: DashboardStepsParams): DashboardStepsResult {
  const form8655Submitted = p.form8655UploadStatus === "uploaded";

  const stepsAllDone =
    !!p.resolvedRollfiCompanyId &&
    p.kybApproved &&
    p.bankLinked &&
    p.payScheduleSet &&
    p.gaps.length === 0 &&
    p.employeeCount > 0 &&
    p.notReadyEmpsCount === 0 &&
    p.form8655Signed &&
    form8655Submitted;

  const steps: DashboardStep[] = [
    {
      id: "company_registered", number: 1, label: "Company registered",
      done: !!p.resolvedRollfiCompanyId,
      missingText: "Enroll your company in the payroll service",
      linkTo: "/settings?tab=company-info",
    },
    {
      id: "business_verified", number: 2, label: "Business verified",
      done: p.kybApproved,
      missingText:
        p.kybStatus === "pending"  ? "Business verification is pending review" :
        p.kybStatus === "failed"   ? "Business verification failed — contact support" :
        "Submit your business verification documents",
      linkTo: "/settings?tab=company-info",
    },
    {
      id: "funding_account", number: 3, label: "Funding account",
      done: p.bankLinked,
      missingText: "Connect a bank account for payroll funding",
      linkTo: null,
    },
    {
      id: "pay_schedule", number: 4, label: "Pay schedule",
      done: p.payScheduleSet,
      missingText: p.payScheduleAdded && !p.payFrequency
        ? "Select a pay frequency to finalize your pay schedule"
        : "Set up a pay schedule for your employees",
      linkTo: "/payroll",
    },
    {
      id: "state_tax", number: 5, label: "State tax registered",
      done: p.gaps.length === 0,
      missingText: p.gaps.length === 1
        ? `${p.gaps[0].state} state tax registration is missing`
        : `${p.gaps.length} states need tax registration`,
      linkTo: "/settings?tab=state-tax",
    },
    {
      id: "employees_added", number: 6, label: "Employees added",
      done: p.employeeCount > 0,
      missingText: "Add at least one employee before running payroll",
      linkTo: "/people/new",
    },
    {
      id: "employees_ready", number: 7, label: "Employees payroll-ready",
      done: p.employeeCount > 0 && p.notReadyEmpsCount === 0,
      missingText: p.notReadyEmpsCount > 0
        ? `${p.notReadyEmpsCount} employee${p.notReadyEmpsCount > 1 ? "s are" : " is"} not yet activated for payroll`
        : "Add employees first",
      linkTo: "/people",
    },
    {
      id: "form_8655_signed", number: 8, label: "IRS Form 8655 signed",
      done: p.form8655Signed,
      missingText: "Sign Form 8655 to authorize federal tax filing",
      linkTo: "/settings?tab=signatures",
    },
    {
      id: "form_8655_submitted", number: 9, label: "Form 8655 submitted to IRS filing service",
      done: form8655Submitted,
      missingText: !p.form8655Signed
        ? "Sign Form 8655 first"
        : p.form8655UploadStatus === "failed"
          ? "Submission failed — retry the upload on the Signatures tab"
          : p.form8655UploadStatus === "pending"
            ? "Submission is in progress — if it has been stuck for more than a few minutes, retry on the Signatures tab"
            : "Form 8655 has not yet been submitted to the IRS filing service",
      linkTo: "/settings?tab=signatures",
    },
    {
      id: "ready_to_run", number: 10, label: "Ready to run payroll",
      done: stepsAllDone,
      missingText: "Complete all steps above to unlock payroll",
      linkTo: null,
    },
  ];

  const completedCount = steps.filter(s => s.done).length;

  return { steps, stepsAllDone, completedCount, totalCount: steps.length };
}
