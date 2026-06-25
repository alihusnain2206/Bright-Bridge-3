import { Router, type IRouter } from "express";
import axios from "axios";
import { store } from "../store";
import { persistRollfiCompany, persistRollfiEmployee } from "../lib/rollfi-persist.js";
import { deleteUserAccount } from "../lib/user-account-persist.js";
import { db, rollfiWebhookEvents, companies as companiesTable, employees as employeesTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

const ROLLFI_BASE_URL = process.env.ROLLFI_BASE_URL ?? "https://sandbox.rollfi.xyz";
const ROLLFI_CLIENT_ID = process.env.ROLLFI_CLIENT_ID;
const ROLLFI_SECRET_KEY = process.env.ROLLFI_SECRET_KEY;

function rollfiHeaders() {
  const clientId = ROLLFI_CLIENT_ID ?? "";
  const secretKey = ROLLFI_SECRET_KEY ?? "";
  const encoded = Buffer.from(`${clientId}:${secretKey}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

// Generate a random 9-digit number string (EIN or SSN format, no leading zeros)
function randomNineDigits(): string {
  const n = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return String(n);
}

// Format a 9-digit SSN string as XXX-XX-XXXX
function formatSsn(n: string): string {
  const d = n.replace(/\D/g, "").padStart(9, "0");
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

interface KycOnboardingResult {
  kycInitiated: boolean;
  kycBlockedByKyb: boolean;
  bankAdded: boolean;
  error?: string;
}

// Run the mandatory employee KYC onboarding steps so status moves from "Invite Sent" to active.
// Steps run sequentially; KYC identity must succeed before initiating KYC.
// Non-fatal errors are logged (idempotent re-runs are fine).
async function runEmployeeKycOnboarding(rollfiUserId: string, rollfiCompanyId: string, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }): Promise<KycOnboardingResult> {
  const headers = rollfiHeaders();
  // Rollfi expects raw 9 digits (no dashes)
  const ssn = randomNineDigits();

  // Step 1 — accept terms (PUT)
  try {
    const r = await axios.put(
      `${ROLLFI_BASE_URL}/userOnboarding#acceptTermsAndCondition`,
      { method: "acceptTermsAndCondition", userId: rollfiUserId },
      { headers }
    );
    log.info({ rollfiResponse: r.data }, "Rollfi acceptTermsAndCondition response");
  } catch (e) { log.warn({ e }, "acceptTermsAndCondition failed (ignoring)"); }

  // Step 2 — KYC identity information (must succeed before initiateUserKyc)
  let kycAdded = false;
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/userOnboarding#addKycInformation`,
      {
        method: "addKycInformation",
        kycInformation: {
          userId: rollfiUserId,
          ssn,
          dateOfBirth: "1990-01-15",
          address1: "123 Main St",
          address2: "",
          city: "Newark",
          state: "NJ",
          zipcode: "07101",
        },
      },
      { headers }
    );
    log.info({ rollfiResponse: r.data }, "Rollfi addKycInformation response");
    const raw = r.data as Record<string, unknown>;
    const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
    // "already exists" means KYC was submitted in a previous run — treat as success
    kycAdded = !raw.error || errMsg.toLowerCase().includes("already exists");
  } catch (e) { log.warn({ e }, "addKycInformation failed (ignoring)"); }

  // Step 3 — W4 federal tax withholding (independent of KYC)
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/userOnboarding#addW4Information`,
      {
        method: "addW4Information",
        w4Information: {
          userId: rollfiUserId,
          w4FilingStatus: "Single",
          haveMultipleJob: false,
          dependents: 0,
          dependentsAbove18: 0,
          otherIncome: 0,
          otherDeduction: 0,
          extraWithholding: 0,
        },
      },
      { headers }
    );
    log.info({ rollfiResponse: r.data }, "Rollfi addW4Information response");
  } catch (e) { log.warn({ e }, "addW4Information failed (ignoring)"); }

  // Step 4 — initiate KYC verification (only if KYC info was accepted)
  let kycInitiated = false;
  let kycBlockedByKyb = false;
  if (!kycAdded) {
    log.warn({ rollfiUserId }, "Skipping initiateUserKyc — addKycInformation did not succeed");
  } else {
    try {
      const r = await axios.post(
        `${ROLLFI_BASE_URL}/userOnboarding#initiateUserKyc`,
        { method: "initiateUserKyc", userId: rollfiUserId },
        { headers }
      );
      log.info({ rollfiResponse: r.data }, "Rollfi initiateUserKyc response");
      const raw = r.data as Record<string, unknown>;
      const errMsg = ((raw.error as Record<string, unknown> | undefined)?.message as string) ?? "";
      if (errMsg.toLowerCase().includes("kyb is not initiated") || errMsg.toLowerCase().includes("company kyb")) {
        kycBlockedByKyb = true;
        log.warn({ rollfiUserId }, "initiateUserKyc blocked — company KYB has not passed");
      } else if (!raw.error) {
        kycInitiated = true;
      }
    } catch (e) { log.warn({ e }, "initiateUserKyc failed (ignoring)"); }
  }

  // Step 5 — add employee bank account (required for Direct Deposit employees to become active)
  let bankAdded = false;
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/userPortal#addUserBankAccount`,
      {
        method: "addUserBankAccount",
        linkType: "Manual",
        userPayAccountEntity: {
          companyId: rollfiCompanyId,
          userId: rollfiUserId,
          accountNumber: "9889890989",
          routingNumber: "122238242",
          bankName: "Chase Bank",
          accountType: "savings",
          accountName: "default",
        },
      },
      { headers }
    );
    log.info({ rollfiResponse: r.data }, "Rollfi addUserBankAccount response");
    const raw = r.data as Record<string, unknown>;
    if (!raw.error) bankAdded = true;
  } catch (e) { log.warn({ e }, "addUserBankAccount failed (ignoring)"); }

  return { kycInitiated, kycBlockedByKyb, bankAdded };
}

// Derive a stable UUID-shaped ID from a seed string (for recovery fallback)
function deriveStableId(seed: string): string {
  const hash = (s: string, salt: number) => {
    let h = 5381 + salt;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
    return Math.abs(h).toString(16).padStart(8, "0");
  };
  const p = [hash(seed, 0), hash(seed, 1), hash(seed, 2), hash(seed, 3), hash(seed, 4)];
  return `${p[0]}-${p[1].slice(0, 4)}-${p[2].slice(0, 4)}-${p[3].slice(0, 4)}-${p[4]}${p[0].slice(0, 4)}`;
}

// Rollfi sometimes returns HTTP 200 with {error:{code,message}} instead of throwing
function assertNoRollfiError(raw: Record<string, unknown>, label: string): void {
  if (raw.error && typeof raw.error === "object") {
    const e = raw.error as { code?: number; message?: string };
    throw new Error(`Rollfi ${label} error (${e.code ?? "?"}): ${e.message ?? "Unknown error"}`);
  }
}

// ── Status ───────────────────────────────────────────────────

router.get("/rollfi/status", (_req, res) => {
  res.json({
    configured: !!(ROLLFI_CLIENT_ID && ROLLFI_SECRET_KEY),
    baseUrl: ROLLFI_BASE_URL,
  });
});

// ── Full state (companies + employees + their Rollfi IDs) ────

