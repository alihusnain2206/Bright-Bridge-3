import { Router, type IRouter } from "express";
import axios from "axios";
import { store } from "../store";

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

// Derive a stable 9-digit EIN from a company seed string so each company gets a unique EIN
function deriveEin(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) & 0x7fffffff;
  }
  return String(100000000 + (h % 900000000));
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

router.get("/rollfi/state", (_req, res) => {
  const companies = store.getDaycareCompanies().map((c) => ({
    ...c,
    rollfi: store.getRollfiCompany(c.id) ?? null,
  }));

  const employees = store
    .getAllStaffUsers()
    .filter((u) => u.employeeId && u.role !== "super_admin")
    .map((u) => ({
      employeeId: u.employeeId,
      name: u.name,
      position: u.position,
      companyId: u.companyId,
      hourlyWage: u.hourlyWage ?? 1500,
      rollfi: u.employeeId ? (store.getRollfiEmployee(u.employeeId) ?? null) : null,
    }));

  res.json({ companies, employees });
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
          ein: deriveEin(company.id),
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
          ssn: "123456789",
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

    store.setRollfiCompany(companyId, {
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      onboardedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      rollfiCompanyId,
      rollfiLocationId: rollfiLocationId ?? "",
      status: reg.status as string | undefined,
      message: reg.message as string | undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // "Ein already in use" means this company was registered in a previous server run.
    // Recover by looking up the existing Rollfi company ID via getCompanies.
    if (msg.toLowerCase().includes("ein already in use")) {
      req.log.warn({ companyName: company.name }, "EIN already in use — looking up existing Rollfi company");
      try {
        const found = await findExistingRollfiCompany(company.name);
        if (found) {
          const rollfiLocationId = await fetchRollfiLocationId(found.companyID);
          store.setRollfiCompany(companyId, {
            rollfiCompanyId: found.companyID,
            rollfiLocationId,
            onboardedAt: new Date().toISOString(),
          });
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
        store.setRollfiCompany(companyId, rollfiCompany);
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

    const addWageResp = await axios.post(
      `${ROLLFI_BASE_URL}/adminPortal#addUserWage`,
      {
        method: "addUserWage",
        userWage: {
          companyId: rollfiCompany.rollfiCompanyId,
          userId: rollfiUserId,
          differentialPay: "No",
          wageRate: wage,
          workerType: "W2",
          wageBasis: "Per Hour",
          userType: "Hourly",
          employmentStatus: "Full Time (30+ Hours per week)",
          userRefTaxExempt: "No",
          startDate: "2024-01-01",
          paymentMethod: "Direct Deposit",
        },
      },
      { headers: rollfiHeaders() }
    );

    req.log.info({ rollfiResponse: addWageResp.data }, "Rollfi addUserWage raw response");

    const addWageRaw = addWageResp.data as Record<string, unknown>;
    const wageObj = (addWageRaw.userWage ?? addWageRaw) as Record<string, unknown>;
    const rollfiWageId = (wageObj.userWageId ?? wageObj.id) as string | undefined;

    store.setRollfiEmployee(employeeId, {
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
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi employee onboarding failed");
    res.status(500).json({ error: "Rollfi employee onboarding failed", details: e.response?.data ?? String(err) });
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
    // Rollfi documents getPayPeriod as GET-with-body; we use POST to avoid proxies stripping the body
    const response = await axios.post(`${ROLLFI_BASE_URL}/reports#getPayPeriod`, {
      method: "getPayPeriod",
      companyId: rollfiCompany.rollfiCompanyId,
      workerType: "W2",
    }, { headers: rollfiHeaders() });

    req.log.info({ rollfiResponse: response.data }, "Rollfi getPayPeriod raw response");

    const raw = response.data as Record<string, unknown>;
    assertNoRollfiError(raw, "getPayPeriod");

    res.json(raw);
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi getPayPeriod failed");
    res.status(500).json({ error: "Failed to get pay period", details: e.response?.data ?? String(err) });
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
    .filter((u) => u.employeeId && u.role !== "super_admin" && u.role !== "parent")
    .filter((u) => !companyId || u.companyId === companyId);

  const entries = allStaff.map((u, i) => {
    const hoursWorked = workdays * 8;
    const breakDeduction = workdays * 0.5;
    const unapprovedHours = i % 3 === 0 ? 2 : 0;
    const netPayableHours = Math.max(0, hoursWorked - breakDeduction - unapprovedHours);
    const hourlyRate = u.hourlyWage ?? 1500;
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

  const { companyId, payPeriodId } = req.body as { companyId: string; payPeriodId: string };
  const rollfiCompany = store.getRollfiCompany(companyId);
  if (!rollfiCompany) {
    res.status(400).json({ error: "Company not onboarded to Rollfi" });
    return;
  }

  req.log.info({ companyId, rollfiCompanyId: rollfiCompany.rollfiCompanyId, payPeriodId }, "Rollfi initiatePayroll request");

  try {
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

    res.json({ success: true, ...raw });
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown; status: number } };
    req.log.error({ err, rollfiErrorBody: e.response?.data }, "Rollfi initiatePayroll failed");
    res.status(500).json({ error: "Failed to initiate payroll", details: e.response?.data ?? String(err) });
  }
});

export default router;
