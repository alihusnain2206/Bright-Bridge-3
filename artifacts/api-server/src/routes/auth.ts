import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import { store } from "../store";
import { persistUserAccount } from "../lib/user-account-persist.js";
import { resolveCompanyLocationId } from "../lib/location.js";
import { db, companies, userAccounts, employees as employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const router: IRouter = Router();

function normalizePemKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let key = raw.replace(/\\n/g, "\n").trim();
  if (!key.includes("\n")) {
    const headerMatch = key.match(/^(-----BEGIN [^-]+-----)/);
    const footerMatch = key.match(/(-----END [^-]+-----)$/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const body = key.slice(header.length, key.length - footer.length).replace(/\s+/g, "");
      const lines: string[] = [];
      for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
      key = `${header}\n${lines.join("\n")}\n${footer}`;
    }
  }
  return key;
}

const EASYTEAM_API_KEY = normalizePemKey(process.env.EASYTEAM_API_KEY);
const EASYTEAM_PARTNER_ID = process.env.EASYTEAM_PARTNER_ID;

// ── Location helper ─────────────────────────────────────────
// Resolves a user's location object. For static companies (Sunshine, Rainbow) the location lives
// in the in-memory store. For dynamically-created companies (wizard-created, DB-only) we construct
// a minimal location from the DB company record so the frontend always gets a valid location.
async function resolveUserLocation(userId: string): Promise<object | undefined> {
  const user = store.getUserById(userId);
  if (!user || !user.companyId) return undefined;

  // 1. If user has an explicit locationId, try the in-memory store first
  if (user.locationId) {
    const storeLocation = store.getLocation(user.locationId);
    if (storeLocation) return storeLocation;
  }

  // 2. Unified resolver: store company location → DB rollfiLocationId → LOC-${id}.
  //    Mirrors the same chain used in token-by-role so /me and JWT are always consistent.
  const locationId = await resolveCompanyLocationId(user.companyId);
  const storeLocation = store.getLocation(locationId);
  if (storeLocation) return storeLocation;

  // 3. DB-derived minimal location for dynamically created (wizard) companies.
  const [dbCo] = await db.select().from(companies).where(eq(companies.id, user.companyId)).catch(() => [undefined]);
  if (dbCo) {
    const addr = [dbCo.address1, dbCo.city, dbCo.state].filter(Boolean).join(", ");
    return {
      id: locationId,
      name: dbCo.locationName ?? dbCo.name ?? "Your Location",
      organizationId: user.companyId,
      address: addr,
      latitude: 0,
      longitude: 0,
    };
  }

  return undefined;
}

// Resolves a user's company object. Seeded demo companies live in the in-memory store;
// wizard-created companies are DB-only, so fall back to the DB row. Without this, managers/
// employees of wizard companies see a blank company name on their dashboard.
async function resolveUserCompany(companyId?: string): Promise<object | undefined> {
  if (!companyId) return undefined;
  const storeCo = store.getCompany(companyId);
  if (storeCo) return storeCo;
  const [dbCo] = await db.select().from(companies).where(eq(companies.id, companyId)).catch(() => [undefined]);
  return dbCo ?? undefined;
}

// ── Login ────────────────────────────────────────────────────

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = store.getUserByEmail(email);
  if (!user || user.password !== password) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;
  const { password: _p, ...safeUser } = user;
  const company = await resolveUserCompany(user.companyId);
  const location = await resolveUserLocation(user.id);
  res.json({ user: safeUser, company, location });
});

// ── Logout ───────────────────────────────────────────────────

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// ── Me ───────────────────────────────────────────────────────

router.get("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = store.getUserById(req.session.userId);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const company = await resolveUserCompany(user.companyId);
  const location = await resolveUserLocation(user.id);
  res.json({ user, company, location });
});

// ── Role-based JWT token generation ─────────────────────────

