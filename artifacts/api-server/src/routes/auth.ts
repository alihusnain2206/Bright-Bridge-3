import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import { store } from "../store";

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
        permissions: ["timeclock", "timeclock.edit", "timesheet.view", "timesheet.edit", "schedule.view", "schedule.manage", "timeoff.view", "timeoff.manage", "reports.view"],
      },
      features: { geolocation: false, shiftNotes: true },
    };
  } else if (user.role === "manager") {
    payload = {
      employeeId: user.employeeId,
      organizationId: user.companyId,
      locationId: user.locationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        permissions: ["timeclock", "timesheet.view", "timesheet.edit", "schedule.view", "schedule.manage", "timeoff.view", "timeoff.manage"],
      },
      features: { geolocation: false, shiftNotes: true },
    };
  } else if (user.role === "employee") {
    payload = {
      employeeId: user.employeeId,
      organizationId: user.companyId,
      locationId: user.locationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      role: { name: user.position, hourlyWage: user.hourlyWage ?? 1500 },
      accessRole: {
        name: "employee",
        permissions: ["timeclock", "timesheet.view", "timeoff.request", "timeoff.view"],
      },
      features: { geolocation: true, shiftNotes: false },
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

  // Try token exchange
  try {
    const axios = (await import("axios")).default;
    const response = await axios.post<{ accessToken: string }>(
      "https://www.easyteam.io/sandbox/embed/api/auth/exchangeToken",
      { token: signedJwt },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    res.json({ token: response.data.accessToken, role: user.role, decoded: payload });
  } catch {
    res.json({
      token: signedJwt,
      role: user.role,
      decoded: payload,
      exchangeWarning: `Token exchange failed — using raw JWT. Set EASYTEAM_PARTNER_ID for full exchange.`,
    });
  }
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
