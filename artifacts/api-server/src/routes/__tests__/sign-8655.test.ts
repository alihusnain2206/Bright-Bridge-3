/**
 * Tests for POST /rollfi/companies/:companyId/sign-8655
 *
 * Coverage goals:
 * 1. Happy path: Rollfi API reachable + upload succeeds
 *    - Returns 200 JSON with { id, signerName, signerTitle, signedAt, uploadStatus: "uploaded", rollfiDocumentId }
 *    - Content-Type is application/json
 *    - DB insert (upsert) is called with signerName/signerTitle/uploadStatus="pending"
 *    - DB update called with uploadStatus="uploaded" after successful upload
 * 2. DB fallback when Rollfi getCompanyInfo throws
 *    - buildForm8655Pdf still called (with DB company data)
 *    - Upload still attempted and succeeds
 *    - signerName echoed back correctly
 * 3. Upload-failure path: Rollfi uploadDocument throws
 *    - Returns 200 with uploadStatus="failed" and an uploadError string
 *    - DB update records the failure (uploadStatus="failed")
 * 4. Upload-failure path: provider returns { success: false }
 *    - Returns 200 with uploadStatus="failed"
 * 5. Validation: missing signerName or signerTitle → 400
 * 6. No rollfiCompanyId in DB → 400
 * 7. Rollfi credentials absent → 503
 * 8. rollfiCompanyId found via legacy rollfiCompanyRecords table
 * 9. DB insert failure → 500
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** Select call queue — each entry is the array returned by the next .where() */
  callQueue: [] as unknown[][],
  /** Track insert calls */
  insertCalls: [] as unknown[],
  /** Track update calls */
  updateCalls: [] as { setValues: unknown }[],
  /** Whether insert should throw */
  insertThrows: false as boolean,
}));

const rollfiCreds = vi.hoisted(() => ({
  present: true as boolean,
}));

/** Mutable store state — lets access-control tests switch roles per-test. */
const storeState = vi.hoisted(() => ({
  role:      "owner" as string,
  companyId: "ORG-TEST" as string,
}));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

/** Minimal PDF bytes returned by the mocked buildForm8655Pdf. */
const FAKE_PDF_BYTES = vi.hoisted(() =>
  new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), // "%PDF-1.4"
);

/** Spy handle for buildForm8655Pdf — set in beforeEach after mock is registered. */
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
   * Returns a plain native Promise so that .catch() / await work correctly
   * without any custom override (avoiding infinite-recursion bugs).
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

  /** Insert chain — tracks calls; onConflictDoUpdate is the terminal. */
  const makeInsertChain = (table: unknown) => ({
    values: (vals: unknown) => ({
      onConflictDoUpdate: (_opts: unknown) => {
        dbState.insertCalls.push({ table, vals });
        if (dbState.insertThrows) {
          return Promise.reject(new Error("DB insert failed"));
        }
        return Promise.resolve([]);
      },
    }),
  });

  /**
   * Update chain — tracks calls; .where() is the terminal and returns a plain
   * native Promise so that the route's optional .catch() works natively.
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
      companyId: {},
      formType:  {},
      signerName:  {},
      signerTitle: {},
      signedAt:    {},
      uploadStatus: {},
      uploadError:  {},
      rollfiDocumentId: {},
    },
    companies: {
      id: {}, rollfiCompanyId: {}, name: {}, ein: {},
      address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {},
    },
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

/**
 * Mock form8655 module — buildForm8655Pdf is stubbed so route tests don't
 * depend on pdf-lib or the IRS PDF asset. PDF generation correctness is
 * covered separately in form-8655-pdf.test.ts. The spy lets tests verify
 * which company data was passed to the builder.
 */
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
const UPLOAD_SUCCESS = { documentId: "doc-abc-123" };

/** DB company record used when Rollfi is unreachable */
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

const SIGNER_NAME  = "Jane Doe";
const SIGNER_TITLE = "CEO";

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

