import { Router, type Request, type Response, type IRouter } from "express";
import axios from "axios";
import { db, companies, employees, beneficialOwners, rollfiCompanyRecords, userAccounts, stateRegistrations as stateRegistrationsTable, onboardingTasks as onboardingTasksTable } from "@workspace/db";
import { buildStateRegistrationPayload } from "../lib/rollfi-state-fields.js";
import { eq, and } from "drizzle-orm";
import { store } from "../store.js";
import { syncEmployeeToIntegrations } from "../lib/employee-onboard.js";
import { persistUserAccount } from "../lib/user-account-persist.js";
import { createOnboardingTasksInDb, createComplianceItemsInDb, generateDisplayIdFromExisting, seedDepartmentsForCompany, logPeopleActivity, calculateComplianceScore, calculateReadinessFlags } from "./people.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";

const router: IRouter = Router();

function rollfiHeaders() {
  const { clientId, secretKey } = getRollfiConfig();
  const encoded = Buffer.from(`${clientId ?? ""}:${secretKey ?? ""}`).toString("base64");
  return { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
}

function getBaseUrl(): string { return getRollfiConfig().baseUrl; }

function randomNineDigits(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

function assertNoRollfiError(raw: Record<string, unknown>, label: string): void {
  if (raw.error && typeof raw.error === "object") {
    const e = raw.error as { code?: number; message?: string };
    throw new Error(`Rollfi ${label} error (${e.code ?? "?"}): ${e.message ?? "Unknown error"}`);
  }
}

function maskAcct(n: string): string {
  return `****${String(n).slice(-4)}`;
}

interface CompanyBankInput {
  bankName?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
}

function validateBankDetails(b: CompanyBankInput): string | null {
  if (!b.routingNumber || !/^\d{9}$/.test(b.routingNumber)) return "Routing number must be exactly 9 digits";
  if (!b.accountNumber || !/^\d{4,17}$/.test(b.accountNumber.replace(/\D/g, ""))) return "Account number must be 4–17 digits";
  if (!b.bankName?.trim()) return "Bank name is required";
  if (b.accountType !== "checking" && b.accountType !== "savings") return "Account type must be checking or savings";
  return null;
}

async function ensureFullOnboarding(
  rollfiCompanyId: string,
  ein: string,
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
  payScheduleParams?: { payFrequency: string; payBeginDate: string; payDate: string; workerType: string },
  bankInput?: CompanyBankInput,
): Promise<void> {
  try {
    await axios.post(`${getBaseUrl()}/companyOnboarding#addKybInformation`, {
      method: "addKybInformation",
      kybInformation: { companyId: rollfiCompanyId, ein, entityType: "LLC", dateOfIncorporation: "2015-01-01", incorporationState: "New Jersey", irsAssisgnedFederalFilingForm: "941" },
    }, { headers: rollfiHeaders() });
  } catch (e) { log.warn({ e }, "addKybInformation failed"); }

  try {
    await axios.post(`${getBaseUrl()}/companyOnboarding#initiateCompanyKyb`, { method: "initiateCompanyKyb", companyId: rollfiCompanyId }, { headers: rollfiHeaders() });
  } catch (e) { log.warn({ e }, "initiateCompanyKyb failed"); }

  await new Promise((r) => setTimeout(r, 2000));

  try {
    const isProduction = getRollfiConfig().env === "production";
    const bank = (isProduction && bankInput?.routingNumber && bankInput?.accountNumber)
      ? { accountNumber: bankInput.accountNumber, routingNumber: bankInput.routingNumber, bankName: bankInput.bankName ?? "Payroll Funding", accountType: bankInput.accountType ?? "checking", accountName: "Payroll Funding" }
      : { accountNumber: ein, routingNumber: "221982389", bankName: "BrightBridge Test Bank", accountType: "checking", accountName: "Payroll Account" };
    log.info({ env: getRollfiConfig().env, bankName: bank.bankName, maskedAcct: maskAcct(bank.accountNumber), maskedRouting: maskAcct(bank.routingNumber) }, "addCompanyBankAccount: using bank details");
    await axios.post(`${getBaseUrl()}/adminPortal#addCompanyBankAccount`, {
      method: "addCompanyBankAccount",
      companyFundingSourceEntity: { companyId: rollfiCompanyId, accountNumber: bank.accountNumber, routingNumber: bank.routingNumber, bankName: bank.bankName, accountType: bank.accountType, accountName: bank.accountName },
    }, { headers: rollfiHeaders() });
  } catch (e) { log.warn({ e }, "addCompanyBankAccount failed"); }

  try {
    const compensationFrequency = payScheduleParams?.payFrequency ?? "BiWeekly";
    // Expected gap in days per frequency — Rollfi infers the period from the date gap, NOT compensationFrequency
    const expectedGapDays: Record<string, number> = { Weekly: 7, BiWeekly: 14, SemiMonthly: 15, Monthly: 30 };
    const gapDays = expectedGapDays[compensationFrequency] ?? 14;
    const fmtDate = (d: Date) => d.toISOString().split("T")[0];
    const today = new Date();
    // Always anchor to today: payBeginDate = today - gap, payDate = today
    // Rollfi infers the period from the date gap and rejects future payDates
    const payBeginDate = fmtDate(new Date(today.getTime() - gapDays * 86_400_000));
    const payDate = fmtDate(today);
    const workerType = payScheduleParams?.workerType === "1099-NEC" ? "1099" : "W2";
    log.info({ rollfiCompanyId, compensationFrequency, payBeginDate, payDate, workerType }, "ensureFullOnboarding: setting pay schedule");
    // Try update first (company may already have a schedule); fall back to add
    let scheduleSet = false;
    try {
      const upd = await axios.post(`${getBaseUrl()}/payroll#updatePaySchedule`, {
        method: "updatePaySchedule",
        paySchedule: { companyId: rollfiCompanyId, workerType, compensationFrequency, payBeginDate, payDate, paymentMode: "Self-Initiated", standardWorkingHours: 8 },
      }, { headers: rollfiHeaders() });
      const updData = upd.data as Record<string, unknown>;
      if (!updData.error) { scheduleSet = true; log.info({ rollfiCompanyId, compensationFrequency, payBeginDate, payDate, workerType, via: "update", rollfiResponse: updData }, "Pay schedule set in Rollfi"); }
      else { log.warn({ rollfiResponse: updData }, "updatePaySchedule returned error body, trying add"); }
    } catch (_) { /* fall through to add */ }
    if (!scheduleSet) {
      const add = await axios.post(`${getBaseUrl()}/payroll#addPaySchedule`, {
        method: "addPaySchedule",
        paySchedule: { companyId: rollfiCompanyId, workerType, compensationFrequency, payBeginDate, payDate, paymentMode: "Self-Initiated", standardWorkingHours: 8 },
      }, { headers: rollfiHeaders() });
      const addData = add.data as Record<string, unknown>;
      if (addData.error) {
        log.warn({ rollfiCompanyId, compensationFrequency, payBeginDate, payDate, rollfiResponse: addData }, "addPaySchedule returned error body — pay schedule NOT set");
      } else {
        log.info({ rollfiCompanyId, compensationFrequency, payBeginDate, payDate, workerType, via: "add", rollfiResponse: addData }, "Pay schedule set in Rollfi");
      }
    }
  } catch (e) { log.warn({ e }, "addPaySchedule failed"); }
}

// ── GET /api/companies ───────────────────────────────────────

router.get("/companies", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller) { res.status(401).json({ error: "User not found" }); return; }

  try {
    let rows;
    if (caller.role === "super_admin") {
      rows = await db.select().from(companies);
    } else {
      rows = await db.select().from(companies).where(eq(companies.id, caller.companyId));
    }
    const enriched = rows.map((c) => ({ ...c, rollfi: store.getRollfiCompany(c.id) ?? null }));
    res.json({ companies: enriched });
  } catch (err) {
    req.log.error({ err }, "Failed to list companies");
    res.status(500).json({ error: "Failed to list companies" });
  }
});

