/**
 * Tests for the Form 8655 retry upload path.
 *
 * Coverage:
 * 1. GET /dashboard — attention item has actionLabel "Retry upload" when
 *    uploadStatus is "pending" (fresh) or "failed".
 * 2. POST /rollfi/companies/:companyId/retry-8655-upload
 *    a. Returns 404 when no signed form exists.
 *    b. Returns 409 when form is already uploaded.
 *    c. Returns { uploadStatus: "uploaded" } when Rollfi succeeds.
 *    d. Returns { uploadStatus: "failed"   } when Rollfi upload call throws.
 *    e. Allows retry when uploadStatus is "pending" (not blocked by guard).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** FIFO queue; each entry is the array resolved by the next .where() call */
  callQueue:   [] as unknown[][],
  /** Captures every .set(data) invocation on db.update(), in order */
  updateSets:  [] as unknown[],
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
   * The returned Promise also exposes .catch() (native on Promise).
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
   * Supports the .catch() tail used in several fire-and-forget update calls.
   */
  const makeUpdateChain = () => {
    const chain: Record<string, unknown> = {};
    chain.set = (data: unknown) => {
      dbState.updateSets.push(data);
      const inner: Record<string, unknown> = {};
      inner.where = () => Promise.resolve(undefined);
      return inner;
    };
    return chain;
  };

  return {
    db: {
      select: () => makeSelectChain(),
      update: () => makeUpdateChain(),
    },
    companySignedForms: {
      companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      uploadAttemptedAt: {}, id: {},
    },
    companies:            { id: {}, rollfiCompanyId: {}, name: {}, ein: {}, address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {}, kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {}, payFrequency: {}, rollfiLocationId: {} },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:            { id: {}, firstName: {}, lastName: {}, homeState: {}, status: {}, rollfiAccountStatus: {}, companyId: {} },
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

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// ── Fixture data ─────────────────────────────────────────────────────────────

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

/** A signed form row with uploadStatus "pending" (e.g. just after signing) */
const PENDING_FORM_ROW = {
  id:               "form-uuid-001",
  companyId:        "ORG-TEST",
  formType:         "8655",
  signerName:       "Jane Doe",
  signerTitle:      "CEO",
  signedAt:         "2026-07-01T12:00:00.000Z",
  uploadStatus:     "pending",
  uploadError:      null,
  rollfiDocumentId: null,
  uploadAttemptedAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
};

/** A signed form row with uploadStatus "failed" */
const FAILED_FORM_ROW = {
  ...PENDING_FORM_ROW,
  uploadStatus: "failed",
  uploadError:  "Network error",
};

/** A signed form row with uploadStatus "uploaded" */
const UPLOADED_FORM_ROW = {
  ...PENDING_FORM_ROW,
  uploadStatus:     "uploaded",
  rollfiDocumentId: "doc-existing-001",
};

const ROLLFI_COMPANY_INFO = {
  Company: [{
    company: "Rollfi Daycare Inc",
    KYBInformations: [{ ein: "987654321", phoneNumber: "5125559999" }],
    CompanyLocations: [{ address1: "99 Provider Ave", city: "Dallas", state: "TX", zipcode: "75201" }],
  }],
};

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

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.callQueue.length = 0;
  dbState.updateSets.length = 0;
  rollfiCreds.present = true;
  axiosMock.post.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dashboard — attention item for pending / failed Form 8655
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /dashboard — Form 8655 attention items", () => {

  /**
   * Seed queue for a full dashboard call with no Rollfi KYB tasks.
   * Dashboard call sequence:
   *   1. companies (single row)                    ← queue[0]
   *   2. Promise.all:
   *      a. employees                              ← queue[1]
   *      b. stateRegistrations                     ← queue[2]
   *      c. companySignedForms                     ← queue[3]
   *   3. axios.post getCompanyTask (mocked)
   */
  function queueDashboard(signedFormRow: unknown) {
    dbState.callQueue.push([COMPANY_ROW]);           // companies
    dbState.callQueue.push([]);                      // employees
    dbState.callQueue.push([]);                      // stateRegistrations
    dbState.callQueue.push(signedFormRow ? [signedFormRow] : []); // companySignedForms
    // getCompanyTask returns no pending tasks
    axiosMock.post.mockResolvedValueOnce({ data: { tasks: [] } });
  }

  describe("when uploadStatus is 'pending' (fresh — within 15 min)", () => {
    it("includes an attention item with actionLabel 'Retry upload'", async () => {
      queueDashboard(PENDING_FORM_ROW);
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
      const attention = res.body.attention as Array<{ id: string; actionLabel?: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_pending");
      expect(item).toBeDefined();
      expect(item?.actionLabel).toBe("Retry upload");
    });

    it("severity is 'medium' when the upload is fresh (< 15 min old)", async () => {
      queueDashboard(PENDING_FORM_ROW);
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string; severity: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_pending");
      expect(item?.severity).toBe("medium");
    });

    it("severity escalates to 'high' when upload is stale (> 15 min old)", async () => {
      const staleRow = {
        ...PENDING_FORM_ROW,
        uploadAttemptedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
      };
      queueDashboard(staleRow);
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string; severity: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_pending");
      expect(item?.severity).toBe("high");
    });
  });

  describe("when uploadStatus is 'failed'", () => {
    it("includes an attention item with actionLabel 'Retry upload'", async () => {
      queueDashboard(FAILED_FORM_ROW);
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
      const attention = res.body.attention as Array<{ id: string; actionLabel?: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_failed");
      expect(item).toBeDefined();
      expect(item?.actionLabel).toBe("Retry upload");
    });

    it("severity is 'high' for a failed upload", async () => {
      queueDashboard(FAILED_FORM_ROW);
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string; severity: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_failed")?.severity).toBe("high");
    });
  });

  describe("when Form 8655 has never been signed", () => {
    it("does NOT include a retry-upload attention item", async () => {
      queueDashboard(null); // no signed form row
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_pending")).toBeUndefined();
      expect(attention.find(a => a.id === "form_8655_upload_failed")).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /rollfi/companies/:companyId/retry-8655-upload
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /rollfi/companies/ORG-TEST/retry-8655-upload", () => {
  const RETRY_URL = "/rollfi/companies/ORG-TEST/retry-8655-upload";

  /**
   * Seed the queue for a successful retry call.
   *
   * Retry call sequence:
   *   1. select from companySignedForms        ← queue[0]
   *   2. db.update (mark pending)              — no queue entry needed
   *   3. select from companies (rollfi ID)     ← queue[1]
   *   4. axios.post getCompanyInfo
   *   5. axios.post uploadDocument
   *   6. db.update (final status)              — no queue entry needed
   */
  function queueRetry(formRow: unknown) {
    dbState.callQueue.push(formRow ? [formRow] : []);  // companySignedForms select
    dbState.callQueue.push([{ rid: "rollfi-co-001" }]); // companies select
  }

  // ── 404 when no signed form exists ──────────────────────────────────────
  describe("when no signed Form 8655 exists", () => {
    it("returns 404", async () => {
      dbState.callQueue.push([]); // empty — no row
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no signed form 8655/i);
    });
  });

  // ── 409 when form is already uploaded ───────────────────────────────────
  describe("when uploadStatus is 'uploaded'", () => {
    it("returns 409 (already uploaded guard)", async () => {
      dbState.callQueue.push([UPLOADED_FORM_ROW]);
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already been uploaded/i);
    });
  });

  // ── Success path: pending form, Rollfi upload succeeds ──────────────────
  describe("when uploadStatus is 'pending' and Rollfi upload succeeds", () => {
    beforeEach(() => {
      queueRetry(PENDING_FORM_ROW);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO }) // getCompanyInfo
        .mockResolvedValueOnce({ data: { documentId: "doc-new-001" } }); // uploadDocument
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(200);
    });

    it("response body has uploadStatus 'uploaded'", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("response body includes the rollfiDocumentId returned by Rollfi", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.body.rollfiDocumentId).toBe("doc-new-001");
    });

    it("uploadError is null on success", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.body.uploadError).toBeNull();
    });

    it("calls Rollfi uploadDocument with documentType '8655Form'", async () => {
      await request(makeApp()).post(RETRY_URL);
      // second axios call is uploadDocument
      const [, uploadCall] = axiosMock.post.mock.calls;
      const body = uploadCall[1] as Record<string, unknown>;
      expect(body.documentType).toBe("8655Form");
    });

    it("marks status as pending (intermediate update) before uploading", async () => {
      await request(makeApp()).post(RETRY_URL);
      // First update recorded is the intermediate pending transition
      const firstUpdate = dbState.updateSets[0] as Record<string, unknown>;
      expect(firstUpdate.uploadStatus).toBe("pending");
    });
  });

  // ── Success with success:true shape (no documentId) ─────────────────────
  describe("when Rollfi returns { success: true } without a documentId", () => {
    it("treats the upload as successful", async () => {
      queueRetry(PENDING_FORM_ROW);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: true } });
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });
  });

  // ── Failure path: pending form, Rollfi upload throws ────────────────────
  describe("when uploadStatus is 'pending' and Rollfi upload throws", () => {
    beforeEach(() => {
      queueRetry(PENDING_FORM_ROW);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO }) // getCompanyInfo
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));   // uploadDocument fails
    });

    it("returns HTTP 200 (signing was already complete)", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(200);
    });

    it("response body has uploadStatus 'failed'", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("response body includes a non-empty uploadError", async () => {
      const res = await request(makeApp()).post(RETRY_URL);
      expect(typeof res.body.uploadError).toBe("string");
      expect(res.body.uploadError.length).toBeGreaterThan(0);
    });

    it("records the failure via db.update (final status set to 'failed')", async () => {
      await request(makeApp()).post(RETRY_URL);
      const finalUpdate = dbState.updateSets.at(-1) as Record<string, unknown>;
      expect(finalUpdate.uploadStatus).toBe("failed");
    });
  });

  // ── Failure path: pending form, Rollfi returns error body ───────────────
  describe("when Rollfi uploadDocument returns { success: false }", () => {
    it("treats the upload as failed", async () => {
      queueRetry(PENDING_FORM_ROW);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: false, error: "Quota exceeded" } });
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("failed");
    });
  });

  // ── Retry is allowed for a "failed" form (not blocked by 409) ───────────
  describe("when uploadStatus is 'failed'", () => {
    it("does not return 409 — retry is allowed for failed uploads", async () => {
      queueRetry(FAILED_FORM_ROW);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { documentId: "doc-new-002" } });
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).not.toBe(409);
      expect(res.body.uploadStatus).toBe("uploaded");
    });
  });

  // ── Getcompanyinfo failure falls back to DB company data ────────────────
  describe("when getCompanyInfo throws and there is no DB company fallback", () => {
    it("still attempts the upload using empty strings for company info", async () => {
      // No DB company fallback — companies select returns empty
      dbState.callQueue.push([PENDING_FORM_ROW]);         // companySignedForms
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]); // companies (rollfi ID)
      dbState.callQueue.push([]);                          // companies fallback select (no row)
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // getCompanyInfo fails
        .mockResolvedValueOnce({ data: { documentId: "doc-new-003" } }); // uploadDocument
      const res = await request(makeApp()).post(RETRY_URL);
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });
  });
});