/** Queue the DB select for companies.rollfiCompanyId (first call in the route). */
function queueRollfiIdSelect(rollfiCompanyId = "rollfi-co-001") {
  dbState.callQueue.push([{ rid: rollfiCompanyId }]);
}

/** POST to the sign endpoint with default or custom body */
function postSign(
  app: ReturnType<typeof makeApp>,
  body: Record<string, unknown> = { signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE },
) {
  return request(app)
    .post("/rollfi/companies/ORG-TEST/sign-8655")
    .send(body)
    .set("Content-Type", "application/json");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbState.callQueue.length   = 0;
  dbState.insertCalls.length = 0;
  dbState.updateCalls.length = 0;
  dbState.insertThrows       = false;
  rollfiCreds.present        = true;
  storeState.role            = "owner";
  storeState.companyId       = "ORG-TEST";
  axiosMock.post.mockReset();
  buildPdfSpy.mockReset();
  buildPdfSpy.mockResolvedValue(FAKE_PDF_BYTES);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /rollfi/companies/:companyId/sign-8655", () => {

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when signerName is missing", async () => {
      const res = await postSign(makeApp(), { signerTitle: SIGNER_TITLE });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signerName/i);
    });

    it("returns 400 when signerTitle is missing", async () => {
      const res = await postSign(makeApp(), { signerName: SIGNER_NAME });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signerTitle/i);
    });

    it("returns 400 when both are missing", async () => {
      const res = await postSign(makeApp(), {});
      expect(res.status).toBe(400);
    });

    it("returns 400 when signerName is whitespace only", async () => {
      const res = await postSign(makeApp(), { signerName: "   ", signerTitle: SIGNER_TITLE });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signerName/i);
    });
  });

  // ── No rollfi enrollment ───────────────────────────────────────────────────

  describe("when company has no rollfiCompanyId", () => {
    it("returns 400 with an enrollment error", async () => {
      dbState.callQueue.push([]);  // companies → no rid
      dbState.callQueue.push([]);  // rollfiCompanyRecords fallback → empty
      const res = await postSign(makeApp());
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not yet enrolled/i);
    });
  });

  // ── Missing credentials ────────────────────────────────────────────────────

  describe("when Rollfi credentials are absent", () => {
    it("returns 503", async () => {
      rollfiCreds.present = false;
      queueRollfiIdSelect();
      const res = await postSign(makeApp());
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/credentials not configured/i);
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path — Rollfi reachable, upload succeeds", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })  // getCompanyInfo
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });       // uploadDocument
    });

    it("returns HTTP 200", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
    });

    it("Content-Type is application/json", async () => {
      const res = await postSign(makeApp());
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("response includes a non-empty id", async () => {
      const res = await postSign(makeApp());
      expect(typeof res.body.id).toBe("string");
      expect(res.body.id.length).toBeGreaterThan(0);
    });

    it("response echoes signerName", async () => {
      const res = await postSign(makeApp());
      expect(res.body.signerName).toBe(SIGNER_NAME);
    });

    it("response echoes signerTitle", async () => {
      const res = await postSign(makeApp());
      expect(res.body.signerTitle).toBe(SIGNER_TITLE);
    });

    it("response includes a parseable signedAt ISO string", async () => {
      const res = await postSign(makeApp());
      expect(() => new Date(res.body.signedAt as string)).not.toThrow();
      expect(isNaN(new Date(res.body.signedAt as string).getTime())).toBe(false);
    });

    it("uploadStatus is 'uploaded'", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("rollfiDocumentId is populated from provider response", async () => {
      const res = await postSign(makeApp());
      expect(res.body.rollfiDocumentId).toBe(UPLOAD_SUCCESS.documentId);
    });

    it("uploadError is null", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadError).toBeNull();
    });

    it("calls Rollfi getCompanyInfo then uploadDocument (2 axios POSTs)", async () => {
      await postSign(makeApp());
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
    });

    it("DB insert (upsert) is called once to persist the signature record", async () => {
      await postSign(makeApp());
      expect(dbState.insertCalls).toHaveLength(1);
    });

    it("DB update is called with uploadStatus='uploaded' and the document ID", async () => {
      await postSign(makeApp());
      expect(dbState.updateCalls).toHaveLength(1);
      const setValues = dbState.updateCalls[0].setValues as Record<string, unknown>;
      expect(setValues.uploadStatus).toBe("uploaded");
      expect(setValues.rollfiDocumentId).toBe(UPLOAD_SUCCESS.documentId);
      expect(setValues.uploadError).toBeNull();
    });

    it("passes Rollfi company name to PDF builder (not the DB name)", async () => {
      await postSign(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: "Rollfi Daycare Inc" }),
      );
    });

    it("passes signerName and signerTitle to PDF builder", async () => {
      await postSign(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE }),
      );
    });
  });

  // ── Provider success=true without documentId ───────────────────────────────

  describe("when uploadDocument returns { success: true } without a documentId", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: true } });
    });

    it("returns 200 with uploadStatus='uploaded'", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("rollfiDocumentId is null (no id from provider)", async () => {
      const res = await postSign(makeApp());
      expect(res.body.rollfiDocumentId).toBeNull();
    });
  });

  // ── DB fallback: getCompanyInfo throws ────────────────────────────────────

  describe("when Rollfi getCompanyInfo throws (DB fallback)", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))  // getCompanyInfo fails
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });   // uploadDocument succeeds
      // DB fallback: full company record queued for the catch-block select
      dbState.callQueue.push([DB_COMPANY]);
    });

    it("returns HTTP 200", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
    });

    it("uploadStatus is 'uploaded' (fallback does not block upload)", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("signerName is echoed correctly", async () => {
      const res = await postSign(makeApp());
      expect(res.body.signerName).toBe(SIGNER_NAME);
    });

    it("DB company name passed to PDF builder (DB fallback activated)", async () => {
      await postSign(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: DB_COMPANY.name }),
      );
    });

    it("DB insert is called (signing still persisted)", async () => {
      await postSign(makeApp());
      expect(dbState.insertCalls).toHaveLength(1);
    });

    it("DB update marks upload as succeeded", async () => {
      await postSign(makeApp());
      const setValues = dbState.updateCalls[0]?.setValues as Record<string, unknown>;
      expect(setValues?.uploadStatus).toBe("uploaded");
    });
  });

  // ── Upload failure: Rollfi uploadDocument throws ───────────────────────────

  describe("when Rollfi uploadDocument throws a network error", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })  // getCompanyInfo OK
        .mockRejectedValueOnce(new Error("Upload timeout"));   // uploadDocument fails
    });

    it("still returns HTTP 200 (signing succeeded even if upload failed)", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
    });

    it("uploadStatus is 'failed'", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("uploadError contains the error message", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadError).toMatch(/upload timeout/i);
    });

    it("rollfiDocumentId is null", async () => {
      const res = await postSign(makeApp());
      expect(res.body.rollfiDocumentId).toBeNull();
    });

    it("signerName is echoed correctly", async () => {
      const res = await postSign(makeApp());
      expect(res.body.signerName).toBe(SIGNER_NAME);
    });

    it("DB insert is called (signature persisted regardless of upload outcome)", async () => {
      await postSign(makeApp());
      expect(dbState.insertCalls).toHaveLength(1);
    });

    it("DB update records the upload failure with uploadStatus='failed'", async () => {
      await postSign(makeApp());
      expect(dbState.updateCalls).toHaveLength(1);
      const setValues = dbState.updateCalls[0].setValues as Record<string, unknown>;
      expect(setValues.uploadStatus).toBe("failed");
      expect(typeof setValues.uploadError).toBe("string");
    });
  });

  // ── Upload failure: provider returns error body ────────────────────────────

  describe("when uploadDocument returns { success: false, error: '...' }", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: { success: false, error: "Document rejected" } });
    });

    it("returns 200 with uploadStatus='failed'", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("failed");
    });

    it("uploadError contains the provider error message", async () => {
      const res = await postSign(makeApp());
      expect(res.body.uploadError).toMatch(/Document rejected/);
    });
  });

  // ── DB insert failure ──────────────────────────────────────────────────────

  describe("when the DB insert fails", () => {
    beforeEach(() => {
      queueRollfiIdSelect();
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
      dbState.insertThrows = true;
    });

    it("returns 500 with a signature-save error", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/failed to save/i);
    });

    it("does not proceed to upload after DB failure", async () => {
      await postSign(makeApp());
      // uploadDocument should never be called if persisting the signature fails
      expect(axiosMock.post).toHaveBeenCalledTimes(1); // only getCompanyInfo
    });
  });

  // ── rollfiCompanyId found via legacy rollfiCompanyRecords ──────────────────

  describe("when rollfiCompanyId is in rollfiCompanyRecords (legacy path)", () => {
    beforeEach(() => {
      // Primary companies select returns nothing
      dbState.callQueue.push([]);
      // Legacy rollfiCompanyRecords select returns the ID
      dbState.callQueue.push([{ rollfiCompanyId: "rollfi-legacy-001" }]);
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
    });

    it("returns 200 using the legacy Rollfi ID", async () => {
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("calls Rollfi APIs (not short-circuited by missing ID)", async () => {
      await postSign(makeApp());
      expect(axiosMock.post).toHaveBeenCalledTimes(2);
    });
  });

  // ── Access control ──────────────────────────────────────────────────────────
  // Verifies that an owner can only sign for their own company, and that
  // super_admin is permitted to sign for any company URL param.

  describe("access control", () => {

    it("returns 403 when an owner posts to a different company's URL", async () => {
      // storeState.companyId is "ORG-TEST"; post to "ORG-OTHER" — mismatch → 403
      const res = await request(makeApp())
        .post("/rollfi/companies/ORG-OTHER/sign-8655")
        .send({ signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE })
        .set("Content-Type", "application/json");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/access denied/i);
    });

    it("does not call Rollfi or touch the DB when an owner is rejected", async () => {
      await request(makeApp())
        .post("/rollfi/companies/ORG-OTHER/sign-8655")
        .send({ signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE })
        .set("Content-Type", "application/json");
      expect(axiosMock.post).not.toHaveBeenCalled();
      expect(dbState.insertCalls).toHaveLength(0);
    });

    it("allows a super_admin to sign for any company URL param", async () => {
      storeState.role      = "super_admin";
      storeState.companyId = "ORG-ADMIN";
      queueRollfiIdSelect("rollfi-other-001");
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
      const res = await request(makeApp())
        .post("/rollfi/companies/ORG-OTHER/sign-8655")
        .send({ signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE })
        .set("Content-Type", "application/json");
      expect(res.status).toBe(200);
      expect(res.body.uploadStatus).toBe("uploaded");
    });

    it("super_admin does not receive a 403 regardless of which company URL they target", async () => {
      storeState.role      = "super_admin";
      storeState.companyId = "ORG-ADMIN";
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
      const res = await request(makeApp())
        .post("/rollfi/companies/ORG-COMPLETELY-DIFFERENT/sign-8655")
        .send({ signerName: SIGNER_NAME, signerTitle: SIGNER_TITLE })
        .set("Content-Type", "application/json");
      expect(res.status).not.toBe(403);
    });

    it("owner posting to their own company URL is not rejected", async () => {
      // Sanity check: ORG-TEST owner → /rollfi/companies/ORG-TEST/... → 200
      queueRollfiIdSelect();
      axiosMock.post
        .mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO })
        .mockResolvedValueOnce({ data: UPLOAD_SUCCESS });
      const res = await postSign(makeApp());
      expect(res.status).toBe(200);
    });

  });

});