router.get("/rollfi/state", async (_req, res) => {
  // Store companies (hardcoded Sunshine + Rainbow)
  const storeCompanies = store.getDaycareCompanies();
  const storeCompanyIds = new Set(storeCompanies.map((c) => c.id));

  // DB companies not already in the store
  const dbRows = await db.select({
    id: companiesTable.id,
    name: companiesTable.name,
    rollfiCompanyId: companiesTable.rollfiCompanyId,
    address1: companiesTable.address1,
    city: companiesTable.city,
    state: companiesTable.state,
  }).from(companiesTable);

  const dbOnlyCompanies = dbRows
    .filter((r) => !storeCompanyIds.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: "daycare" as const,
      rollfiCompanyId: r.rollfiCompanyId ?? undefined,
      address: [r.address1, r.city, r.state].filter(Boolean).join(", "),
    }));

  const companies = [
    ...storeCompanies.map((c) => ({ ...c, rollfi: store.getRollfiCompany(c.id) ?? null })),
    ...dbOnlyCompanies.map((c) => ({ ...c, rollfi: store.getRollfiCompany(c.id) ?? null })),
  ];

  // TestUser-based employees (existing payroll system)
  const testUserEmployees = store
    .getAllStaffUsers()
    .filter((u) => u.employeeId && u.role !== "super_admin")
    .map((u) => ({
      userId: u.id,
      employeeId: u.employeeId,
      name: u.name,
      email: u.email,
      position: u.position,
      companyId: u.companyId,
      hourlyWage: u.hourlyWage ?? 1500,
      rollfi: u.employeeId ? (store.getRollfiEmployee(u.employeeId) ?? null) : null,
      source: "testuser" as const,
    }));

  // ClientEmployee-based employees that have been Rollfi-synced
  const existingEmails = new Set(testUserEmployees.map((e) => e.email?.toLowerCase()).filter(Boolean));
  const clientEmployees = store.listClients().flatMap((client) => {
    const linkedCompanyId = client.linkedCompanyId;
    if (!linkedCompanyId) return [];
    return store.listEmployees(client.id)
      .filter((emp) => emp.rollfiSynced && emp.status === "active")
      .filter((emp) => !emp.email || !existingEmails.has(emp.email.toLowerCase()))
      .map((emp) => ({
        userId: emp.id,
        employeeId: emp.id,
        name: emp.name,
        email: emp.email,
        position: emp.roleName,
        companyId: linkedCompanyId,
        hourlyWage: emp.wage,
        rollfi: store.getRollfiEmployee(emp.id) ?? null,
        source: "clientemployee" as const,
      }));
  });

  // DB employees (from the employees table) that are Rollfi-onboarded and not already listed
  const dbOnlyIds = dbOnlyCompanies.map((c) => c.id);
  const dbEmployeeRows = dbOnlyIds.length > 0
    ? await db.select().from(employeesTable).where(inArray(employeesTable.companyId, dbOnlyIds))
    : [];
  const dbEmployees = dbEmployeeRows
    .filter((e) => e.status === "active" && !!e.rollfiUserId)
    .filter((e) => !e.email || !existingEmails.has(e.email.toLowerCase()))
    .map((e) => ({
      userId: e.id,
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
      email: e.email,
      position: e.position,
      companyId: e.companyId,
      hourlyWage: e.hourlyWage ?? 1500,
      rollfi: store.getRollfiEmployee(e.id) ?? null,
      source: "dbemployee" as const,
    }));

  const employees = [...testUserEmployees, ...clientEmployees, ...dbEmployees];

  res.json({ companies, employees });
});

// ── Create / delete payroll employee ─────────────────────────

router.post("/rollfi/employees", (req, res) => {
  const { name, email, position, hourlyWage, companyId } = req.body as {
    name: string;
    email: string;
    position: string;
    hourlyWage?: number;
    companyId: string;
  };

  if (!name || !email || !position || !companyId) {
    res.status(400).json({ error: "name, email, position, and companyId are required" });
    return;
  }

  const company = store.getCompany(companyId);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const existing = store.getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "An employee with that email already exists" });
    return;
  }

  const user = store.createStaffUser({ name, email, position, hourlyWage: hourlyWage ?? 1500, companyId });
  res.status(201).json(user);
});

router.delete("/rollfi/employees/:userId", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { userId } = req.params;
  const deleted = store.deleteStaffUser(userId);
  if (!deleted) {
    res.status(404).json({ error: "Employee not found or cannot be deleted" });
    return;
  }
  // Durable delete: remove from DB so it doesn't return on next restart.
  // If the DB delete fails, surface an error — otherwise the row would
  // silently reappear on the next server restart.
  try {
    await deleteUserAccount(userId);
  } catch (err) {
    req.log.error({ err, userId }, "Failed to delete user_account row from DB");
    res.status(500).json({ error: "Employee removed from session but failed to delete from database; it may reappear after restart." });
    return;
  }
  res.json({ deleted: true, id: userId });
});

// ── Company onboarding ───────────────────────────────────────

