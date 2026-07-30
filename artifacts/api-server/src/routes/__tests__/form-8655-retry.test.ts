/**
 * Tests for POST /rollfi/companies/:companyId/retry-8655-upload
 *
 * Coverage goals:
 * 1. Returns 404 when no signed Form 8655 record exists.
 * 2. Returns 409 when the form is already uploaded (uploadStatus="uploaded").
 * 3. Success path — upload succeeds → response uploadStatus="uploaded",
 *    DB updated with uploadStatus="uploaded" and the documentId.
 * 4. Failure path — uploadDocument throws → response uploadStatus="failed",
 *    DB updated with uploadStatus="failed" and the error message.
 * 5. DB is first set to "pending" in both the success and failure paths.
 * 6. Returns 400 when the company has no Rollfi company ID.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updateSets:  [] as Array<Record<string, unknown>>,
}));

const rollfiCreds = vi.hoisted(() => ({ present: true as boolean }));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:  (_col: unknown, _val: unknown) => ({}),
  and: (..._args: unknown[]) => ({}),
}));

// @workspace/db — select uses FIFO queue; update records the set-values for assertions.
vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from  = () => chain;
    chain.where = () => {
      const result: unknown[] = dbState.selectQueue.shift() ?? [];
      return Promise.resolve(result);
    };
    return chain;
  };

  const makeUpdateChain = () => ({
    set: (values: Record<string, unknown>) => {
      dbState.updateSets.push({ ...values });
      return {
        where: () => Promise.resolve([]),
      };
    },
  });

  return {
    db: {
      select: () => makeSelectChain(),
      update: () => makeUpdateChain(),
    },
    companySignedForms: {
      companyId: {}, formType: {}, id: {}, uploadStatus: {},
      signerName: {}, signerTitle: {}, signedAt: {},
      rollfiDocumentId: {}, uploadError: {},
    },
    companies:            { id: {}, rollfiCompanyId: {}, name: {}, ein: {}, address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {} },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:            {},
    stateRegistrations:   {},
  };
});

vi.mock("../../lib/rollfi-config.js", () => ({
  getRollfiConfig: () => ({
    credentialsPresent: rollfiCreds.present,
    baseUrl:   "https://sandbox.rollfi.xyz",
    clientId:  rollfiCreds.present ? "test-cid" : undefined,
    secretKey: rollfiCreds.present ? "test-sk"  : undefined,
  }),
}));

vi.mock("../../store.js", () => ({
  store: {
    getUserById: (_id: string) => ({
      id:        "USER-TEST",
      role:      "owner",
      companyId: "ORG-TEST",
    }),
  },
}));

vi.mock("../../lib/auth-middleware.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: "USER-TEST" };
    next();
  },
}));

vi.mock("axios", () => ({ default: axiosMock }));

vi.mock("../../lib/rollfi-employee-sync.js", () => ({
  extractRollfiError: (_data: unknown) => null,
}));
vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps: [], stepsAllDone: false, completedCount: 0, totalCount: 10,
  }),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// ── Fixture data ─────────────────────────────────────────────────────────────

/** A form that failed its first upload attempt. */
const FAILED_SIGNED_RECORD = {
  id:           "form-row-001",
  uploadStatus: "failed",
  signerName:   "Jane Owner",
  signerTitle:  "CEO",
  signedAt:     "2026-07-01T12:00:00.000Z",
};

/** A form that is stuck in pending. */
const PENDING_SIGNED_RECORD = {
  ...FAILED_SIGNED_RECORD,
  uploadStatus: "pending",
};

/** Rollfi getCompanyInfo response used to rebuild the PDF. */
const ROLLFI_COMPANY_INFO = {
  Company: [{
    company: "Sunshine Payroll LLC",
    KYBInformations: [{ ein: "123456789", phoneNumber: "5125550100" }],
    CompanyLocations: [{ address1: "1 Main St", city: "Austin", state: "TX", zipcode: "78701" }],
  }],
};

/** Successful uploadDocument response from Rollfi. */
const UPLOAD_SUCCESS = { documentId: "doc-abc123" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(companySettingsRouter);
  return app;
}

/** POST to the retry endpoint and return the supertest response. */
function postRetry(app: ReturnType<typeof makeApp>) {
  return request(app).post("/rollfi/companies/ORG-TEST/retry-8655-upload");
}

/**
 * Queue the two DB selects that every non-404 path needs:
 *   1. companySignedForms lookup
 *   2. companies.rollfiCompanyId lookup
 */