// ── GET /api/companies/:companyId ─────────────────────────────

router.get("/companies/:companyId", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.params.companyId);
  try {
    const [row] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!row) { res.status(404).json({ error: "Company not found" }); return; }
    const empRows = await db.select().from(employees).where(eq(employees.companyId, companyId));
    res.json({ ...row, rollfi: store.getRollfiCompany(companyId) ?? null, employeeCount: empRows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to get company");
    res.status(500).json({ error: "Failed to get company" });
  }
});

// ── GET /api/companies/:companyId/onboarding-status ──────────

router.get("/companies/:companyId/onboarding-status", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.params.companyId);
  try {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) { res.status(404).json({ error: "Company not found" }); return; }
    const rollfi = store.getRollfiCompany(companyId);
    const empRows = await db.select().from(employees).where(eq(employees.companyId, companyId));
    res.json({
      companyId,
      name: company.name,
      steps: {
        brightbridgeAccount: { done: true, label: "BrightBridge account" },
        rollfiRegistered:    { done: !!rollfi, label: "Rollfi payroll registration" },
        kybVerification:     { done: company.kybStatus === "verified", pending: company.kybStatus === "pending", label: "KYB business verification" },
        bankAccount:         { done: company.bankAccountAdded, label: "Company bank account" },
        paySchedule:         { done: company.payScheduleAdded, label: "Pay schedule configured" },
        employees:           { done: empRows.length > 0, count: empRows.length, label: "Employees added" },
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get onboarding status");
    res.status(500).json({ error: "Failed to get onboarding status" });
  }
});

// ── POST /api/companies ──────────────────────────────────────