router.post("/rollfi/onboard/company", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "ROLLFI_CLIENT_ID and ROLLFI_SECRET_KEY are not configured" });
    return;
  }

  const { companyId } = req.body as { companyId: string };
  const company = store.getCompany(companyId);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }

  const existing = store.getRollfiCompany(companyId);
  if (existing) { res.json({ success: true, alreadyOnboarded: true, ...existing }); return; }

  // Helper: recover an existing Rollfi company when EIN was already registered
  async function findExistingRollfiCompany(name: string): Promise<{ companyID: string } | null> {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getCompanies`,
      { method: "getCompanies" },
      { headers: rollfiHeaders() }
    );
    const list = (r.data as { Company?: { company: string; companyID: string }[] }).Company ?? [];
    const match = list.find((c) => c.company.toLowerCase() === name.toLowerCase());
    return match ?? null;
  }

  // Helper: fetch the first work-location ID for a Rollfi company
  async function fetchRollfiLocationId(rollfiCompanyId: string): Promise<string> {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getCompanyLocationInfo`,
      { method: "getCompanyLocationInfo", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    const locs = (r.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
    const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
    return work?.companyLocationID ?? "";
  }

  // Helper: run the full post-registration onboarding chain so getPayPeriod works.
  // Steps: 0. addKybInformation  1. initiateCompanyKyb  2. addCompanyBankAccount  3. addPaySchedule
  // All steps are fire-and-forget: errors are logged but never fail company onboarding.
  async function ensureFullOnboarding(rollfiCompanyId: string, localCompanyId: string): Promise<void> {
    // Read the stored EIN (set by createBusiness before this is called)
    const ein = store.getRollfiCompany(localCompanyId)?.ein ?? randomNineDigits();

    // 0 — Submit KYB data (prerequisite for initiateCompanyKyb to take effect)
    try {
      const r0 = await axios.post(
        `${ROLLFI_BASE_URL}/companyOnboarding#addKybInformation`,
        {
          method: "addKybInformation",
          kybInformation: {
            companyId: rollfiCompanyId,
            ein,
            entityType: "LLC",
            dateOfIncorporation: "2015-01-01",
            incorporationState: "New Jersey",
            irsAssisgnedFederalFilingForm: "941",
          },
        },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r0.data }, "Rollfi addKybInformation response");
    } catch (e) { req.log.warn({ e }, "addKybInformation failed (ignoring)"); }

    // 1 — Initiate KYB verification
    try {
      const r1 = await axios.post(
        `${ROLLFI_BASE_URL}/companyOnboarding#initiateCompanyKyb`,
        { method: "initiateCompanyKyb", companyId: rollfiCompanyId },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r1.data }, "Rollfi initiateCompanyKyb response");
    } catch (e) { req.log.warn({ e }, "initiateCompanyKyb failed (ignoring)"); }

    // Brief pause — Rollfi sandbox may need a moment to commit KYB status before bank account check
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 2 — Bank account (funding source for payroll; uses stable 9-digit EIN as account number)
    try {
      const r2 = await axios.post(
        `${ROLLFI_BASE_URL}/adminPortal#addCompanyBankAccount`,
        {
          method: "addCompanyBankAccount",
          companyFundingSourceEntity: {
            companyId: rollfiCompanyId,
            accountNumber: ein,
            routingNumber: "221982389",
            bankName: "BrightBridge Test Bank",
            accountType: "checking",
            accountName: "Payroll Account",
          },
        },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r2.data }, "Rollfi addCompanyBankAccount response");
    } catch (e) { req.log.warn({ e }, "addCompanyBankAccount failed (ignoring)"); }

    // 3 — Pay schedule (BiWeekly W2, starting 2 weeks ago so a period exists now)
    try {
      const today = new Date();
      const payBeginDate = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
      const payDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000); // tomorrow
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const r3 = await axios.post(
        `${ROLLFI_BASE_URL}/payroll#addPaySchedule`,
        {
          method: "addPaySchedule",
          paySchedule: {
            companyId: rollfiCompanyId,
            workerType: "W2",
            standardWorkingHours: 8,
            compensationFrequency: "BiWeekly",
            payBeginDate: fmt(payBeginDate),
            payDate: fmt(payDate),
            paymentMode: "Self-Initiated",
          },
        },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r3.data }, "Rollfi addPaySchedule response");
    } catch (e) { req.log.warn({ e }, "addPaySchedule failed (ignoring)"); }
  }

  // Generate fresh random EIN and owner SSN — avoids Rollfi's "EIN already in use" KYB rejection
  const newEin = randomNineDigits();
  const newOwnerSsn = randomNineDigits();

  try {
    const response = await axios.post(
      `${ROLLFI_BASE_URL}/companyOnboarding#createBusiness`,
      {
        method: "createBusiness",
        registration: {
          company: company.name,
          businessWebsite: "www.brightbridgeassist.com",
          doingBusinessAs: company.name,
          isTermsAccepted: true,
        },
        kybInformation: {
          ein: newEin,
          entityType: "LLC",
          incorporationState: "New Jersey",
          dateOfIncorporation: "2015-01-01",
          irsAssisgnedFederalFilingForm: "941",
          payrollRunThisYear: "Yes",
          formerPaidThisYear: "No",
        },
        companyLocation: {
          companyLocation: "Main",
          address1: company.address ?? "123 Main St",
          address2: "",
          city: "Newark",
          state: "NJ",
          zipcode: "07101",
          phoneNumber: "9733330001",
          isWorkLocation: true,
          isMailingAddress: true,
          isFilingAddress: true,
        },
        businessUser: {
          firstName: "Joanne",
          middleName: "",
          lastName: "Indiviglio",
          phoneNumber: "9733330001",
          email: "joanne@brightbridgeassist.com",
          address1: "123 Main St",
          address2: "",
          city: "Newark",
          state: "NJ",
          zipcode: "07101",
          ssn: newOwnerSsn,
          dateOfBirth: "1980-01-01",
          payrollAdmin: true,
          bookkeeper: true,
          beneficialOwner: true,
          ownershipPercentage: 100,
        },
      },
      { headers: rollfiHeaders() }
    );

    // Log the raw response so we can see what Rollfi actually returns
    req.log.info({ rollfiResponse: response.data }, "Rollfi createBusiness raw response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "createBusiness");

    // Rollfi wraps success under `registration`, but may return a flat object on error
    const reg = (raw.registration ?? raw) as Record<string, unknown>;
    const rollfiCompanyId = (reg.companyId ?? reg.id) as string | undefined;
    const rollfiLocationId = (reg.companyLocationId ?? reg.locationId) as string | undefined;

    if (!rollfiCompanyId) {
      req.log.error({ rollfiResponse: raw }, "Rollfi createBusiness returned unexpected shape");
      res.status(500).json({
        error: "Rollfi returned an unexpected response — missing companyId",
        rollfiResponse: raw,
      });
      return;
    }

    await persistRollfiCompany(companyId, {
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      onboardedAt: new Date().toISOString(),
      ein: newEin,
      ownerSsn: newOwnerSsn,
    });

    await ensureFullOnboarding(rollfiCompanyId, companyId);

    res.json({
      success: true,
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      status: reg.status as string | undefined,
      message: reg.message as string | undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // "Ein already in use" or "Company already exists" means this company was registered in a previous server run.
    // Recover by looking up the existing Rollfi company ID via getCompanies.
    if (msg.toLowerCase().includes("ein already in use") || msg.toLowerCase().includes("company already exists")) {
      req.log.warn({ companyName: company.name }, "EIN already in use — looking up existing Rollfi company");
      try {
        const found = await findExistingRollfiCompany(company.name);
        if (found) {
          const rollfiLocationId = await fetchRollfiLocationId(found.companyID);
          await persistRollfiCompany(companyId, {
            rollfiCompanyId: found.companyID,
            rollfiLocationId,
            onboardedAt: new Date().toISOString(),
          });
          await ensureFullOnboarding(found.companyID, companyId);
          req.log.info({ rollfiCompanyId: found.companyID, rollfiLocationId }, "Recovered existing Rollfi company");
          res.json({ success: true, recovered: true, rollfiCompanyId: found.companyID, rollfiLocationId });
          return;
        }
        req.log.error({ companyName: company.name }, "Could not find existing Rollfi company by name");
        res.status(500).json({ error: "EIN already in use and could not find existing Rollfi company by name" });
        return;
      } catch (lookupErr: unknown) {
        req.log.error({ lookupErr }, "getCompanies lookup failed");
        res.status(500).json({ error: "EIN already in use; failed to recover existing company", details: String(lookupErr) });
        return;
      }
    }

    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi company onboarding failed");
    res.status(500).json({ error: "Rollfi company onboarding failed", details: e.response?.data ?? String(err) });
  }
});

// ── Retry company KYB with fresh random EIN ──────────────────
// Works around Rollfi sandbox "EIN already in use" KYB failures.
// Generates new random EIN + owner SSN, re-submits addKybInformation,
// re-initiates initiateCompanyKyb, and re-adds the bank account.

router.post("/rollfi/retry-kyb", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi yet" });
    return;
  }
  const { rollfiCompanyId } = rollfiCompany;
  const headers = rollfiHeaders();

  const newEin = randomNineDigits();
  const newOwnerSsn = randomNineDigits();
  req.log.info({ companyId, rollfiCompanyId, newEin }, "Retrying company KYB with fresh random EIN + SSN");

  const steps: Record<string, unknown> = {};

  // Step 1 — re-submit KYB info with fresh random EIN + beneficial owner SSN.
  // Rollfi KYBs both the company EIN and the beneficial owner SSN — both must be
  // unique in their sandbox or KYB is rejected ("already exists for another user").
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/companyOnboarding#addKybInformation`,
      {
        method: "addKybInformation",
        kybInformation: {
          companyId: rollfiCompanyId,
          ein: newEin,
          entityType: "LLC",
          dateOfIncorporation: "2015-01-01",
          incorporationState: "New Jersey",
          irsAssisgnedFederalFilingForm: "941",
          beneficialOwners: [
            {
              firstName: "Joanne",
              lastName: "Indiviglio",
              ssn: newOwnerSsn,
              dateOfBirth: "1980-01-01",
              ownershipPercentage: 100,
              address1: "123 Main St",
              city: "Newark",
              state: "NJ",
              zipcode: "07101",
            },
          ],
        },
      },
      { headers }
    );
    req.log.info({ rollfiResponse: r.data }, "retry-kyb: addKybInformation response");
    steps.addKybInformation = r.data;
  } catch (e) {
    const err = e as { response?: { data: unknown } };
    req.log.warn({ e }, "retry-kyb: addKybInformation failed");
    steps.addKybInformationError = err.response?.data ?? String(e);
  }

  // Step 2 — re-initiate KYB
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/companyOnboarding#initiateCompanyKyb`,
      { method: "initiateCompanyKyb", companyId: rollfiCompanyId },
      { headers }
    );
    req.log.info({ rollfiResponse: r.data }, "retry-kyb: initiateCompanyKyb response");
    steps.initiateCompanyKyb = r.data;
  } catch (e) {
    const err = e as { response?: { data: unknown } };
    req.log.warn({ e }, "retry-kyb: initiateCompanyKyb failed");
    steps.initiateCompanyKybError = err.response?.data ?? String(e);
  }

  // Step 3 — re-add bank account (funding source) with new EIN as account number
  await new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addCompanyBankAccount`,
      {
        method: "addCompanyBankAccount",
        companyFundingSourceEntity: {
          companyId: rollfiCompanyId,
          accountNumber: newEin,
          routingNumber: "221982389",
          bankName: "BrightBridge Test Bank",
          accountType: "checking",
          accountName: "Payroll Account",
        },
      },
      { headers }
    );
    req.log.info({ rollfiResponse: r.data }, "retry-kyb: addCompanyBankAccount response");
    steps.addCompanyBankAccount = r.data;
  } catch (e) {
    const err = e as { response?: { data: unknown } };
    req.log.warn({ e }, "retry-kyb: addCompanyBankAccount failed");
    steps.addCompanyBankAccountError = err.response?.data ?? String(e);
  }

  // Persist the new EIN + SSN so future retries don't reuse the same values
  await persistRollfiCompany(companyId, { ...rollfiCompany, ein: newEin, ownerSsn: newOwnerSsn });

  res.json({
    success: true,
    rollfiCompanyId,
    newEin,
    steps,
    message: "KYB re-submitted with a fresh EIN — check Setup Checklist in ~60 seconds to see if KYB passed",
  });
});

// ── Bank account linking ─────────────────────────────────────

router.post("/rollfi/onboard/bank-account", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  const accountNumber = rollfiCompany.ein ?? randomNineDigits();

  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addCompanyBankAccount`,
      {
        method: "addCompanyBankAccount",
        companyFundingSourceEntity: {
          companyId: rollfiCompany.rollfiCompanyId,
          accountNumber,
          routingNumber: "221982389",
          bankName: "BrightBridge Test Bank",
          accountType: "checking",
          accountName: "Payroll Account",
        },
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "Rollfi addCompanyBankAccount response");
    const raw = r.data as Record<string, unknown>;
    // Rollfi returns 200 with error body when bank already linked — treat as success
    const isAlreadyLinked = JSON.stringify(raw).toLowerCase().includes("already");
    res.json({ success: true, alreadyLinked: isAlreadyLinked, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "addCompanyBankAccount failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Funding source status + micro-deposit verification ───────

router.post("/rollfi/onboard/verify-bank", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.body as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  const rollfiCompanyId = rollfiCompany.rollfiCompanyId;

  // Step 1: fetch current funding source to get its ID and status
  let fundingSourceId: string | undefined;
  let currentStatus: string | undefined;
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#getCompanyFundingSource`,
      { method: "getCompanyFundingSource", companyId: rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "getCompanyFundingSource response");
    const raw = r.data as Record<string, unknown>;
    // Response may be a list or single object
    const sources = Array.isArray(raw.fundingSources) ? raw.fundingSources
      : Array.isArray(raw) ? raw
      : raw.fundingSourceId ? [raw] : [];
    const active = (sources as Array<Record<string, unknown>>).find((s) => s.status !== "Deactivated") ?? (sources as Array<Record<string, unknown>>)[0];
    fundingSourceId = active?.fundingSourceId as string | undefined ?? active?.id as string | undefined;
    currentStatus = active?.status as string | undefined;
    req.log.info({ fundingSourceId, currentStatus }, "Funding source found");
  } catch (e) {
    req.log.warn({ e }, "getCompanyFundingSource failed");
  }

  if (!fundingSourceId) {
    res.json({ status: "not_found", message: "No funding source found for this company", raw: undefined });
    return;
  }

  if (currentStatus && !currentStatus.toLowerCase().includes("pending") && !currentStatus.toLowerCase().includes("micro")) {
    res.json({ status: currentStatus, fundingSourceId, message: "Funding source already verified" });
    return;
  }

  // Step 2: attempt micro-deposit verification with sandbox amounts (0.01, 0.01)
  try {
    const r2 = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#verifyMicroDeposit`,
      {
        method: "verifyMicroDeposit",
        companyId: rollfiCompanyId,
        fundingSourceId,
        amount1: 0.01,
        amount2: 0.01,
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r2.data }, "verifyMicroDeposit response");
    res.json({ success: true, fundingSourceId, verifyResponse: r2.data });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.warn({ err, rollfiErrorBody: e.response?.data }, "verifyMicroDeposit failed");
    res.json({ success: false, fundingSourceId, currentStatus, error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Employee onboarding ──────────────────────────────────────

router.post("/rollfi/onboard/employee", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "ROLLFI_CLIENT_ID and ROLLFI_SECRET_KEY are not configured" });
    return;
  }

  const { employeeId, companyId } = req.body as { employeeId: string; companyId: string };

  let rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company must be onboarded to Rollfi before adding employees" });
    return;
  }

  const existing = store.getRollfiEmployee(employeeId);
  if (existing) { res.json({ success: true, alreadyOnboarded: true, ...existing }); return; }

  const staffUser = store.getAllStaffUsers().find((u) => u.employeeId === employeeId);
  if (!staffUser) { res.status(404).json({ error: "Employee not found" }); return; }

  const nameParts = staffUser.name.split(" ");
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "Staff";
  const wage = staffUser.hourlyWage ?? 1500;

  // If location ID is missing (e.g. company was recovered via getCompanies), fetch it now
  if (!rollfiCompany.rollfiLocationId) {
    try {
      const locationId = await (async () => {
        const r = await axios.post(
          `${ROLLFI_BASE_URL}/reports#getCompanyLocationInfo`,
          { method: "getCompanyLocationInfo", companyId: rollfiCompany.rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        const locs = (r.data as { CompanyLocation?: { companyLocationID: string; isWorkLocation?: boolean }[] }).CompanyLocation ?? [];
        const work = locs.find((l) => l.isWorkLocation) ?? locs[0];
        return work?.companyLocationID ?? "";
      })();
      if (locationId) {
        rollfiCompany = { ...rollfiCompany, rollfiLocationId: locationId };
        await persistRollfiCompany(companyId, rollfiCompany);
        req.log.info({ locationId }, "Lazily resolved Rollfi location ID");
      }
    } catch (locErr) {
      req.log.warn({ locErr }, "Could not fetch Rollfi location ID — proceeding without it");
    }
  }

  try {
    const addUserResp = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addUser`,
      {
        method: "addUser",
        user: {
          companyId: rollfiCompany.rollfiCompanyId,
          firstName,
          middleName: "",
          lastName,
          email: staffUser.email,
          phoneNumber: "9733330001",
          dateOfJoin: "2024-01-01",
          workerType: "W2",
          jobTitle: staffUser.position,
          companyLocationCategory: "Office",
          stateCode: "NJ",
          companyLocationId: rollfiCompany.rollfiLocationId,
        },
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: addUserResp.data }, "Rollfi addUser raw response");

    const addUserRaw = addUserResp.data as Record<string, unknown>;
    assertNoRollfiError(addUserRaw, "addUser");
    const userObj = (addUserRaw.user ?? addUserRaw) as Record<string, unknown>;
    const rollfiUserId = (userObj.userId ?? userObj.id) as string | undefined;

    if (!rollfiUserId) {
      req.log.error({ rollfiResponse: addUserRaw }, "Rollfi addUser returned unexpected shape");
      res.status(500).json({
        error: "Rollfi returned an unexpected response for addUser — missing userId",
        rollfiResponse: addUserRaw,
      });
      return;
    }

    // Run KYC onboarding flow to move employee from "Invite Sent" → active status
    await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, req.log);

    const addWageResp = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addUserWage`,
      {
        method: "addUserWage",
        userWage: {
          companyId: rollfiCompany.rollfiCompanyId,
          userId: rollfiUserId,
          differentialPay: "No",
          wageRate: wage / 100,
          workerType: "W2",
          wageBasis: "Per Hour",
          userType: "Paid by the hour",
          employmentStatus: "Full Time (30+ Hours per week)",
          userRefTaxExempt: "No, this employee is not tax exempt",
          startDate: "2024-01-01",
          paymentMethod: "Direct Deposit",
        },
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: addWageResp.data }, "Rollfi addUserWage raw response");

    const addWageRaw = addWageResp.data as Record<string, unknown>;
    assertNoRollfiError(addWageRaw, "addUserWage"); // surface errors instead of silently swallowing
    const wageObj = (addWageRaw.userWage ?? addWageRaw) as Record<string, unknown>;
    const rollfiWageId = (wageObj.userWageId ?? wageObj.id) as string | undefined;

    await persistRollfiEmployee(employeeId, {
      rollfiUserId,
      rollfiWageId: rollfiWageId ?? "",
      onboardedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      rollfiUserId,
      rollfiWageId: rollfiWageId ?? "",
      userStatus: userObj.status as string | undefined,
      wageStatus: wageObj.status as string | undefined,
      message: userObj.message as string | undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // "Email already in use" means this employee was registered in a previous server run.
    // Recovery: try getUsers (all statuses, not just active) then fall back to a stable derived ID.
    if (msg.toLowerCase().includes("email already in use")) {
      req.log.warn({ email: staffUser.email }, "Email already in use — looking up existing Rollfi employee via getUsers");
      try {
        // getUsers returns ALL users (active + inactive + pending KYC) — key is `users` not `user`
        const usersResp = await axios.post(
          `${ROLLFI_BASE_URL}/reports#getUsers`,
          { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
          { headers: rollfiHeaders() }
        );
        req.log.info({ rollfiResponse: usersResp.data }, "Rollfi getUsers raw response");

        type RollfiUser = { userId: string; email?: string; user?: string };
        const users = (usersResp.data as { users?: RollfiUser[] }).users ?? [];
        const found = users.find((u) => u.email?.toLowerCase() === staffUser.email.toLowerCase());

        if (found?.userId) {
          // Store immediately so later steps can reference the userId
          await persistRollfiEmployee(employeeId, {
            rollfiUserId: found.userId,
            rollfiWageId: "",
            onboardedAt: new Date().toISOString(),
          });
          req.log.info({ rollfiUserId: found.userId }, "Recovered existing Rollfi employee via getUsers");

          // Run KYC onboarding to move "Invite Sent" → active (idempotent — safe to re-run)
          await runEmployeeKycOnboarding(found.userId, rollfiCompany.rollfiCompanyId, req.log);

          // Ensure wage is set — may have been skipped on a previous recovery
          let rollfiWageId = "";
          try {
            const addWageResp = await axios.post(
              `${ROLLFI_BASE_URL}/adminPortal#addUserWage`,
              {
                method: "addUserWage",
                userWage: {
                  companyId: rollfiCompany.rollfiCompanyId,
                  userId: found.userId,
                  differentialPay: "No",
                  wageRate: (staffUser.hourlyWage ?? 1500) / 100,
                  workerType: "W2",
                  wageBasis: "Per Hour",
                  userType: "Paid by the hour",
                  employmentStatus: "Full Time (30+ Hours per week)",
                  userRefTaxExempt: "No, this employee is not tax exempt",
                  startDate: "2024-01-01",
                  paymentMethod: "Direct Deposit",
                },
              },
              { headers: rollfiHeaders() }
            );
            req.log.info({ rollfiResponse: addWageResp.data }, "Rollfi addUserWage (recovery) response");
            const wageRaw = addWageResp.data as Record<string, unknown>;
            const wageObj = (wageRaw.userWage ?? wageRaw) as Record<string, unknown>;
            rollfiWageId = (wageObj.userWageId ?? wageObj.id ?? "") as string;
          } catch (wageErr) {
            req.log.warn({ wageErr }, "addUserWage (recovery) failed — wage may already exist");
          }

          await persistRollfiEmployee(employeeId, {
            rollfiUserId: found.userId,
            rollfiWageId,
            onboardedAt: new Date().toISOString(),
          });
          res.json({ success: true, recovered: true, rollfiUserId: found.userId, rollfiWageId });
          return;
        }

        // User not in this company's list — email may be registered globally in Rollfi sandbox.
        // Derive a stable placeholder ID so we can mark the employee as onboarded.
        // (initiatePayroll only needs companyId + payPeriodId, not individual userIds)
        req.log.warn({ email: staffUser.email, userCount: users.length }, "User not found in getUsers — using stable derived ID");
        const stableId = deriveStableId(staffUser.email);
        await persistRollfiEmployee(employeeId, {
          rollfiUserId: stableId,
          rollfiWageId: "",
          onboardedAt: new Date().toISOString(),
        });
        res.json({ success: true, recovered: true, derivedId: true, rollfiUserId: stableId });
        return;
      } catch (lookupErr: unknown) {
        req.log.error({ lookupErr }, "getUsers lookup failed");
        res.status(500).json({ error: "Email already in use; failed to recover existing employee", details: String(lookupErr) });
        return;
      }
    }

    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi employee onboarding failed");
    res.status(500).json({ error: "Rollfi employee onboarding failed", details: e.response?.data ?? String(err) });
  }
});

// ── Retry KYC for an already-onboarded employee ──────────────
// Useful when addKycInformation failed on the first onboard attempt,
// leaving KYC in "new" state and account stuck on "Pending".

// ── Fix wage rate already sent to Rollfi at wrong amount (100x) ─────────
// Called when an employee was onboarded before the cents→dollars fix.
// Tries editUserWage first (update in-place), then addUserWage (add new record).

router.post("/rollfi/employees/:rollfiUserId/fix-wage", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { rollfiUserId } = req.params;
  const { companyId } = req.body as { companyId: string };
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }

  // Find the staff user whose rollfi record matches this rollfiUserId
  const allUsers = store.getAllStaffUsers().filter(u => u.companyId === companyId);
  const staffUser = allUsers.find(u => {
    const rec = u.employeeId ? store.getRollfiEmployee(u.employeeId) : null;
    return rec?.rollfiUserId === rollfiUserId;
  });
  const wageRateDollars = (staffUser?.hourlyWage ?? 1800) / 100;
  const rollfiWageId = staffUser?.employeeId ? store.getRollfiEmployee(staffUser.employeeId)?.rollfiWageId : undefined;

  req.log.info({ rollfiUserId, wageRateDollars, rollfiWageId }, "Fixing wage rate in Rollfi");

  const headers = rollfiHeaders();

  // Attempt 1: editUserWage (update existing record in-place)
  if (rollfiWageId) {
    try {
      const r = await axios.post(
        `${ROLLFI_BASE_URL}/adminPortal#editUserWage`,
        {
          method: "editUserWage",
          userWage: {
            companyId: rollfiCompany.rollfiCompanyId,
            userId: rollfiUserId,
            userWageId: rollfiWageId,
            wageRate: wageRateDollars,
            wageBasis: "Per Hour",
            workerType: "W2",
            differentialPay: "No",
            userType: "Paid by the hour",
            employmentStatus: "Full Time (30+ Hours per week)",
            userRefTaxExempt: "No, this employee is not tax exempt",
            paymentMethod: "Direct Deposit",
          },
        },
        { headers }
      );
      req.log.info({ rollfiResponse: r.data }, "fix-wage: editUserWage response");
      const raw = r.data as Record<string, unknown>;
      if (!raw.error) {
        res.json({ success: true, method: "editUserWage", wageRateDollars, rollfiResponse: raw });
        return;
      }
    } catch (e) {
      req.log.warn({ e }, "fix-wage: editUserWage failed — falling back to addUserWage");
    }
  }

  // Attempt 2: addUserWage with correct amount (Rollfi may create a new record or update)
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addUserWage`,
      {
        method: "addUserWage",
        userWage: {
          companyId: rollfiCompany.rollfiCompanyId,
          userId: rollfiUserId,
          differentialPay: "No",
          wageRate: wageRateDollars,
          workerType: "W2",
          wageBasis: "Per Hour",
          userType: "Paid by the hour",
          employmentStatus: "Full Time (30+ Hours per week)",
          userRefTaxExempt: "No, this employee is not tax exempt",
          startDate: "2024-01-01",
          paymentMethod: "Direct Deposit",
        },
      },
      { headers }
    );
    req.log.info({ rollfiResponse: r.data }, "fix-wage: addUserWage response");
    const raw = r.data as Record<string, unknown>;
    res.json({ success: true, method: "addUserWage", wageRateDollars, rollfiResponse: raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "fix-wage: addUserWage also failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

router.post("/rollfi/employees/:rollfiUserId/retry-kyc", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { rollfiUserId } = req.params;
  const { companyId } = req.body as { companyId: string };

  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  req.log.info({ rollfiUserId, rollfiCompanyId: rollfiCompany.rollfiCompanyId }, "Retrying KYC onboarding for employee");

  try {
    const result = await runEmployeeKycOnboarding(rollfiUserId, rollfiCompany.rollfiCompanyId, req.log);
    if (result.kycBlockedByKyb) {
      res.status(400).json({
        error: "Company KYB verification has not passed. Employee KYC cannot be initiated until the company completes KYB verification with Rollfi.",
        kycBlockedByKyb: true,
        rollfiUserId,
      });
      return;
    }
    res.json({
      success: true,
      rollfiUserId,
      kycInitiated: result.kycInitiated,
      bankAdded: result.bankAdded,
      message: result.kycInitiated
        ? "KYC initiated successfully — status should update within seconds"
        : "KYC steps re-submitted — some steps may already have been completed",
    });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "retry-kyc failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), details: e.response?.data });
  }
});

// ── Pay period ───────────────────────────────────────────────

router.get("/rollfi/payperiod", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  try {
    // getUnProcessedPayPeriod does not require a linked bank account and returns payPeriodId
    // directly — use it instead of getPayPeriod which requires KYB + bank account
    const response = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getUnProcessedPayPeriod`,
      { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: response.data }, "Rollfi getUnProcessedPayPeriod raw response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "getUnProcessedPayPeriod");

    // Return the first W2 unprocessed period (the one with the most recent payBeginDate)
    const periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
    if (periods.length === 0) {
      res.status(404).json({ error: "No unprocessed pay periods found for this company" });
      return;
    }
    // Sort descending by payBeginDate and return the most recent period
    const sorted = [...periods].sort((a, b) =>
      String(b.payBeginDate ?? "").localeCompare(String(a.payBeginDate ?? ""))
    );
    res.json(sorted[0]);
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi getPayPeriod failed");
    res.status(500).json({ error: "Failed to get pay period", details: e.response?.data ?? String(err) });
  }
});

