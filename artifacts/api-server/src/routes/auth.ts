import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { store } from "../store";
import { persistUserAccount } from "../lib/user-account-persist.js";
import { resolveCompanyLocationId, resolveEmployeeLocationId } from "../lib/location.js";
import { resolveEasyTeamOrgId } from "../lib/easyteam-org.js";
import { db, companies, userAccounts, employees as employeesTable, passwordResetTokens } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { sendPasswordResetEmail, APP_URL } from "../lib/email.js";

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
  // Always check the DB so we can surface easyteamOrgId (set when the company was created).
  // DB wins over store for shared fields; the spread preserves store-only fields (e.g.
  // latitude/longitude for seeded demo companies that may have no DB row or a sparse one).
  const [dbCo] = await db.select().from(companies).where(eq(companies.id, companyId)).catch(() => [undefined]);
  if (dbCo) return { ...storeCo, ...dbCo };
  return storeCo ?? undefined;
}

// ── Login ────────────────────────────────────────────────────

/** Shape returned by the DB fallback path. Mirrors TestUser closely enough for auth. */
async function loadUserFromDb(email: string): Promise<import("../store.js").TestUser | undefined> {
  const [row] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, email.toLowerCase()))
    .catch(() => [undefined]);
  if (!row) return undefined;
  // Deactivated DB accounts are rejected outright
  if (row.isActive === false) return undefined;
  return {
    id:         row.id,
    name:       row.name,
    email:      row.email,
    password:   row.password,
    role:       row.role as import("../store.js").UserRole,
    companyId:  row.companyId ?? "",
    locationId: row.locationId ?? undefined,
    employeeId: row.employeeId ?? null,
    position:   row.position ?? "",
    isActive:   row.isActive,
  };
}

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  // 1. In-memory store — covers hardcoded testUsers + all boot-loaded DB accounts
  let user = store.getUserByEmail(email);

  // 2. DB fallback — catches newly-created platform accounts that weren't present at boot
  //    (e.g. created via POST /api/admin/platform-users after the server started, in a
  //    different process, or before the first restart). Only bcrypt-compare on this path.
  let fromDbFallback = false;
  if (!user) {
    const dbUser = await loadUserFromDb(email);
    if (dbUser) {
      // Push into store so getUserById works for the rest of this session
      store.addTestUser(dbUser);
      user = dbUser;
      fromDbFallback = true;
    }
  }

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // DB-fallback accounts must use bcrypt (they were created with a bcrypt hash).
  // In-memory accounts support both legacy plaintext and bcrypt hashes.
  const storedPw = user.password;
  let isMatch: boolean;
  if (fromDbFallback) {
    // Strict: DB fallback always bcrypt-only
    isMatch = (storedPw.startsWith("$2b$") || storedPw.startsWith("$2a$"))
      ? await bcrypt.compare(password, storedPw)
      : false;
  } else {
    // Legacy plaintext or bcrypt — existing behaviour unchanged
    isMatch = (storedPw.startsWith("$2b$") || storedPw.startsWith("$2a$"))
      ? await bcrypt.compare(password, storedPw)
      : storedPw === password;
  }

  if (!isMatch) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Always re-read role + locationId from DB so role changes made after boot
  // (e.g. grant-access, change-role) take effect on the very next login without
  // requiring a server restart.
  const [freshDbRow] = await db
    .select({ role: userAccounts.role, locationId: userAccounts.locationId })
    .from(userAccounts)
    .where(eq(userAccounts.id, user.id))
    .catch(() => [undefined]);
  if (freshDbRow && (freshDbRow.role !== user.role || freshDbRow.locationId !== (user.locationId ?? null))) {
    req.log.info(
      { userId: user.id, storeRole: user.role, dbRole: freshDbRow.role },
      "Login: refreshing stale store role from DB"
    );
    user.role       = freshDbRow.role as import("../store.js").UserRole;
    user.locationId = freshDbRow.locationId ?? undefined;
    // Patch the store entry so /auth/me returns the same fresh values
    const storeEntry = store.getUserById(user.id);
    if (storeEntry) {
      storeEntry.role       = user.role;
      storeEntry.locationId = user.locationId;
    }
  }

  req.session.userId = user.id;
  const { password: _p, ...safeUser } = user;
  const company = await resolveUserCompany(user.companyId || undefined);
  const location = await resolveUserLocation(user.id);
  res.json({ user: safeUser, company, location });
});

