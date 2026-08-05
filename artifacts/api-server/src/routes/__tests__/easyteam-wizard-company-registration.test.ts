/**
 * Regression tests for EasyTeam registration of employees at wizard-created companies.
 *
 * The original bug: `POST /rollfi/employees` read the company's `rollfiLocationId` from
 * the DB and applied `?? undefined`, which does NOT catch an empty string. An empty string
 * is falsy but not nullish, so `(etLocationId && etLocationId.trim())` evaluates to false
 * and the code correctly falls through to `resolveCompanyLocationId`. This is the fix.
 *
 * These tests confirm that `registerEmployeeInEasyTeam` is always called with a non-empty
 * locationId — specifically the stable `LOC-<companyId>` fallback when the DB row has
 * an empty or null rollfiLocationId.
 *
 * Coverage:
 * 1. Wizard company (not in store) with empty rollfiLocationId in DB
 *    → registerEmployeeInEasyTeam called with "LOC-<companyId>" (never "")
 * 2. Wizard company (not in store) with a real EasyTeam locationId in DB
 *    → registerEmployeeInEasyTeam called with that real locationId
 * 3. Seeded company in the in-memory store (LOC-SUNSHINE)
 *    → registerEmployeeInEasyTeam called with the store locationId
 * 4. Route returns 404 when the company is absent from both store and DB
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

/**
 * FIFO queue for db.select() calls. Each entry is the array resolved by the
 * next .from().where() call. Consumed in arrival order.
 */
const dbSelectQueue = vi.hoisted(() => ({
  queue: [] as Array<{ rollfiLocationId?: string | null }>,
}));

/**
 * Controls what store.getCompany() returns.
 * null = company not in store (wizard-created); a company object = seeded company.
 */
const storeState = vi.hoisted(() => ({
  company: null as { id: string; locationId?: string } | null,
}));

/** Spy target for registerEmployeeInEasyTeam calls. Exposed to assertions. */
const etSpy = vi.hoisted(() => ({
  calls: [] as Array<{ locationId: string }>,
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:       (_col: unknown, _val: unknown) => ({}),
  and:      (..._args: unknown[]) => ({}),
  inArray:  (_col: unknown, _vals: unknown) => ({}),
  desc:     (_col: unknown) => ({}),
  isNull:   (_col: unknown) => ({}),
  isNotNull:(_col: unknown) => ({}),
}));

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => {
      const inner: Record<string, unknown> = {};
      inner.where = () => {
        const row = dbSelectQueue.queue.shift();
        return Promise.resolve(row !== undefined ? [row] : []);
      };
      // Support .from() without .where() (some paths use .catch() instead)
      (inner as Record<string, unknown>).catch = (_fn: unknown) => Promise.resolve([]);
      return inner;
    };
    // Support .select().where() directly (without .from())
    chain.where = () => {
      const row = dbSelectQueue.queue.shift();
      return Promise.resolve(row !== undefined ? [row] : []);
    };
    return chain;
  };

  const makeInsertChain = () => ({
    values: (_data: unknown) =>
      Object.assign(Promise.resolve(undefined), {
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
  });

  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => makeInsertChain(),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
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
      easyteamUuid: {}, easyteamSynced: {}, hourlyWage: {}, position: {},
      email: {}, startDate: {}, payType: {},
    },
    rollfiEmployeeRecords: { rollfiUserId: {}, employeeId: {} },
    rollfiWebhookEvents: {
      id: {}, eventType: {}, companyId: {}, rollfiCompanyId: {},
      payPeriodId: {}, payload: {}, receivedAt: {},
    },
    stateRegistrations: { companyId: {}, stateCode: {}, status: {} },
    companySignedForms: {
      companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      uploadAttemptedAt: {}, id: {}, signatureImage: {}, createdAt: {},
    },
    appActivityLog: {
      id: {}, companyId: {}, type: {}, description: {},
      actorName: {}, actorRole: {}, createdAt: {},
    },
    userAccounts: { id: {}, companyId: {} },
  };
});

vi.mock("../../store.js", () => ({
  store: {
    getCompany: (_id: string) => storeState.company,
    getUserByEmail: (_email: string) => null,
    getUserById: (_id: string) => null,
    createStaffUser: (_data: unknown) => ({
      employeeId: "EMP-TEST-001",
      name: "Jane Doe",
      email: "jane@example.com",
      position: "Teacher",
      hourlyWage: 1500,
      companyId: (_data as { companyId: string }).companyId,
    }),
    logActivity: vi.fn(),
    getRollfiCompany: (_id: string) => null,
    getRollfiEmployee: (_id: string) => null,
    getCompanies: () => [],
  },
}));

vi.mock("../../lib/rollfi-config.js", () => ({
  getRollfiConfig: () => ({
    credentialsPresent: true,
    baseUrl: "https://sandbox.rollfi.xyz",
    clientId: "test-cid",
    secretKey: "test-sk",
    env: "sandbox",
  }),
}));

vi.mock("../../lib/rollfi-persist.js", () => ({
  persistRollfiCompany: vi.fn(),
  persistRollfiEmployee: vi.fn(),
}));

vi.mock("../../lib/timesheet-approvals-persist.js", () => ({
  getTimesheetApprovalsByCompanyPeriod: vi.fn().mockResolvedValue([]),
  getLatestTimesheetApprovalsByCompany: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/user-account-persist.js", () => ({
  deleteUserAccount: vi.fn(),
}));