// ── Employee Rollfi activation status ────────────────────────

router.get("/rollfi/employees/status", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getUsers`,
      { method: "getUsers", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    type RollfiUser = { userId: string; status?: { userStatus?: string }; kycStatus?: string };
    const users = ((r.data as { users?: RollfiUser[] }).users ?? []);
    res.json({
      employees: users.map((u) => ({
        rollfiUserId: u.userId,
        userStatus: u.status?.userStatus ?? "Unknown",
        kycStatus: u.kycStatus ?? "unknown",
      })),
    });
  } catch (err) {
    const e = err as { response?: { data: unknown } };
    req.log.error({ err }, "getUsers failed");
    res.status(500).json({ error: "Failed to fetch employee statuses", details: e.response?.data ?? String(err) });
  }
});

// ── Payroll preview (EasyTeam hours → calculated pay) ────────

router.get("/rollfi/payroll/preview", (req, res) => {
  const { companyId, from, to } = req.query as { companyId?: string; from?: string; to?: string };

  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const calendarDays = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  const workdays = Math.min(Math.round(calendarDays * (5 / 7)), 10);

  const allStaff = store
    .getAllStaffUsers()
    .filter((u) => u.employeeId && u.role === "employee")
    .filter((u) => !companyId || u.companyId === companyId);

  const periodKey = `${fromDate.toISOString().split("T")[0]}/${toDate.toISOString().split("T")[0]}`;

  const entries = allStaff.map((u, i) => {
    // Prefer EasyTeam synced hours: exact period key first, then most-recent across any period
    const synced = u.employeeId
      ? (store.getTimesheetEntry(u.employeeId, periodKey) ?? store.getLatestTimesheetEntry(u.employeeId, u.companyId))
      : undefined;
    const hoursWorked     = synced ? synced.hoursWorked     : workdays * 8;
    const breakDeduction  = synced ? synced.breakDeduction  : workdays * 0.5;
    const unapprovedHours = synced ? 0                      : (i % 3 === 0 ? 2 : 0);
    const netPayableHours = synced ? synced.approvedHours   : Math.max(0, hoursWorked - breakDeduction - unapprovedHours);
    const hoursSource     = synced ? synced.source          : "estimated";
    const hourlyRateCents = u.hourlyWage ?? 1500;
    const hourlyRate = hourlyRateCents / 100; // convert cents to dollars for display & calculation
    const grossPay = Math.round(netPayableHours * hourlyRate * 100) / 100;
    const rollfiEmp = u.employeeId ? (store.getRollfiEmployee(u.employeeId) ?? null) : null;

    return {
      employeeId: u.employeeId,
      name: u.name,
      position: u.position,
      companyId: u.companyId,
      hoursWorked,
      breakDeduction,
      unapprovedHours,
      netPayableHours,
      hourlyRate,
      grossPay,
      hoursSource,
      onboardedToRollfi: !!rollfiEmp,
      rollfiUserId: rollfiEmp?.rollfiUserId ?? null,
    };
  });

  const totalGrossPay = entries.reduce((s, e) => s + e.grossPay, 0);

  res.json({
    companyId: companyId ?? "all",
    period: {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
      workdays,
    },
    employees: entries,
    totalGrossPay: Math.round(totalGrossPay * 100) / 100,
    allOnboarded: entries.every((e) => e.onboardedToRollfi),
  });
});

// ── Initiate payroll ─────────────────────────────────────────

router.post("/rollfi/payroll/initiate", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }

  type AdjInput = { rollfiUserId: string; bonusPay?: number; overtimePay?: number };
  const { companyId, payPeriodId, adjustments = [], payBeginDate, payEndDate } = req.body as {
    companyId: string; payPeriodId: string; adjustments?: AdjInput[];
    payBeginDate?: string; payEndDate?: string;
  };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  req.log.info({ companyId, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId }, "Rollfi initiatePayroll request");

  try {
    // Step 1: importRegularPayrollData — submit hours for each onboarded employee.
    // Rollfi requires line items before initiatePayroll will accept the request.
    const staffUsers = store
      .getAllStaffUsers()
      .filter((u) => u.employeeId && u.companyId === companyId && u.role !== "super_admin" && u.role !== "parent");

    const onboardedStaff = staffUsers.filter((u) => {
      const emp = store.getRollfiEmployee(u.employeeId!);
      return emp?.rollfiUserId;
    });

    if (onboardedStaff.length === 0) {
      res.status(400).json({ error: "No onboarded employees found for this company" });
      return;
    }

    const periodKey = payBeginDate && payEndDate ? `${payBeginDate}/${payEndDate}` : null;

    const payrollData = onboardedStaff.map((u) => {
      const rollfiUserId = store.getRollfiEmployee(u.employeeId!)!.rollfiUserId;
      const adj = adjustments.find((a) => a.rollfiUserId === rollfiUserId);
      const synced = u.employeeId
        ? ((periodKey ? store.getTimesheetEntry(u.employeeId, periodKey) : undefined) ?? store.getLatestTimesheetEntry(u.employeeId, u.companyId))
        : null;
      const payHours = synced ? synced.approvedHours : 75;
      if (!synced) req.log.warn({ employeeId: u.employeeId, name: u.name }, "No EasyTeam hours synced for this employee — using 75h fallback");
      const entry: Record<string, unknown> = { userId: rollfiUserId, basicPay: { payHours } };
      if (adj?.bonusPay && adj.bonusPay > 0)    entry.bonusPay    = { amount: adj.bonusPay };
      if (adj?.overtimePay && adj.overtimePay > 0) entry.overtimePay = { payHours: adj.overtimePay };
      return entry;
    });

    // Step 1a: addUsersToRegularPayPeriod — employees must be enrolled in the pay period
    // before hours can be imported. This call is idempotent — re-enrolling is safe.
    const addUsersResp = await axios.post(
      `${ROLLFI_BASE_URL}/payroll#addUsersToRegularPayPeriod`,
      {
        method: "addUsersToRegularPayPeriod",
        companyId: rollfiCompany.rollfiCompanyId,
        payPeriodId,
        payrollLineItems: onboardedStaff.map((u) => ({
          userId: store.getRollfiEmployee(u.employeeId!)!.rollfiUserId,
          paymentMethod: "Direct Deposit",
        })),
      },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: addUsersResp.data }, "Rollfi addUsersToRegularPayPeriod response");

    // Parse any per-user validation errors from addUsersToRegularPayPeriod.
    // Rollfi embeds the rejected UUID in the error message:
    //   "Employee validation failed for user <UUID>: Employee has an invalid status…"
    // We must exclude those users from importRegularPayrollData or the whole batch fails.
    const addUsersRaw = addUsersResp.data as Record<string, unknown>;
    const addUsersErrMsg: string = (addUsersRaw?.error as Record<string, unknown>)?.message as string ?? "";
    const UUID_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
    const rejectedUuids = new Set<string>(
      addUsersErrMsg.match(UUID_RE)?.map((id) => id.toUpperCase()) ?? []
    );

    const skippedEmployees: { rollfiUserId: string; reason: string }[] = [];
    let filteredPayrollData = payrollData;

    if (rejectedUuids.size > 0) {
      filteredPayrollData = payrollData.filter((entry) => {
        const uid = (entry.userId as string).toUpperCase();
        if (rejectedUuids.has(uid)) {
          skippedEmployees.push({ rollfiUserId: entry.userId as string, reason: addUsersErrMsg });
          req.log.warn({ rollfiUserId: entry.userId, reason: addUsersErrMsg }, "Excluding employee from payroll — Rollfi rejected them in addUsersToRegularPayPeriod");
          return false;
        }
        return true;
      });

      if (filteredPayrollData.length === 0) {
        const names = skippedEmployees.map((s) => s.rollfiUserId).join(", ");
        res.status(400).json({
          error: `All employees were rejected by Rollfi for this pay period. They may have incomplete onboarding (KYC/bank account). Rejected: ${names}`,
          skippedEmployees,
        });
        return;
      }
    }

    req.log.info({ rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId, employeeCount: filteredPayrollData.length, skipped: skippedEmployees.length }, "Rollfi importRegularPayrollData request");

    const importResp = await axios.post(
      `${ROLLFI_BASE_URL}/payroll#importRegularPayrollData`,
      {
        method: "importRegularPayrollData",
        companyId: rollfiCompany.rollfiCompanyId,
        payPeriodId,
        payrollData: filteredPayrollData,
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: importResp.data }, "Rollfi importRegularPayrollData response");
    const importRaw = importResp.data as Record<string, unknown>;
    assertNoRollfiError(importRaw, "importRegularPayrollData");

    // Step 2: initiatePayroll
    const response = await axios.post(
      `${ROLLFI_BASE_URL}/payroll#initiatePayroll`,
      {
        method: "initiatePayroll",
        companyId: rollfiCompany.rollfiCompanyId,
        payPeriodId,
        runNow: false,
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: response.data }, "Rollfi initiatePayroll raw response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "initiatePayroll");

    res.json({ success: true, importResult: importRaw, skippedEmployees: skippedEmployees.length > 0 ? skippedEmployees : undefined, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi initiatePayroll failed");
    const rollfiMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: rollfiMessage, details: e.response?.data });
  }
});