router.post("/companies", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin access required" }); return; }

  const body = req.body as {
    companyName: string; doingBusinessAs?: string; businessWebsite?: string; phone: string;
    industry: string; package: string;
    address1: string; address2?: string; city: string; state: string; zipcode: string; locationName?: string;
    ownerFirstName: string; ownerLastName: string; ownerEmail: string; ownerPhone: string;
    ownerDob: string; ownerSsn: string; ownerAddress1: string; ownerCity: string; ownerState: string; ownerZip: string;
    ownershipPercentage: number; isPayrollAdmin: boolean;
    entityType: string; ein?: string; incorporationState: string; dateOfIncorporation: string; irsFilingForm: string;
    payrollRunThisYear: string;
    payFrequency: string; payBeginDate: string; payDate: string; workerType: string;
    fundingBankName?: string; fundingRoutingNumber?: string; fundingAccountNumber?: string; fundingAccountType?: string;
    stateTaxRegistrations?: Array<{
      stateCode: string; stateName: string; fieldValues: Record<string, string>;
    }>;
  };

  if (!body.companyName || !body.address1 || !body.city || !body.state || !body.zipcode) {
    res.status(400).json({ error: "Company name and address are required" });
    return;
  }

  if (getRollfiConfig().env === "production") {
    const bankErr = validateBankDetails({
      routingNumber: body.fundingRoutingNumber,
      accountNumber: body.fundingAccountNumber,
      bankName: body.fundingBankName,
      accountType: body.fundingAccountType,
    });
    if (bankErr) { res.status(400).json({ error: `Company funding account: ${bankErr}` }); return; }
  }

  const now = new Date().toISOString();
  const companyId = `ORG-${uid().toUpperCase()}`;
  const useEin = body.ein?.replace(/\D/g, "") || randomNineDigits();
  const ownerSsn = body.ownerSsn?.replace(/\D/g, "") || randomNineDigits();

  try {
    // 1. Save company to DB
    await db.insert(companies).values({
      id: companyId,
      name: body.companyName,
      doingBusinessAs: body.doingBusinessAs,
      businessWebsite: body.businessWebsite,
      phone: body.phone,
      industry: body.industry,
      package: body.package,
      status: "setting_up",
      address1: body.address1,
      address2: body.address2,
      city: body.city,
      state: body.state,
      zipcode: body.zipcode,
      locationName: body.locationName ?? body.companyName,
      ein: useEin,
      fundingBankName: body.fundingBankName,
      fundingAccountLast4: body.fundingAccountNumber ? body.fundingAccountNumber.slice(-4) : null,
      fundingAccountType: body.fundingAccountType,
      kybStatus: "not_started",
      bankAccountAdded: false,
      payScheduleAdded: false,
      payFrequency: body.payFrequency,
      firstPayDate: body.payDate,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Save beneficial owner
    await db.insert(beneficialOwners).values({
      companyId,
      firstName: body.ownerFirstName,
      lastName: body.ownerLastName,
      email: body.ownerEmail,
      phone: body.ownerPhone,
      dateOfBirth: body.ownerDob,
      ssn: ownerSsn,
      address1: body.ownerAddress1,
      city: body.ownerCity,
      state: body.ownerState,
      zipcode: body.ownerZip,
      ownershipPercentage: body.ownershipPercentage ?? 100,
      isPayrollAdmin: body.isPayrollAdmin ?? true,
    });

    req.log.info({ companyId, name: body.companyName }, "Company created in DB");

    let rollfiResult: { rollfiCompanyId?: string; rollfiLocationId?: string; error?: string } = {};

    // 4. Trigger Rollfi onboarding if credentials configured
    if (getRollfiConfig().credentialsPresent) {
      try {
        const incorporationDate = body.dateOfIncorporation
          ? body.dateOfIncorporation.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2")
          : "2015-01-01";

        const response = await axios.post(`${getBaseUrl()}/companyOnboarding#createBusiness`, {
          method: "createBusiness",
          registration: { company: body.companyName, businessWebsite: body.businessWebsite ?? "", doingBusinessAs: body.doingBusinessAs ?? body.companyName, isTermsAccepted: true },
          kybInformation: { ein: useEin, entityType: body.entityType ?? "LLC", incorporationState: body.incorporationState ?? "New Jersey", dateOfIncorporation: incorporationDate, irsAssisgnedFederalFilingForm: body.irsFilingForm ?? "941", payrollRunThisYear: body.payrollRunThisYear === "Yes" ? "Yes" : "No", formerPaidThisYear: "No" },
          companyLocation: { companyLocation: body.locationName ?? "Main", address1: body.address1, address2: body.address2 ?? "", city: body.city, state: body.state, zipcode: body.zipcode, phoneNumber: body.phone, isWorkLocation: true, isMailingAddress: true, isFilingAddress: true },
          businessUser: { firstName: body.ownerFirstName, middleName: "", lastName: body.ownerLastName, phoneNumber: body.ownerPhone, email: body.ownerEmail, address1: body.ownerAddress1, address2: "", city: body.ownerCity, state: body.ownerState, zipcode: body.ownerZip, ssn: ownerSsn, dateOfBirth: body.ownerDob.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2"), payrollAdmin: true, bookkeeper: true, beneficialOwner: true, ownershipPercentage: body.ownershipPercentage ?? 100 },
        }, { headers: rollfiHeaders() });

        req.log.info({ rollfiResponse: response.data }, "Rollfi createBusiness response");
        const raw = response.data as Record<string, unknown>;
        assertNoRollfiError(raw, "createBusiness");
        const reg = (raw.registration ?? raw) as Record<string, unknown>;
        const rollfiCompanyId = (reg.companyId ?? reg.id) as string | undefined;
        const rollfiLocationId = (reg.companyLocationId ?? reg.locationId) as string | undefined;

        if (rollfiCompanyId) {
          await db.insert(rollfiCompanyRecords).values({ companyId, rollfiCompanyId, rollfiLocationId: rollfiLocationId ?? "", onboardedAt: now, ein: useEin, ownerSsn }).onConflictDoNothing();
          store.setRollfiCompany(companyId, { rollfiCompanyId, rollfiLocationId: rollfiLocationId ?? "", onboardedAt: now, ein: useEin, ownerSsn });
          await db.update(companies).set({ rollfiCompanyId, rollfiLocationId: rollfiLocationId ?? "", rollfiOnboardedAt: now, status: "setting_up", kybStatus: "pending", updatedAt: new Date().toISOString() }).where(eq(companies.id, companyId));
          rollfiResult = { rollfiCompanyId, rollfiLocationId };

          // State tax registrations — submit each in sequence; failures stored locally as "failed"
          const stateTaxList = body.stateTaxRegistrations ?? [];
          let stateRegSuccessCount = 0;
          for (const sr of stateTaxList) {
            const srId = `SR-${sr.stateCode}-${Date.now()}`;
            const fieldValues = sr.fieldValues as Record<string, string>;
            const fieldValuesJson = JSON.stringify(fieldValues);
            try {
              const srResp = await axios.post(
                `${getBaseUrl()}/adminPortal/addStateRegistrationInfo`,
                {
                  method: "addStateRegistrationInfo",
                  companyId: rollfiCompanyId,
                  code: sr.stateCode,
                  companyStateRegistration: fieldValues,
                },
                { headers: rollfiHeaders() }
              );
              // Rollfi returns HTTP 200 even on errors — check body
              const srRollfiErr = (srResp.data as { error?: { code?: number; message?: string } })?.error;
              if (srRollfiErr) {
                throw new Error(srRollfiErr.message ?? "Rollfi rejected state registration");
              }
              await db.insert(stateRegistrationsTable).values({
                id: srId, companyId, rollfiCompanyId,
                stateCode: sr.stateCode, stateName: sr.stateName,
                stateEmployerId: null, suiAccountNumber: null, suiRate: null,
                fieldValuesJson,
                status: "active",
                rollfiResponse: JSON.stringify(srResp.data),
                registeredAt: now, updatedAt: now,
              }).onConflictDoNothing();
              stateRegSuccessCount++;
              req.log.info({ companyId, stateCode: sr.stateCode }, "State registration submitted");
            } catch (srErr: unknown) {
              req.log.warn({ srErr, companyId, stateCode: sr.stateCode }, "State registration failed — storing as failed");
              await db.insert(stateRegistrationsTable).values({
                id: srId, companyId, rollfiCompanyId,
                stateCode: sr.stateCode, stateName: sr.stateName,
                stateEmployerId: null, suiAccountNumber: null, suiRate: null,
                fieldValuesJson,
                status: "failed",
                rollfiResponse: String(srErr),
                registeredAt: now, updatedAt: now,
              }).onConflictDoNothing().catch(() => {});
            }
          }
          rollfiResult = { ...rollfiResult, stateRegSuccessCount } as typeof rollfiResult & { stateRegSuccessCount: number };

          // Fire-and-forget full onboarding
          void ensureFullOnboarding(rollfiCompanyId, useEin, req.log, {
            payFrequency: body.payFrequency,
            payBeginDate: body.payBeginDate,
            payDate: body.payDate,
            workerType: body.workerType,
          }, {
            bankName: body.fundingBankName,
            routingNumber: body.fundingRoutingNumber,
            accountNumber: body.fundingAccountNumber,
            accountType: body.fundingAccountType,
          }).then(async () => {
            await db.update(companies).set({ bankAccountAdded: true, payScheduleAdded: true, status: "active", updatedAt: new Date().toISOString() }).where(eq(companies.id, companyId));
            req.log.info({ companyId }, "Rollfi full onboarding complete");
          }).catch((e: unknown) => req.log.warn({ e }, "ensureFullOnboarding had errors"));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err, companyId }, "Rollfi onboarding failed — company saved without Rollfi");
        rollfiResult = { error: msg };
      }
    }

    // Seed default departments for this company (in-memory, fast)
    const isDaycare = body.industry === "daycare" || body.package === "full_daycare";
    seedDepartmentsForCompany(companyId, isDaycare);
    req.log.info({ companyId, isDaycare }, "Departments seeded");

    void logPeopleActivity({ companyId, action: "company.created", description: `Company "${body.companyName}" created`, category: "company", performedBy: req.session.userId ?? "system" });

    const [saved] = await db.select().from(companies).where(eq(companies.id, companyId));
    const stateRegCount = (rollfiResult as Record<string, unknown>).stateRegSuccessCount as number | undefined;
    res.status(201).json({ ...saved, rollfi: rollfiResult, stateRegistrations: stateRegCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to create company");
    res.status(500).json({ error: "Failed to create company" });
  }
});

// ── PUT /api/companies/:companyId ─────────────────────────────

router.put("/companies/:companyId", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin access required" }); return; }
  const companyId = String(req.params.companyId);
  const updates = req.body as Partial<typeof companies.$inferInsert>;
  try {
    await db.update(companies).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(companies.id, companyId));
    const [updated] = await db.select().from(companies).where(eq(companies.id, companyId));
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update company");
    res.status(500).json({ error: "Failed to update company" });
  }
});

// ── GET /api/companies/:companyId/users (managers + admins) ──

router.get("/companies/:companyId/users", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.params.companyId);
  try {
    // From in-memory store (hardcoded test users with manager/employee roles)
    const storeUsers = store.getUsersForCompany(companyId)
      .filter((u) => u.role === "owner" || u.role === "manager" || u.role === "super_admin");

    // From DB user_accounts (managers created via the wizard)
    const storeEmails = new Set(storeUsers.map((u) => u.email.toLowerCase()));
    const dbUsers = await db.select({
      id: userAccounts.id,
      name: userAccounts.name,
      email: userAccounts.email,
      role: userAccounts.role,
      position: userAccounts.position,
      companyId: userAccounts.companyId,
      createdAt: userAccounts.createdAt,
    }).from(userAccounts)
      .where(and(eq(userAccounts.companyId, companyId)));

    const dbFiltered = dbUsers
      .filter((u) => (u.role === "owner" || u.role === "manager" || u.role === "super_admin") && !storeEmails.has(u.email.toLowerCase()));

    const merged = [
      ...storeUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, position: u.position ?? "", source: "store" })),
      ...dbFiltered.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, position: u.position ?? "", source: "db" })),
    ];

    res.json({ users: merged });
  } catch (err) {
    req.log.error({ err }, "Failed to list company users");
    res.status(500).json({ error: "Failed to list company users" });
  }
});