// ── Forgot password ──────────────────────────────────────────

router.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    res.status(400).json({ error: "Email is required" }); return;
  }

  // Always respond with the same message to prevent email enumeration
  const ok = { message: "If that email is registered you will receive a reset link shortly." };

  const user = store.getUserByEmail(email.trim().toLowerCase());
  if (!user) { res.json(ok); return; }

  let token: string | null = null;

  // ── 1. Persist the token ──────────────────────────────────────
  try {
    const now = new Date().toISOString();
    token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await db.insert(passwordResetTokens).values({
      userId:    user.id,
      token,
      expiresAt,
      usedAt:    null,
      createdAt: now,
    });
  } catch (err) {
    req.log.error({ err, userId: user.id }, "forgot-password: failed to persist reset token");
    res.json(ok);
    return;
  }

  // ── 2. Send the email ─────────────────────────────────────────
  try {
    if (!APP_URL) {
      req.log.error({ userId: user.id }, "forgot-password: APP_URL environment variable is not set — cannot build reset link; email not sent. Set APP_URL to the production base URL (e.g. https://app.brightbridgeassist.com).");
      res.json(ok);
      return;
    }

    const resetLink = `${APP_URL}/reset-password?token=${token}`;

    await sendPasswordResetEmail({ to: user.email, name: user.name, resetLink });
    req.log.info({ userId: user.id }, "forgot-password: reset email sent");
  } catch (err) {
    req.log.error({ err, userId: user.id }, "forgot-password: reset token persisted but email delivery failed");
  }

  res.json(ok);
});

// ── Reset password ───────────────────────────────────────────

