/**
 * Tests for POST /rollfi/companies/:companyId/retry-8655-upload
 *
 * Coverage goals:
 * 1. Payload sent to Rollfi uploadDocument carries the correct fields:
 *    - companyId  = Rollfi UUID (not the internal DB ID)
 *    - documentType = "8655Form"
 *    - fileBase64 = non-empty base64 string
 * 2. Happy path — returns 200 with uploadStatus="uploaded" and rollfiDocumentId
 * 3. No signed form in DB → 404
 * 4. Form already uploaded → 409
 * 5. No rollfiCompanyId → 400
 * 6. Missing Rollfi credentials → 503
 * 7. uploadDocument throws → 200 with uploadStatus="failed"
 * 8. rollfiCompanyId resolved via legacy rollfiCompanyRecords table
 * 9. getCompanyInfo throws → DB fallback used but upload still carries correct payload
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** Select call queue — each entry is the array returned by the next .where() */
  callQueue: [] as unknown[][],
  /** Track update calls */
  updateCalls: [] as { setValues: unknown }[],
}));

const rollfiCreds = vi.hoisted(() => ({
  present: true as boolean,
}));

const storeState = vi.hoisted(() => ({
  role:      "owner" as string,
  companyId: "ORG-TEST" as string,
}));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

/** Minimal fake PDF bytes returned by the mocked buildForm8655Pdf. */
const FAKE_PDF_BYTES = vi.hoisted(() =>
  new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), // "%PDF-1.4"
);

const buildPdfSpy = vi.hoisted(() =>
  vi.fn<(data: unknown) => Promise<Uint8Array>>(),
);

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:  (_col: unknown, _val: unknown) => ({}),
  and: (..._args: unknown[]) => ({}),
}));

