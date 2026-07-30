/**
 * Tests for the Form 8655 first-sign upload path.
 *
 * Coverage:
 * 1. POST /rollfi/companies/:companyId/sign-8655
 *    a. Success path — uploadStatus "uploaded", rollfiDocumentId present.
 *    b. Rollfi returns { success: true } without a documentId — treated as uploaded.
 *    c. Upload throws (network error) — uploadStatus "failed", uploadError set,
 *       signed record still persisted (signing and upload are independent).
 *    d. Upload returns { success: false } — treated as failed.
 *    e. Upload returns an unexpected shape (no documentId, no success, no error)
 *       — treated as failed, never silently swallowed.
 *    f. Signed record is persisted to DB (insert called) even when upload fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** FIFO queue; each entry is the array resolved by the next .where() call */
  callQueue:    [] as unknown[][],
  /** Captures every .set(data) invocation on db.update(), in order */
  updateSets:   [] as unknown[],
  /** Captures every .values(data) invocation on db.insert(), in order */
  insertValues: [] as unknown[],
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

vi.mock("@workspace/db", () => {
  /**
   * Returns a chain whose .where() pops the next item from the shared queue.
   */
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from  = () => chain;
    chain.where = () => {
      const result: unknown[] = dbState.callQueue.shift() ?? [];
      return Promise.resolve(result);
    };
    return chain;
  };

  /**
   * Returns a chain whose .set().where() records the payload and resolves void.
   * Supports the .catch() tail used in the upload-failure path.
   */
  const makeUpdateChain = () => {
    const chain: Record<string, unknown> = {};
    chain.set = (data: unknown) => {
      dbState.updateSets.push(data);
      const inner: Record<string, unknown> = {};
      inner.where = () => {
        const p = Promise.resolve(undefined);
        // Attach a .catch() so the fire-and-forget tail in sign-8655 doesn't throw
        (p as unknown as Record<string, unknown>).catch = () => p;
        return p;
      };
      return inner;
    };
    return chain;
  };

  /**
   * Returns a chain for db.insert().values().onConflictDoUpdate().
   * Records the values payload so tests can verify the signed record was persisted.
   */
  const makeInsertChain = () => {
    const chain: Record<string, unknown> = {};
    chain.values = (data: unknown) => {
      dbState.insertValues.push(data);
      const inner: Record<string, unknown> = {};
      inner.onConflictDoUpdate = () => Promise.resolve(undefined);
      return inner;
    };
    return chain;
  };

  return {
    db: {
      select: () => makeSelectChain(),
      update: () => makeUpdateChain(),
      insert: () => makeInsertChain(),
    },
    companySignedForms: {
      companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      uploadAttemptedAt: {}, id: {}, signatureImage: {}, createdAt: {},
    },
    companies:            {
      id: {}, rollfiCompanyId: {}, name: {}, ein: {},
      address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {},
      kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {}, payFrequency: {},
      rollfiLocationId: {},
    },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:            {
      id: {}, firstName: {}, lastName: {}, homeState: {},
      status: {}, rollfiAccountStatus: {}, companyId: {},
    },
    stateRegistrations:   { companyId: {}, stateCode: {}, status: {} },
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

/** Stub buildForm8655Pdf — returns a tiny fake PDF buffer */
vi.mock("../../lib/form8655.js", () => ({
  buildForm8655Pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), // %PDF
  getForm8655AuthDates: () => ({
    annual940:    "2026-01-01",
    quarterly941: "2026-01-01",
  }),
}));

/** Stub randomUUID so tests get a deterministic id */
vi.mock("node:crypto", () => ({
  randomUUID: () => "test-uuid-sign-8655",
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// ── Fixture data ──────────────────────────────────────────────────────────────

const COMPANY_ROW = {
  id:               "ORG-TEST",
  name:             "Sunshine Daycare LLC",
  ein:              "123456789",
  address1:         "123 Main St",
  address2:         null,
  city:             "Austin",
  state:            "TX",
  zipcode:          "78701",
  phone:            "5125550100",
  rollfiCompanyId:  "rollfi-co-001",
  rollfiLocationId: null,
  kybStatus:        "approved",
  bankAccountAdded: true,
  payScheduleAdded: true,
  payFrequency:     "biweekly",
};

const ROLLFI_COMPANY_INFO = {
  Company: [{
    company: "Rollfi Daycare Inc",
    KYBInformations: [{ ein: "987654321", phoneNumber: "5125559999" }],
    CompanyLocations: [{ address1: "99 Provider Ave", city: "Dallas", state: "TX", zipcode: "75201" }],
  }],
};

const SIGN_BODY = {
  signerName:  "Jane Doe",
  signerTitle: "CEO",
};

const SIGN_URL = "/rollfi/companies/ORG-TEST/sign-8655";

// ── App factory ───────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed the DB queue for a standard sign-8655 call.
 * Sequence:
 *   1. companies select (rollfiCompanyId lookup)   ← queue[0]
 *   2. axios.post getCompanyInfo                   (Rollfi call — not queued)
 *   3. db.insert companySignedForms (UPSERT)        (insert chain — not queued)
 *   4. axios.post uploadDocument                   (Rollfi call — not queued)
 *   5. db.update companySignedForms (final status)  (update chain — not queued)
 */
function queueSign() {
  dbState.callQueue.push([{ rid: "rollfi-co-001" }]); // companies select
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.callQueue.length   = 0;
  dbState.updateSets.length  = 0;
  dbState.insertValues.length = 0;
  rollfiCreds.present = true;
  axiosMock.post.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /rollfi/companies/:companyId/sign-8655 — upload step
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/companies/ORG-TEST/sign-8655 — upload step", () => {

  // ── Success: Rollfi returns documentId ────────────────────────────────────
  describe("when Rollfi uploadDocument returns a documentId", () => {
    beforeEach(() => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO }) // getCompanyInfo
        .mockResolvedValueOnce({ data: { documentId: "doc-001" } }); // uploadDocument
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.status).toBe(200);
    });

    it("response body has uploadStatus 'uploaded'", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("response body includes the rollfiDocumentId returned by Rollfi", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.rollfiDocumentId).toBe("doc-001");
    });

    it("uploadError is null on success", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.uploadError).toBeNull();
    });

    it("response body includes signerName and signerTitle", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.signerName).toBe("Jane Doe");
      expect(res.body.signerTitle).toBe("CEO");
    });

    it("calls Rollfi uploadDocument with documentType '8655Form'", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      // second axios call is uploadDocument
      const [, uploadCall] = axiosMock.post.mock.calls;
      const body = uploadCall[1] as Record<string, unknown>;
      expect(body.documentType).toBe("8655Form");
    });

    it("calls Rollfi uploadDocument with the correct rollfiCompanyId", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      const [, uploadCall] = axiosMock.post.mock.calls;
      const body = uploadCall[1] as Record<string, unknown>;
      expect(body.companyId).toBe("rollfi-co-001");
    });

    it("persists the signed record to the DB (insert is called)", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(dbState.insertValues.length).toBeGreaterThan(0);
      const inserted = dbState.insertValues[0] as Record<string, unknown>;
      expect(inserted.companyId).toBe("ORG-TEST");
      expect(inserted.formType).toBe("8655");
      expect(inserted.signerName).toBe("Jane Doe");
    });

    it("persists an initial uploadStatus of 'pending' at insert time", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      const inserted = dbState.insertValues[0] as Record<string, unknown>;
      expect(inserted.uploadStatus).toBe("pending");
    });

    it("then updates DB to 'uploaded' after successful upload", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      const finalUpdate = dbState.updateSets.at(-1) as Record<string, unknown>;
      expect(finalUpdate.uploadStatus).toBe("uploaded");
    });
  });

  // ── Success: Rollfi returns { success: true } without a documentId ─────────
  describe("when Rollfi uploadDocument returns { success: true } without a documentId", () => {
    it("treats the upload as successful (uploadStatus 'uploaded')", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: true } });
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("rollfiDocumentId is null (provider did not return one)", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: true } });
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.rollfiDocumentId).toBeNull();
    });
  });

  // ── Failure: uploadDocument throws ────────────────────────────────────────
  describe("when uploadDocument throws a network error", () => {
    beforeEach(() => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    });

    it("returns HTTP 200 (signing is complete regardless of upload outcome)", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.status).toBe(200);
    });

    it("response body has uploadStatus 'failed'", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("response body includes a non-empty uploadError string", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(typeof res.body.uploadError).toBe("string");
      expect(res.body.uploadError.length).toBeGreaterThan(0);
    });

    it("signed record is still persisted to DB (insert was called before upload)", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(dbState.insertValues.length).toBeGreaterThan(0);
      const inserted = dbState.insertValues[0] as Record<string, unknown>;
      expect(inserted.signerName).toBe("Jane Doe");
      expect(inserted.formType).toBe("8655");
    });

    it("updates DB to uploadStatus 'failed' with an uploadError message", async () => {
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      const finalUpdate = dbState.updateSets.at(-1) as Record<string, unknown>;
      expect(finalUpdate.uploadStatus).toBe("failed");
      expect(typeof finalUpdate.uploadError).toBe("string");
      expect((finalUpdate.uploadError as string).length).toBeGreaterThan(0);
    });

    it("response body includes signerName (signing outcome is returned)", async () => {
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.body.signerName).toBe("Jane Doe");
    });
  });

  // ── Failure: uploadDocument returns { success: false } ────────────────────
  describe("when Rollfi uploadDocument returns { success: false }", () => {
    it("treats the upload as failed (uploadStatus 'failed')", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: false, error: "Quota exceeded" } });
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("signed record is still persisted even though upload failed", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: false, error: "Quota exceeded" } });
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(dbState.insertValues.length).toBeGreaterThan(0);
    });
  });

  // ── Failure: uploadDocument returns unexpected shape ──────────────────────
  describe("when Rollfi uploadDocument returns an unexpected shape (no documentId, no success, no error)", () => {
    it("treats the upload as failed — never silently swallows the response", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: {} }); // empty object — unrecognised shape
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("includes an uploadError message describing the unexpected shape", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { someRandomField: 42 } });
      const res = await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(typeof res.body.uploadError).toBe("string");
      expect(res.body.uploadError.length).toBeGreaterThan(0);
    });

    it("signed record is still persisted even though upload returned unexpected shape", async () => {
      queueSign();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: {} });
      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);
      expect(dbState.insertValues.length).toBeGreaterThan(0);
    });
  });

  // ── Signed record independence: insert always happens before upload ────────
  describe("signed record independence from upload outcome", () => {
    it("insert is called before uploadDocument — signing is always persisted first", async () => {
      const callOrder: string[] = [];

      // Spy on insertValues to detect the insert call
      const originalInsertPush = dbState.insertValues.push.bind(dbState.insertValues);
      dbState.insertValues.push = (...args) => {
        callOrder.push("insert");
        return originalInsertPush(...args);
      };

      queueSign();
      axiosMock.post
        .mockImplementationOnce(async () => { return { data: ROLLFI_COMPANY_INFO }; })
        .mockImplementationOnce(async () => {
          callOrder.push("uploadDocument");
          return { data: { documentId: "doc-order-test" } };
        });

      await request(makeApp()).post(SIGN_URL).send(SIGN_BODY);

      // Restore
      dbState.insertValues.push = originalInsertPush;

      const insertIdx = callOrder.indexOf("insert");
      const uploadIdx = callOrder.indexOf("uploadDocument");
      expect(insertIdx).toBeGreaterThanOrEqual(0);
      expect(uploadIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeLessThan(uploadIdx);
    });
  });
});