router.post("/auth/token-by-role", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  const targetId = userId ?? req.session.userId;

  if (!targetId) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const user = store.getRawUser(targetId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ error: "EASYTEAM_API_KEY not configured" });
    return;
  }

  let payload: Record<string, unknown>;

  // Look up current wage from employees table — canonical source, always beats user_accounts.
  // user.hourlyWage comes from user_accounts (stale); employees.hourly_wage is what the UI edits.
  const [empWageRow] = user.employeeId
    ? await db.select({ hourlyWage: employeesTable.hourlyWage })
        .from(employeesTable)
        .where(eq(employeesTable.id, user.employeeId))
        .catch(() => [undefined])
    : [undefined];
  const wageCents = empWageRow?.hourlyWage ?? user.hourlyWage ?? 1500;

  if (user.role === "super_admin") {
    payload = {
      employeeId: user.employeeId,
      organizationId: user.companyId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "admin",
        permissions: ["ORGANIZATION_ADMIN", "LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"],
      },
      role: { name: user.position, hourlyWage: 0 },
      wage: 0,
      wageType: "hourly",
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
    };
  } else if (user.role === "owner") {
    // Company owner: admin-level EasyTeam access scoped to their own company's location
    const ownerLocationId = user.locationId ?? (user.companyId ? await resolveCompanyLocationId(user.companyId) : undefined);
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: ownerLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        permissions: ["LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"],
      },
      role: { name: user.position, hourlyWage: wageCents / 100 },
      wage: wageCents / 100,
      wageType: "hourly",
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
    };
  } else if (user.role === "manager") {
    // Unified location resolver: store company → DB rollfiLocationId → LOC-${id}
    const mgrLocationId = user.locationId ?? (user.companyId ? await resolveCompanyLocationId(user.companyId) : undefined);
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: mgrLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        permissions: ["LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"],
      },
      role: { name: user.position, hourlyWage: wageCents / 100 },
      wage: wageCents / 100,
      wageType: "hourly",
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
    };
  } else if (user.role === "employee") {
    // Resolve locationId: user record first, then company (in-memory store), then DB fallback
    // for dynamically-created companies (wizard-created), then LOC-SUNSHINE as last resort.
    // The DB fallback is critical: without it, dynamic-company employees clock in at LOC-SUNSHINE
    // (a different location than where Pull Hours syncs), causing the manager to see 0 hours.
    const empLocationId = user.locationId ?? (user.companyId ? await resolveCompanyLocationId(user.companyId) : "LOC-SUNSHINE");
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: empLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "employee",
        permissions: ["LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE"],
      },
      role: { name: user.position, hourlyWage: wageCents / 100 },
      wage: wageCents / 100,
      wageType: "hourly",
      features: { geolocation: false, shiftNotes: false },
    };
  } else {
    res.json({ token: null, role: "parent", message: "Parents do not have EasyTeam access" });
    return;
  }

  let signedJwt: string;
  try {
    signedJwt = jwt.sign(payload, EASYTEAM_API_KEY, { algorithm: "RS256", expiresIn: "8h" });
  } catch (err) {
    const error = err as Error;
    req.log.error({ err }, "JWT signing failed");
    res.status(500).json({ error: `JWT signing failed: ${error.message}` });
    return;
  }

  // Return the signed JWT directly — EasyTeamLauncher handles token exchange internally
  res.json({ token: signedJwt, role: user.role, decoded: payload });
});

// ── Manager creation (super_admin only) ──────────────────────

router.post("/auth/create-manager", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || caller.role !== "super_admin") {
    res.status(403).json({ error: "Only super admins can create managers" });
    return;
  }

  const { name, email, companyId, position, password } = req.body as {
    name?: string; email?: string; companyId?: string; position?: string; password?: string;
  };

  if (!name || !email || !companyId) {
    res.status(400).json({ error: "name, email, and companyId are required" });
    return;
  }

  const storeCompany = store.getCompany(companyId);
  if (!storeCompany) {
    const [dbCompany] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, companyId));
    if (!dbCompany) { res.status(404).json({ error: "Company not found" }); return; }
  }

  const existing = store.getUserByEmail(email);
  if (existing) { res.status(409).json({ error: "A user with that email already exists" }); return; }

  const { user, password: generatedPassword } = store.createManagerUser({
    name,
    email,
    position: position ?? "Daycare Manager",
    companyId,
    password,
  });
  const finalPassword = password ?? generatedPassword;

  const fullUser = store.getUserByEmail(email);
  if (fullUser) {
    await persistUserAccount(fullUser).catch((err) => {
      req.log.warn({ err }, "Failed to persist manager user account to DB");
    });
  }

  req.log.info({ userId: user.id, name, companyId }, "Owner account created by super_admin");
  res.status(201).json({ ...user, password: finalPassword, loginEmail: email });
});

