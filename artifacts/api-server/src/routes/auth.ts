import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import { store } from "../store";
import { persistUserAccount } from "../lib/user-account-persist.js";
import { db, companies } from "@workspace/db";
import { eq } from "drizzle-orm";
import { registerEmployeeInEasyTeam } from "../lib/easyteam-employee-sync.js";

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

// ── Login ────────────────────────────────────────────────────

router.post("/auth/login", (req, res) => {
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
  const location = user.locationId ? store.getLocation(user.locationId) : undefined;
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

router.get("/auth/me", (req, res) => {
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
  const location = user.locationId ? store.getLocation(user.locationId) : undefined;
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
    payload = {
      employeeId: user.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId: user.locationId,
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
    // Resolve locationId: user record first, then company fallback, then LOC-SUNSHINE default
    const empLocationId = user.locationId
      ?? store.getCompany(user.companyId ?? "")?.locationId
      ?? "LOC-SUNSHINE";
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

  // For employees and managers: register/refresh with EasyTeam in the background.
  // EasyTeam upserts the employee on every exchangeToken call — this ensures dynamically
  // created employees (added after boot sync) are always registered.
  if (user.role === "employee" || user.role === "manager") {
    const locationId = (payload.locationId as string | undefined)
      ?? store.getCompany(user.companyId ?? "")?.locationId
      ?? "LOC-SUNSHINE";
    void registerEmployeeInEasyTeam(
      {
        id: user.employeeId ?? user.id,
        name: user.name,
        email: user.email,
        roleName: user.position ?? user.role,
        wage: (user.hourlyWage ?? 1500) / 100,
        wageType: "hourly",
      },
      locationId,
      req.log
    ).catch(() => { /* non-fatal — SDK handles its own exchange */ });
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