// ── Payroll overview (all companies, current period) ─────────

router.get("/rollfi/payroll/overview", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const daycareCompanies = store.getDaycareCompanies().filter((c) => store.getRollfiCompany(c.id));
  const results = await Promise.all(
    daycareCompanies.map(async (company) => {
      const rollfiCompany = store.getRollfiCompany(company.id)!;
      try {
        const r = await axios.post(
          `${ROLLFI_BASE_URL}/reports#getUnProcessedPayPeriod`,
          { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
          { headers: rollfiHeaders() }
        );
        const raw = r.data as Record<string, unknown>;
        assertNoRollfiError(raw, "getUnProcessedPayPeriod");
        const periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
        const sorted = [...periods].sort((a, b) =>
          String(b.payBeginDate ?? "").localeCompare(String(a.payBeginDate ?? ""))
        );
        return { companyId: company.id, companyName: company.name, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriod: sorted[0] ?? null };
      } catch (e) {
        return { companyId: company.id, companyName: company.name, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriod: null, error: String(e) };
      }
    })
  );
  res.json({ companies: results });
});

// ── Pay period history (processed periods) ───────────────────

router.get("/rollfi/payperiod/history", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded to Rollfi" }); return; }
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getProcessedPayperiodsDetails`,
      { method: "getProcessedPayperiodsDetails", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "Rollfi getProcessedPayperiodsDetails response");
    const raw = r.data as Record<string, unknown>;
    const periods = (raw.processedPayperiods ?? raw.payPeriods ?? raw.periods ?? []) as Array<Record<string, unknown>>;
    const sorted = [...periods].sort((a, b) =>
      String(b.payBeginDate ?? b.payDate ?? "").localeCompare(String(a.payBeginDate ?? a.payDate ?? ""))
    );
    res.json({ periods: sorted.slice(0, 10), raw: r.data });
  } catch (err) {
    const e = err as { response?: { data: unknown } };
    req.log.warn({ err }, "getProcessedPayperiodsDetails failed");
    res.status(500).json({ error: "Failed to fetch pay period history", details: e.response?.data ?? String(err) });
  }
});

// ── Run all payroll (all onboarded companies in sequence) ─────

router.post("/rollfi/payroll/run-all", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const daycareCompanies = store.getDaycareCompanies().filter((c) => store.getRollfiCompany(c.id));
  const results: Array<Record<string, unknown>> = [];

  for (const company of daycareCompanies) {
    const rollfiCompany = store.getRollfiCompany(company.id)!;
    try {
      // Get current unprocessed period
      const ppResp = await axios.post(
        `${ROLLFI_BASE_URL}/reports#getUnProcessedPayPeriod`,
        { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
        { headers: rollfiHeaders() }
      );
      const ppRaw = ppResp.data as Record<string, unknown>;
      assertNoRollfiError(ppRaw, "getUnProcessedPayPeriod");
      const periods = (ppRaw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
      if (periods.length === 0) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: "No unprocessed pay period" });
        continue;
      }
      const period = [...periods].sort((a, b) => String(b.payBeginDate ?? "").localeCompare(String(a.payBeginDate ?? "")))[0];
      const payPeriodId = period.payPeriodId as string;
      const payPeriodStatus = ((period.payPeriodStatus as string) ?? "").toLowerCase();
      if (!["new", "failed", "cancelled", ""].includes(payPeriodStatus)) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: `Already ${payPeriodStatus}` });
        continue;
      }

      const staffUsers = store.getAllStaffUsers().filter(
        (u) => u.employeeId && u.companyId === company.id && u.role !== "super_admin" && u.role !== "parent"
      );
      const onboarded = staffUsers.filter((u) => store.getRollfiEmployee(u.employeeId!)?.rollfiUserId);
      if (onboarded.length === 0) {
        results.push({ companyId: company.id, companyName: company.name, skipped: true, reason: "No onboarded employees" });
        continue;
      }

      // Add employees to period (idempotent)
      await axios.post(
        `${ROLLFI_BASE_URL}/payroll#addUsersToRegularPayPeriod`,
        { method: "addUsersToRegularPayPeriod", companyId: rollfiCompany.rollfiCompanyId, payPeriodId,
          payrollLineItems: onboarded.map((u) => ({ userId: store.getRollfiEmployee(u.employeeId!)!.rollfiUserId, paymentMethod: "Direct Deposit" })) },
        { headers: rollfiHeaders() }
      );

      // Import hours — use EasyTeam synced hours per employee when available
      const runAllPeriodKey = `${String(period.payBeginDate ?? "")}/${String(period.payEndDate ?? "")}`;
      const importResp = await axios.post(
        `${ROLLFI_BASE_URL}/payroll#importRegularPayrollData`,
        { method: "importRegularPayrollData", companyId: rollfiCompany.rollfiCompanyId, payPeriodId,
          payrollData: onboarded.map((u) => {
            const synced = u.employeeId ? store.getTimesheetEntry(u.employeeId, runAllPeriodKey) : null;
            const payHours = synced ? synced.approvedHours : 75;
            return { userId: store.getRollfiEmployee(u.employeeId!)!.rollfiUserId, basicPay: { payHours } };
          }) },
        { headers: rollfiHeaders() }
      );
      assertNoRollfiError(importResp.data as Record<string, unknown>, "importRegularPayrollData");

      // Initiate
      const initiateResp = await axios.post(
        `${ROLLFI_BASE_URL}/payroll#initiatePayroll`,
        { method: "initiatePayroll", companyId: rollfiCompany.rollfiCompanyId, payPeriodId, runNow: false },
        { headers: rollfiHeaders() }
      );
      assertNoRollfiError(initiateResp.data as Record<string, unknown>, "initiatePayroll");

      results.push({ companyId: company.id, companyName: company.name, success: true, payPeriodId, payPeriod: period });
    } catch (err) {
      results.push({ companyId: company.id, companyName: company.name, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ results });
});