// ── GET /api/companies/:companyId/users/:userId (credentials) ─

router.get("/companies/:companyId/users/:userId", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin only" }); return; }
  const userId = String(req.params.userId);
  // Check store first
  const storeUser = store.getTestUserById(userId);
  if (storeUser) {
    const { password, ...safe } = storeUser;
    res.json({ ...safe, password });
    return;
  }
  // Fall back to DB
  const [dbUser] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
  if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }
  res.json(dbUser);
});

// ── PUT /api/companies/:companyId/users/:userId (update creds) ─

async function handleUpdateCompanyUser(req: Request, res: Response) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin only" }); return; }
  const userId = String(req.params.userId);
  const { name, email, password, position } = req.body as { name?: string; email?: string; password?: string; position?: string };

  const updates: Record<string, string> = {};
  if (name)     updates.name = name;
  if (email)    updates.email = email;
  if (password) updates.password = password;
  if (position) updates.position = position;

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  try {
    store.updateTestUser(userId, updates as Parameters<typeof store.updateTestUser>[1]);

    await db.insert(userAccounts).values({
      id: userId, name: name ?? "", email: email ?? "", password: password ?? "",
      role: "manager", companyId: String(req.params.companyId), createdAt: new Date().toISOString(),
      position: position ?? null,
    }).onConflictDoUpdate({
      target: userAccounts.id,
      set: { ...updates },
    });

    const updated = store.getTestUserById(userId);
    if (updated) {
      const { password: _p, ...safe } = updated;
      res.json({ ...safe, password: updated.password });
    } else {
      const [dbUser] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
      res.json(dbUser);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to update user credentials");
    res.status(500).json({ error: "Failed to update user" });
  }
}

