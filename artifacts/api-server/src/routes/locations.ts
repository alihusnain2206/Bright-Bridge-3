/**
 * Locations routes — owner + super_admin only (manager: read-only).
 *
 * GET    /api/locations             — list all locations for a company
 * POST   /api/locations             — create a new location (+ Rollfi + EasyTeam registration)
 * PUT    /api/locations/:id         — update code/name/address
 * DELETE /api/locations/:id         — soft-deactivate (blocked if active employees assigned)
 */
import { Router, type Request, type Response, type IRouter } from "express";
import axios from "axios";
import {
  db,
  locations as locationsTable,
  employees as employeesTable,
  rollfiCompanyRecords,
  companies as companiesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireRole } from "../lib/auth-middleware.js";
import { store } from "../store.js";
import { getRollfiConfig } from "../lib/rollfi-config.js";
import { extractRollfiError } from "../lib/rollfi-employee-sync.js";
import { ensureLocationTimezone, ensureTimeOffPolicy } from "./easyteam.js";

const router: IRouter = Router();
function nowIso() { return new Date().toISOString(); }

// ── Helper: resolve caller companyId with super_admin override ─────────────────
function callerCompanyId(req: Request, bodyOrQuery?: { companyId?: string }): string | null {
  const caller = store.getUserById((req.session as { userId?: string }).userId ?? "");
  if (!caller) return null;
  if (caller.role === "super_admin") return bodyOrQuery?.companyId ?? null;
  return caller.companyId;
}

// ── GET /api/locations ─────────────────────────────────────────────────────────
router.get("/locations", requireRole("super_admin", "owner", "manager"), async (req: Request, res: Response) => {
  const caller = store.getUserById((req.session as { userId?: string }).userId ?? "");
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const companyIdQ = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
  const companyId = caller.role === "super_admin" ? companyIdQ : caller.companyId;

  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  try {
    const rows = await db.select().from(locationsTable)
      .where(eq(locationsTable.companyId, companyId))
      .orderBy(locationsTable.code);
    res.json({ locations: rows });
  } catch (err) {
    req.log.error({ err }, "GET /locations failed");
    res.status(500).json({ error: "Failed to list locations" });
  }
});