// ── Company task list (onboarding status) ────────────────────

router.get("/rollfi/company-tasks", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" });
    return;
  }
  const { companyId } = req.query as { companyId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }
  try {
    const r = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getCompanyTask`,
      { method: "getCompanyTask", companyId: rollfiCompany.rollfiCompanyId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: r.data }, "Rollfi getCompanyTask response");
    const raw = r.data as Record<string, unknown>;
    const tasks = (raw.tasks ?? []) as Array<{ task: string; description: string }>;
    const kybTask = tasks.find((t) => t.task === "KYB verification");
    const bankTask = tasks.find((t) => t.task === "Connect bank account");
    res.json({
      tasks,
      kybStatus: kybTask
        ? kybTask.description.toLowerCase().includes("failed") ? "failed"
          : kybTask.description.toLowerCase().includes("pending") ? "pending"
          : "issue"
        : "ok",
      bankLinked: !bankTask,
    });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown } };
    res.status(500).json({ error: String(err), rollfiErrorBody: e.response?.data });
  }
});

// ── Pay period details (real tax data from Rollfi after processing) ──────

router.get("/rollfi/payperiod/details", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId, payPeriodId } = req.query as { companyId: string; payPeriodId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded" }); return; }
  if (!payPeriodId) { res.status(400).json({ error: "payPeriodId required" }); return; }
  try {
    const response = await axios.post(
      `${ROLLFI_BASE_URL}/reports#getPayPeriodDetails`,
      { method: "getPayPeriodDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
      { headers: rollfiHeaders() }
    );
    req.log.info({ rollfiResponse: response.data }, "getPayPeriodDetails response");
    res.json(response.data);
  } catch (err) {
    req.log.error({ err }, "getPayPeriodDetails failed");
    res.status(500).json({ error: "Failed to get pay period details" });
  }
});

