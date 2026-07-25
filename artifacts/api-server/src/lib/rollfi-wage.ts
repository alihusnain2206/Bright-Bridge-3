/**
 * Shared resolver: maps an employee's pay type to the three Rollfi wage fields
 * that appear in EVERY addUserWage / updateUserWage call.
 *
 * PROVEN by sandbox experiment (2026-07-25):
 *   wageBasis "Per Year" → Rollfi auto-computes period salary; payHours is ignored.
 *   wageBasis "Per Hour" → gross = netPayableHours × wageRate.
 *
 * EVERY addUserWage and updateUserWage call MUST call getRollfiWageFields().
 * There must be zero hardcoded "Per Hour" strings outside this file (grep enforced).
 */

export interface EmployeeWageInfo {
  /** DB pay_type column: 'hourly' | 'salary'. Anything starting with 'salary' is treated as salary. */
  payType?: string | null;
  /** Cents. Meaningful ONLY when payType = 'hourly'. */
  hourlyWage?: number | null;
  /** Cents. Meaningful ONLY when payType = 'salary'. */
  annualSalary?: number | null;
  /** When true and payType = 'salary', Rollfi userType becomes "Salary/Eligible for overtime". */
  overtimeEligible?: boolean | null;
}

export interface RollfiWageFields {
  /** Dollars — Rollfi expects dollars, not cents. */
  wageRate: number;
  wageBasis: "Per Hour" | "Per Year";
  userType: string;
}

export function getRollfiWageFields(emp: EmployeeWageInfo): RollfiWageFields {
  // Legacy 'salary_yearly' values are normalised to 'salary' at write time (companies.ts).
  // Any remaining 'salary_yearly' records in prod are one-off data bugs; treat as salary here too.
  const isSalary = emp.payType === "salary" || emp.payType === "salary_yearly" /* legacy — do not add new variants */;
  if (isSalary) {
    return {
      wageRate: (emp.annualSalary ?? 0) / 100,
      wageBasis: "Per Year",
      userType: emp.overtimeEligible
        ? "Salary/Eligible for overtime"
        : "Salary/No overtime",
    };
  }
  // Default: hourly
  return {
    wageRate: (emp.hourlyWage ?? 1500) / 100,
    wageBasis: "Per Hour",
    userType: "Paid by the hour",
  };
}