// ── POST /api/locations ────────────────────────────────────────────────────────
router.post("/locations", requireRole("super_admin", "owner"), async (req: Request, res: Response) => {
  const body = req.body as {
    companyId?: string;
    code?: string;
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };

  const companyId = callerCompanyId(req, body);
  if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }

  const caller = store.getUserById((req.session as { userId?: string }).userId ?? "");
  if (caller?.role === "owner" && companyId !== caller.companyId) {
    res.status(403).json({ error: "Not authorized for this company" }); return;
  }

  const code = (body.code ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!code) { res.status(400).json({ error: "code is required" }); return; }
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Uniqueness: code must be unique per company (active + inactive)
  const [clash] = await db.select({ id: locationsTable.id })
    .from(locationsTable)
    .where(and(eq(locationsTable.companyId, companyId), eq(locationsTable.code, code)));
  if (clash) {
    res.status(409).json({ error: `Location code "${code}" is already in use for this company.` }); return;
  }

  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    const rowId = randomUUID();

    // easyteamLocationId: stable UUID-based ID so code/name changes don't break existing JWTs
    const easyteamLocationId = rowId;

    // Insert the location row FIRST — always saved regardless of provider results
    await db.insert(locationsTable).values({
      id: rowId,
      companyId,
      code,
      name,
      address1: body.address1 ?? "",
      address2: body.address2 ?? null,
      city: body.city ?? "",
      state: body.state ?? "",
      zipcode: body.zipcode ?? "",
      easyteamLocationId,
      rollfiLocationId: null,   // populated below if Rollfi succeeds
      isActive: true,
      createdAt: nowIso(),
    });

    // ── Rollfi: addCompanyLocation (best-effort, skip for non-Rollfi companies) ──
    let rollfiWarning: string | null = null;
    const rollfiCo = await db.select().from(rollfiCompanyRecords)
      .where(eq(rollfiCompanyRecords.companyId, companyId)).then(r => r[0]);

    if (rollfiCo) {
      try {
        const rollfiCfg = getRollfiConfig();
        const encoded = Buffer.from(`${rollfiCfg.clientId ?? ""}:${rollfiCfg.secretKey ?? ""}`).toString("base64");
        const headers = { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
        const payload = {
          method: "addCompanyLocation",
          companyLocation: {
            companyId: rollfiCo.rollfiCompanyId,
            companyLocation: name,
            address1: body.address1 ?? "",
            address2: body.address2 ?? "",
            city: body.city ?? "",
            state: body.state ?? "",
            zipcode: body.zipcode ?? "",
            phoneNumber: company?.phone?.replace(/\D/g, "").slice(-10) || "9733330001",
            isWorkLocation: true,
            isMailingAddress: false,
            isFilingAddress: false,
          },
        };
        req.log.info({ payload }, "POST /locations: Rollfi addCompanyLocation");
        const r = await axios.post(`${rollfiCfg.baseUrl}/companyOnboarding/addCompanyLocation`, payload, { headers, timeout: 15000 });
        const rollfiErr = extractRollfiError(r.data as Record<string, unknown>);
        if (rollfiErr) {
          rollfiWarning = `Rollfi: ${rollfiErr}`;
          req.log.warn({ rollfiErr, rowId }, "POST /locations: Rollfi error in response body (non-fatal)");
        } else {
          const data = r.data as Record<string, unknown>;
          // Documented response: { companyLocation: { companyLocationId, status, message } }
          // Fallback paths in case Rollfi varies the envelope key
          const inner = (data.companyLocation ?? data.registration ?? data) as Record<string, unknown>;
          const rollfiLocId = String(inner.companyLocationId ?? inner.locationId ?? inner.companyLocationID ?? "").trim();
          if (rollfiLocId) {
            await db.update(locationsTable).set({ rollfiLocationId: rollfiLocId }).where(eq(locationsTable.id, rowId));
            req.log.info({ rollfiLocId, rowId }, "POST /locations: Rollfi location registered");
          } else {
            rollfiWarning = "Rollfi accepted the request but returned no companyLocationId.";
            req.log.warn({ data, rowId }, "POST /locations: Rollfi returned no companyLocationId");
          }
        }
      } catch (err) {
        const axErr = err as { message?: string; response?: { status?: number; data?: unknown } };
        rollfiWarning = axErr.response
          ? `Rollfi HTTP ${axErr.response.status ?? "?"}: ${JSON.stringify(axErr.response.data)}`
          : (axErr.message ?? "Rollfi call failed");
        req.log.warn({ rollfiWarning, rowId }, "POST /locations: Rollfi addCompanyLocation failed (non-fatal)");
      }
    }

    // ── EasyTeam: configure the new location (best-effort) ────────────────────
    // EasyTeam auto-creates the location on first JWT exchange; these calls configure it.
    let easyteamWarning: string | null = null;
    try {
      const tzResult = await ensureLocationTimezone(easyteamLocationId, { country: "US", state: body.state || "NJ" });
      if (!tzResult.ok) easyteamWarning = `EasyTeam timezone: ${tzResult.detail ?? "failed"}`;

      // ensureTimeOffPolicy returns 404 on orgs that don't have the policy feature enabled.
      // This is a known permanent limitation — log it but never surface it to the owner.
      const polResult = await ensureTimeOffPolicy(easyteamLocationId);
      if (!polResult.ok) {
        req.log.warn({ detail: polResult.detail, rowId }, "POST /locations: time-off policy setup skipped (non-fatal, not shown to user)");
      }
    } catch (err) {
      easyteamWarning = `EasyTeam setup: ${String(err)}`;
      req.log.warn({ err, rowId }, "POST /locations: EasyTeam location setup failed (non-fatal)");
    }

    // Re-fetch with any IDs set by provider calls
    const [saved] = await db.select().from(locationsTable).where(eq(locationsTable.id, rowId));

    const warnings: string[] = [];
    if (rollfiWarning) warnings.push(rollfiWarning);
    if (easyteamWarning) warnings.push(easyteamWarning);

    res.status(201).json({ location: saved, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (err) {
    req.log.error({ err }, "POST /locations failed");
    res.status(500).json({ error: "Failed to create location" });
  }
});

// ── PUT /api/locations/:id ─────────────────────────────────────────────────────
router.put("/locations/:id", requireRole("super_admin", "owner"), async (req: Request, res: Response) => {
  const caller = store.getUserById((req.session as { userId?: string }).userId ?? "");
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = String(req.params.id);
  const body = req.body as {
    code?: string; name?: string;
    address1?: string; address2?: string;
    city?: string; state?: string; zipcode?: string;
    isActive?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  };

  try {
    const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.id, id));
    if (!loc) { res.status(404).json({ error: "Location not found" }); return; }
    if (caller.role === "owner" && loc.companyId !== caller.companyId) {
      res.status(403).json({ error: "Not authorized for this location" }); return;
    }

    // Code uniqueness when changing code
    if (body.code !== undefined && body.code.trim() !== loc.code) {
      const [existing] = await db.select({ id: locationsTable.id })
        .from(locationsTable)
        .where(and(eq(locationsTable.companyId, loc.companyId), eq(locationsTable.code, body.code.trim())));
      if (existing) {
        res.status(409).json({ error: `Location code "${body.code.trim()}" is already in use for this company.` }); return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.code      !== undefined) updates.code      = body.code.trim();
    if (body.name      !== undefined) updates.name      = body.name.trim();
    if (body.address1  !== undefined) updates.address1  = body.address1;
    if (body.address2  !== undefined) updates.address2  = body.address2 || null;
    if (body.city      !== undefined) updates.city      = body.city;
    if (body.state     !== undefined) updates.state     = body.state;
    if (body.zipcode   !== undefined) updates.zipcode   = body.zipcode;
    if (body.latitude  !== undefined) updates.latitude  = body.latitude;
    if (body.longitude !== undefined) updates.longitude = body.longitude;

    // ── isActive toggle ────────────────────────────────────────────────────────
    if (body.isActive === false && loc.isActive) {
      // Deactivation: block if this is the primary location
      if ((loc as Record<string, unknown>).isPrimary) {
        res.status(409).json({ error: "Cannot deactivate the primary location. Designate another location as primary first." });
        return;
      }
      // Block if active employees are assigned
      const activeEmps = await db.select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.locationId, id), eq(employeesTable.status, "active")));
      if (activeEmps.length > 0) {
        res.status(409).json({
          error: `Reassign ${activeEmps.length} employee${activeEmps.length !== 1 ? "s" : ""} before deactivating this location.`,
          assignedCount: activeEmps.length,
        });
        return;
      }
      updates.isActive = false;
    } else if (body.isActive === true && !loc.isActive) {
      // Activation: coordinates (lat/lng) must exist (in update or already in DB)
      const finalLat = body.latitude  ?? (loc as Record<string, unknown>).latitude as number | null | undefined;
      const finalLng = body.longitude ?? (loc as Record<string, unknown>).longitude as number | null | undefined;
      if (finalLat == null || finalLng == null) {
        res.status(400).json({ error: "Coordinates (latitude and longitude) are required before activating a location. Fill them in and save, then activate." });
        return;
      }
      updates.isActive  = true;
      updates.latitude  = finalLat;
      updates.longitude = finalLng;
    }

    if (Object.keys(updates).length === 0) { res.json({ location: loc, noChange: true }); return; }

    await db.update(locationsTable).set(updates).where(eq(locationsTable.id, id));

    // ── EasyTeam: re-run setup if location just got activated ─────────────────
    let easyteamWarning: string | null = null;
    if (body.isActive === true && !loc.isActive && loc.easyteamLocationId) {
      const stateToUse = (updates.state as string | undefined) ?? loc.state;
      try {
        const tzResult = await ensureLocationTimezone(loc.easyteamLocationId, { country: "US", state: stateToUse || "NJ" });
        if (!tzResult.ok) easyteamWarning = `EasyTeam timezone: ${tzResult.detail ?? "failed"}`;

        const polResult = await ensureTimeOffPolicy(loc.easyteamLocationId);
        if (!polResult.ok) {
          const polMsg = `EasyTeam time-off policy: ${polResult.detail ?? "failed"}`;
          easyteamWarning = easyteamWarning ? `${easyteamWarning}; ${polMsg}` : polMsg;
          req.log.warn({ detail: polResult.detail, id }, "PUT /locations: time-off policy setup failed on activation");
        }
      } catch (err) {
        easyteamWarning = `EasyTeam setup: ${String(err)}`;
        req.log.warn({ err, id }, "PUT /locations: EasyTeam setup failed on activation (non-fatal)");
      }
    }

    // Rollfi: update address if changed and rollfiLocationId exists
    let rollfiWarning: string | null = null;
    const addressChanged = ["address1","address2","city","state","zipcode"].some(k => k in updates);
    if (addressChanged && loc.rollfiLocationId) {
      try {
        const rollfiCo = await db.select().from(rollfiCompanyRecords)
          .where(eq(rollfiCompanyRecords.companyId, loc.companyId)).then(r => r[0]);
        if (rollfiCo) {
          const rollfiCfg = getRollfiConfig();
          const encoded = Buffer.from(`${rollfiCfg.clientId ?? ""}:${rollfiCfg.secretKey ?? ""}`).toString("base64");
          const headers = { Authorization: `Basic ${encoded}`, "Content-Type": "application/json" };
          const locPayload: Record<string, string> = { companyLocationId: loc.rollfiLocationId };
          if (updates.address1) locPayload.address1 = updates.address1 as string;
          if (updates.address2) locPayload.address2 = updates.address2 as string;
          if (updates.city)     locPayload.city     = updates.city as string;
          if (updates.state)    locPayload.state    = updates.state as string;
          if (updates.zipcode)  locPayload.zipcode  = updates.zipcode as string;
          const r = await axios.post(
            `${rollfiCfg.baseUrl}/adminPortal/updateCompanyLocation`,
            { method: "updateCompanyLocation", companyLocation: locPayload },
            { headers, timeout: 15000 }
          );
          const rollfiErr = extractRollfiError(r.data as Record<string, unknown>);
          if (rollfiErr) rollfiWarning = `Rollfi: ${rollfiErr}`;
        }
      } catch (err) {
        const axErr = err as { message?: string };
        rollfiWarning = `Rollfi update failed: ${axErr.message ?? "unknown"}`;
        req.log.warn({ err, id }, "PUT /locations: Rollfi updateCompanyLocation failed (non-fatal)");
      }
    }

    // EasyTeam: re-patch timezone if state changed (skip if we already ran setup above for activation)
    if (updates.state && loc.easyteamLocationId && body.isActive !== true) {
      ensureLocationTimezone(loc.easyteamLocationId, { country: "US", state: updates.state as string })
        .catch(() => { /* non-fatal, already logged inside */ });
    }

    const [updated] = await db.select().from(locationsTable).where(eq(locationsTable.id, id));
    const allWarnings: string[] = [];
    if (rollfiWarning) allWarnings.push(rollfiWarning);
    if (easyteamWarning) allWarnings.push(easyteamWarning);
    res.json({ location: updated, warnings: allWarnings.length > 0 ? allWarnings : undefined });
  } catch (err) {
    req.log.error({ err }, "PUT /locations failed");
    res.status(500).json({ error: "Failed to update location" });
  }
});

