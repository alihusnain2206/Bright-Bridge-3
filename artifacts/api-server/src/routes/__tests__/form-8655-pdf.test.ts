/**
 * Tests for GET /rollfi/companies/:companyId/form-8655.pdf
 *
 * Coverage goals:
 * 1. Returns a valid PDF (application/pdf, %PDF magic bytes) in the happy path
 *    (Rollfi API reachable).
 * 2. Returns a valid PDF from the DB fallback when Rollfi credentials are absent.
 * 3. Returns a valid PDF from the DB fallback when the Rollfi API throws.
 * 4. DB fallback populates taxpayer name, EIN, and address (verified by checking
 *    the PDF bytes for those string values).
 * 5. Content-Disposition attachment header is set correctly in all paths.
 * 6. Returns 404 when no signed Form 8655 record exists yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────
// vi.hoisted ensures these are initialised before any mock factory runs.

const dbState = vi.hoisted(() => ({
  callQueue: [] as unknown[][],
}));

const rollfiCreds = vi.hoisted(() => ({
  present: false as boolean,
}));

const axiosMock = vi.hoisted(() => ({
  post: vi.fn<() => Promise<unknown>>(),
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

// drizzle-orm helpers — the mocked db.where() ignores arguments, so these
// just need to return a non-throwing value.
vi.mock("drizzle-orm", () => ({
  eq:  (_col: unknown, _val: unknown) => ({}),
  and: (..._args: unknown[]) => ({}),
}));

// @workspace/db — returns queued results in FIFO order; .catch() just wraps
// the promise so it behaves like Drizzle's lazy promise.
//
// The `select()` call now accepts the projection object and filters each
// queued row to only the keys that appear in the projection (matching Drizzle's
// real behaviour).  This means a test will fail if a column is removed from the
// select, which is the regression this file exists to guard against.
vi.mock("@workspace/db", () => {
  const makeChain = (projection?: Record<string, unknown>) => {
    // Build the list of output keys from the projection.
    // Only include keys whose value is not undefined — omitting a column from
    // the route's select() causes its value in the projection to be undefined
    // (because the column object doesn't exist on the table mock).
    const projectedKeys =
      projection && Object.keys(projection).length > 0
        ? Object.keys(projection).filter((k) => projection[k] !== undefined)
        : null;

    const chain: Record<string, unknown> = {};
    chain.from  = () => chain;
    chain.where = () => {
      const rawResult: unknown[] = dbState.callQueue.shift() ?? [];
      if (projectedKeys && projectedKeys.length > 0) {
        return Promise.resolve(
          rawResult.map((row) => {
            if (typeof row !== "object" || row === null) return row;
            const out: Record<string, unknown> = {};
            for (const k of projectedKeys) {
              out[k] = (row as Record<string, unknown>)[k];
            }
            return out;
          }),
        );
      }
      // No projection (db.select() with no args) — return the full row.
      return Promise.resolve(rawResult);
    };
    return chain;
  };
  return {
    db: { select: (proj?: unknown) => makeChain(proj as Record<string, unknown> | undefined) },
    companySignedForms: {
      companyId:      {},
      formType:       {},
      signerName:     {},
      signerTitle:    {},
      signedAt:       {},
      signatureImage: {}, // ← must be present so the route's select projection includes it
    },
    // Route imports `companies` and aliases it to `companiesTable` locally.
    companies:            { id: {}, rollfiCompanyId: {}, name: {}, ein: {}, address1: {}, address2: {}, city: {}, state: {}, zipcode: {}, phone: {} },
    rollfiCompanyRecords: { companyId: {}, rollfiCompanyId: {} },
    employees:            {},
    stateRegistrations:   {},
  };
});

// Rollfi config
vi.mock("../../lib/rollfi-config.js", () => ({
  getRollfiConfig: () => ({
    credentialsPresent: rollfiCreds.present,
    baseUrl:   "https://sandbox.rollfi.xyz",
    clientId:  rollfiCreds.present ? "test-cid" : undefined,
    secretKey: rollfiCreds.present ? "test-sk"  : undefined,
  }),
}));

// In-memory user store
vi.mock("../../store.js", () => ({
  store: {
    getUserById: (_id: string) => ({
      id:        "USER-TEST",
      role:      "owner",
      companyId: "ORG-TEST",
    }),
  },
}));

// Auth middleware — injects a session so requireAuth passes
vi.mock("../../lib/auth-middleware.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = { userId: "USER-TEST" };
    next();
  },
}));

// axios
vi.mock("axios", () => ({ default: axiosMock }));

// Transitive deps of company-settings.ts that aren't needed for this endpoint
vi.mock("../../lib/rollfi-employee-sync.js", () => ({
  extractRollfiError: (_data: unknown) => null,
}));
vi.mock("../../lib/dashboard-steps.js", () => ({
  buildDashboardSteps: () => ({
    steps: [], stepsAllDone: false, completedCount: 0, totalCount: 10,
  }),
}));

// ── Import router AFTER mocks are registered ─────────────────────────────────
import companySettingsRouter from "../company-settings.js";

// Spy surface for buildForm8655Pdf — imported after mocks so the module
// is already in Vitest's module registry and the spy binds correctly.
import * as form8655Module from "../../lib/form8655.js";

// Capture the original implementation once at module scope, before any
// beforeEach spy is installed.  If we captured it inside beforeEach, the
// second test would capture the spy from the first test, causing a chain.
const realBuildForm8655Pdf = form8655Module.buildForm8655Pdf;

// ── Fixture data ─────────────────────────────────────────────────────────────

const SIGNED_RECORD = {
  signerName:  "Jane Doe",
  signerTitle: "CEO",
  signedAt:    "2026-07-01T12:00:00.000Z",
};

/** Rollfi-shaped company info response */
const ROLLFI_COMPANY_INFO = {
  Company: [{
    company: "Rollfi Daycare Inc",
    KYBInformations: [{ ein: "987654321", phoneNumber: "5125559999" }],
    CompanyLocations: [{ address1: "99 Provider Ave", city: "Dallas", state: "TX", zipcode: "75201" }],
  }],
};

