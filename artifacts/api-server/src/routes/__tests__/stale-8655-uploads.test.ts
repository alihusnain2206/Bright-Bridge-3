/**
 * Tests for GET /api/admin/stale-8655-uploads
 *
 * Coverage goals:
 * 1. super_admin + no stale rows → { staleUploads: [], thresholdMs }
 * 2. super_admin + one stale row (uploadAttemptedAt > threshold ago) → row included
 * 3. super_admin + one fresh row (uploadAttemptedAt < threshold ago) → row excluded
 * 4. super_admin + uploaded status (not pending) → row excluded
 * 5. super_admin + pending row with null uploadAttemptedAt → row excluded
 * 6. Non-super_admin (owner) → 403
 * 7. Unauthenticated (no session) → 403
 * 8. Company name is resolved from the companies table
 * 9. Multiple stale rows are sorted most-stale-first
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Hoisted mutable state ────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  /** FIFO queue; each entry is the array resolved by the next .where() call */
  callQueue: [] as unknown[][],
}));

/** Mutable store state — lets tests switch roles. */
const storeState = vi.hoisted(() => ({
  role:      "super_admin" as string,
  companyId: "ORG-BRIGHTBRIDGE" as string,
  userId:    "USER-001" as string | null,
}));

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:      (_col: unknown, _val: unknown) => ({}),
  and:     (..._args: unknown[]) => ({}),
  isNotNull: (_col: unknown) => ({}),
  inArray: (_col: unknown, _vals: unknown) => ({}),
}));

