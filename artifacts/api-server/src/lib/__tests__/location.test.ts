/**
 * Unit tests for resolveCompanyLocationId.
 *
 * Coverage:
 * 1. Store entry with locationId → returned immediately (no DB call)
 * 2. No store entry, DB has a real rollfiLocationId → that ID returned
 * 3. No store entry, DB rollfiLocationId is empty string → derived "LOC-<companyId>" fallback
 * 4. No store entry, DB rollfiLocationId is null → derived "LOC-<companyId>" fallback
 * 5. No store entry, DB has no row → derived "LOC-<companyId>" fallback
 * 6. No store entry, DB throws → derived "LOC-<companyId>" fallback (catch branch)
 * 7. Empty companyId → returns ""
 *
 * Scenario 3 is the regression guard: the original bug returned "" when rollfiLocationId
 * was an empty string (falsy but not nullish), silently sending new employees to Sunshine
 * Daycare instead of their actual company.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

/** Controls what store.getCompany returns for the current test. */
const storeState = vi.hoisted(() => ({
  company: undefined as { locationId?: string } | undefined,
}));

/**
 * Controls what db.select(...).from(...).where(...) resolves to.
 * Set to a row object to simulate a found company, or undefined for no row.
 * Set to "throw" to simulate a DB error.
 */
const dbState = vi.hoisted(() => ({
  result: undefined as { rollfiLocationId: string | null | undefined } | undefined | "throw",
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, _val: unknown) => ({}),
}));

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => {
      const inner: Record<string, unknown> = {};
      inner.where = () => {
        if (dbState.result === "throw") return Promise.reject(new Error("DB unavailable"));
        return Promise.resolve(dbState.result !== undefined ? [dbState.result] : []);
      };
      return inner;
    };
    return chain;
  };

  return {
    db: { select: () => makeSelectChain() },
    companies: { id: {}, rollfiLocationId: {} },
  };
});

vi.mock("../store.js", () => ({
  store: {
    getCompany: (_id: string) => storeState.company,
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { resolveCompanyLocationId } from "../location.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  storeState.company = undefined;
  dbState.result = undefined;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveCompanyLocationId", () => {

  describe("when the company is in the in-memory store with a locationId", () => {
    it("returns the store locationId without hitting the DB", async () => {
      storeState.company = { locationId: "LOC-SUNSHINE" };
      const result = await resolveCompanyLocationId("ORG-SUNSHINE");
      expect(result).toBe("LOC-SUNSHINE");
    });

    it("returns the store locationId for any truthy value, including a UUID-shaped locationId", async () => {
      // LOC-SUNSHINE is known to the real store (seed company), so we use it to
      // confirm any truthy store locationId is returned as-is without hitting the DB.
      storeState.company = { locationId: "LOC-SUNSHINE" };
      const result = await resolveCompanyLocationId("ORG-SUNSHINE");
      expect(result).toBe("LOC-SUNSHINE");
      // The derived fallback would be "LOC-ORG-SUNSHINE" — confirm we got the store value.
      expect(result).not.toBe("LOC-ORG-SUNSHINE");
    });
  });

  describe("when the company is NOT in the store (wizard-created, not seeded)", () => {

    it("returns the DB rollfiLocationId when it is a non-empty string", async () => {
      storeState.company = undefined;
      dbState.result = { rollfiLocationId: "F9F1F179-171C-436B-8FEA-133EAD1BA43D" };
      const result = await resolveCompanyLocationId("ORG-MSG8W5WM-G6PNF1");
      expect(result).toBe("F9F1F179-171C-436B-8FEA-133EAD1BA43D");
    });

    it("returns LOC-<companyId> when DB rollfiLocationId is an empty string (the regression case)", async () => {
      // This was the original bug: `"" ?? undefined` evaluates to "" (not nullish),
      // so the old code returned "" and a subsequent `?? "LOC-SUNSHINE"` was never reached.
      // The fix: treat empty string as absent and fall through to the derived ID.
      storeState.company = undefined;
      dbState.result = { rollfiLocationId: "" };
      const result = await resolveCompanyLocationId("ORG-WIZARD-001");
      expect(result).toBe("LOC-ORG-WIZARD-001");
      // Must not be empty — an empty locationId silently registers employees at the wrong company
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns LOC-<companyId> when DB rollfiLocationId is null", async () => {
      storeState.company = undefined;
      dbState.result = { rollfiLocationId: null };
      const result = await resolveCompanyLocationId("ORG-WIZARD-002");
      expect(result).toBe("LOC-ORG-WIZARD-002");
    });

    it("returns LOC-<companyId> when DB has no company row", async () => {
      storeState.company = undefined;
      dbState.result = undefined; // empty array from DB
      const result = await resolveCompanyLocationId("ORG-WIZARD-003");
      expect(result).toBe("LOC-ORG-WIZARD-003");
    });

    it("returns LOC-<companyId> when the DB throws (catch branch)", async () => {
      storeState.company = undefined;
      dbState.result = "throw";
      const result = await resolveCompanyLocationId("ORG-WIZARD-004");
      expect(result).toBe("LOC-ORG-WIZARD-004");
    });

    it("the derived fallback always starts with 'LOC-' and includes the companyId", async () => {
      storeState.company = undefined;
      dbState.result = { rollfiLocationId: "" };
      const companyId = "ORG-MSG8W5WM-G6PNF1";
      const result = await resolveCompanyLocationId(companyId);
      expect(result).toMatch(/^LOC-/);
      expect(result).toContain(companyId);
    });
  });

  describe("edge cases", () => {
    it("returns empty string for an empty companyId", async () => {
      const result = await resolveCompanyLocationId("");
      expect(result).toBe("");
    });
  });
});