/**
 * Minimal 1×1 transparent PNG (base64, no data: prefix).
 * Small enough to keep tests fast; real enough that pdf-lib can embed it.
 */
const SIGNATURE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A second, distinct PNG used to simulate an overwrite after re-signing. */
const SIGNATURE_PNG_B64_V2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR42mNk+M9QDwADAgEAAkYBGMIAAAAASUVORK5CYII=";

/** Signed record that includes a drawn signature image. */
const SIGNED_RECORD_WITH_IMAGE = {
  ...{
    signerName:  "Jane Doe",
    signerTitle: "CEO",
    signedAt:    "2026-07-01T12:00:00.000Z",
  },
  signatureImage: SIGNATURE_PNG_B64,
};

/** DB record for a company — used as the fallback data source */
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

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  // Add req.log so the route's logging calls don't throw
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = {
      info:  vi.fn(),
      error: vi.fn(),
      warn:  vi.fn(),
    };
    next();
  });
  app.use(companySettingsRouter);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let buildPdfSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbState.callQueue.length = 0;
  rollfiCreds.present = true;
  axiosMock.post.mockReset();
  // Restore any spy installed by the previous test before re-installing.
  vi.restoreAllMocks();
  // Spy on buildForm8655Pdf so tests can assert what data the route passes it.
  // Use realBuildForm8655Pdf (module-scope constant) so the implementation
  // never goes through the spy and there is no cross-test spy chain.
  buildPdfSpy = vi.spyOn(form8655Module, "buildForm8655Pdf");
  buildPdfSpy.mockImplementation((data) => realBuildForm8655Pdf(data));
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Queue the 2 DB queries common to every success path (signed form + companies.rid). */
function queueBaseDb(rollfiCompanyId = "rollfi-co-001") {
  dbState.callQueue.push([SIGNED_RECORD]);                        // signed form record
  dbState.callQueue.push([{ rid: rollfiCompanyId }]);             // companies.rollfiCompanyId
}