vi.mock("@workspace/db", () => {
  /**
   * Select chain.
   * First call (.from().where()) → pops first queue entry (companySignedForms rows).
   * Second call (.from().where()) → pops second queue entry (companies rows).
   * Chain supports both .where() (terminal) and no-.where() (terminal via .from()).
   */
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from  = () => {
      const inner: Record<string, unknown> = {};
      inner.where = () => {
        const result: unknown[] = dbState.callQueue.shift() ?? [];
        return Promise.resolve(result);
      };
      // Support .from() without .where() (shouldn't happen in our route)
      return inner;
    };
    chain.where = () => {
      const result: unknown[] = dbState.callQueue.shift() ?? [];
      return Promise.resolve(result);
    };
    return chain;
  };

  const makeUpdateChain = () => ({
    set: (_data: unknown) => ({
      where: () => Promise.resolve([]),
    }),
  });

  return {
    db: {
      select: () => makeSelectChain(),
      update: () => makeUpdateChain(),
    },
    companySignedForms: {
      id:               {},
      companyId:        {},
      formType:         {},
      signerName:       {},
      uploadAttemptedAt: {},
      uploadStatus:     {},
    },
    companies: { id: {}, name: {} },
    employees:            {},
    userAccounts:         {},
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
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import adminRouter from "../admin.js";
import { FORM_8655_STALE_THRESHOLD_MS } from "../../lib/form8655-constants.js";

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
  app.use(adminRouter);
  return app;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** ISO timestamp that is `ms` milliseconds ago. */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const STALE_DELTA   = FORM_8655_STALE_THRESHOLD_MS + 60_000; // 1 minute past threshold
const FRESH_DELTA   = FORM_8655_STALE_THRESHOLD_MS - 60_000; // 1 minute before threshold

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface PendingRowOverrides {
  companyId?:         string;
  uploadAttemptedAt?: string | null;
  uploadStatus?:      string;
  signerName?:        string;
}

function makePendingRow(overrides: PendingRowOverrides = {}) {
  return {
    id:               "csf-001",
    companyId:        "companyId"         in overrides ? overrides.companyId!        : "ORG-TEST",
    signerName:       "signerName"        in overrides ? overrides.signerName!       : "Jane Owner",
    uploadAttemptedAt: "uploadAttemptedAt" in overrides ? overrides.uploadAttemptedAt : msAgo(STALE_DELTA),
    uploadStatus:     "uploadStatus"      in overrides ? overrides.uploadStatus!     : "pending",
  };
}

function makeCompanyRow(id = "ORG-TEST", name = "Sunshine Daycare") {
  return { id, name };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /admin/stale-8655-uploads", () => {
  beforeEach(() => {
    dbState.callQueue = [];
    storeState.role      = "super_admin";
    storeState.userId    = "USER-001";
    storeState.companyId = "ORG-BRIGHTBRIDGE";
  });

  it("returns empty list when no pending rows exist", async () => {
    // DB returns no pending signed-forms rows
    dbState.callQueue.push([]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toEqual([]);
    expect(res.body.thresholdMs).toBe(FORM_8655_STALE_THRESHOLD_MS);
  });

  it("includes a row whose uploadAttemptedAt is older than the threshold", async () => {
    const row     = makePendingRow({ uploadAttemptedAt: msAgo(STALE_DELTA) });
    const company = makeCompanyRow("ORG-TEST", "Sunshine Daycare");

    // First DB call: companySignedForms query; second: companies lookup
    dbState.callQueue.push([row], [company]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toHaveLength(1);
    expect(res.body.staleUploads[0].companyId).toBe("ORG-TEST");
    expect(res.body.staleUploads[0].companyName).toBe("Sunshine Daycare");
    expect(res.body.staleUploads[0].signerName).toBe("Jane Owner");
    expect(res.body.staleUploads[0].uploadAttemptedAt).toBe(row.uploadAttemptedAt);
    expect(res.body.staleUploads[0].staleForMs).toBeGreaterThan(FORM_8655_STALE_THRESHOLD_MS);
  });

  it("excludes a pending row whose uploadAttemptedAt is within the threshold (fresh)", async () => {
    const row = makePendingRow({ uploadAttemptedAt: msAgo(FRESH_DELTA) });

    // DB returns the fresh pending row; no second call needed (filtered out in JS)
    dbState.callQueue.push([row]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toEqual([]);
  });

  it("excludes a row with uploadStatus 'uploaded'", async () => {
    // Route WHERE clause filters uploadStatus = 'pending' at the DB level;
    // if the mock returns an uploaded row (simulating a pass-through), the JS
    // filter would still exclude it via the uploadAttemptedAt time check — but
    // confirm the empty-path works for an 'uploaded' row with null attemptedAt.
    const row = makePendingRow({ uploadStatus: "uploaded", uploadAttemptedAt: null });

    dbState.callQueue.push([row]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toEqual([]);
  });

  it("excludes a pending row with null uploadAttemptedAt", async () => {
    const row = makePendingRow({ uploadAttemptedAt: null });

    dbState.callQueue.push([row]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toEqual([]);
  });

  it("returns 403 for owner role", async () => {
    storeState.role = "owner";

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/super_admin/);
  });

  it("returns 403 when userId is absent from session", async () => {
    storeState.userId = null;

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(403);
  });

  it("resolves company name from the companies table", async () => {
    const row     = makePendingRow({ companyId: "ORG-RAINBOW" });
    const company = makeCompanyRow("ORG-RAINBOW", "Rainbow Kids Daycare");

    dbState.callQueue.push([row], [company]);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads[0].companyName).toBe("Rainbow Kids Daycare");
  });

  it("falls back to companyId as name when company is not found", async () => {
    const row = makePendingRow({ companyId: "ORG-UNKNOWN" });

    // Companies query returns empty — no matching company in DB
    dbState.callQueue.push([row], []);

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads[0].companyName).toBe("ORG-UNKNOWN");
  });

  it("sorts multiple stale rows most-stale-first", async () => {
    const older  = makePendingRow({ companyId: "ORG-A", uploadAttemptedAt: msAgo(STALE_DELTA + 300_000), signerName: "Alice" });
    const newer  = makePendingRow({ companyId: "ORG-B", uploadAttemptedAt: msAgo(STALE_DELTA + 60_000),  signerName: "Bob" });

    dbState.callQueue.push(
      [newer, older], // DB returns in any order
      [makeCompanyRow("ORG-A", "Alpha"), makeCompanyRow("ORG-B", "Beta")],
    );

    const res = await request(makeApp()).get("/admin/stale-8655-uploads");

    expect(res.status).toBe(200);
    expect(res.body.staleUploads).toHaveLength(2);
    // Most-stale first: ORG-A is older
    expect(res.body.staleUploads[0].companyId).toBe("ORG-A");
    expect(res.body.staleUploads[1].companyId).toBe("ORG-B");
  });
});
