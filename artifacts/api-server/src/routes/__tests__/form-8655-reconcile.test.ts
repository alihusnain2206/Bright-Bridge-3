/**
 * Tests for the inline reconcile path (reconcile8655UploadInline).
 *
 * reconcile8655UploadInline is called by both GET /dashboard and
 * GET /rollfi/pending-signatures whenever the stored Form 8655 uploadStatus
 * is "uploaded".  It queries Rollfi to confirm the document still exists.
 * If Rollfi reports the document is gone, the DB record is flipped to
 * "failed" and the same HTTP response already carries the corrected status
 * — no extra round-trip from the client.
 *
 * Coverage:
 *
 * GET /dashboard:
 *   1. uploadStatus "uploaded" + Rollfi returns empty doc list
 *      → response uploadStatus is "failed"
 *      → attention item "form_8655_upload_failed" is present
 *      → DB update was called with uploadStatus "failed"
 *   2. uploadStatus "uploaded" + Rollfi document is present
 *      → response uploadStatus stays "uploaded"
 *      → no "failed" attention item
 *   3. uploadStatus "uploaded" + Rollfi unreachable (both endpoints throw)
 *      → response uploadStatus stays "uploaded" (no false flip)
 *
 * GET /rollfi/pending-signatures:
 *   4. uploadStatus "uploaded" + Rollfi returns empty doc list
 *      → signedForms["8655"].uploadStatus is "failed" in the response
 *   5. uploadStatus "uploaded" + Rollfi document is present
 *      → signedForms["8655"].uploadStatus stays "uploaded"
 *   6. uploadStatus "uploaded" + Rollfi unreachable
 *      → signedForms["8655"].uploadStatus stays "uploaded"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** FIFO queue; each entry is the array resolved by the next .where() call */
  callQueue:  [] as unknown[][],
  /** Captures every .set(data) invocation on db.update(), in order */
  updateSets: [] as unknown[],
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
   * The returned Promise has native .catch() (it's a real Promise).
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
   * Returns a chain whose .set().where() records the payload and resolves
   * undefined.  The native .catch() on the resolved Promise satisfies the
   * fire-and-forget tail in reconcile8655UploadInline.
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
    companies: {
      id: {}, rollfiCompanyId: {}, name: {}, ein: {},
      address1: {}, address2: {}, city: {}, state: {}, zipcode: {},
      phone: {}, kybStatus: {}, bankAccountAdded: {}, payScheduleAdded: {},
      payFrequency: {}, rollfiLocationId: {},
    },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees: {
      id: {}, firstName: {}, lastName: {}, homeState: {}, status: {},
      rollfiAccountStatus: {}, companyId: {},
    },
    stateRegistrations: { companyId: {}, stateCode: {}, status: {} },
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
  // extractRollfiError is used by reconcile to detect body-level Rollfi errors.
  // Return null (no error) unless the test injects one via axiosMock data shape.
  extractRollfiError: (data: unknown) => {
    if (data && typeof data === "object" && (data as Record<string, unknown>).error) {
      return String((data as Record<string, unknown>).error);
    }
    return null;
  },
}));

vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps: [], stepsAllDone: false, completedCount: 0, totalCount: 10,
  }),
}));

// ── Import router AFTER all mocks ─────────────────────────────────────────────
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

/** A signed form row with uploadStatus "uploaded" and a stored document ID. */
const UPLOADED_FORM_ROW = {
  formType:          "8655",
  signerName:        "Jane Doe",
  signerTitle:       "CEO",
  signedAt:          "2026-07-01T12:00:00.000Z",
  uploadStatus:      "uploaded",
  uploadError:       null,
  rollfiDocumentId:  "doc-existing-001",
  uploadAttemptedAt: "2026-07-01T12:01:00.000Z",
};

/**
 * Rollfi getCompanyDocuments response where the document IS present.
 * The documentId matches UPLOADED_FORM_ROW.rollfiDocumentId.
 */
const DOC_LIST_PRESENT = {
  documents: [{ documentId: "doc-existing-001", documentType: "8655Form" }],
};

/** Rollfi getCompanyDocuments response where the document is absent. */
const DOC_LIST_EMPTY = { documents: [] };

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
 * Seed the DB queue for a full GET /dashboard call.
 *
 * Call sequence when uploadStatus === "uploaded":
 *   1. companies select (single row)                     ← queue[0]
 *   2. Promise.all:
 *      a. employees                                      ← queue[1]
 *      b. stateRegistrations                             ← queue[2]
 *      c. companySignedForms                             ← queue[3]
 *   → reconcile8655UploadInline: 2 axios.post calls (adminPortal + reports, parallel)
 *   → axios.post getCompanyTask
 */
function queueDashboardUploaded() {
  dbState.callQueue.push([COMPANY_ROW]);        // companies
  dbState.callQueue.push([]);                   // employees
  dbState.callQueue.push([]);                   // stateRegistrations
  dbState.callQueue.push([UPLOADED_FORM_ROW]);  // companySignedForms
}