function queueBaseSelects(record: typeof FAILED_SIGNED_RECORD = FAILED_SIGNED_RECORD) {
  dbState.selectQueue.push([record]);              // signed form
  dbState.selectQueue.push([{ rid: "rollfi-co-001" }]); // companies.rollfiCompanyId
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.selectQueue.length = 0;
  dbState.updateSets.length  = 0;
  rollfiCreds.present = true;
  axiosMock.post.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /rollfi/companies/:companyId/retry-8655-upload", () => {

  // ── 404 — form has never been signed ─────────────────────────────────────

  describe("when no signed Form 8655 record exists", () => {
    it("returns 404", async () => {
      dbState.selectQueue.push([]); // empty → no record
      const res = await postRetry(makeApp());
      expect(res.status).toBe(404);
    });

    it("error body mentions Form 8655", async () => {
      dbState.selectQueue.push([]);
      const res = await postRetry(makeApp());
      expect(res.body.error).toMatch(/form 8655/i);
    });
  });

  // ── 409 — already uploaded ────────────────────────────────────────────────

  describe("when the form is already uploaded", () => {
    it("returns 409", async () => {
      dbState.selectQueue.push([{ ...FAILED_SIGNED_RECORD, uploadStatus: "uploaded" }]);
      const res = await postRetry(makeApp());
      expect(res.status).toBe(409);
    });

    it("error body indicates already uploaded", async () => {
      dbState.selectQueue.push([{ ...FAILED_SIGNED_RECORD, uploadStatus: "uploaded" }]);
      const res = await postRetry(makeApp());
      expect(res.body.error).toMatch(/already been uploaded/i);
    });
  });

  // ── Success path — upload succeeds ────────────────────────────────────────

  describe("success path — uploadDocument returns a documentId", () => {
    beforeEach(() => {
      queueBaseSelects();
      // axios call 1: getCompanyInfo
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
      // axios call 2: uploadDocument
      axiosMock.post.mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
    });

    it("returns HTTP 200", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("response uploadStatus is 'uploaded'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("response contains the rollfiDocumentId returned by Rollfi", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.rollfiDocumentId).toBe("doc-abc123");
    });

    it("response uploadError is null", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadError).toBeNull();
    });

    it("DB is first updated to 'pending'", async () => {
      await postRetry(makeApp());
      expect(dbState.updateSets[0]).toMatchObject({ uploadStatus: "pending", uploadError: null });
    });

    it("DB is then updated to 'uploaded' with documentId", async () => {
      await postRetry(makeApp());
      const finalSet = dbState.updateSets.find(s => s.uploadStatus === "uploaded");
      expect(finalSet).toBeDefined();
      expect(finalSet).toMatchObject({
        uploadStatus:    "uploaded",
        rollfiDocumentId: "doc-abc123",
        uploadError:     null,
      });
    });
  });

  // ── Success path via success:true ─────────────────────────────────────────

  describe("success path — uploadDocument returns success:true (no documentId)", () => {
    beforeEach(() => {
      queueBaseSelects();
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
      axiosMock.post.mockResolvedValueOnce({ data: { success: true } });
    });

    it("response uploadStatus is 'uploaded'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("DB updated to 'uploaded'", async () => {
      await postRetry(makeApp());
      const finalSet = dbState.updateSets.find(s => s.uploadStatus === "uploaded");
      expect(finalSet).toMatchObject({ uploadStatus: "uploaded", uploadError: null });
    });
  });

  // ── Failure path — uploadDocument throws ─────────────────────────────────

  describe("failure path — uploadDocument throws a network error", () => {
    beforeEach(() => {
      queueBaseSelects(PENDING_SIGNED_RECORD);
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
      axiosMock.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    });

    it("returns HTTP 200 (failure is expressed in the body, not the status)", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("response uploadStatus is 'failed'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("response uploadError contains the error message", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadError).toMatch(/ECONNREFUSED/i);
    });

    it("DB is first updated to 'pending'", async () => {
      await postRetry(makeApp());
      expect(dbState.updateSets[0]).toMatchObject({ uploadStatus: "pending", uploadError: null });
    });

    it("DB is then updated to 'failed' with uploadError set", async () => {
      await postRetry(makeApp());
      const failedSet = dbState.updateSets.find(s => s.uploadStatus === "failed");
      expect(failedSet).toBeDefined();
      expect(typeof failedSet!.uploadError).toBe("string");
      expect(String(failedSet!.uploadError)).toMatch(/ECONNREFUSED/i);
    });
  });

  // ── Failure path — uploadDocument returns error body ─────────────────────

  describe("failure path — uploadDocument returns { error: '...' } in body", () => {
    beforeEach(() => {
      queueBaseSelects();
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
      axiosMock.post.mockResolvedValueOnce({ data: { error: "Document type not allowed" } });
    });

    it("response uploadStatus is 'failed'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("DB updated to 'failed'", async () => {
      await postRetry(makeApp());
      const failedSet = dbState.updateSets.find(s => s.uploadStatus === "failed");
      expect(failedSet).toBeDefined();
    });
  });

  // ── 400 — company not enrolled ────────────────────────────────────────────

  describe("when the company has no Rollfi company ID", () => {
    it("returns 400", async () => {
      dbState.selectQueue.push([FAILED_SIGNED_RECORD]); // signed form
      dbState.selectQueue.push([{ rid: null }]);        // companies → no rollfiCompanyId
      dbState.selectQueue.push([]);                     // rollfiCompanyRecords fallback → empty
      const res = await postRetry(makeApp());
      expect(res.status).toBe(400);
    });

    it("error body mentions enrollment", async () => {
      dbState.selectQueue.push([FAILED_SIGNED_RECORD]);
      dbState.selectQueue.push([{ rid: null }]);
      dbState.selectQueue.push([]);
      const res = await postRetry(makeApp());
      expect(res.body.error).toMatch(/not enrolled/i);
    });
  });

  // ── 503 — credentials missing ─────────────────────────────────────────────

  describe("when Rollfi credentials are not configured", () => {
    it("returns 503", async () => {
      rollfiCreds.present = false;
      queueBaseSelects();
      const res = await postRetry(makeApp());
      expect(res.status).toBe(503);
    });
  });
});
