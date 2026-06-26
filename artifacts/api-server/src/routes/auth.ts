import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import { store } from "../store";
import { persistUserAccount } from "../lib/user-account-persist.js";
import { db, companies } from "@workspace/db";
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
  if (!user) return undefined;

  // 1. If user has an explicit locationId, try the in-memory store first
  if (user.locationId) {
    const storeLocation = store.getLocation(user.locationId);
    if (storeLocation) return storeLocation;
  }

  // 2. No store hit (or no explicit locationId) — derive from company.
  //    Mirrors the same chain used in token-by-role so /me and JWT are always consistent.
  if (!user.companyId) return undefined;

  // Check in-memory store company first (ORG-SUNSHINE / ORG-RAINBOW)
  const storeCompanyLocationId = store.getCompany(user.companyId)?.locationId;
  if (storeCompanyLocationId) {
    const storeLocation = store.getLocation(storeCompanyLocationId);
    if (storeLocation) return storeLocation;
  }

  // DB fallback for dynamically created companies (wizard-created, not in static store)
  const [dbCo] = await db.select().from(companies).where(eq(companies.id, user.companyId)).catch(() => [undefined]);
  if (dbCo?.rollfiLocationId) {
    const addr = [dbCo.address1, dbCo.city, dbCo.state].filter(Boolean).join(", ");
    return {
      id: dbCo.rollfiLocationId,
      name: dbCo.locationName ?? dbCo.name ?? "Your Location",
      organizationId: user.companyId,
      address: addr,
      latitude: 0,
      longitude: 0,
    };
  }

  return undefined;
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
  const company = store.getCompany(user.companyId);
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
  const company = store.getCompany(user.companyId);
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
  } else if (user.role === "manager") {
    // Same DB-fallback chain as employees so dynamic-company managers get the right locationId
    const mgrStoreLocation = store.getCompany(user.companyId ?? "")?.locationId;
    const mgrDbLocation = (!user.locationId && !mgrStoreLocation && user.companyId)
      ? await db.select({ rollfiLocationId: companies.rollfiLocationId })
          .from(companies)
          .where(eq(companies.id, user.companyId))
          .then((rows) => rows[0]?.rollfiLocationId ?? undefined)
          .catch(() => undefined)
      : undefined;
    const mgrLocationId = user.locationId ?? mgrStoreLocation ?? mgrDbLocation;
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: mgrLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        permissions: ["LOCATION_ADMIN", "LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE"],
      },
      role: { name: user.position, hourlyWage: (user.hourlyWage ?? 2500) / 100 },
      wage: (user.hourlyWage ?? 2500) / 100,
      wageType: "hourly",
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
    };
  } else if (user.role === "employee") {
    // Resolve locationId: user record first, then company (in-memory store), then DB fallback
    // for dynamically-created companies (wizard-created), then LOC-SUNSHINE as last resort.
    // The DB fallback is critical: without it, dynamic-company employees clock in at LOC-SUNSHINE
    // (a different location than where Pull Hours syncs), causing the manager to see 0 hours.
    const storeLocation = store.getCompany(user.companyId ?? "")?.locationId;
    const dbLocation = (!user.locationId && !storeLocation && user.companyId)
      ? await db.select({ rollfiLocationId: companies.rollfiLocationId })
          .from(companies)
          .where(eq(companies.id, user.companyId))
          .then((rows) => rows[0]?.rollfiLocationId ?? undefined)
          .catch(() => undefined)
      : undefined;
    const empLocationId = user.locationId ?? storeLocation ?? dbLocation ?? "LOC-SUNSHINE";
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: empLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "employee",
        permissions: ["LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE"],
      },
      role: { name: user.position, hourlyWage: (user.hourlyWage ?? 1500) / 100 },
      wage: (user.hourlyWage ?? 1500) / 100,
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

  const { name, email, companyId, position } = req.body as {
    name?: string; email?: string; companyId?: string; position?: string;
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

  const { user, password } = store.createManagerUser({
    name,
    email,
    position: position ?? "Daycare Manager",
    companyId,
  });

  const fullUser = store.getUserByEmail(email);
  if (fullUser) {
    await persistUserAccount(fullUser).catch((err) => {
      req.log.warn({ err }, "Failed to persist manager user account to DB");
    });
  }

  req.log.info({ userId: user.id, name, companyId }, "Manager account created by super_admin");
  res.status(201).json({ ...user, password, loginEmail: email });
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
