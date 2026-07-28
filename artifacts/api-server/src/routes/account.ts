/**
 * Account Settings routes — available to ALL authenticated roles.
 *
 * GET    /api/account/me              → current user profile + photoUrl
 * PUT    /api/account/profile         → update display name (user_accounts only)
 * POST   /api/account/change-password → verify current + set new (bcrypt)
 * POST   /api/account/photo           → upload profile photo
 * DELETE /api/account/photo           → remove profile photo
 * GET    /api/account/photo           → serve own profile photo file
 *
 * ⚠️  Display name (user_accounts.name) is intentionally ISOLATED from
 *     employees.first_name / employees.last_name.  Changing it here never
 *     touches the employees table and never reaches the payroll provider.
 *
 * ⚠️  Accounts that exist only in the in-memory store (e.g. USER-001 Joanne,
 *     static demo accounts seeded before the DB-persist flow was introduced)
 *     are NOT present in the user_accounts table.  Password changes and
 *     photo uploads require a DB row; those accounts receive a clear error.
 */
import { Router, type Request, type Response } from "express";
import * as bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, userAccounts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware.js";
import { store } from "../store.js";

const router = Router();

// ── File storage ──────────────────────────────────────────────
const PHOTO_DIR = path.resolve("uploads/account-photos");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ── GET /api/account/me ───────────────────────────────────────
router.get("/account/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const memUser = store.getUserById(userId);
  if (!memUser) { res.status(404).json({ error: "User not found" }); return; }

  // Fetch photoUrl from DB (not in in-memory store)
  const [dbRow] = await db
    .select({ photoUrl: userAccounts.photoUrl })
    .from(userAccounts)
    .where(eq(userAccounts.id, userId))
    .catch(() => [undefined]);

  // getUserById already strips password — spread directly
  res.json({ ...memUser, photoUrl: dbRow?.photoUrl ?? null });
});

// ── PUT /api/account/profile ──────────────────────────────────
// Updates user_accounts.name ONLY.  The employees table is never touched,
// and no call is made to the payroll provider.
router.put("/account/profile", requireAuth, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

  const userId = req.session.userId!;

  // Ensure user exists in the DB — static/hardcoded accounts cannot be updated here
  const [dbRow] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.id, userId))
    .catch(() => [undefined]);

  if (!dbRow) {
    res.status(400).json({
      error:
        "This account is managed by the system and cannot be edited here. " +
        "Contact your administrator to update your display name.",
    });
    return;
  }

  const trimmed = name.trim();

  // Update DB
  await db.update(userAccounts).set({ name: trimmed }).where(eq(userAccounts.id, userId));

  // Sync in-memory store so /auth/me reflects the change immediately.
  // getRawUser returns the actual TestUser reference (getUserById returns a stripped copy).
  const rawUser = store.getRawUser(userId);
  if (rawUser) rawUser.name = trimmed;

  res.json({ success: true, name: trimmed });
});

// ── POST /api/account/change-password ────────────────────────
router.post("/account/change-password", requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword, confirmPassword } =
    req.body as { currentPassword?: string; newPassword?: string; confirmPassword?: string };

  if (!currentPassword || !newPassword || !confirmPassword) {
    res.status(400).json({ error: "All three fields are required" }); return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: "New passwords do not match" }); return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }

  const userId = req.session.userId!;

  // Only accounts that have a DB row can have their password changed.
  // USER-001 (Joanne) and other static demo accounts live only in the
  // in-memory store and are not in user_accounts — they receive a clear error.
  const [dbRow] = await db
    .select({ password: userAccounts.password })
    .from(userAccounts)
    .where(eq(userAccounts.id, userId))
    .catch(() => [undefined]);

  if (!dbRow) {
    res.status(400).json({
      error:
        "This account uses system-managed credentials. " +
        "Password changes are not available for this account — contact your administrator.",
    });
    return;
  }

  // Verify current password — supports both legacy plain-text and bcrypt hashes
  const storedPw = dbRow.password;
  const isMatch = storedPw.startsWith("$2b$") || storedPw.startsWith("$2a$")
    ? await bcrypt.compare(currentPassword, storedPw)
    : storedPw === currentPassword;

  if (!isMatch) {
    res.status(400).json({ error: "Current password is incorrect" }); return;
  }

  // Hash new password with bcrypt
  const hashed = await bcrypt.hash(newPassword, 12);

  // Persist to DB
  await db.update(userAccounts).set({ password: hashed }).where(eq(userAccounts.id, userId));

  // Sync in-memory store so subsequent logins work without a restart.
  // getRawUser returns the actual TestUser reference (getUserById returns a stripped copy).
  const rawUser = store.getRawUser(userId);
  if (rawUser) rawUser.password = hashed;

  res.json({ success: true });
});

// ── POST /api/account/photo ───────────────────────────────────
router.post(
  "/account/photo",
  requireAuth,
  (req: Request, res: Response, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) { res.status(400).json({ error: err.message ?? "Upload failed" }); return; }
      next();
    });
  },
  async (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const userId = req.session.userId!;
    const [dbRow] = await db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.id, userId))
      .catch(() => [undefined]);

    if (!dbRow) {
      res.status(400).json({
        error: "Profile photos can only be set on database-persisted accounts.",
      });
      return;
    }

    // Remove any prior photo files for this user
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const old = path.join(PHOTO_DIR, `${userId}.${ext}`);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    // Save new file
    const mime = req.file.mimetype;
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const filename = `${userId}.${ext}`;
    fs.writeFileSync(path.join(PHOTO_DIR, filename), req.file.buffer);

    // Store a timestamp-busted URL so the browser reloads the image
    const photoUrl = `/api/account/photo?t=${Date.now()}`;
    await db.update(userAccounts).set({ photoUrl }).where(eq(userAccounts.id, userId));

    res.json({ success: true, photoUrl });
  },
);

// ── DELETE /api/account/photo ─────────────────────────────────
router.delete("/account/photo", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const f = path.join(PHOTO_DIR, `${userId}.${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  await db
    .update(userAccounts)
    .set({ photoUrl: null })
    .where(eq(userAccounts.id, userId))
    .catch(() => {});

  res.json({ success: true });
});

// ── GET /api/account/photo ────────────────────────────────────
// Serves the authenticated user's own profile photo.
router.get("/account/photo", requireAuth, (req: Request, res: Response) => {
  const userId = req.session.userId!;
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const fp = path.join(PHOTO_DIR, `${userId}.${ext}`);
    if (fs.existsSync(fp)) {
      res.sendFile(fp);
      return;
    }
  }
  res.status(404).json({ error: "No profile photo uploaded" });
});

export default router;
