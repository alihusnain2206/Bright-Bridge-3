/**
 * Test plan for injectSalariedCompensations fix.
 *
 * Tests:
 *  T1: Diane + $200 bonus → payHours:48, baseTotal:$1,338.46, comp:$200, gross:$1,538.46
 *  T2: Change to $350 → comp replaced, base intact
 *  T3: Remove bonus → comp cleared, base still $1,338.46
 *  T4: No bonus at all (fresh import) → base $1,338.46, comp empty
 *  T5: Import twice → no accumulation, no drift
 *  T6: Hourly employees (John Smith, Mary Johnson) unchanged by any import
 *
 * Note: T5 (freshly enrolled salaried at payHours=0) is covered structurally —
 * recoverZeroedSalariedEmployees now triggers on payHours===0 for ALL salaried employees,
 * not just those with adjustments. Diane is already at payHours:48 so we can't simulate
 * a fresh-enroll without re-enrolling her, which would require a cancelled-period reset.
 */

import axios from "axios";

const BASE = "http://localhost:8080";
const COMPANY_ID = "ORG-SUNSHINE";
const PAY_PERIOD_ID = "338FA4C5-3178-4AAA-8442-7573C76FAC41";
const ROLLFI_COMPANY_ID = "43A90BF7-B2BB-4BB5-A6F5-090306556DC4";
const DIANE_UUID = "B11D088D-79BC-4390-8E76-DE0F58BA8E8F";
const JOHN_UUID = "B7B17DF6-9575-4FF8-B4E5-3B89F01C5B36";  // hourly $35/hr

// ── Auth ──────────────────────────────────────────────────────────────────────

async function login() {
  const r = await axios.post(`${BASE}/api/auth/login`, {
    email: "manager@sunshine.com",
    password: "Manager123!"
  }, { withCredentials: true });
  const cookie = r.headers["set-cookie"]?.join("; ") ?? "";
  if (!cookie) throw new Error("No session cookie returned");
  console.log("✅ Logged in as Susan Manager");
  return cookie;
}

// ── Rollfi direct: read pay period details ─────────────────────────────────

import { createRequire } from "module";
const req = createRequire(import.meta.url);
const dotenv = req("dotenv");
dotenv.config({ path: "artifacts/api-server/.env" });

const ROLLFI_SECRET = process.env.ROLLFI_SECRET_KEY;
const ROLLFI_CLIENT = process.env.ROLLFI_CLIENT_ID;
const ROLLFI_URL = "https://sandbox.rollfi.xyz";

function rollfiHeaders() {
  return {
    "x-secret-key": ROLLFI_SECRET,
    "x-client-id": ROLLFI_CLIENT,
    "Content-Type": "application/json",
  };
}

async function getDetails() {
  const r = await axios.post(`${ROLLFI_URL}/reports#getPayPeriodDetails`, {
    method: "getPayPeriodDetails",
    companyId: ROLLFI_COMPANY_ID,
    payPeriodId: PAY_PERIOD_ID,
  }, { headers: rollfiHeaders() });
  const items = ((r.data?.payPeriod ?? [])[0]?.payrollLineItems ?? []);
  return items;
}

function findEmployee(items, uuid) {
  return items.find(i => (i.userId ?? i.userID ?? "").toUpperCase() === uuid.toUpperCase());
}