router.put("/companies/:companyId/users/:userId", (req, res) => { void handleUpdateCompanyUser(req, res); });
router.patch("/companies/:companyId/users/:userId", (req, res) => { void handleUpdateCompanyUser(req, res); });

// ── GET /api/employees ───────────────────────────────────────

router.get("/employees", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller) { res.status(401).json({ error: "User not found" }); return; }

  const companyIdQ = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
  const statusQ = typeof req.query.status === "string" ? req.query.status : undefined;

  try {
    const targetCompanyId = caller.role === "super_admin" ? companyIdQ : caller.companyId;
    const conditions = [];
    if (targetCompanyId) conditions.push(eq(employees.companyId, targetCompanyId));
    if (statusQ) conditions.push(eq(employees.status, statusQ));
    const rows = conditions.length > 0
      ? await db.select().from(employees).where(and(...conditions))
      : await db.select().from(employees);
    res.json({ employees: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list employees");
    res.status(500).json({ error: "Failed to list employees" });
  }
});

// ── GET /api/employees/:employeeId ───────────────────────────

router.get("/employees/:employeeId", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const employeeId = String(req.params.employeeId);
  try {
    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
    if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
    res.json({ employee: row });
  } catch (err) {
    req.log.error({ err }, "Failed to get employee");
    res.status(500).json({ error: "Failed to get employee" });
  }
});

// ── POST /api/employees ──────────────────────────────────────

