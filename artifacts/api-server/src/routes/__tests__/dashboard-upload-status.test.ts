/**
 * Integration test: GET /dashboard wires form8655_upload_status correctly.
 *
 * Verifies that the real DB column value flows through the HTTP layer into the
 * `form_8655_submitted` step without being swallowed, hard-coded, or mangled.
 * Uses the REAL `buildDashboardSteps` (not mocked) so the test covers the full
 * DB → endpoint → step-builder chain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  callQueue: [] as unknown[][],
}));

const storeState = vi.hoisted(() => ({
  userId:    "USER-001" as string | null,
  role:      "owner"   as string,
  companyId: "ORG-001" as string,
}));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:  (_col: unknown, _val: unknown) => ({}),
  and: (..._args: unknown[]) => ({}),
}));

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => {
      const inner: Record<string, unknown> = {};
      inner.where = () => {
        const result: unknown[] = dbState.callQueue.shift() ?? [];
        return Promise.resolve(result);
      };
      // Handles .from().catch() without a .where() call (legacy lookup pattern)
      (inner as Record<string, unknown>).catch = (_fn: unknown) =>
        Promise.resolve([undefined]);
      return inner;
    };
    // Handles .select().where() without .from()
    chain.where = () => {
      const result: unknown[] = dbState.callQueue.shift() ?? [];
      return Promise.resolve(result);
    };
    return chain;
  };

  const makeUpdateChain = () => ({
    set: () => ({ where: () => Promise.resolve([]) }),
  });

  return {
    db: {
      select: () => makeSelectChain(),
      update: () => makeUpdateChain(),
    },
    companies: {
      id: {}, name: {}, rollfiCompanyId: {}, rollfiLocationId: {},
      kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {}, payFrequency: {},
    },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees: {
      id: {}, firstName: {}, lastName: {}, homeState: {}, status: {},
      rollfiAccountStatus: {}, companyId: {},
    },
    stateRegistrations:  { companyId: {}, stateCode: {}, status: {} },
    companySignedForms:  {
      companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      uploadAttemptedAt: {}, id: {},
    },
  };
});

vi.mock("../../store.js", () => ({
  store: {
    getUserById: (id: string) => {
      if (!storeState.userId || id !== storeState.userId) return null;
      return { id: storeState.userId, role: storeState.role, companyId: storeState.companyId };
    },
    getRawUser: () => null,
  },
}));

vi.mock("../../lib/auth-middleware.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: storeState.userId ?? undefined };
    next();
  },
}));

vi.mock("../../lib/rollfi-config.js", () => ({
  getRollfiConfig: () => ({
    credentialsPresent: false,
    baseUrl:   "https://sandbox.rollfi.xyz",
    clientId:  undefined,
    secretKey: undefined,
  }),
  rollfiHeaders: () => ({}),
  getBaseUrl:    () => "https://sandbox.rollfi.xyz",
}));

vi.mock("../../lib/rollfi-employee-sync.js", () => ({
  extractRollfiError: (_data: unknown) => null,
}));

// form8655 lib — only needed for sign/upload routes, not dashboard
vi.mock("../../lib/form8655.js", () => ({
  buildForm8655Pdf:    vi.fn(),
  getForm8655AuthDates: vi.fn(),
}));

vi.mock("axios", () => ({ default: axiosMock }));

// ── Import router AFTER all mocks ─────────────────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: storeState.userId ?? undefined };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(companySettingsRouter);
  return app;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

/**
 * Company row without a Rollfi ID so:
 *  - the legacy rollfiCompanyRecords lookup returns undefined (no queue slot consumed)
 *  - the getCompanyTask Rollfi call is skipped entirely
 *  - the upload-reconcile check is skipped (requires resolvedRollfiCompanyId)
 *
 * All other setup flags are set to "done" so the only variable is uploadStatus.
 */
const COMPANY_ROW = {
  id:               "ORG-001",
  name:             "Acme Payroll LLC",
  rollfiCompanyId:  null,
  rollfiLocationId: null,
  kybStatus:        "approved",
  bankAccountAdded: true,
  payScheduleAdded: true,
  payFrequency:     "biweekly",
};

/** One active employee who is payroll-ready — satisfies employee steps. */
const EMPLOYEE_ROW = {
  id:                  "EMP-001",
  firstName:           "Jane",
  lastName:            "Doe",
  homeState:           "WA",        // NO_REGISTRATION_NEEDED state → no gap
  status:              "active",
  rollfiAccountStatus: "Active",
};

/** State registration for WA so no gap is generated (WA is in NO_REGISTRATION_NEEDED anyway,
 *  but adding it here keeps the fixture explicit and stable if the set ever changes). */
const REG_ROW = { stateCode: "WA", status: "active" };

/**
 * Build a companySignedForms row for form 8655 with the given uploadStatus.
 * signerName/Title/signedAt are required by the route to treat form8655Signed = true.
 */