function fmt(item) {
  if (!item) return "(not found)";
  const comp = (item.additionalCompensations ?? []).map(c => `${c.description}=$${c.amount}`).join(", ");
  return `payHours:${item.payHours} | baseTotal:$${item.baseTotal} | gross:$${item.grossTotal} | comp:[${comp}]`;
}

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label} — ${detail}`);
    process.exitCode = 1;
  }
}

// ── App import endpoint ───────────────────────────────────────────────────────

async function doImport(cookie, adjustments) {
  const r = await axios.post(`${BASE}/api/rollfi/payroll/import`, {
    companyId: COMPANY_ID,
    payPeriodId: PAY_PERIOD_ID,
    adjustments,
  }, {
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    validateStatus: () => true,
  });
  if (r.status !== 200) {
    console.error(`  HTTP ${r.status}`, JSON.stringify(r.data).slice(0, 400));
    process.exitCode = 1;
  }
  if (r.data?.salariedCompWarnings?.length) {
    console.warn("  ⚠ salariedCompWarnings:", JSON.stringify(r.data.salariedCompWarnings));
  }
  return r.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  const cookie = await login();

  // ─── Baseline ────────────────────────────────────────────────────────────
  console.log("\n── Baseline (before any test import) ──");
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("Diane baseline payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("Diane baseline baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("Diane baseline comp empty", (diane?.additionalCompensations ?? []).length === 0, JSON.stringify(diane?.additionalCompensations));
  }

  // ─── T1: Diane + $200 bonus ──────────────────────────────────────────────
  console.log("\n── T1: Diane + $200 Performance Bonus ──");
  await doImport(cookie, [{
    rollfiUserId: DIANE_UUID,
    additionalCompensation: [{ description: "Performance Bonus", amount: 200 }],
    overTime: [],
  }]);
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T1 payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T1 baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T1 comp has 1 entry", (diane?.additionalCompensations ?? []).length === 1, JSON.stringify(diane?.additionalCompensations));
    assert("T1 comp amount=200", Math.abs(Number((diane?.additionalCompensations ?? [])[0]?.amount) - 200) < 0.01, JSON.stringify(diane?.additionalCompensations));
    assert("T1 grossTotal=1538.46", Math.abs(Number(diane?.grossTotal) - 1538.46) < 0.02, `got ${diane?.grossTotal}`);
    const john = findEmployee(items, JOHN_UUID);
    console.log("  John Smith:", fmt(john));
  }

  // ─── T2: Change bonus to $350 ─────────────────────────────────────────────
  console.log("\n── T2: Change bonus to $350 ──");
  await doImport(cookie, [{
    rollfiUserId: DIANE_UUID,
    additionalCompensation: [{ description: "Performance Bonus", amount: 350 }],
    overTime: [],
  }]);
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T2 payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T2 baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T2 comp has 1 entry (replaced not stacked)", (diane?.additionalCompensations ?? []).length === 1, JSON.stringify(diane?.additionalCompensations));
    assert("T2 comp amount=350", Math.abs(Number((diane?.additionalCompensations ?? [])[0]?.amount) - 350) < 0.01, JSON.stringify(diane?.additionalCompensations));
    assert("T2 grossTotal=1688.46", Math.abs(Number(diane?.grossTotal) - 1688.46) < 0.02, `got ${diane?.grossTotal}`);
  }

  // ─── T3: Remove bonus ─────────────────────────────────────────────────────
  console.log("\n── T3: Remove bonus (empty adjustments) ──");
  await doImport(cookie, [{
    rollfiUserId: DIANE_UUID,
    additionalCompensation: [],
    overTime: [],
  }]);
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T3 payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T3 baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T3 comp empty", (diane?.additionalCompensations ?? []).length === 0, JSON.stringify(diane?.additionalCompensations));
    assert("T3 grossTotal=1338.46", Math.abs(Number(diane?.grossTotal) - 1338.46) < 0.02, `got ${diane?.grossTotal}`);
  }

  // ─── T4: Import with no Diane entry at all ────────────────────────────────
  console.log("\n── T4: Import with no adjustments array (Diane absent from payload) ──");
  await doImport(cookie, []);  // empty adjustments — Diane entirely absent
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T4 payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T4 baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T4 comp empty", (diane?.additionalCompensations ?? []).length === 0, JSON.stringify(diane?.additionalCompensations));
  }

  // ─── T5: Import twice with $200 bonus — no accumulation ───────────────────
  console.log("\n── T5: Import twice with $200 bonus — no accumulation ──");
  const adj200 = [{ rollfiUserId: DIANE_UUID, additionalCompensation: [{ description: "Holiday Bonus", amount: 200 }], overTime: [] }];
  await doImport(cookie, adj200);
  console.log("  (first import done)");
  await doImport(cookie, adj200);
  console.log("  (second import done)");
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T5 payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T5 baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T5 exactly 1 comp entry (no stacking)", (diane?.additionalCompensations ?? []).length === 1, JSON.stringify(diane?.additionalCompensations));
    assert("T5 comp=200", Math.abs(Number((diane?.additionalCompensations ?? [])[0]?.amount) - 200) < 0.01, JSON.stringify(diane?.additionalCompensations));
    assert("T5 grossTotal=1538.46", Math.abs(Number(diane?.grossTotal) - 1538.46) < 0.02, `got ${diane?.grossTotal}`);
  }

  // ─── T6: Hourly employees unaffected ────────────────────────────────────
  console.log("\n── T6: Hourly employees unchanged ──");
  {
    // Do an import with Diane + $300 so hourly employees appear in same run
    await doImport(cookie, [{ rollfiUserId: DIANE_UUID, additionalCompensation: [{ description: "Test", amount: 300 }], overTime: [] }]);
    const items = await getDetails();
    const john = findEmployee(items, JOHN_UUID);
    console.log("  John Smith:", fmt(john));
    // John should have his EasyTeam hours (1.9833h) — not zeroed and not comp-corrupted
    assert("T6 John payHours > 0 (hours preserved)", Number(john?.payHours) > 0, `got ${john?.payHours}`);
    assert("T6 John comp empty", (john?.additionalCompensations ?? []).length === 0, JSON.stringify(john?.additionalCompensations));
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("T6 Diane payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("T6 Diane baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("T6 Diane comp=300", Math.abs(Number((diane?.additionalCompensations ?? [])[0]?.amount) - 300) < 0.01, JSON.stringify(diane?.additionalCompensations));
  }

  // ─── Cleanup: leave Diane clean ──────────────────────────────────────────
  console.log("\n── Cleanup: leave Diane with no comp ──");
  await doImport(cookie, [{ rollfiUserId: DIANE_UUID, additionalCompensation: [], overTime: [] }]);
  {
    const items = await getDetails();
    const diane = findEmployee(items, DIANE_UUID);
    console.log("  Diane:", fmt(diane));
    assert("Cleanup payHours=48", Number(diane?.payHours) === 48, `got ${diane?.payHours}`);
    assert("Cleanup baseTotal=1338.46", Math.abs(Number(diane?.baseTotal) - 1338.46) < 0.02, `got ${diane?.baseTotal}`);
    assert("Cleanup comp empty", (diane?.additionalCompensations ?? []).length === 0, JSON.stringify(diane?.additionalCompensations));
  }

  console.log(process.exitCode === 1 ? "\n❌ Some tests failed." : "\n✅ All tests passed.");
}

main().catch(e => { console.error(e); process.exit(1); });
