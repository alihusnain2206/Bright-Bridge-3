import { describe, it, expect } from "vitest";
import { buildDashboardSteps, type DashboardStepsParams } from "../dashboard-steps.js";

/** A "fully-configured" baseline where every step is done. */
const allDone: DashboardStepsParams = {
  resolvedRollfiCompanyId: "rc-123",
  kybApproved: true,
  kybStatus: "approved",
  bankLinked: true,
  payScheduleSet: true,
  payScheduleAdded: true,
  payFrequency: "bi_weekly",
  gaps: [],
  employeeCount: 2,
  notReadyEmpsCount: 0,
  form8655Signed: true,
  form8655UploadStatus: "uploaded",
};

function step(result: ReturnType<typeof buildDashboardSteps>, id: string) {
  const s = result.steps.find(s => s.id === id);
  if (!s) throw new Error(`Step "${id}" not found`);
  return s;
}

// ── totalCount ────────────────────────────────────────────────────────────────

describe("totalCount", () => {
  it("equals the number of steps (derived, not hard-coded)", () => {
    const result = buildDashboardSteps(allDone);
    expect(result.totalCount).toBe(result.steps.length);
  });

  it("stays consistent regardless of upload status", () => {
    const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: null });
    expect(result.totalCount).toBe(result.steps.length);
  });
});

// ── uploadStatus === "pending" ─────────────────────────────────────────────────

describe("uploadStatus = pending", () => {
  const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: "pending" });

  it("form_8655_signed is done: true", () => {
    expect(step(result, "form_8655_signed").done).toBe(true);
  });

  it("form_8655_submitted is done: false", () => {
    expect(step(result, "form_8655_submitted").done).toBe(false);
  });

  it("form_8655_submitted missingText says submission is in progress", () => {
    expect(step(result, "form_8655_submitted").missingText).toMatch(
      /in progress/i,
    );
  });

  it("ready_to_run is done: false (blocked by pending upload)", () => {
    expect(step(result, "ready_to_run").done).toBe(false);
  });
});

// ── uploadStatus === "uploaded" ────────────────────────────────────────────────

describe("uploadStatus = uploaded (fully complete)", () => {
  const result = buildDashboardSteps(allDone); // allDone already has "uploaded"

  it("form_8655_signed is done: true", () => {
    expect(step(result, "form_8655_signed").done).toBe(true);
  });

  it("form_8655_submitted is done: true", () => {
    expect(step(result, "form_8655_submitted").done).toBe(true);
  });

  it("ready_to_run is done: true when all other steps are also complete", () => {
    expect(step(result, "ready_to_run").done).toBe(true);
  });

  it("stepsAllDone is true", () => {
    expect(result.stepsAllDone).toBe(true);
  });
});

// ── uploadStatus === "failed" ──────────────────────────────────────────────────

describe("uploadStatus = failed", () => {
  const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: "failed" });

  it("form_8655_signed is done: true", () => {
    expect(step(result, "form_8655_signed").done).toBe(true);
  });

  it("form_8655_submitted is done: false", () => {
    expect(step(result, "form_8655_submitted").done).toBe(false);
  });

  it("form_8655_submitted missingText mentions retry", () => {
    expect(step(result, "form_8655_submitted").missingText).toMatch(/retry/i);
  });

  it("ready_to_run is done: false", () => {
    expect(step(result, "ready_to_run").done).toBe(false);
  });
});

// ── uploadStatus === null (form never signed) ──────────────────────────────────

describe("uploadStatus = null (form not signed at all)", () => {
  const result = buildDashboardSteps({
    ...allDone,
    form8655Signed: false,
    form8655UploadStatus: null,
  });

  it("form_8655_signed is done: false", () => {
    expect(step(result, "form_8655_signed").done).toBe(false);
  });

  it("form_8655_submitted is done: false", () => {
    expect(step(result, "form_8655_submitted").done).toBe(false);
  });

  it("form_8655_submitted missingText instructs to sign first", () => {
    expect(step(result, "form_8655_submitted").missingText).toMatch(/sign form 8655 first/i);
  });

  it("ready_to_run is done: false", () => {
    expect(step(result, "ready_to_run").done).toBe(false);
  });
});

// ── ready_to_run edge cases ────────────────────────────────────────────────────

describe("ready_to_run gate", () => {
  it("stays false when only the upload is missing (everything else done)", () => {
    const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: "pending" });
    expect(step(result, "ready_to_run").done).toBe(false);
  });

  it("stays false when no employees are present even if forms are done", () => {
    const result = buildDashboardSteps({ ...allDone, employeeCount: 0 });
    expect(step(result, "ready_to_run").done).toBe(false);
  });

  it("stays false when KYB is not approved even if forms are done", () => {
    const result = buildDashboardSteps({ ...allDone, kybApproved: false, kybStatus: "pending" });
    expect(step(result, "ready_to_run").done).toBe(false);
  });
});

// ── completedCount ─────────────────────────────────────────────────────────────

describe("completedCount", () => {
  it("equals 10 when all steps are done", () => {
    expect(buildDashboardSteps(allDone).completedCount).toBe(10);
  });

  it("is less than 10 when upload is pending", () => {
    const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: "pending" });
    // form_8655_submitted and ready_to_run are both false → 8 done
    expect(result.completedCount).toBe(8);
  });
});