vi.mock("../../lib/easyteam-employee-sync.js", () => ({
  registerEmployeeInEasyTeam: vi.fn(
    async (_emp: unknown, locationId: string) => {
      etSpy.calls.push({ locationId });
      return { success: true, easyteamEmployeeId: "et-uuid-001" };
    }
  ),
}));

vi.mock("../../lib/rollfi-state-fields.js", () => ({
  buildStateRegistrationPayload: vi.fn(),
}));

vi.mock("../../lib/rollfi-employee-sync.js", () => ({
  runEmployeeKycOnboarding: vi.fn(),
  extractRollfiError: (_data: unknown) => null,
}));

vi.mock("../../lib/rollfi-wage.js", () => ({
  getRollfiWageFields: vi.fn(),
}));

vi.mock("../../lib/auth-middleware.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: "USER-OWNER-001" };
    next();
  },
  requireOwner: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps: [], stepsAllDone: false, completedCount: 0, totalCount: 0,
  }),
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn(),
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
    (req as any).session = { userId: "USER-OWNER-001" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use(rollfiRouter);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NEW_EMPLOYEE_BODY = {
  name: "Jane Doe",
  email: "jane@example.com",
  position: "Teacher",
  hourlyWage: 2000,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbSelectQueue.queue = [];
  storeState.company = null;
  etSpy.calls = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Wizard company — empty rollfiLocationId in DB
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/employees — wizard company with empty rollfiLocationId", () => {
  const COMPANY_ID = "ORG-WIZARD-001";

  beforeEach(() => {
    // Store miss (wizard-created company not in memory)
    storeState.company = null;

    // Route's company-existence check: company found, but rollfiLocationId is ""
    dbSelectQueue.queue.push({ rollfiLocationId: "" });

    // resolveCompanyLocationId's DB lookup (called because etLocationId is ""):
    // also returns "" → falls through to LOC-<companyId>
    dbSelectQueue.queue.push({ rollfiLocationId: "" });
  });

  it("returns HTTP 201 (employee created successfully)", async () => {
    const res = await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(res.status).toBe(201);
  });

  it("calls registerEmployeeInEasyTeam with a non-empty locationId", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls).toHaveLength(1);
    expect(etSpy.calls[0].locationId.length).toBeGreaterThan(0);
  });

  it("uses the LOC-<companyId> derived fallback — never an empty string", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    const { locationId } = etSpy.calls[0];
    // Must not be the bug value
    expect(locationId).not.toBe("");
    // Must not be the Sunshine fallback that caused the original incident
    expect(locationId).not.toBe("LOC-SUNSHINE");
    // Must be the stable derived fallback
    expect(locationId).toBe(`LOC-${COMPANY_ID}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wizard company — null rollfiLocationId in DB
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/employees — wizard company with null rollfiLocationId", () => {
  const COMPANY_ID = "ORG-WIZARD-002";

  beforeEach(() => {
    storeState.company = null;
    // Route's existence check: company found, rollfiLocationId null
    dbSelectQueue.queue.push({ rollfiLocationId: null });
    // resolveCompanyLocationId DB lookup: null → fallback
    dbSelectQueue.queue.push({ rollfiLocationId: null });
  });

  it("uses the LOC-<companyId> derived fallback for a null rollfiLocationId", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls).toHaveLength(1);
    expect(etSpy.calls[0].locationId).toBe(`LOC-${COMPANY_ID}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wizard company — real EasyTeam locationId stored in DB
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/employees — wizard company with a real EasyTeam locationId", () => {
  const COMPANY_ID = "ORG-MSG8W5WM-G6PNF1";
  const REAL_LOCATION_ID = "F9F1F179-171C-436B-8FEA-133EAD1BA43D";

  beforeEach(() => {
    storeState.company = null;
    // Route's existence check: company found with real locationId
    dbSelectQueue.queue.push({ rollfiLocationId: REAL_LOCATION_ID });
    // resolveCompanyLocationId is NOT called when etLocationId is a real non-empty string,
    // so no second queue entry is needed.
  });

  it("uses the real stored locationId, not the derived fallback", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls).toHaveLength(1);
    expect(etSpy.calls[0].locationId).toBe(REAL_LOCATION_ID);
  });

  it("does NOT use LOC-<companyId> when a real locationId is present", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls[0].locationId).not.toBe(`LOC-${COMPANY_ID}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Seeded company in the in-memory store
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/employees — seeded company found in the in-memory store", () => {
  const COMPANY_ID = "ORG-SUNSHINE";

  beforeEach(() => {
    // Company is in the store (no DB call needed for location)
    storeState.company = { id: COMPANY_ID, locationId: "LOC-SUNSHINE" };
    // No DB select queue entries needed — the store path is synchronous
  });

  it("uses the store locationId directly", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls).toHaveLength(1);
    expect(etSpy.calls[0].locationId).toBe("LOC-SUNSHINE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Company absent from both store and DB — returns 404
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/employees — company not found in store or DB", () => {
  const COMPANY_ID = "ORG-GHOST-001";

  beforeEach(() => {
    storeState.company = null;
    // DB returns no row (empty array from the .catch() fallback chain)
    // No push needed — the queue returns undefined → empty array → no company row
  });

  it("returns 404", async () => {
    const res = await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(res.status).toBe(404);
  });

  it("does not call registerEmployeeInEasyTeam", async () => {
    await request(makeApp())
      .post("/rollfi/employees")
      .send({ ...NEW_EMPLOYEE_BODY, companyId: COMPANY_ID });
    expect(etSpy.calls).toHaveLength(0);
  });
});
