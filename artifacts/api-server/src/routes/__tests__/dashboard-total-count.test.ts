/**
 * Route-level regression test for GET /dashboard — progress.totalCount.
 *
 * Guards against the route hard-coding `totalCount` (e.g. `totalCount: 10`)
 * instead of forwarding the value derived by `buildDashboardSteps`.
 *
 * The mock returns a non-standard number of steps (3) so that a hard-coded
 * value of 10 would cause the assertion to fail even if the helper were fixed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** FIFO queue; each `.where()` / `.catch()` call pops the next entry */
  callQueue: [] as unknown[][],
}));

const storeState = vi.hoisted(() => ({
  userId: "USER-001" as string | null,
  role: "owner" as string,
  companyId: "ORG-TEST" as string,
}));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

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
      // Support .from() without .where() (legacy rollfi lookup uses .catch())
      (inner as Record<string, unknown>).catch = (_fn: unknown) =>
        Promise.resolve([undefined]);
      return inner;
    };
    // Support select().where() directly (without .from())
    chain.where = () => {
      const result: unknown[] = dbState.callQueue.shift() ?? [];
      return Promise.resolve(result);
    };
    return chain;
  };

  const makeUpdateChain = () => ({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  });

  return {
    db: {
      select:  () => makeSelectChain(),
      update:  () => makeUpdateChain(),
    },
    companies:            {
      id: {}, name: {}, rollfiCompanyId: {}, rollfiLocationId: {},
      kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {}, payFrequency: {},
    },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:            {
      id: {}, firstName: {}, lastName: {}, homeState: {}, status: {},
      rollfiAccountStatus: {}, companyId: {},
    },
    stateRegistrations:   { companyId: {}, stateCode: {}, status: {} },
    companySignedForms:   {
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
      return {
        id:        storeState.userId,
        role:      storeState.role,
        companyId: storeState.companyId,
      };
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

vi.mock("axios", () => ({ default: axiosMock }));

/**
 * The key mock: return 3 steps with totalCount: 3.
 * A route that hard-codes `totalCount: 10` would fail the assertion below.
 */
const FAKE_STEPS = [
  { id: "s1", number: 1, label: "Step 1", done: true,  missingText: "", linkTo: null },
  { id: "s2", number: 2, label: "Step 2", done: true,  missingText: "", linkTo: null },
  { id: "s3", number: 3, label: "Step 3", done: false, missingText: "Do it", linkTo: null },
];

vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps:         FAKE_STEPS,
    stepsAllDone:  false,
    completedCount: 2,
    totalCount:    FAKE_STEPS.length, // 3, not 10
  }),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ROW = {
  id:               "ORG-TEST",
  name:             "Sunshine Daycare LLC",
  rollfiCompanyId:  null, // no Rollfi ID → skips getCompanyTask call
  rollfiLocationId: null,
  kybStatus:        "approved",
  bankAccountAdded: true,
  payScheduleAdded: true,
  payFrequency:     "biweekly",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /dashboard — progress.totalCount", () => {
  beforeEach(() => {
    dbState.callQueue = [];
    storeState.userId    = "USER-001";
    storeState.role      = "owner";
    storeState.companyId = "ORG-TEST";
    axiosMock.post.mockReset();
  });

  it("forwards totalCount from buildDashboardSteps, not a hard-coded value", async () => {
    // 1. company lookup
    dbState.callQueue.push([COMPANY_ROW]);
    // 2a. employees  2b. state registrations  2c. signed forms (parallel)
    dbState.callQueue.push([]); // no employees
    dbState.callQueue.push([]); // no state registrations
    dbState.callQueue.push([]); // no signed forms

    const res = await request(makeApp()).get("/dashboard");

    expect(res.status).toBe(200);
    const { progress } = res.body as {
      progress: { totalCount: number; steps: unknown[] };
    };

    // totalCount must equal steps.length (derived), not any hard-coded constant.
    expect(progress.totalCount).toBe(progress.steps.length);
    // Confirm the mock's value (3) actually came through — catches a test that
    // passes trivially because both sides are 0.
    expect(progress.totalCount).toBe(3);
  });
});