router.post("/employees", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || (caller.role !== "super_admin" && caller.role !== "manager" && caller.role !== "owner")) {
    res.status(403).json({ error: "Super admin, manager, or owner access required" }); return;
  }
  // Owners can only add employees to their own company
  if (caller.role === "owner" && req.body?.companyId && req.body.companyId !== caller.companyId) {
    res.status(403).json({ error: "Owners can only add employees to their own company" }); return;
  }

  const body = req.body as {
    companyId: string;
    firstName: string; lastName: string; email: string; phone: string;
    position: string; employmentType: string; workerType: string; startDate: string;
    payType: string; wageAmount: number; overtimeEligible: boolean;
    paymentMethod: string; taxExempt: boolean;
    ssn?: string; dateOfBirth?: string;
    homeAddress?: string; homeCity?: string; homeState?: string; homeZip?: string;
    w4FilingStatus?: string; w4MultipleJobs?: boolean; w4Dependents?: number; w4ExtraWithholding?: number;
    stateW4Fields?: Record<string, string>;
    bankSetupMethod: "invite" | "manual";
    bankName?: string; routingNumber?: string; accountNumber?: string; accountType?: string;
    department?: string; managerId?: string; managerName?: string;
  };

  if (!body.companyId || !body.firstName || !body.lastName || !body.email || !body.position) {
    res.status(400).json({ error: "companyId, firstName, lastName, email, and position are required" });
    return;
  }

  // Validate employee bank details in production when manually entered
  if (getRollfiConfig().env === "production" && body.bankSetupMethod === "manual") {
    const bankErr = validateBankDetails({
      routingNumber: body.routingNumber,
      accountNumber: body.accountNumber,
      bankName: body.bankName,
      accountType: body.accountType,
    });
    if (bankErr) { res.status(400).json({ error: `Employee bank account: ${bankErr}` }); return; }
  }

  if (caller.role === "manager" && caller.companyId !== body.companyId) {
    res.status(403).json({ error: "Managers can only add employees to their own company" }); return;
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, body.companyId));
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }

  const now = new Date().toISOString();
  const employeeId = `EMP-${uid().toUpperCase()}`;
  // Normalise pay type: "salary_yearly" / "salary_monthly" / "salary_weekly" all become "salary"
  const isSalary = body.payType === "salary" || (typeof body.payType === "string" && body.payType.startsWith("salary_"));
  const payTypeNormalized = isSalary ? "salary" : "hourly";
  // hourlyWage is 0 for salaried employees — annualSalary carries the real amount
  const hourlyWageCents   = isSalary ? 0 : Math.round((body.wageAmount ?? 18) * 100);
  const annualSalaryCents = isSalary ? Math.round((body.wageAmount ?? 0) * 100) : null;

  // ── Wage sanity guard (creation) ─────────────────────────────────────────────
  // wageAmount is supplied in dollars; guard catches the classic cents-as-dollars mistake.
  if (isSalary && (annualSalaryCents == null || annualSalaryCents < 100_000)) {
    res.status(400).json({
      error: "Annual salary must be at least $1,000/yr. Provide wageAmount in dollars (e.g. 52000 for $52,000/yr). " +
             "Received: " + (body.wageAmount ?? "missing"),
    });
    return;
  }
  if (!isSalary && hourlyWageCents < 100) {
    res.status(400).json({
      error: "Hourly wage must be at least $1.00/hr. Provide wageAmount in dollars (e.g. 18.50 for $18.50/hr). " +
             "Received: " + (body.wageAmount ?? "missing"),
    });
    return;
  }

  // SSN — required in production; sandbox-only fallback for test runs.
  const isProductionEnv = getRollfiConfig().env === "production";
  const rawSsn = (body.ssn ?? "").replace(/\D/g, "");
  if (!rawSsn) {
    if (isProductionEnv) {
      res.status(400).json({ error: "SSN is required. Collect the employee's Social Security Number before proceeding." });
      return;
    }
    // Sandbox only — generate a random test value so the Rollfi sandbox KYC call has something
    // to process. This branch is unreachable in production (returned 400 above).
    req.log.warn({ companyId: body.companyId }, "SSN not provided — generating random test value (SANDBOX ONLY, never accepted in production)");
  }
  const ssn = rawSsn || randomNineDigits(); // randomNineDigits() reachable only in sandbox
  const dob = body.dateOfBirth?.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2") ?? "1990-01-15";

  try {
    // 1. Save employee to DB
    await db.insert(employees).values({
      id: employeeId,
      companyId: body.companyId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone ?? "",
      position: body.position,
      employmentType: body.employmentType,
      workerType: body.workerType,
      startDate: body.startDate,
      payType: payTypeNormalized,
      hourlyWage: hourlyWageCents,
      annualSalary: annualSalaryCents,
      overtimeEligible: body.overtimeEligible ?? (isSalary ? false : true),
      paymentMethod: body.paymentMethod,
      taxExempt: body.taxExempt ?? false,
      ssn,
      dateOfBirth: dob,
      homeAddress: body.homeAddress,
      homeCity: body.homeCity,
      homeState: body.homeState,
      homeZip: body.homeZip,
      w4FilingStatus: body.w4FilingStatus,
      w4MultipleJobs: body.w4MultipleJobs ?? false,
      w4Dependents: body.w4Dependents ?? 0,
      w4ExtraWithholding: body.w4ExtraWithholding ?? 0,
      department: body.department ?? null,
      managerId: body.managerId ?? null,
      managerName: body.managerName ?? null,
      bankName: body.bankSetupMethod === "manual" ? (body.bankName ?? null) : null,
      accountLast4: body.bankSetupMethod === "manual" && body.accountNumber ? body.accountNumber.slice(-4) : null,
      accountType: body.bankSetupMethod === "manual" ? (body.accountType ?? null) : null,
      status: "onboarding",
      kycStatus: "not_started",
      bankAccountAdded: body.bankSetupMethod === "manual",
      w4Submitted: !!(body.w4FilingStatus),
      easyteamSynced: false,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // 2. Sync the new employee to EasyTeam + Rollfi through the unified integration path.
    const sync = await syncEmployeeToIntegrations(
      {
        id: employeeId,
        companyId: body.companyId,
        name: `${body.firstName} ${body.lastName}`,
        email: body.email,
        position: body.position,
        hourlyWageCents,
        payType: payTypeNormalized,
        annualSalaryCents,
        overtimeEligible: body.overtimeEligible ?? (isSalary ? false : true),
        homeAddress: body.homeAddress,
        homeCity: body.homeCity,
        homeState: body.homeState,
        homeZip: body.homeZip,
        ssn,
        dateOfBirth: dob,
        w4FilingStatus: body.w4FilingStatus,
        w4MultipleJobs: body.w4MultipleJobs,
        w4Dependents: body.w4Dependents,
        w4ExtraWithholding: body.w4ExtraWithholding,
        stateW4Fields: body.stateW4Fields,
        phone: body.phone ?? "",
        startDate: body.startDate,
        bankName: body.bankSetupMethod === "manual" ? body.bankName : undefined,
        routingNumber: body.bankSetupMethod === "manual" ? body.routingNumber : undefined,
        accountNumber: body.bankSetupMethod === "manual" ? body.accountNumber : undefined,
        accountType: body.bankSetupMethod === "manual" ? body.accountType : undefined,
      },
      req.log
    );
    const easyteamSynced = sync.easyteamSynced;
    const rollfiSynced = sync.rollfiSynced;
    const rollfiUserId = sync.rollfiUserId;
    const syncError = sync.syncError;
    const rollfiFailedSteps = sync.rollfiFailedSteps;
    const rollfiSoftWarnings = sync.rollfiSoftWarnings;

    // 3. Update DB with sync results
    // Only mark rollfiOnboardedAt when ALL hard steps succeeded (no failed steps)
    const hasHardFailures = rollfiFailedSteps && rollfiFailedSteps.length > 0;
    const syncStatus = easyteamSynced && rollfiSynced ? "synced" : (rollfiSynced || easyteamSynced) ? "partial" : "pending";
    const lastSyncErrorValue = hasHardFailures
      ? JSON.stringify({ failedSteps: rollfiFailedSteps, softWarnings: rollfiSoftWarnings ?? [] })
      : syncError ?? null;
    await db.update(employees).set({
      easyteamSynced,
      rollfiUserId,
      rollfiOnboardedAt: rollfiSynced && !hasHardFailures ? now : undefined,
      syncStatus,
      lastSyncError: lastSyncErrorValue,
      updatedAt: new Date().toISOString(),
    }).where(eq(employees.id, employeeId));

    // 6. Auto-create login account and persist to DB so it survives restarts
    const existingUser = store.getUserByEmail(body.email);
    if (!existingUser) {
      const newLoginUser = {
        id: `USER-DYN-${Date.now()}`,
        name: `${body.firstName} ${body.lastName}`,
        email: body.email,
        password: "Staff123!",
        role: "employee" as const,
        companyId: body.companyId,
        employeeId,
        position: body.position,
        hourlyWage: hourlyWageCents,
        /** FIX 2: carry payType so payroll preview works even when the DB lookup hasn't run yet. */
        payType: payTypeNormalized,
      };
      store.addTestUser(newLoginUser);
      // Persist so login survives server restarts
      await persistUserAccount(newLoginUser).catch((err) => {
        req.log.warn({ err, email: body.email }, "Failed to persist employee login account to DB");
      });
    }

    // 4. People Module: assign display ID + seed onboarding tasks + compliance items in DB
    try {
      // 4a. Generate and assign display ID
      const companyEmps = await db.select({ id: employees.employeeDisplayId }).from(employees).where(eq(employees.companyId, body.companyId));
      const existingIds = companyEmps.map((e) => e.id ?? "").filter(Boolean);
      const displayId = generateDisplayIdFromExisting(existingIds);
      await db.update(employees).set({ employeeDisplayId: displayId, updatedAt: new Date().toISOString() }).where(eq(employees.id, employeeId));

      // 4b. Detect daycare context
      const [co] = await db.select({ industry: companies.industry, package: companies.package }).from(companies).where(eq(companies.id, body.companyId));
      const isDaycareEmployee = co ? (co.industry === "daycare" || co.package === "full_daycare") : false;

      // 4c. Seed onboarding tasks in DB
      await createOnboardingTasksInDb(employeeId, body.companyId, body.startDate, isDaycareEmployee, undefined, req.session.userId);

      // 4c-post. Auto-complete tasks whose data was collected during the wizard
      {
        const seedNow = new Date().toISOString();
        const newTasks = await db.select().from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, employeeId));
        const complete = async (name: string) => {
          const task = newTasks.find(t => t.taskName === name && t.status !== "completed");
          if (task) await db.update(onboardingTasksTable).set({ status: "completed", completedAt: seedNow, completedBy: "system", completionMethod: "auto", completionNote: "Auto-completed: collected during employee creation wizard", updatedAt: seedNow } as Record<string, unknown>).where(eq(onboardingTasksTable.id, task.id));
        };

        // Always: data collected/created during employee creation wizard
        await complete("Issue Employee ID");
        await complete("Assign Job Title");
        await complete("Complete Personal Information");
        await complete("Assign Pay Schedule");
        await complete("Create System Login");
        if (easyteamSynced) await complete("Assign Time & Attendance Profile");

        // Conditionally from wizard data
        if (body.department) await complete("Assign Department");
        if (body.managerId)  await complete("Assign Manager");
        if (body.w4FilingStatus) await complete("Federal W-4");
        if (body.stateW4Fields && Object.keys(body.stateW4Fields).length > 0) await complete("State Tax Form");
        if (body.bankSetupMethod === "manual") await complete("Direct Deposit Setup");

        // Re-calculate onboarding progress from tasks and write back
        const allTaskRows = await db.select({ status: onboardingTasksTable.status }).from(onboardingTasksTable).where(eq(onboardingTasksTable.employeeId, employeeId));
        const taskProgress = allTaskRows.length > 0
          ? Math.round(allTaskRows.filter(t => t.status === "completed" || t.status === "skipped").length / allTaskRows.length * 100)
          : 0;
        await db.update(employees).set({ onboardingProgress: taskProgress, updatedAt: new Date().toISOString() }).where(eq(employees.id, employeeId));

        const parts: string[] = [];
        if (body.department) parts.push(`assigned to ${body.department}`);
        if (body.managerName) parts.push(`reporting to ${body.managerName}`);
        if (parts.length > 0) void logPeopleActivity({ companyId: body.companyId, employeeId, action: "employee.assignment", description: `${body.firstName} ${body.lastName} — ${parts.join(", ")}`, category: "onboarding", performedBy: req.session.userId ?? "system" });
      }

      // 4d. Seed compliance items in DB, then write compliance score + readiness flags back to employee
      await createComplianceItemsInDb(employeeId, body.companyId, isDaycareEmployee, {
        w4Submitted: !!(body.w4FilingStatus),
        bankAccountAdded: body.bankSetupMethod === "manual",
        kycStatus: null,
      });
      const compScore = await calculateComplianceScore(employeeId);
      const readiness = await calculateReadinessFlags(employeeId);
      await db.update(employees).set({
        complianceScore: compScore,
        payrollReady:     readiness.payrollReady,
        hrReady:          readiness.hrReady,
        complianceReady:  readiness.complianceReady,
        firstPayrollReady: readiness.firstPayrollReady,
        updatedAt: new Date().toISOString(),
      }).where(eq(employees.id, employeeId));

      // 4e. Log activity
      void logPeopleActivity({ companyId: body.companyId, employeeId, action: "employee.created", description: `${body.firstName} ${body.lastName} added (${displayId})`, category: "onboarding", performedBy: req.session.userId ?? "system" });

      req.log.info({ employeeId, displayId, isDaycareEmployee, compScore }, "People Module seeded for new employee");
    } catch (pmErr) {
      req.log.warn({ pmErr, employeeId }, "People Module seed failed — employee still created (non-fatal)");
    }

    const [saved] = await db.select().from(employees).where(eq(employees.id, employeeId));
    res.status(201).json({
      ...saved,
      easyteamSynced,
      rollfiSynced,
      rollfiUserId,
      loginPassword: "Staff123!",
      rollfiFailedSteps: rollfiFailedSteps ?? [],
      rollfiSoftWarnings: rollfiSoftWarnings ?? [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create employee");
    res.status(500).json({ error: "Failed to create employee" });
  }
});

// ── PUT /api/employees/:employeeId ───────────────────────────

router.put("/employees/:employeeId", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") { res.status(403).json({ error: "Super admin access required" }); return; }
  const employeeId = String(req.params.employeeId);
  const updates = req.body as Partial<typeof employees.$inferInsert>;

  // ── Wage sanity guard (edit) ──────────────────────────────────────────────────
  // The edit body uses DB column values: hourlyWage and annualSalary are stored in CENTS.
  // Guard catches the classic cents-as-dollars mistake on direct column updates.
  const editHourly = updates.hourlyWage;
  const editSalary = updates.annualSalary;
  if (editHourly !== undefined && editHourly !== null && Number(editHourly) < 100) {
    res.status(400).json({
      error: "hourlyWage is stored in cents and must be ≥ 100 (=$1.00/hr). " +
             "Received: " + editHourly + ". Example: 1850 for $18.50/hr.",
    });
    return;
  }
  if (editSalary !== undefined && editSalary !== null && Number(editSalary) < 100_000) {
    res.status(400).json({
      error: "annualSalary is stored in cents and must be ≥ 100,000 (=$1,000/yr). " +
             "Received: " + editSalary + ". Example: 6000000 for $60,000/yr.",
    });
    return;
  }

  try {
    await db.update(employees).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(employees.id, employeeId));
    const [updated] = await db.select().from(employees).where(eq(employees.id, employeeId));
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update employee");
    res.status(500).json({ error: "Failed to update employee" });
  }
});