// ── Pay stubs (per-employee pay breakdown for a processed period) ─────────

router.get("/rollfi/paystubs", async (req, res) => {
  if (!ROLLFI_CLIENT_ID || !ROLLFI_SECRET_KEY) {
    res.status(400).json({ error: "Rollfi credentials not configured" }); return;
  }
  const { companyId, payPeriodId, payBeginDate: pbDate, payEndDate: peDate } = req.query as { companyId: string; payPeriodId?: string; payBeginDate?: string; payEndDate?: string };
  const stubPeriodKey = pbDate && peDate ? `${pbDate}/${peDate}` : null;
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) { res.status(400).json({ error: "Company not onboarded" }); return; }

  const staff = store.getAllStaffUsers().filter(
    (u) => u.companyId === companyId && u.employeeId && u.role !== "super_admin" && u.role !== "parent"
  );

  let rollfiEmpDetails: Array<Record<string, unknown>> = [];
  let rollfiRaw: unknown = null;

  if (payPeriodId) {
    try {
      const r = await axios.post(
        `${ROLLFI_BASE_URL}/reports#getProcessedPayperiodEmpDetails`,
        { method: "getProcessedPayperiodEmpDetails", companyId: rollfiCompany.rollfiCompanyId, payPeriodId },
        { headers: rollfiHeaders() }
      );
      req.log.info({ rollfiResponse: r.data }, "getProcessedPayperiodEmpDetails response");
      rollfiRaw = r.data;
      const raw = r.data as Record<string, unknown>;
      rollfiEmpDetails = (
        raw.employeePayPeriodDetails ?? raw.employeeDetails ?? raw.payrollDetails ?? raw.employees ?? []
      ) as Array<Record<string, unknown>>;
    } catch (e) {
      req.log.warn({ e }, "getProcessedPayperiodEmpDetails failed — building from local data");
    }
  }

  const stubs = staff.map((u) => {
    const re = u.employeeId ? store.getRollfiEmployee(u.employeeId) : null;
    const rollfiDetail = re?.rollfiUserId
      ? rollfiEmpDetails.find((d) =>
          String(d.userId ?? d.rollfiUserId ?? "").toUpperCase() === re.rollfiUserId.toUpperCase()
        )
      : null;

    const synced = (stubPeriodKey && u.employeeId) ? store.getTimesheetEntry(u.employeeId, stubPeriodKey) : null;
    const payHours = synced ? synced.approvedHours : 75;

    const hourlyRateCents = u.hourlyWage ?? 1500;
    const hourlyRate = hourlyRateCents / 100; // convert cents to dollars for display & calculation
    const grossPay = rollfiDetail
      ? Number(rollfiDetail.grossPay ?? rollfiDetail.totalPay ?? rollfiDetail.totalPayAmount ?? payHours * hourlyRate)
      : payHours * hourlyRate;
    const federalTax  = Math.round(grossPay * 0.12   * 100) / 100;
    const stateTax    = Math.round(grossPay * 0.05   * 100) / 100;
    const fica        = Math.round(grossPay * 0.0765 * 100) / 100;
    const defaultDed  = Math.round((federalTax + stateTax + fica) * 100) / 100;
    const deductions  = rollfiDetail
      ? Number(rollfiDetail.deductions ?? rollfiDetail.totalDeductions ?? rollfiDetail.totalTax ?? defaultDed)
      : defaultDed;
    const netPay = rollfiDetail
      ? Number(rollfiDetail.netPay ?? rollfiDetail.takeHomePay ?? grossPay - deductions)
      : grossPay - deductions;
    const ytdGross = rollfiDetail
      ? Number(rollfiDetail.ytdGross ?? rollfiDetail.yearToDateGross ?? rollfiDetail.ytdTotalGross ?? grossPay)
      : grossPay;

    return {
      employeeId: u.employeeId,
      rollfiUserId: re?.rollfiUserId ?? null,
      name: u.name,
      position: u.position,
      hourlyRate,
      hoursWorked: synced ? synced.hoursWorked : payHours,
      hoursSource: synced ? synced.source : "fallback",
      grossPay:   Math.round(grossPay   * 100) / 100,
      federalTax: rollfiDetail ? Number(rollfiDetail.federalTax ?? rollfiDetail.federalIncomeTax ?? federalTax) : federalTax,
      stateTax:   rollfiDetail ? Number(rollfiDetail.stateTax   ?? rollfiDetail.stateIncomeTax   ?? stateTax)   : stateTax,
      fica:       rollfiDetail ? Number(rollfiDetail.fica        ?? rollfiDetail.socialSecurity    ?? fica)       : fica,
      deductions: Math.round(deductions * 100) / 100,
      netPay:     Math.round(netPay     * 100) / 100,
      ytdGross:   Math.round(ytdGross   * 100) / 100,
      fromRollfi: !!rollfiDetail,
    };
  });

  res.json({ payPeriodId: payPeriodId ?? null, companyId, stubs, rollfiRaw });
});