/**
 * Seed the DB queue for GET /rollfi/pending-signatures when uploadStatus === "uploaded".
 *
 * Call sequence:
 *   1. companySignedForms select                         ← queue[0]
 *   2. companies select (for rollfiCompanyId)            ← queue[1]
 *   → reconcile8655UploadInline: 2 axios.post calls (adminPortal + reports, parallel)
 *   → axios.post getCompanyTask
 */
function queuePendingSignaturesUploaded() {
  dbState.callQueue.push([UPLOADED_FORM_ROW]);            // companySignedForms
  dbState.callQueue.push([{ rid: "rollfi-co-001" }]);     // companies
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.callQueue.length = 0;
  dbState.updateSets.length = 0;
  rollfiCreds.present = true;
  axiosMock.post.mockReset();
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /dashboard — inline reconcile
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /dashboard — inline reconcile of uploadStatus='uploaded'", () => {

  // ── 1. Rollfi confirms document is gone ────────────────────────────────────
  describe("when Rollfi returns an empty document list (document missing)", () => {

    beforeEach(() => {
      queueDashboardUploaded();
      // reconcile fires 2 parallel calls: adminPortal then reports
      axiosMock.post
        .mockResolvedValueOnce({ data: DOC_LIST_EMPTY })  // adminPortal/getCompanyDocuments
        .mockResolvedValueOnce({ data: DOC_LIST_EMPTY })  // reports#getCompanyDocuments
        .mockResolvedValueOnce({ data: { tasks: [] } });  // getCompanyTask
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("response attention includes the 'form_8655_upload_failed' item", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_failed")).toBeDefined();
    });

    it("the failed attention item has actionLabel 'Retry upload'", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string; actionLabel?: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_failed");
      expect(item?.actionLabel).toBe("Retry upload");
    });

    it("the failed attention item has severity 'high'", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string; severity: string }>;
      const item = attention.find(a => a.id === "form_8655_upload_failed");
      expect(item?.severity).toBe("high");
    });

    it("does NOT emit a 'form_8655_unsigned' attention item (form IS signed)", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_unsigned")).toBeUndefined();
    });

    it("writes uploadStatus='failed' to the DB via db.update", async () => {
      await request(makeApp()).get("/dashboard");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeDefined();
    });
  });

  // ── 2. Rollfi confirms document is present ─────────────────────────────────
  describe("when Rollfi confirms the document is present", () => {

    beforeEach(() => {
      queueDashboardUploaded();
      axiosMock.post
        .mockResolvedValueOnce({ data: DOC_LIST_PRESENT }) // adminPortal/getCompanyDocuments
        .mockResolvedValueOnce({ data: DOC_LIST_PRESENT }) // reports#getCompanyDocuments
        .mockResolvedValueOnce({ data: { tasks: [] } });   // getCompanyTask
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("does NOT include the 'form_8655_upload_failed' attention item", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_failed")).toBeUndefined();
    });

    it("does not write a failed status to the DB", async () => {
      await request(makeApp()).get("/dashboard");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeUndefined();
    });
  });

  // ── 3. Rollfi unreachable (both endpoints throw) ───────────────────────────
  describe("when Rollfi is unreachable (both endpoints throw)", () => {

    beforeEach(() => {
      queueDashboardUploaded();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // adminPortal/getCompanyDocuments
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // reports#getCompanyDocuments
        .mockResolvedValueOnce({ data: { tasks: [] } });  // getCompanyTask
    });

    it("returns HTTP 200 (Rollfi failure is non-fatal)", async () => {
      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
    });

    it("does NOT flip uploadStatus to 'failed' — no false positive", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_failed")).toBeUndefined();
    });

    it("does not write a failed status to the DB when Rollfi is unreachable", async () => {
      await request(makeApp()).get("/dashboard");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeUndefined();
    });
  });

  // ── 4. Only one Rollfi endpoint reachable — present on one source ──────────
  describe("when only adminPortal is reachable and reports the document present", () => {

    beforeEach(() => {
      queueDashboardUploaded();
      axiosMock.post
        .mockResolvedValueOnce({ data: DOC_LIST_PRESENT })  // adminPortal — present
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))   // reports — unreachable
        .mockResolvedValueOnce({ data: { tasks: [] } });    // getCompanyTask
    });

    it("keeps uploadStatus as 'uploaded' (one usable source saying present is enough)", async () => {
      const res = await request(makeApp()).get("/dashboard");
      const attention = res.body.attention as Array<{ id: string }>;
      expect(attention.find(a => a.id === "form_8655_upload_failed")).toBeUndefined();
    });
  });

  // ── 5. No reconcile when uploadStatus is not "uploaded" ───────────────────
  describe("when the stored uploadStatus is 'pending' (not 'uploaded')", () => {

    it("does not call Rollfi document endpoints for reconciliation", async () => {
      // Use a pending form row — reconcile should NOT fire
      dbState.callQueue.push([COMPANY_ROW]);
      dbState.callQueue.push([]);
      dbState.callQueue.push([]);
      dbState.callQueue.push([{
        ...UPLOADED_FORM_ROW,
        uploadStatus:     "pending",
        rollfiDocumentId: null,
        uploadAttemptedAt: new Date(Date.now() - 60_000).toISOString(),
      }]);
      axiosMock.post.mockResolvedValue({ data: { tasks: [] } }); // only getCompanyTask

      const res = await request(makeApp()).get("/dashboard");
      expect(res.status).toBe(200);
      // Only 1 axios call (getCompanyTask); no reconcile calls
      const docCalls = (axiosMock.post.mock.calls as unknown[][]).filter(
        (call) => String(call[0]).includes("getCompanyDocuments"),
      );
      expect(docCalls).toHaveLength(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /rollfi/pending-signatures — inline reconcile
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /rollfi/pending-signatures — inline reconcile of uploadStatus='uploaded'", () => {

  // ── 4. Rollfi confirms document is gone ────────────────────────────────────
  describe("when Rollfi returns an empty document list (document missing)", () => {

    beforeEach(() => {
      queuePendingSignaturesUploaded();
      axiosMock.post
        .mockResolvedValueOnce({ data: DOC_LIST_EMPTY })  // adminPortal/getCompanyDocuments
        .mockResolvedValueOnce({ data: DOC_LIST_EMPTY })  // reports#getCompanyDocuments
        .mockResolvedValueOnce({ data: { tasks: [] } });  // getCompanyTask
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.status).toBe(200);
    });

    it("signedForms['8655'].uploadStatus is 'failed' in the response", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.body.signedForms?.["8655"]?.uploadStatus).toBe("failed");
    });

    it("signedForms['8655'].uploadError is set to a non-empty string", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      const uploadError: unknown = res.body.signedForms?.["8655"]?.uploadError;
      expect(typeof uploadError).toBe("string");
      expect((uploadError as string).length).toBeGreaterThan(0);
    });

    it("writes uploadStatus='failed' to the DB via db.update", async () => {
      await request(makeApp()).get("/rollfi/pending-signatures");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeDefined();
    });
  });

  // ── 5. Rollfi confirms document is present ─────────────────────────────────
  describe("when Rollfi confirms the document is present", () => {

    beforeEach(() => {
      queuePendingSignaturesUploaded();
      axiosMock.post
        .mockResolvedValueOnce({ data: DOC_LIST_PRESENT }) // adminPortal
        .mockResolvedValueOnce({ data: DOC_LIST_PRESENT }) // reports
        .mockResolvedValueOnce({ data: { tasks: [] } });   // getCompanyTask
    });

    it("returns HTTP 200", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.status).toBe(200);
    });

    it("signedForms['8655'].uploadStatus remains 'uploaded'", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.body.signedForms?.["8655"]?.uploadStatus).toBe("uploaded");
    });

    it("does not write a failed status to the DB", async () => {
      await request(makeApp()).get("/rollfi/pending-signatures");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeUndefined();
    });
  });

  // ── 6. Rollfi unreachable ─────────────────────────────────────────────────
  describe("when Rollfi is unreachable (both endpoints throw)", () => {

    beforeEach(() => {
      queuePendingSignaturesUploaded();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))    // adminPortal
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))    // reports
        .mockResolvedValueOnce({ data: { tasks: [] } });  // getCompanyTask
    });

    it("returns HTTP 200 (network failure is non-fatal)", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.status).toBe(200);
    });

    it("signedForms['8655'].uploadStatus remains 'uploaded' — no false flip", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.body.signedForms?.["8655"]?.uploadStatus).toBe("uploaded");
    });

    it("does not write a failed status to the DB when Rollfi is unreachable", async () => {
      await request(makeApp()).get("/rollfi/pending-signatures");
      const failedUpdate = (dbState.updateSets as Array<Record<string, unknown>>)
        .find(s => s.uploadStatus === "failed");
      expect(failedUpdate).toBeUndefined();
    });
  });

  // ── 7. Only reports endpoint reachable — reports document absent ────────────
  describe("when only reports endpoint is reachable and reports the document absent", () => {

    beforeEach(() => {
      queuePendingSignaturesUploaded();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // adminPortal — unreachable
        .mockResolvedValueOnce({ data: DOC_LIST_EMPTY })  // reports — absent
        .mockResolvedValueOnce({ data: { tasks: [] } });  // getCompanyTask
    });

    it("flips signedForms['8655'].uploadStatus to 'failed' (one usable source saying absent)", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.body.signedForms?.["8655"]?.uploadStatus).toBe("failed");
    });
  });

  // ── 8. No reconcile when credentials are missing ──────────────────────────
  describe("when Rollfi credentials are not configured", () => {

    beforeEach(() => {
      rollfiCreds.present = false;
      queuePendingSignaturesUploaded();
    });

    it("returns { signatures: [], signedForms } without calling any Rollfi endpoint", async () => {
      const res = await request(makeApp()).get("/rollfi/pending-signatures");
      expect(res.status).toBe(200);
      expect(res.body.signatures).toEqual([]);
      // No Rollfi calls should have been made (credentials gate is checked first)
      const docCalls = (axiosMock.post.mock.calls as unknown[][]).filter(
        (call) => String(call[0]).includes("getCompanyDocuments"),
      );
      expect(docCalls).toHaveLength(0);
    });
  });
});