router.post("/auth/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token?.trim()) {
    res.status(400).json({ error: "Reset token is required" }); return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }

  const now = new Date().toISOString();

  // Find a valid (unused, unexpired) token
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token, token.trim()),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .catch(() => [undefined]);

  if (!row) {
    res.status(400).json({ error: "Reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);

  // Update the password in DB
  await db
    .update(userAccounts)
    .set({ password: hashed })
    .where(eq(userAccounts.id, row.userId));

  // Also update in-memory store so subsequent logins work without a restart.
  // getRawUser returns the actual TestUser reference; getUserById returns a
  // password-stripped copy, so mutating it would be a dead write.
  const rawUser = store.getRawUser(row.userId);
  if (rawUser) rawUser.password = hashed;

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, row.id));

  req.log.info({ userId: row.userId }, "reset-password: password updated");
  res.json({ success: true });
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

  // 1. In-memory store (fast path)
  let user = store.getUserById(req.session.userId);

  // 2. DB fallback — for accounts added after boot (e.g. new platform accounts)
  if (!user) {
    const [row] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, req.session.userId))
      .catch(() => [undefined]);
    if (row && row.isActive !== false) {
      const dbUser: import("../store.js").TestUser = {
        id:         row.id,
        name:       row.name,
        email:      row.email,
        password:   row.password,
        role:       row.role as import("../store.js").UserRole,
        companyId:  row.companyId ?? "",
        locationId: row.locationId ?? undefined,
        employeeId: row.employeeId ?? null,
        position:   row.position ?? "",
        isActive:   row.isActive,
      };
      store.addTestUser(dbUser);
      const { password: _p, ...safe } = dbUser;
      user = safe;
    }
  }

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const company = await resolveUserCompany(user.companyId || undefined);
  const location = await resolveUserLocation(user.id);
  // Re-read role + locationId + photoUrl from DB on every /me call so that
  // role changes made after the server booted (grant-access, change-role, direct DB edits)
  // are reflected immediately — no logout/login required.
  const [dbRow] = await db
    .select({ photoUrl: userAccounts.photoUrl, role: userAccounts.role, locationId: userAccounts.locationId })
    .from(userAccounts)
    .where(eq(userAccounts.id, user.id))
    .catch(() => [undefined]);
  if (dbRow && (dbRow.role !== user.role || dbRow.locationId !== (user.locationId ?? null))) {
    req.log.info(
      { userId: user.id, storeRole: user.role, dbRole: dbRow.role },
      "/me: refreshing stale store role from DB"
    );
    // Patch the store so future lookups are also fresh
    const storeEntry = store.getUserById(user.id);
    if (storeEntry) {
      storeEntry.role       = dbRow.role as import("../store.js").UserRole;
      storeEntry.locationId = dbRow.locationId ?? undefined;
    }
    user = { ...user, role: dbRow.role as import("../store.js").UserRole, locationId: dbRow.locationId ?? undefined };
  }
  // getUserById already strips password — spread directly
  res.json({ user: { ...user, photoUrl: dbRow?.photoUrl ?? null }, company, location });
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
    // Company owner: org-wide EasyTeam access — no locationId in JWT so EasyTeam shows
    // all locations/employees in the timesheets summary.  Adding locationId scopes the
    // iframe to that specific location; if the value is our internal string (e.g.
    // "LOC-SUNSHINE") rather than EasyTeam's UUID it silently filters all shifts to 0m.
    payload = {
      employeeId: user.employeeId,
      organizationId: await resolveEasyTeamOrgId(user.companyId),
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
    // Resolution order: 1. employees.location_id (DB-authoritative — updated by PATCH /employees/:id)
    // → 2. user_accounts.location_id (in-memory fallback, covers seeded users without a DB employee row)
    // → 3. company primary location.  DB is checked FIRST so a location reassignment takes effect on
    // the very next token request without requiring a server restart or store refresh.
    const mgrLocationId = (user.employeeId ? (await resolveEmployeeLocationId(user.employeeId)) ?? undefined : undefined)
      ?? user.locationId
      ?? (user.companyId ? await resolveCompanyLocationId(user.companyId) : undefined);
    payload = {
      employeeId: user.employeeId,
      organizationId: await resolveEasyTeamOrgId(user.companyId),
      locationId: mgrLocationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        // LOCATION_ADMIN removed: grants org-wide location switching in EasyTeam UI.
        // Managers are scoped to their single assigned location only.
        permissions: ["LOCATION_READ", "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "SCHEDULE_READ", "SCHEDULE_WRITE", "TIMESHEET_READ", "TIMESHEET_WRITE"],
      },
      role: { name: user.position, hourlyWage: wageCents / 100 },
      wage: wageCents / 100,
      wageType: "hourly",
      // location_picker: false — prevents the EasyTeam "All locations" dropdown from appearing
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: false, timesheets_wages: true },
    };
  } else if (user.role === "employee") {
    // Resolution order: 1. employees.location_id (DB-authoritative — updated by PATCH /employees/:id)
    //   → 2. user_accounts.location_id (in-memory fallback, covers seeded/admin users without an employees row)
    //   → 3. company's is_primary location → 4. LOC-SUNSHINE (absolute last resort).
    // DB is checked FIRST so a location reassignment via PATCH /employees/:id takes effect on the very
    // next token request without requiring a server restart.  This is the core Phase 3 assertion.
    const empLocationId = (user.employeeId ? (await resolveEmployeeLocationId(user.employeeId)) ?? undefined : undefined)
      ?? user.locationId
      ?? (user.companyId ? await resolveCompanyLocationId(user.companyId) : "LOC-SUNSHINE")
      ?? "LOC-SUNSHINE";
    payload = {
      employeeId: user.employeeId,
      organizationId: await resolveEasyTeamOrgId(user.companyId),
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

  const { name, email, role, position, hourlyWage, password: submittedPassword } = req.body as {
    name?: string; email?: string;
    role?: "owner" | "employee";
    position?: string; hourlyWage?: number;
    password?: string;
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
      password: submittedPassword || undefined,
    });
    newUser = result.user;
    password = result.password;
  } else {
    const staffUser = store.createStaffUser({
      name, email,
      position: position ?? "Staff",
      hourlyWage: hourlyWage ?? 1500,
      companyId,
      password: submittedPassword || undefined,
    });
    newUser = staffUser;
    password = submittedPassword || "Staff123!";
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