vi.mock("@workspace/db", () => {
  /**
   * Select chain — each .where() call pops one item from the FIFO queue.
   * Returns a plain native Promise so that .catch() / await work correctly.
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

  /** Insert chain stub (not exercised by retry endpoint, but needed for import). */
  const makeInsertChain = (_table: unknown) => ({
    values: (_vals: unknown) => ({
      onConflictDoUpdate: (_opts: unknown) => Promise.resolve([]),
    }),
  });

  /**
   * Update chain — tracks calls; .where() is the terminal.
   */
  const makeUpdateChain = (_table: unknown) => ({
    set: (setValues: unknown) => ({
      where: (..._whereArgs: unknown[]) => {
        dbState.updateCalls.push({ setValues });
        return Promise.resolve([]);
      },
    }),
  });

  return {
    db: {
      select: () => makeSelectChain(),
      insert: (table: unknown) => makeInsertChain(table),
      update: (table: unknown) => makeUpdateChain(table),
    },
    companySignedForms: {
      id: {}, companyId: {}, formType: {}, signerName: {}, signerTitle: {},
      signedAt: {}, uploadStatus: {}, uploadError: {}, rollfiDocumentId: {},
      signatureImage: {}, uploadAttemptedAt: {},
    },
    companies: {
      id: {}, rollfiCompanyId: {}, name: {}, ein: {},
      address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {},
    },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:          {},
    stateRegistrations: {},
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
      role:      storeState.role,
      companyId: storeState.companyId,
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

vi.mock("../../lib/form8655.js", () => ({
  buildForm8655Pdf: buildPdfSpy,
  getForm8655AuthDates: (_date: Date) => ({
    annual940:    "2026",
    quarterly941: "2026/09",
  }),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// ── Fixture data ──────────────────────────────────────────────────────────────

/** Rollfi-shaped getCompanyInfo response */
const ROLLFI_COMPANY_INFO = {
  Company: [{
    company: "Rollfi Daycare Inc",
    KYBInformations: [{ ein: "987654321", phoneNumber: "5125559999" }],
    CompanyLocations: [{ address1: "99 Provider Ave", city: "Dallas", state: "TX", zipcode: "75201" }],
  }],
};

/** Rollfi uploadDocument success response */
const UPLOAD_SUCCESS = { documentId: "doc-retry-999" };

/** Stored signed-form record (upload previously failed — safe to retry). */
const SIGNED_FORM_ROW = {
  id:             "form-row-001",
  uploadStatus:   "failed",
  signerName:     "Jane Doe",
  signerTitle:    "CEO",
  signedAt:       "2026-07-01T12:00:00.000Z",
  signatureImage: null as string | null,
};

/** DB company record for the fallback path when getCompanyInfo throws. */
const DB_COMPANY = {
  id:       "ORG-TEST",
  name:     "Sunshine Daycare LLC",
  ein:      "123456789",
  address1: "123 Main St",
  address2: null as null,
  city:     "Austin",
  state:    "TX",
  zipcode:  "78701",
  phone:    "5125550100",
};

const ROLLFI_UUID = "rollfi-co-001";

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
 * Queue the standard two DB selects for the happy path:
 * 1. companySignedForms → the stored form row
 * 2. companies          → { rid: rollfiCompanyId }
 */
function queueHappyPathSelects(rollfiCompanyId = ROLLFI_UUID) {
  dbState.callQueue.push([SIGNED_FORM_ROW]);
  dbState.callQueue.push([{ rid: rollfiCompanyId }]);
}

function postRetry(app: ReturnType<typeof makeApp>, companyId = "ORG-TEST") {
  return request(app)
    .post(`/rollfi/companies/${companyId}/retry-8655-upload`)
    .set("Content-Type", "application/json");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.callQueue.length   = 0;
  dbState.updateCalls.length = 0;
  rollfiCreds.present        = true;
  storeState.role            = "owner";
  storeState.companyId       = "ORG-TEST";
  axiosMock.post.mockReset();
  buildPdfSpy.mockReset();
  buildPdfSpy.mockResolvedValue(FAKE_PDF_BYTES);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /rollfi/companies/:companyId/retry-8655-upload", () => {

  // ── Core payload assertions ────────────────────────────────────────────────
  // These are the primary purpose of this test file: confirm that the exact
  // fields the task requires are sent to Rollfi's uploadDocument endpoint.

  describe("uploadDocument payload — correct fields sent to Rollfi", () => {
    beforeEach(() => {
      queueHappyPathSelects();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO }) // getCompanyInfo
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });      // uploadDocument
    });

    it("sends the Rollfi company UUID (not the internal company ID) as companyId", async () => {
      await postRetry(makeApp());
      // First axios.post = getCompanyInfo; second = uploadDocument
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.companyId).toBe(ROLLFI_UUID);
      expect(payload.companyId).not.toBe("ORG-TEST");
    });

    it("sends documentType = '8655Form'", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.documentType).toBe("8655Form");
    });

    it("sends a non-empty base64 string as fileBase64", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(typeof payload.fileBase64).toBe("string");
      expect((payload.fileBase64 as string).length).toBeGreaterThan(0);
    });

    it("all three required fields are present in the same upload call", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload).toMatchObject({
        companyId:    ROLLFI_UUID,
        documentType: "8655Form",
      });
      expect(typeof payload.fileBase64).toBe("string");
      expect((payload.fileBase64 as string).length).toBeGreaterThan(0);
    });

    it("targets the adminPortal/uploadDocument endpoint URL", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const url = uploadCall[0] as string;
      expect(url).toMatch(/adminPortal\/uploadDocument/);
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path — getCompanyInfo and uploadDocument both succeed", () => {
    beforeEach(() => {
      queueHappyPathSelects();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
    });

    it("returns HTTP 200", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("returns uploadStatus='uploaded'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("returns the rollfiDocumentId from the provider response", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.rollfiDocumentId).toBe(UPLOAD_SUCCESS.documentId);
    });

    it("returns uploadError=null on success", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadError).toBeNull();
    });

    it("makes exactly 2 axios POSTs (getCompanyInfo + uploadDocument)", async () => {
      await postRetry(makeApp());
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
    });

    it("marks record as pending before upload, then updates to uploaded", async () => {
      await postRetry(makeApp());
      // First update: set to pending; second update: set to uploaded
      expect(dbState.updateCalls.length).toBeGreaterThanOrEqual(2);
      const pendingUpdate = dbState.updateCalls[0].setValues as Record<string, unknown>;
      expect(pendingUpdate.uploadStatus).toBe("pending");
      const finalUpdate   = dbState.updateCalls[dbState.updateCalls.length - 1].setValues as Record<string, unknown>;
      expect(finalUpdate.uploadStatus).toBe("uploaded");
    });
  });

  // ── getCompanyInfo throws — DB fallback, upload payload still correct ───────

  describe("when getCompanyInfo throws (DB fallback active)", () => {
    beforeEach(() => {
      // Signed form + companies select for rollfiCompanyId
      queueHappyPathSelects();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))  // getCompanyInfo fails
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });   // uploadDocument succeeds
      // DB fallback: full company record for the catch-block select
      dbState.callQueue.push([DB_COMPANY]);
    });

    it("returns HTTP 200 even when getCompanyInfo fails", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("uploadStatus is 'uploaded' — DB fallback does not block upload", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("still sends the Rollfi UUID as companyId in the upload payload", async () => {
      await postRetry(makeApp());
      // First axios call threw; second (index 1) is uploadDocument
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.companyId).toBe(ROLLFI_UUID);
    });

    it("still sends documentType='8655Form' when falling back to DB", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.documentType).toBe("8655Form");
    });

    it("still sends a non-empty fileBase64 when falling back to DB", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(typeof payload.fileBase64).toBe("string");
      expect((payload.fileBase64 as string).length).toBeGreaterThan(0);
    });
  });

  // ── No signed form record ──────────────────────────────────────────────────

  describe("when no signed Form 8655 exists for the company", () => {
    it("returns 404", async () => {
      dbState.callQueue.push([]); // companySignedForms → empty
      const res = await postRetry(makeApp());
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no signed form 8655/i);
    });

    it("does not call Rollfi", async () => {
      dbState.callQueue.push([]);
      await postRetry(makeApp());
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });

  // ── Form already uploaded ──────────────────────────────────────────────────

  describe("when the Form 8655 is already uploaded successfully", () => {
    it("returns 409", async () => {
      dbState.callQueue.push([{ ...SIGNED_FORM_ROW, uploadStatus: "uploaded" }]);
      const res = await postRetry(makeApp());
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already been uploaded/i);
    });

    it("does not call Rollfi", async () => {
      dbState.callQueue.push([{ ...SIGNED_FORM_ROW, uploadStatus: "uploaded" }]);
      await postRetry(makeApp());
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });

  // ── No rollfiCompanyId ─────────────────────────────────────────────────────

  describe("when the company has no rollfiCompanyId", () => {
    it("returns 400 with an enrollment error", async () => {
      dbState.callQueue.push([SIGNED_FORM_ROW]); // signed form found
      dbState.callQueue.push([]);                 // companies → no rid
      dbState.callQueue.push([]);                 // rollfiCompanyRecords fallback → empty
      const res = await postRetry(makeApp());
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not enrolled/i);
    });
  });

  // ── Missing credentials ────────────────────────────────────────────────────

  describe("when Rollfi credentials are absent", () => {
    it("returns 503", async () => {
      rollfiCreds.present = false;
      queueHappyPathSelects();
      const res = await postRetry(makeApp());
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/credentials not configured/i);
    });
  });

  // ── uploadDocument throws ──────────────────────────────────────────────────

  describe("when Rollfi uploadDocument throws a network error", () => {
    beforeEach(() => {
      queueHappyPathSelects();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockRejectedValueOnce(new Error("Upload timeout"));
    });

    it("returns HTTP 200 (the retry is attempted; outcome is reflected in the body)", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("returns uploadStatus='failed'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("returns uploadError containing the error message", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadError).toMatch(/upload timeout/i);
    });

    it("returns rollfiDocumentId=null", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.rollfiDocumentId).toBeNull();
    });
  });

  // ── rollfiCompanyId from legacy rollfiCompanyRecords ──────────────────────

  describe("when rollfiCompanyId is in rollfiCompanyRecords (legacy path)", () => {
    beforeEach(() => {
      dbState.callQueue.push([SIGNED_FORM_ROW]);                            // companySignedForms
      dbState.callQueue.push([]);                                             // companies → no rid
      dbState.callQueue.push([{ rollfiCompanyId: "rollfi-legacy-001" }]);   // rollfiCompanyRecords
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
    });

    it("returns 200 using the legacy Rollfi ID", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("sends the legacy Rollfi UUID in the upload payload", async () => {
      await postRetry(makeApp());
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.companyId).toBe("rollfi-legacy-001");
      expect(payload.documentType).toBe("8655Form");
      expect(typeof payload.fileBase64).toBe("string");
      expect((payload.fileBase64 as string).length).toBeGreaterThan(0);
    });
  });

  // ── getCompanyInfo throws AND DB company row is missing ───────────────────
  // The route uses `if (dbCo) { ... }` — when the companies table has no row,
  // taxpayerName / ein / address fields stay as empty strings but the signer
  // data from companySignedForms is still intact.  The PDF must still be built
  // (containing at least the signer name) and the upload must still be attempted.

  describe("when getCompanyInfo throws AND the DB company row is missing", () => {
    beforeEach(() => {
      // Signed form + companies select for rollfiCompanyId
      queueHappyPathSelects();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))  // getCompanyInfo fails
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });   // uploadDocument succeeds
      // DB fallback select for company info returns empty (no company row)
      dbState.callQueue.push([]);
    });

    it("returns HTTP 200 — missing company row does not abort the retry", async () => {
      const res = await postRetry(makeApp());
      expect(res.status).toBe(200);
    });

    it("upload is still attempted even with no DB company row", async () => {
      await postRetry(makeApp());
      // First axios call threw; second (index 1) is uploadDocument
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(payload.documentType).toBe("8655Form");
      expect(payload.companyId).toBe(ROLLFI_UUID);
    });

    it("upload succeeds and returns uploadStatus='uploaded'", async () => {
      const res = await postRetry(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("PDF is built with the stored signer name even when company row is absent", async () => {
      await postRetry(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledTimes(1);
      const pdfArg = buildPdfSpy.mock.calls[0][0] as Record<string, unknown>;
      // Signer name must come from the companySignedForms row (not the missing company)
      expect(pdfArg.signerName).toBe(SIGNED_FORM_ROW.signerName.trim());
    });

    it("PDF is built with empty company fields (graceful degradation) not a fallback crash", async () => {
      await postRetry(makeApp());
      const pdfArg = buildPdfSpy.mock.calls[0][0] as Record<string, unknown>;
      // taxpayerName falls back to "Company" (the || "Company" default in the route)
      expect(typeof pdfArg.taxpayerName).toBe("string");
      // Upload payload still contains a non-empty base64 PDF
      const uploadCall = axiosMock.post.mock.calls[1] as unknown[];
      const payload = uploadCall[1] as Record<string, unknown>;
      expect(typeof payload.fileBase64).toBe("string");
      expect((payload.fileBase64 as string).length).toBeGreaterThan(0);
    });
  });

  // ── Access control ─────────────────────────────────────────────────────────

  describe("access control", () => {
    it("returns 403 when an owner retries for a different company's URL", async () => {
      // storeState.companyId is "ORG-TEST"; targeting "ORG-OTHER" → 403
      const res = await postRetry(makeApp(), "ORG-OTHER");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/access denied/i);
    });

    it("does not call Rollfi when an owner is rejected", async () => {
      await postRetry(makeApp(), "ORG-OTHER");
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("allows a super_admin to retry for any company URL", async () => {
      storeState.role      = "super_admin";
      storeState.companyId = "ORG-ADMIN";
      queueHappyPathSelects("rollfi-other-001");
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
      const res = await postRetry(makeApp(), "ORG-OTHER");
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });
  });
});
