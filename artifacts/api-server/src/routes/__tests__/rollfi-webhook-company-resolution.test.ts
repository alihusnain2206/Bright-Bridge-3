/**
 * Tests for webhook company resolution — multi-company case.
 *
 * Coverage:
 * 1. Two `payperiod.payperiodstatus.update` events arrive with different
 *    rollfiCompanyId values. When both companies are in the in-memory store
 *    (fast path), each stored event carries the correct internal companyId.
 * 2. When the in-memory store is empty (slow path), resolveCompanyIdAsync
 *    falls back to a DB lookup and still maps each event to the right company.
 * 3. An event whose rollfiCompanyId has no match (neither store nor DB)
 *    is stored with companyId = null rather than swapped to the wrong tenant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

/** Controls which companies the store mock returns. */
const storeState = vi.hoisted(() => ({
  companies:     [] as Array<{ id: string }>,
  rollfiRecords: new Map<string, { rollfiCompanyId: string }>(),
}));

/** Tracks every `.values()` call on db.insert(), in arrival order. */
const dbInserts = vi.hoisted(() => ({
  values: [] as Array<Record<string, unknown>>,
}));

/**
 * Controls what the DB select returns for the slow-path lookup.
 * Each entry is consumed FIFO; the first item is used for the next
 * `.where().limit()` call inside resolveCompanyIdAsync.
 */
const dbSelectQueue = vi.hoisted(() => ({
  queue: [] as Array<{ id: string } | undefined>,
}));

// ── Module mocks — must be declared before any imports ───────────────────────

vi.mock("../../store.js", () => ({
  store: {
    getCompanies: () => storeState.companies,
    getRollfiCompany: (id: string) => storeState.rollfiRecords.get(id),
    // Remaining store methods referenced by rollfi.ts routes we don't exercise:
    getUserById:     (_id: string) => undefined,
    getActivity:     (_id: string, _n: number) => [],
    persistActivity: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.from   = () => chain;
    chain.where  = () => chain;
    chain.limit  = () => {
      const row = dbSelectQueue.queue.shift();
      return Promise.resolve(row ? [row] : []);
    };
    // Some call sites don't call .limit() — add a then-able fallback
    chain.then = (resolve: (v: unknown[]) => unknown) => {
      const row = dbSelectQueue.queue.shift();
      return Promise.resolve(row ? [row] : []).then(resolve);
    };
    return chain;
  };

  const makeInsertChain = () => {
    const chain: Record<string, unknown> = {};
    chain.values = (data: unknown) => {
      dbInserts.values.push(data as Record<string, unknown>);
      // Support .onConflictDoUpdate() or plain resolution
      const inner: Record<string, unknown> = {};
      inner.onConflictDoUpdate = () => Promise.resolve(undefined);
      return Object.assign(Promise.resolve(undefined), inner);
    };
    return chain;
  };

  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => makeInsertChain(),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
    // Table stubs — only the column names that rollfi.ts destructures matter
    rollfiWebhookEvents: {
      id: {}, eventType: {}, companyId: {}, rollfiCompanyId: {},
      payPeriodId: {}, payload: {}, receivedAt: {},
    },
    rollfiEmployeeRecords: { rollfiUserId: {}, employeeId: {} },
    companies: {
      id: {}, rollfiCompanyId: {}, name: {}, ein: {},
      address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {},
      kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {}, payFrequency: {},
      rollfiLocationId: {},
    },
    employees: {
      id: {}, firstName: {}, lastName: {}, homeState: {}, status: {},
      rollfiAccountStatus: {}, companyId: {}, rollfiUserId: {},
      homeAddress: {}, homeCity: {}, homeZip: {}, dateOfBirth: {}, ssn: {},
    },
    stateRegistrations: { companyId: {}, stateCode: {}, status: {} },
    companySignedForms: {
      companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      uploadAttemptedAt: {}, id: {}, signatureImage: {}, createdAt: {},
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq:      (_col: unknown, _val: unknown) => ({}),
  and:     (..._args: unknown[]) => ({}),
  inArray: (_col: unknown, _vals: unknown) => ({}),
  desc:    (_col: unknown) => ({}),
}));

vi.mock("../../lib/rollfi-config.js", () => ({
  getRollfiConfig: () => ({
    credentialsPresent: true,
    baseUrl:   "https://sandbox.rollfi.xyz",
    clientId:  "test-cid",
    secretKey: "test-sk",
    env:       "sandbox",
  }),
}));

vi.mock("../../lib/rollfi-persist.js", () => ({
  persistRollfiCompany:  vi.fn(),
  persistRollfiEmployee: vi.fn(),
}));

vi.mock("../../lib/timesheet-approvals-persist.js", () => ({
  getTimesheetApprovalsByCompanyPeriod:       vi.fn().mockResolvedValue([]),
  getLatestTimesheetApprovalsByCompany:        vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/user-account-persist.js", () => ({
  deleteUserAccount: vi.fn(),
}));

vi.mock("../../lib/easyteam-employee-sync.js", () => ({
  registerEmployeeInEasyTeam: vi.fn(),
}));

vi.mock("../../lib/rollfi-state-fields.js", () => ({
  buildStateRegistrationPayload: vi.fn(),
}));

vi.mock("../../lib/rollfi-employee-sync.js", () => ({
  runEmployeeKycOnboarding: vi.fn(),
  extractRollfiError:       (_data: unknown) => null,
}));

vi.mock("../../lib/rollfi-wage.js", () => ({
  getRollfiWageFields: vi.fn(),
}));

vi.mock("../../lib/auth-middleware.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireOwner: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps: [], stepsAllDone: false, completedCount: 0, totalCount: 0,
  }),
}));