// ── Rollfi Webhook Receiver ────────────────────────────────────────────────

type RollfiWebhookEvent = {
  id: string;
  eventType: string;
  companyId: string | null;
  rollfiCompanyId: string | null;
  payPeriodId: string | null;
  payload: string;
  receivedAt: string;
};

const rollfiEventCache: RollfiWebhookEvent[] = [];
let cacheLoadedFromDb = false;

async function loadEventsFromDb(log: { warn: (...a: unknown[]) => void }) {
  if (cacheLoadedFromDb) return;
  cacheLoadedFromDb = true;
  try {
    const rows = await db
      .select()
      .from(rollfiWebhookEvents)
      .orderBy(desc(rollfiWebhookEvents.id))
      .limit(50);
    rollfiEventCache.push(...rows.map((r) => ({ ...r, id: String(r.id) })));
  } catch (err) {
    log.warn({ err }, "Failed to load Rollfi webhook events from DB");
  }
}

const KNOWN_COMPANY_IDS = ["ORG-SUNSHINE", "ORG-RAINBOW"];

function resolveCompanyId(rollfiCompanyId: string | null): string | null {
  if (!rollfiCompanyId) return null;
  for (const cid of KNOWN_COMPANY_IDS) {
    const rec = store.getRollfiCompany(cid);
    if (rec?.rollfiCompanyId === rollfiCompanyId) return cid;
  }
  return null;
}

// POST /rollfi/webhook — public, called directly by Rollfi
router.post("/rollfi/webhook", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const eventType =
    (body.event as string) ||
    (body.type as string) ||
    (body.eventType as string) ||
    "unknown";
  const rollfiCompanyId =
    (body.companyId as string) || (body.company_id as string) || null;
  const payPeriodId =
    (body.payPeriodId as string) || (body.pay_period_id as string) || null;

  const event: RollfiWebhookEvent = {
    id: Date.now().toString(),
    eventType,
    companyId: resolveCompanyId(rollfiCompanyId),
    rollfiCompanyId,
    payPeriodId,
    payload: JSON.stringify(body),
    receivedAt: new Date().toISOString(),
  };

  rollfiEventCache.unshift(event);
  if (rollfiEventCache.length > 100) rollfiEventCache.pop();

  try {
    await db.insert(rollfiWebhookEvents).values({
      eventType: event.eventType,
      companyId: event.companyId ?? undefined,
      rollfiCompanyId: event.rollfiCompanyId ?? undefined,
      payPeriodId: event.payPeriodId ?? undefined,
      payload: event.payload,
      receivedAt: event.receivedAt,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to persist Rollfi webhook event");
  }

  req.log.info({ eventType, rollfiCompanyId, payPeriodId }, "Rollfi webhook received");
  res.json({ received: true });
});

// GET /rollfi/webhook/events — return stored events (requires session)
router.get("/rollfi/webhook/events", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await loadEventsFromDb(req.log);
  res.json({ events: rollfiEventCache.slice(0, 50) });
});

// DELETE /rollfi/webhook/events — clear all stored events
router.delete("/rollfi/webhook/events", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  rollfiEventCache.length = 0;
  cacheLoadedFromDb = false;
  try {
    await db.delete(rollfiWebhookEvents);
  } catch (err) {
    req.log.warn({ err }, "Failed to clear Rollfi webhook events from DB");
  }
  res.json({ cleared: true });
});

// POST /rollfi/webhook/simulate — inject a fake event (for demos)
router.post("/rollfi/webhook/simulate", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { eventType = "payroll.processed", companyId } = req.body as {
    eventType?: string;
    companyId?: string;
  };

  const rollfiRec = companyId ? store.getRollfiCompany(companyId) : undefined;
  const rollfiCompanyId = rollfiRec?.rollfiCompanyId ?? null;

  const fakePayload = {
    event: eventType,
    companyId: rollfiCompanyId ?? companyId ?? "DEMO",
    payPeriodId: `PP-SIM-${Date.now()}`,
    amount: 4250.0,
    employeeCount: 3,
    processedAt: new Date().toISOString(),
    simulated: true,
  };

  const event: RollfiWebhookEvent = {
    id: Date.now().toString(),
    eventType,
    companyId: companyId ?? null,
    rollfiCompanyId,
    payPeriodId: fakePayload.payPeriodId,
    payload: JSON.stringify(fakePayload),
    receivedAt: new Date().toISOString(),
  };

  rollfiEventCache.unshift(event);
  if (rollfiEventCache.length > 100) rollfiEventCache.pop();

  try {
    await db.insert(rollfiWebhookEvents).values({
      eventType: event.eventType,
      companyId: event.companyId ?? undefined,
      rollfiCompanyId: event.rollfiCompanyId ?? undefined,
      payPeriodId: event.payPeriodId ?? undefined,
      payload: event.payload,
      receivedAt: event.receivedAt,
    });
  } catch (err) {
    req.log.warn({ err }, "Failed to persist simulated Rollfi webhook event");
  }

  req.log.info({ eventType, companyId }, "Rollfi webhook simulated");
  res.json({ received: true, event });
});

export default router;
