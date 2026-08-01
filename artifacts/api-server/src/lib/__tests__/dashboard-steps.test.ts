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

// ── stepsAllDone structural invariant ─────────────────────────────────────────
//
// `stepsAllDone` is derived directly from the prerequisite steps array, so any
// step whose `done` flag is false automatically blocks the gate.  The test
// below verifies the invariant itself: `stepsAllDone` must always equal
// "every prerequisite step (i.e. every step except ready_to_run) is done".
//
// This catches a regression where a new step is added to the array but its
// condition is somehow disconnected from the structural derivation — regardless
// of whether an explicit boolean expression or a test case list is updated.

describe("stepsAllDone structural invariant", () => {
  const representativeParams: Array<[string, Partial<DashboardStepsParams>]> = [
    ["all done",                              {}],
    ["resolvedRollfiCompanyId is null",       { resolvedRollfiCompanyId: null }],
    ["kybApproved is false",                  { kybApproved: false, kybStatus: "pending" }],
    ["bankLinked is false",                   { bankLinked: false }],
    ["payScheduleSet is false",               { payScheduleSet: false }],
    ["gaps is non-empty",                     { gaps: [{ state: "CA" }] }],
    ["employeeCount is 0",                    { employeeCount: 0 }],
    ["notReadyEmpsCount is > 0",              { notReadyEmpsCount: 1 }],
    ["form8655Signed is false",               { form8655Signed: false }],
    ["form8655UploadStatus is not uploaded",  { form8655UploadStatus: "pending" }],
  ];

  it.each(representativeParams)(
    "stepsAllDone === every prereq step done (%s)",
    (_label, override) => {
      const result = buildDashboardSteps({ ...allDone, ...override });
      const prereqsDone = result.steps
        .filter(s => s.id !== "ready_to_run")
        .every(s => s.done);
      expect(result.stepsAllDone).toBe(prereqsDone);
    },
  );
});

// ── completedCount ─────────────────────────────────────────────────────────────

describe("completedCount", () => {
  it("equals totalCount when all steps are done — guards against silent step-count drift from a newly added step whose done is hard-coded to false", () => {
    const result = buildDashboardSteps(allDone);
    expect(result.completedCount).toBe(result.totalCount);
  });

  it("equals 10 when all steps are done", () => {
    expect(buildDashboardSteps(allDone).completedCount).toBe(10);
  });

  it("is less than 10 when upload is pending", () => {
    const result = buildDashboardSteps({ ...allDone, form8655UploadStatus: "pending" });
    // form_8655_submitted and ready_to_run are both false → 8 done
    expect(result.completedCount).toBe(8);
  });
});
