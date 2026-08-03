/**
 * Focused tests confirming that safeRollfiLog — the shared helper used before
 * every Rollfi API response log statement — never leaks SSN, routing numbers,
 * or account numbers, even when Rollfi echoes them back in a response body.
 *
 * Imports the real implementation from lib/safe-rollfi-log.ts so these tests
 * exercise the actual function used in production, not a hand-rolled copy.
 */
import { describe, it, expect } from "vitest";
import { safeRollfiLog } from "../safe-rollfi-log.js";

// ── Helper ─────────────────────────────────────────────────────────────────

/** Assert that a serialized log object contains no trace of a sensitive value. */
function assertNotLogged(logObj: Record<string, unknown>, sensitiveValues: string[]) {
  const serialized = JSON.stringify(logObj);
  for (const v of sensitiveValues) {
    expect(serialized, `log output must not contain "${v}"`).not.toContain(v);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("safeRollfiLog — SSN and bank data never appear in log output", () => {

  it("strips SSN echoed back in a flat Rollfi KYC response", () => {
    const rollfiKycResponse = {
      status: "success",
      userId: "U-123",
      kycInformation: {
        ssn: "123-45-6789",
        dateOfBirth: "1990-01-15",
        address1: "123 Main St",
      },
    };
    const result = safeRollfiLog(rollfiKycResponse);
    assertNotLogged(result, ["123-45-6789", "123456789"]);
    expect(result["status"]).toBe("success");
    expect(result["userId"]).toBe("U-123");
    expect(result).not.toHaveProperty("kycInformation");
  });

  it("strips routing and account numbers echoed back in an addUserBankAccount response", () => {
    const rollfiBank = {
      status: "success",
      userPayAccountEntity: {
        accountNumber: "987654321",
        routingNumber: "021000021",
        bankName: "Test Bank",
      },
    };
    const result = safeRollfiLog(rollfiBank);
    assertNotLogged(result, ["987654321", "021000021"]);
    expect(result).not.toHaveProperty("userPayAccountEntity");
  });

  it("strips SSN echoed in a createBusiness/addKycInformation style nested payload", () => {
    const rollfiCreate = {
      registration: {
        companyId: "C-456",
        businessUser: {
          ssn: "987-65-4321",
          firstName: "Jane",
          lastName: "Smith",
        },
      },
      status: "pending",
    };
    const result = safeRollfiLog(rollfiCreate);
    assertNotLogged(result, ["987-65-4321", "987654321"]);
    expect(result["status"]).toBe("pending");
    expect(result).not.toHaveProperty("registration");
  });

  it("strips bank credentials from a company funding source response", () => {
    const rollfiCompanyBank = {
      success: true,
      companyFundingSourceEntity: {
        accountNumber: "111222333",
        routingNumber: "021000089",
        bankName: "Payroll Bank",
      },
    };
    const result = safeRollfiLog(rollfiCompanyBank);
    assertNotLogged(result, ["111222333", "021000089"]);
    expect(result["success"]).toBe(true);
    expect(result).not.toHaveProperty("companyFundingSourceEntity");
  });

  it("preserves scalar status/code fields while blocking object values", () => {
    const response = {
      status: "ok",
      code: 200,
      success: true,
      userId: "U-789",
      companyId: "C-001",
      result: { sensitiveField: "secret" },
      message: "Created",
    };
    const result = safeRollfiLog(response);
    expect(result["status"]).toBe("ok");
    expect(result["code"]).toBe(200);
    expect(result["success"]).toBe(true);
    expect(result["userId"]).toBe("U-789");
    expect(result["companyId"]).toBe("C-001");
    expect(result["result"]).toBe("[object]"); // non-scalar object replaced
    expect(result["message"]).toBe("Created");
    assertNotLogged(result, ["secret"]);
  });

  it("extracts only the message string from a Rollfi error object — drops nested PII", () => {
    const response = {
      error: {
        code: 4001,
        message: "SSN already exists",
        kycPayload: { ssn: "999-88-7777" },
      },
    };
    const result = safeRollfiLog(response);
    assertNotLogged(result, ["999-88-7777", "999887777"]);
    expect(result["error"]).toBe("SSN already exists"); // only the message string
  });

  it("handles a string error field safely", () => {
    const result = safeRollfiLog({ error: "Invalid routing number" });
    expect(result["error"]).toBe("Invalid routing number");
  });

  it("returns empty object for non-objects", () => {
    expect(safeRollfiLog(null)).toEqual({});
    expect(safeRollfiLog(undefined)).toEqual({});
    expect(safeRollfiLog("string")).toEqual({});
    expect(safeRollfiLog(42)).toEqual({});
  });

  it("handles deeply nested SSN that Rollfi might echo back — outer object blocked", () => {
    // Simulate an unusual Rollfi response shape that nests PII three levels deep
    const response = {
      status: "error",
      details: {
        user: {
          ssn: "555-44-3333",
          routingNumber: "122238242",
          accountNumber: "9889890989",
        },
      },
    };
    const result = safeRollfiLog(response);
    assertNotLogged(result, ["555-44-3333", "555443333", "122238242", "9889890989"]);
    expect(result["status"]).toBe("error");
    // "details" is not in the allow-list
    expect(result).not.toHaveProperty("details");
  });

  it("does not leak ownerSsn from a createBusiness-style error response", () => {
    // Rollfi sometimes echoes submitted data in error payloads
    const errResponse = {
      error: {
        code: 409,
        message: "Business already registered",
        submittedData: {
          ownerSsn: "111-22-3333",
          ein: "12-3456789",
        },
      },
    };
    const result = safeRollfiLog(errResponse);
    assertNotLogged(result, ["111-22-3333", "111223333", "12-3456789"]);
    // error.message is still surfaced for debugging
    expect(result["error"]).toBe("Business already registered");
  });

  it("strips bank numbers from a pay-schedule/addPaySchedule response", () => {
    // Verify the helper covers the company setup wizard path (setRollfiPaySchedule)
    const payScheduleResponse = {
      status: "success",
      paySchedule: {
        companyId: "C-789",
        accountNumber: "555666777",
        routingNumber: "021001088",
        compensationFrequency: "BiWeekly",
      },
    };
    const result = safeRollfiLog(payScheduleResponse);
    assertNotLogged(result, ["555666777", "021001088"]);
    expect(result["status"]).toBe("success");
    expect(result).not.toHaveProperty("paySchedule");
  });
});