function signedFormRow(uploadStatus: string | null) {
  return {
    formType:          "8655",
    signerName:        "Jane Doe",
    signerTitle:       "Owner",
    signedAt:          "2026-07-01T10:00:00.000Z",
    uploadStatus,
    uploadError:       null,
    rollfiDocumentId:  null,
    uploadAttemptedAt: "2026-07-01T10:00:05.000Z",
  };
}

/**
 * Seed the DB call queue for one GET /dashboard request.
 *
 * Call order (each .where() pops one entry):
 *  1. companies  table
 *  2. rollfiCompanyRecords  (company has no rollfiCompanyId → always looked up)
 *  3. employees             (Promise.all slot 0)
 *  4. stateRegistrations    (Promise.all slot 1)
 *  5. companySignedForms    (Promise.all slot 2)
 */
function seedQueue(uploadStatus: string | null) {
  dbState.callQueue = [
    [COMPANY_ROW],                          // 1. companies
    [],                                     // 2. rollfiCompanyRecords (no legacy row)
    [EMPLOYEE_ROW],                         // 3. employees
    [REG_ROW],                              // 4. stateRegistrations
    [signedFormRow(uploadStatus)],          // 5. companySignedForms
  ];
}

/** Extract the named step from the response body. */
function getStep(body: Record<string, unknown>, stepId: string) {
  const progress = body.progress as { steps: Array<{ id: string; done: boolean; missingText: string }> };
  const s = progress.steps.find(s => s.id === stepId);
  if (!s) throw new Error(`Step "${stepId}" not found in response`);
  return s;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /dashboard — form8655_upload_status wiring", () => {
  beforeEach(() => {
    dbState.callQueue = [];
    storeState.userId    = "USER-001";
    storeState.role      = "owner";
    storeState.companyId = "ORG-001";
    axiosMock.post.mockReset();
  });

  // ── pending ────────────────────────────────────────────────────────────────

  describe("when upload_status = 'pending'", () => {
    it("returns HTTP 200", async () => {
      seedQueue("pending");
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("form_8655_submitted step is done: false", async () => {
      seedQueue("pending");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_submitted").done).toBe(false);
    });

    it("form_8655_submitted missingText says submission is in progress", async () => {
      seedQueue("pending");
      const res = await request(makeApp()).get("/dashboard");
      expect(
        getStep(res.body as Record<string, unknown>, "form_8655_submitted").missingText,
      ).toMatch(/in progress/i);
    });

    it("ready_to_run step is done: false", async () => {
      seedQueue("pending");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "ready_to_run").done).toBe(false);
    });
  });

  // ── failed ─────────────────────────────────────────────────────────────────

  describe("when upload_status = 'failed'", () => {
    it("returns HTTP 200", async () => {
      seedQueue("failed");
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("form_8655_submitted step is done: false", async () => {
      seedQueue("failed");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_submitted").done).toBe(false);
    });

    it("form_8655_submitted missingText mentions retry", async () => {
      seedQueue("failed");
      const res = await request(makeApp()).get("/dashboard");
      expect(
        getStep(res.body as Record<string, unknown>, "form_8655_submitted").missingText,
      ).toMatch(/retry/i);
    });

    it("ready_to_run step is done: false", async () => {
      seedQueue("failed");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "ready_to_run").done).toBe(false);
    });
  });

  // ── uploaded ───────────────────────────────────────────────────────────────
  // resolvedRollfiCompanyId is null in COMPANY_ROW, so the reconcile check is
  // skipped and the "uploaded" status is trusted as-is.

  describe("when upload_status = 'uploaded'", () => {
    it("returns HTTP 200", async () => {
      seedQueue("uploaded");
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("form_8655_submitted step is done: true", async () => {
      seedQueue("uploaded");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_submitted").done).toBe(true);
    });

    it("form_8655_signed step is also done: true", async () => {
      seedQueue("uploaded");
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_signed").done).toBe(true);
    });
  });

  // ── null (never signed) ────────────────────────────────────────────────────

  describe("when no signed-forms row exists (upload_status = null)", () => {
    it("returns HTTP 200", async () => {
      // empty signedForms list = form never signed
      dbState.callQueue = [
        [COMPANY_ROW],
        [],
        [EMPLOYEE_ROW],
        [REG_ROW],
        [],                  // no signed forms
      ];
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("form_8655_signed step is done: false", async () => {
      dbState.callQueue = [[COMPANY_ROW], [], [EMPLOYEE_ROW], [REG_ROW], []];
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_signed").done).toBe(false);
    });

    it("form_8655_submitted step is done: false", async () => {
      dbState.callQueue = [[COMPANY_ROW], [], [EMPLOYEE_ROW], [REG_ROW], []];
      const res = await request(makeApp()).get("/dashboard");
      expect(getStep(res.body as Record<string, unknown>, "form_8655_submitted").done).toBe(false);
    });

    it("form_8655_submitted missingText instructs to sign first", async () => {
      dbState.callQueue = [[COMPANY_ROW], [], [EMPLOYEE_ROW], [REG_ROW], []];
      const res = await request(makeApp()).get("/dashboard");
      expect(
        getStep(res.body as Record<string, unknown>, "form_8655_submitted").missingText,
      ).toMatch(/sign form 8655 first/i);
    });
  });
});