// ── Owner: create sub-role accounts for their company ────────

router.post("/auth/create-sub-role", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || (caller.role !== "owner" && caller.role !== "super_admin")) {
    res.status(403).json({ error: "Only company owners can create sub-role accounts" });
    return;
  }

  const { name, email, role, position, hourlyWage } = req.body as {
    name?: string; email?: string;
    role?: "owner" | "employee";
    position?: string; hourlyWage?: number;
  };

  if (!name || !email || !role) {
    res.status(400).json({ error: "name, email, and role are required" });
    return;
  }
  if (!["owner", "employee"].includes(role)) {
    res.status(400).json({ error: "role must be 'owner' or 'employee'" });
    return;
  }

  // Owners can only create accounts for their own company
  const companyId = caller.role === "super_admin"
    ? (req.body as { companyId?: string }).companyId ?? caller.companyId ?? ""
    : caller.companyId ?? "";

  if (!companyId) { res.status(400).json({ error: "No company associated with this account" }); return; }

  const existing = store.getUserByEmail(email);
  if (existing) { res.status(409).json({ error: "A user with that email already exists" }); return; }

  let newUser: Omit<ReturnType<typeof store.createManagerUser>["user"], never>;
  let password: string;

  if (role === "owner") {
    const result = store.createManagerUser({
      name, email,
      position: position ?? "Company Manager",
      companyId,
    });
    newUser = result.user;
    password = result.password;
  } else {
    const staffUser = store.createStaffUser({
      name, email,
      position: position ?? "Staff",
      hourlyWage: hourlyWage ?? 1500,
      companyId,
    });
    newUser = staffUser;
    password = "Staff123!";
  }

  const fullUser = store.getUserByEmail(email);
  if (fullUser) {
    await persistUserAccount(fullUser).catch((err) => {
      req.log.warn({ err }, "Failed to persist sub-role user account to DB");
    });
  }

  req.log.info({ userId: newUser.id, name, role, companyId }, "Sub-role account created by owner");
  res.status(201).json({ ...newUser, password, loginEmail: email });
});

// ── Owner: list company accounts ──────────────────────────────

router.get("/auth/company-accounts", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const caller = store.getUserById(req.session.userId);
  if (!caller || (caller.role !== "owner" && caller.role !== "super_admin")) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }

  const companyId = caller.companyId ?? "";
  const storeUsers = store.getAllStaffUsers()
    .filter((u) => u.companyId === companyId && u.role !== "super_admin");

  // Also fetch from DB for wizard-created accounts not yet in-memory
  const dbRows = await db.select({
    id: userAccounts.id,
    name: userAccounts.name,
    email: userAccounts.email,
    role: userAccounts.role,
    companyId: userAccounts.companyId,
    position: userAccounts.position,
    employeeId: userAccounts.employeeId,
  }).from(userAccounts).where(eq(userAccounts.companyId, companyId));

  const storeIds = new Set(storeUsers.map((u) => u.id));
  const combined = [
    ...storeUsers,
    ...dbRows.filter((r) => !storeIds.has(r.id) && r.role !== "super_admin"),
  ];

  res.json({ accounts: combined });
});

// ── Children check-in (parent feature) ──────────────────────

router.post("/auth/children/checkin", (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { childId } = req.body as { childId?: string };
  if (!childId) { res.status(400).json({ error: "childId required" }); return; }
  const ok = store.checkInChild(childId);
  res.json({ success: ok });
});

router.post("/auth/children/checkout", (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { childId } = req.body as { childId?: string };
  if (!childId) { res.status(400).json({ error: "childId required" }); return; }
  const ok = store.checkOutChild(childId);
  res.json({ success: ok });
});

router.get("/auth/children", (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const children = store.getChildrenForParent(req.session.userId);
  res.json({ children });
});

export default router;