// ── GET /api/companies/:companyId/pay-period ──────────────────
// Returns the current pay-period date window.
// Strategy 1: pull exact dates from Rollfi's live pay period (most accurate).
// Strategy 2: fall back to anchor-based computation from payFrequency alone.

const BIWEEKLY_ANCHOR = new Date("2025-01-06T00:00:00Z");
const MS_PER_DAY = 86400000;

/** Parse any Rollfi date string ("Jul 9, 2026", "2026-07-09", "07/09/2026") to ISO YYYY-MM-DD. */
function parseRollfiDate(d: string): string | null {
  if (!d) return null;
  const parsed = new Date(d);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0]!;
  return null;
}

function computePayPeriod(frequency: string | null | undefined): { from: string; to: string; frequency: string } {
  const fmt = (d: Date) => d.toISOString().split("T")[0]!;
  const today = new Date();
  const freq = (frequency ?? "weekly").toLowerCase().replace(/[^a-z]/g, "");

  if (freq === "biweekly") {
    const daysSinceAnchor = Math.floor((today.getTime() - BIWEEKLY_ANCHOR.getTime()) / MS_PER_DAY);
    const windowIndex = Math.floor(daysSinceAnchor / 14);
    const from = new Date(BIWEEKLY_ANCHOR.getTime() + windowIndex * 14 * MS_PER_DAY);
    const to   = new Date(from.getTime() + 13 * MS_PER_DAY);
    return { from: fmt(from), to: fmt(to), frequency: "BiWeekly" };
  }
  if (freq === "semimonthly") {
    const day = today.getDate();
    if (day <= 15) return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(new Date(today.getFullYear(), today.getMonth(), 15)), frequency: "SemiMonthly" };
    return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 16)), to: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0)), frequency: "SemiMonthly" };
  }
  if (freq === "monthly") {
    return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0)), frequency: "Monthly" };
  }
  // Default: weekly Mon–Sun
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: fmt(monday), to: fmt(sunday), frequency: "Weekly" };
}