/** Hit the PDF endpoint and return the supertest response with raw body buffered. */
function getPdf(app: ReturnType<typeof makeApp>) {
  return request(app)
    .get("/rollfi/companies/ORG-TEST/form-8655.pdf")
    .buffer(true)
    // Treat any content-type as a raw buffer
    .parse((_res, callback) => {
      const chunks: Buffer[] = [];
      _res.on("data", (chunk: Buffer) => chunks.push(chunk));
      _res.on("end",  () => callback(null, Buffer.concat(chunks)));
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /rollfi/companies/:companyId/form-8655.pdf", () => {

  // ── 404 when form has never been signed ──────────────────────────────────

  describe("when no signed Form 8655 record exists", () => {
    it("returns 404", async () => {
      dbState.callQueue.push([]); // signed form query → empty result
      const res = await request(makeApp())
        .get("/rollfi/companies/ORG-TEST/form-8655.pdf");
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no signed form 8655/i);
    });
  });

  // ── Happy path: Rollfi reachable ──────────────────────────────────────────

  describe("when Rollfi API returns company data", () => {
    beforeEach(() => {
      queueBaseDb();
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
    });

    it("returns HTTP 200", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
    });

    it("sets Content-Type to application/pdf", async () => {
      const res = await getPdf(makeApp());
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    });

    it("sets Content-Disposition to attachment with a .pdf filename", async () => {
      const res = await getPdf(makeApp());
      const cd = res.headers["content-disposition"] as string;
      expect(cd).toMatch(/attachment/i);
      expect(cd).toMatch(/Form8655_Jane_Doe_2026-07-01\.pdf/);
    });

    it("response body is a valid PDF (starts with %PDF)", async () => {
      const res = await getPdf(makeApp());
      // Body is buffered as a raw Buffer by the custom parser
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });

    it("PDF body is non-trivially large (> 1 KB)", async () => {
      const res = await getPdf(makeApp());
      expect((res.body as Buffer).length).toBeGreaterThan(1024);
    });

    it("passes Rollfi company name to PDF builder (not the DB name)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: "Rollfi Daycare Inc" }),
      );
    });
  });

  // ── Rollfi path: drawn signature preserved when Rollfi data is used ─────────
  //
  // Regression guard for the case where merging Rollfi company data into the
  // PDF payload inadvertently dropped `signatureImageBase64`, causing the
  // downloaded PDF to show a blank signature line even though the user had
  // drawn one.

  describe("when Rollfi API returns company data and the signed record has a drawn signature", () => {
    beforeEach(() => {
      rollfiCreds.present = true;
      // Queue signed form record WITH the image column populated
      dbState.callQueue.push([SIGNED_RECORD_WITH_IMAGE]);
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]);
      // No DB company fallback needed — Rollfi call succeeds
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
    });

    it("passes signatureImageBase64 to buildForm8655Pdf (not dropped when Rollfi data is merged)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ signatureImageBase64: SIGNATURE_PNG_B64 }),
      );
    });

    it("also uses Rollfi company name (both sources are active simultaneously)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: "Rollfi Daycare Inc" }),
      );
    });

    it("PDF bytes contain an embedded image object (not text-only output)", async () => {
      const res = await getPdf(makeApp());
      const pdfText = (res.body as Buffer).toString("binary");
      expect(pdfText).toContain("/Image");
    });

    it("returns HTTP 200 and a valid PDF", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });
  });

  // ── Rollfi path: null signatureImage handled correctly (text-only fallback) ─
  //
  // When the user completes the signing flow without drawing a signature (rare
  // but permitted — the form still records signerName/signerTitle), signatureImage
  // is stored as NULL in the DB.  The route must convert that to `undefined` so
  // pdf-lib receives no image argument and produces a text-only signature line
  // without throwing (passing `null` or `""` would confuse pdf-lib).

  describe("when Rollfi API returns company data and the signed record has no image (signatureImage: null)", () => {
    beforeEach(() => {
      rollfiCreds.present = true;
      // Queue signed form record with signatureImage explicitly null
      dbState.callQueue.push([{ ...SIGNED_RECORD, signatureImage: null }]);
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]);
      // No DB company fallback needed — Rollfi call succeeds
      axiosMock.post.mockResolvedValueOnce({ data: ROLLFI_COMPANY_INFO });
    });

    it("passes signatureImageBase64: undefined (not null) to buildForm8655Pdf", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ signatureImageBase64: undefined }),
      );
    });

    it("does not pass signatureImageBase64 as null or empty string", async () => {
      await getPdf(makeApp());
      const callArg = buildPdfSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.signatureImageBase64).not.toBe(null);
      expect(callArg.signatureImageBase64).not.toBe("");
    });

    it("returns HTTP 200", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
    });

    it("response body is a valid PDF (starts with %PDF)", async () => {
      const res = await getPdf(makeApp());
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });

    it("still uses Rollfi company name even when there is no signature image", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: "Rollfi Daycare Inc" }),
      );
    });
  });

  // ── Fallback path: credentials absent ─────────────────────────────────────

  describe("when Rollfi credentials are absent", () => {
    beforeEach(() => {
      rollfiCreds.present = false;
      queueBaseDb();
      // DB fallback query
      dbState.callQueue.push([DB_COMPANY]);
    });

    it("does NOT call the Rollfi API", async () => {
      await getPdf(makeApp());
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    it("returns HTTP 200", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
    });

    it("sets Content-Type to application/pdf", async () => {
      const res = await getPdf(makeApp());
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    });

    it("sets Content-Disposition to attachment with a .pdf filename", async () => {
      const res = await getPdf(makeApp());
      const cd = res.headers["content-disposition"] as string;
      expect(cd).toMatch(/attachment/i);
      expect(cd).toMatch(/Form8655_Jane_Doe_2026-07-01\.pdf/);
    });

    it("PDF starts with %PDF magic bytes", async () => {
      const res = await getPdf(makeApp());
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });

    it("DB company name passed to PDF builder (fallback populated name)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: DB_COMPANY.name }),
      );
    });

    it("DB address passed to PDF builder (fallback populated address)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ address: DB_COMPANY.address1 }),
      );
    });

    it("DB EIN passed to PDF builder (fallback populated EIN)", async () => {
      await getPdf(makeApp());
      // Route passes raw digits; buildForm8655Pdf formats to XX-XXXXXXX internally
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerEin: DB_COMPANY.ein }),
      );
    });
  });

  // ── Fallback path: Rollfi API throws ──────────────────────────────────────

  describe("when Rollfi API throws a network error", () => {
    beforeEach(() => {
      rollfiCreds.present = true;
      queueBaseDb();
      axiosMock.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // DB fallback query
      dbState.callQueue.push([DB_COMPANY]);
    });

    it("returns HTTP 200 (error is handled gracefully)", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
    });

    it("sets Content-Type to application/pdf", async () => {
      const res = await getPdf(makeApp());
      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    });

    it("sets Content-Disposition to attachment with .pdf filename", async () => {
      const res = await getPdf(makeApp());
      const cd = res.headers["content-disposition"] as string;
      expect(cd).toMatch(/attachment/i);
      expect(cd).toMatch(/Form8655_Jane_Doe_2026-07-01\.pdf/);
    });

    it("PDF starts with %PDF magic bytes", async () => {
      const res = await getPdf(makeApp());
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });

    it("DB company name passed to PDF builder (fallback activated on API error)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taxpayerName: DB_COMPANY.name }),
      );
    });

    it("DB city/state/zip passed to PDF builder as cityStateZip", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cityStateZip: `${DB_COMPANY.city}, ${DB_COMPANY.state}, ${DB_COMPANY.zipcode}`,
        }),
      );
    });
  });

  // ── Fallback when both Rollfi and companies table are empty ───────────────

  describe("when Rollfi is down and DB company has no address", () => {
    beforeEach(() => {
      rollfiCreds.present = false;
      queueBaseDb();
      // DB company with sparse data — only name set
      dbState.callQueue.push([{ ...DB_COMPANY, address1: null, city: null, state: null, zipcode: null, ein: null, phone: null }]);
    });

    it("still returns a valid PDF (uses 'Company' placeholder for empty name fallback)", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });
  });

  // ── Drawn signature image is preserved in the downloaded PDF ─────────────
  //
  // Regression guard for the bug where `signatureImage` was omitted from the
  // DB select, causing the downloaded PDF to show a blank line even after a
  // successful in-app signing.

  describe("when the signed record contains a drawn signature image", () => {
    beforeEach(() => {
      rollfiCreds.present = false;
      // Queue signed form record WITH the image column populated
      dbState.callQueue.push([SIGNED_RECORD_WITH_IMAGE]);
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]);
      dbState.callQueue.push([DB_COMPANY]);
    });

    it("passes signatureImageBase64 to buildForm8655Pdf (route reads the signatureImage column)", async () => {
      await getPdf(makeApp());
      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ signatureImageBase64: SIGNATURE_PNG_B64 }),
      );
    });

    it("does not fall back to the typed signer name when an image is present", async () => {
      await getPdf(makeApp());
      // The spy must have received a non-empty signatureImageBase64, confirming
      // the route did NOT drop it and trigger the text-only fallback.
      const callArg = buildPdfSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof callArg.signatureImageBase64).toBe("string");
      expect((callArg.signatureImageBase64 as string).length).toBeGreaterThan(0);
    });

    it("PDF bytes contain an embedded image object (not text-only output)", async () => {
      const res = await getPdf(makeApp());
      // pdf-lib writes '/Subtype /Image' into the PDF content stream when
      // drawImage() is called.  Its presence confirms the image path was taken.
      const pdfText = (res.body as Buffer).toString("binary");
      expect(pdfText).toContain("/Image");
    });

    it("returns HTTP 200 and a valid PDF", async () => {
      const res = await getPdf(makeApp());
      expect(res.status).toBe(200);
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).toBe("%PDF");
    });
  });

  // ── Cross-company access: owner may not download another company's PDF ──────
  //
  // Security regression guard.  The URL param (:companyId) must be validated
  // against the session-resolved company.  If they diverge, the route must
  // return 403 — never serve another company's PDF.

  describe("when the session belongs to company A but the URL targets company B", () => {
    it("returns 403 (not 200 with another company's PDF)", async () => {
      // No DB queue needed — the guard fires before any DB query.
      const res = await request(makeApp())
        .get("/rollfi/companies/ORG-OTHER/form-8655.pdf");
      expect(res.status).toBe(403);
    });

    it("response body contains an error field", async () => {
      const res = await request(makeApp())
        .get("/rollfi/companies/ORG-OTHER/form-8655.pdf");
      expect(res.body).toHaveProperty("error");
    });

    it("does not return a PDF body", async () => {
      const res = await request(makeApp())
        .get("/rollfi/companies/ORG-OTHER/form-8655.pdf")
        .buffer(true)
        .parse((_r, cb) => {
          const chunks: Buffer[] = [];
          _r.on("data", (c: Buffer) => chunks.push(c));
          _r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      const magic = (res.body as Buffer).slice(0, 4).toString("ascii");
      expect(magic).not.toBe("%PDF");
    });
  });

  // ── Re-sign overwrites: downloaded PDF always reflects the latest image ───

  describe("when the drawn signature is overwritten by a second signing", () => {
    it("downloaded PDF uses the new signature image, not the original one", async () => {
      // Simulate a second sign: the DB record now holds SIGNATURE_PNG_B64_V2
      rollfiCreds.present = false;
      dbState.callQueue.push([{ ...SIGNED_RECORD_WITH_IMAGE, signatureImage: SIGNATURE_PNG_B64_V2 }]);
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]);
      dbState.callQueue.push([DB_COMPANY]);

      await getPdf(makeApp());

      expect(buildPdfSpy).toHaveBeenCalledWith(
        expect.objectContaining({ signatureImageBase64: SIGNATURE_PNG_B64_V2 }),
      );
    });

    it("PDF bytes still contain an embedded image after re-sign", async () => {
      rollfiCreds.present = false;
      dbState.callQueue.push([{ ...SIGNED_RECORD_WITH_IMAGE, signatureImage: SIGNATURE_PNG_B64_V2 }]);
      dbState.callQueue.push([{ rid: "rollfi-co-001" }]);
      dbState.callQueue.push([DB_COMPANY]);

      const res = await getPdf(makeApp());
      const pdfText = (res.body as Buffer).toString("binary");
      expect(pdfText).toContain("/Image");
    });
  });
});