vi.mock("axios", () => ({
  default: {
    get:  vi.fn(),
    post: vi.fn(),
    put:  vi.fn(),
  },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import rollfiRouter from "../rollfi.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = {
      info:  vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    next();
  });
  app.use(rollfiRouter);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A_ID        = "internal-company-alpha";
const COMPANY_B_ID        = "internal-company-beta";
const ROLLFI_ID_A         = "rollfi-co-aaaa-1111";
const ROLLFI_ID_B         = "rollfi-co-bbbb-2222";
const ROLLFI_ID_UNKNOWN   = "rollfi-co-xxxx-9999";

/** Build a minimal payperiod.payperiodstatus.update payload */
function makePayPeriodPayload(rollfiCompanyId: string, payPeriodId = "pp-001") {
  return {
    trigger: {
      eventType: "payperiod.payperiodstatus.update",
      companyId: rollfiCompanyId,
      payPeriodId,
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbInserts.values.length = 0;
  dbSelectQueue.queue.length = 0;
  storeState.companies.length = 0;
  storeState.rollfiRecords.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveCompanyIdAsync — multi-company webhook routing", () => {

  describe("fast path: both companies are in the in-memory store", () => {
    beforeEach(() => {
      // Populate the store with two companies
      storeState.companies.push({ id: COMPANY_A_ID }, { id: COMPANY_B_ID });
      storeState.rollfiRecords.set(COMPANY_A_ID, { rollfiCompanyId: ROLLFI_ID_A });
      storeState.rollfiRecords.set(COMPANY_B_ID, { rollfiCompanyId: ROLLFI_ID_B });
    });

    it("links a payperiod event for company A to the correct internal id", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_A, "pp-alpha-001"));

      expect(res.status).toBe(200);

      const stored = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_A,
      ) as Record<string, unknown> | undefined;
      expect(stored).toBeDefined();
      expect(stored?.companyId).toBe(COMPANY_A_ID);
    });

    it("links a payperiod event for company B to the correct internal id", async () => {
      const app = makeApp();
      const res = await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_B, "pp-beta-001"));

      expect(res.status).toBe(200);

      const stored = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_B,
      ) as Record<string, unknown> | undefined;
      expect(stored).toBeDefined();
      expect(stored?.companyId).toBe(COMPANY_B_ID);
    });

    it("does not swap company ids when two events arrive in sequence", async () => {
      const app = makeApp();

      await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_A, "pp-alpha-seq"));
      await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_B, "pp-beta-seq"));

      expect(dbInserts.values).toHaveLength(2);

      const eventA = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_A,
      ) as Record<string, unknown>;
      const eventB = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_B,
      ) as Record<string, unknown>;

      expect(eventA.companyId).toBe(COMPANY_A_ID);
      expect(eventB.companyId).toBe(COMPANY_B_ID);
      // Guard: company ids must not be swapped
      expect(eventA.companyId).not.toBe(COMPANY_B_ID);
      expect(eventB.companyId).not.toBe(COMPANY_A_ID);
    });
  });

  describe("slow path: store is empty, DB lookup resolves the company", () => {
    it("resolves company A via DB when store has no entries", async () => {
      // Store is empty — resolveCompanyIdAsync must fall through to the DB
      dbSelectQueue.queue.push({ id: COMPANY_A_ID });

      const app = makeApp();
      const res = await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_A, "pp-alpha-db"));

      expect(res.status).toBe(200);

      const stored = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_A,
      ) as Record<string, unknown> | undefined;
      expect(stored).toBeDefined();
      expect(stored?.companyId).toBe(COMPANY_A_ID);
    });

    it("does not swap ids for two companies resolved entirely via DB", async () => {
      // Queue both company rows — consumed FIFO by the two sequential lookups
      dbSelectQueue.queue.push({ id: COMPANY_A_ID }, { id: COMPANY_B_ID });

      const app = makeApp();

      await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_A, "pp-alpha-db-seq"));
      await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_B, "pp-beta-db-seq"));

      expect(dbInserts.values).toHaveLength(2);

      const eventA = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_A,
      ) as Record<string, unknown>;
      const eventB = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_B,
      ) as Record<string, unknown>;

      expect(eventA.companyId).toBe(COMPANY_A_ID);
      expect(eventB.companyId).toBe(COMPANY_B_ID);
    });
  });

  describe("no match: unknown rollfiCompanyId is stored with null companyId", () => {
    it("stores the event with companyId undefined/null when no company matches", async () => {
      // Store is empty, DB returns nothing
      // (dbSelectQueue is empty → queue.shift() returns undefined → resolves [])
      storeState.companies.push({ id: COMPANY_A_ID });
      storeState.rollfiRecords.set(COMPANY_A_ID, { rollfiCompanyId: ROLLFI_ID_A });

      const app = makeApp();
      const res = await request(app)
        .post("/rollfi/webhook")
        .send(makePayPeriodPayload(ROLLFI_ID_UNKNOWN, "pp-unknown"));

      expect(res.status).toBe(200);

      const stored = dbInserts.values.find(
        (v) => (v as Record<string, unknown>).rollfiCompanyId === ROLLFI_ID_UNKNOWN,
      ) as Record<string, unknown> | undefined;
      expect(stored).toBeDefined();
      // companyId must not be set to another company's id
      expect(stored?.companyId).not.toBe(COMPANY_A_ID);
      // Stored as undefined (which maps to NULL in the DB)
      expect(stored?.companyId == null).toBe(true);
    });
  });
});