router.get("/companies/:companyId/pay-period", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = String(req.params.companyId);

  // Resolve payFrequency label from DB then store
  let payFrequency: string | null = null;
  try {
    const [row] = await db.select({ payFrequency: companies.payFrequency }).from(companies).where(eq(companies.id, companyId));
    if (row?.payFrequency) payFrequency = row.payFrequency;
  } catch { /* ignore */ }
  if (!payFrequency) {
    const storeCompany = store.getCompanyById(companyId);
    if (storeCompany?.payFrequency) payFrequency = storeCompany.payFrequency;
  }

  // ── Strategy 1: Rollfi live pay period ────────────────────
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (rollfiCompany && getRollfiConfig().credentialsPresent) {
    try {
      let rollfiFrom: string | null = null;
      let rollfiTo: string | null = null;

      // Try getPayPeriod first (recommended by Rollfi docs)
      try {
        const gpRes = await axios.post(
          `${getBaseUrl()}/reports#getPayPeriod`,
          { method: "getPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
          { headers: rollfiHeaders() }
        );
        const gp = gpRes.data as Record<string, unknown>;
        if (gp.payPeriodId && gp.payBeginDate) {
          rollfiFrom = parseRollfiDate(String(gp.payBeginDate));
          rollfiTo   = gp.payEndDate ? parseRollfiDate(String(gp.payEndDate)) : null;
        }
      } catch { /* fall through to getUnProcessedPayPeriod */ }

      // Fallback: getUnProcessedPayPeriod
      if (!rollfiFrom) {
        const upRes = await axios.post(
          `${getBaseUrl()}/reports#getUnProcessedPayPeriod`,
          { method: "getUnProcessedPayPeriod", companyId: rollfiCompany.rollfiCompanyId, workerType: "W2" },
          { headers: rollfiHeaders() }
        );
        const raw = upRes.data as Record<string, unknown>;
        const periods = (raw.unprocessedPayPeriods ?? []) as Array<Record<string, unknown>>;
        if (periods.length > 0) {
          // Priority 1: find the period whose date range contains today (what the manager is working in)
          // Priority 2: most recent period by start date
          const todayTs = Date.now();
          const parsedPeriods = periods.map(p => ({
            raw: p,
            from: p.payBeginDate ? parseRollfiDate(String(p.payBeginDate)) : null,
            to:   p.payEndDate   ? parseRollfiDate(String(p.payEndDate))   : null,
          }));
          const containsToday = parsedPeriods.filter(p =>
            p.from && p.to &&
            new Date(p.from).getTime() <= todayTs &&
            todayTs <= new Date(p.to + "T23:59:59Z").getTime()
          );
          const best = containsToday.length > 0
            ? containsToday[0]!
            : [...parsedPeriods].sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""))[0]!;
          rollfiFrom = best.from;
          rollfiTo   = best.to;
        }
      }

      if (rollfiFrom && rollfiTo) {
        // Infer frequency from actual date range — more reliable than DB field
        const rangeDays = Math.round((new Date(rollfiTo).getTime() - new Date(rollfiFrom).getTime()) / MS_PER_DAY) + 1;
        const inferredFreq = rangeDays >= 28 ? "Monthly" : rangeDays >= 13 ? "BiWeekly" : rangeDays >= 10 ? "SemiMonthly" : "Weekly";
        req.log.info({ companyId, from: rollfiFrom, to: rollfiTo, rangeDays, inferredFreq, source: "rollfi" }, "pay-period from Rollfi");
        res.json({ companyId, from: rollfiFrom, to: rollfiTo, frequency: inferredFreq, source: "rollfi" });
        return;
      }
    } catch (err) {
      req.log.warn({ err, companyId }, "pay-period: Rollfi call failed — falling back to anchor computation");
    }
  }

  // ── Strategy 2: anchor computation ────────────────────────
  const period = computePayPeriod(payFrequency);
  req.log.info({ companyId, payFrequency, period, source: "computed" }, "pay-period computed from anchor");
  res.json({ companyId, ...period, source: "computed" });
});

export default router;