// ── DELETE /api/locations/:id ──────────────────────────────────────────────────
router.delete("/locations/:id", requireRole("super_admin", "owner"), async (req: Request, res: Response) => {
  const caller = store.getUserById((req.session as { userId?: string }).userId ?? "");
  if (!caller) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = String(req.params.id);

  try {
    const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.id, id));
    if (!loc) { res.status(404).json({ error: "Location not found" }); return; }
    if (caller.role === "owner" && loc.companyId !== caller.companyId) {
      res.status(403).json({ error: "Not authorized for this location" }); return;
    }

    // Guard: block deactivation of the primary location
    if ((loc as Record<string, unknown>).isPrimary) {
      res.status(409).json({ error: "Cannot deactivate the primary location. Designate another location as primary first." });
      return;
    }

    // Guard: block if any ACTIVE employees are assigned here
    const activeEmps = await db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
      .from(employeesTable)
      .where(and(eq(employeesTable.locationId, id), eq(employeesTable.status, "active")));

    if (activeEmps.length > 0) {
      res.status(409).json({
        error: `Reassign ${activeEmps.length} employee${activeEmps.length !== 1 ? "s" : ""} before deactivating this location.`,
        assignedCount: activeEmps.length,
      });
      return;
    }

    await db.update(locationsTable).set({ isActive: false }).where(eq(locationsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /locations failed");
    res.status(500).json({ error: "Failed to deactivate location" });
  }
});

export default router;
