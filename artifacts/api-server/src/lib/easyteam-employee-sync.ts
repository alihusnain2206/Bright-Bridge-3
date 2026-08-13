import axios from "axios";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { store } from "../store.js";
import { db, employees } from "@workspace/db";
import type { Logger } from "pino";
import { resolveEasyTeamOrgId } from "./easyteam-org.js";

function normalizePemKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.includes("\n")) return raw;
  const body = raw.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, "").trim();
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN RSA PRIVATE KEY-----\n${lines.join("\n")}\n-----END RSA PRIVATE KEY-----`;
}

const EASYTEAM_API_KEY    = normalizePemKey(process.env.EASYTEAM_API_KEY);
const EASYTEAM_PARTNER_ID = process.env.EASYTEAM_PARTNER_ID;
const EASYTEAM_SANDBOX_URL = "https://www.easyteam.io/embed";

export interface EasyTeamRegistrationResult {
  success: boolean;
  easyteamEmployeeId?: string;
  error?: string;
}

/**
 * Register an employee in EasyTeam by performing a token exchange with their
 * own employee-level JWT. EasyTeam creates (or looks up) the employee record
 * the moment their JWT is exchanged — there is no separate "create employee"
 * endpoint in the embed API. This is the canonical registration path.
 *
 * On success this function ALWAYS:
 *   1. Updates the in-memory etUuidToEmployeeId map (store.setEasyTeamUuidMapping)
 *   2. Persists easyteam_uuid to the DB employees row (non-fatal if no row exists)
 *
 * Callers do NOT need to call setEasyTeamUuidMapping themselves — it happens here
 * so no call-site can forget it.
 */
export async function registerEmployeeInEasyTeam(
  employee: { id: string; name: string; email?: string; roleName: string; wage: number; wageType: string },
  locationId: string,
  companyId?: string,
  log?: Logger
): Promise<EasyTeamRegistrationResult> {
  if (!EASYTEAM_API_KEY) {
    return { success: false, error: "EasyTeam API key not configured" };
  }

  // Find the matching staff user so we can use their canonical EasyTeam employeeId
  const staffUser = store.getAllStaffUsers().find(
    (u) => u.email === employee.email || u.employeeId === employee.id
  );

  // The EasyTeam employeeId must match what the SDK iframe will use for this person.
  // Staff users have a dedicated employeeId (e.g. EMP-RAINBOW-002); fall back to
  // our internal client-employee id if there's no staff user record.
  const etEmployeeId = staffUser?.employeeId ?? employee.id;

  try {
    const employeeJwt = jwt.sign(
      {
        employeeId: etEmployeeId,
        organizationId: await resolveEasyTeamOrgId(companyId),
        locationId,
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: {
          name: "employee",
          permissions: ["SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE", "TIMESHEET_READ"],
        },
        role: { name: employee.roleName, hourlyWage: employee.wage },
        wage: employee.wage,
        wageType: employee.wageType,
        features: { geolocation: false, shiftNotes: true, timesheet_badges: true },
      },
      EASYTEAM_API_KEY,
      { algorithm: "RS256", expiresIn: "8h" }
    );

    // Exchanging the token is what registers the employee in EasyTeam's system.
    // EasyTeam upserts the employee on every exchange — no separate POST needed.
    const resp = await axios.post<{ accessToken: string }>(
      `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
      { token: employeeJwt },
      { timeout: 8000 }
    );

    const accessToken = resp.data.accessToken;

    // Decode to extract EasyTeam's internal UUID for this employee
    let easyteamEmployeeId: string | undefined;
    try {
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1]!, "base64url").toString("utf8")
        ) as Record<string, unknown>;
        if (typeof payload.employeeId === "string") easyteamEmployeeId = payload.employeeId;
      }
    } catch { /* non-fatal */ }

    log?.info(
      { clientEmployeeId: employee.id, etEmployeeId, name: employee.name, easyteamEmployeeId },
      "Employee registered in EasyTeam via token exchange"
    );

    if (easyteamEmployeeId) {
      // ── ONE PLACE, THREE DOORS ──────────────────────────────────────────────
      // Always update the in-memory UUID map immediately so the current process
      // can resolve shifts for this employee without waiting for a restart.
      store.setEasyTeamUuidMapping(easyteamEmployeeId, employee.id);

      // Persist to DB so every future server restart can repopulate the map
      // from the DB column (fast, no API calls). Non-fatal: if no DB row exists
      // for this employee (e.g. store-only employees created via quick-add),
      // the UPDATE affects 0 rows and is harmlessly ignored.
      try {
        await db
          .update(employees)
          .set({ easyteamUuid: easyteamEmployeeId, easyteamSynced: true })
          .where(eq(employees.id, employee.id));
      } catch (dbErr) {
        log?.warn({ employeeId: employee.id, dbErr }, "EasyTeam UUID: DB persist failed (non-fatal — mapping still active in memory)");
      }
      // ── END ONE PLACE ───────────────────────────────────────────────────────
    }

    return { success: true, easyteamEmployeeId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ clientEmployeeId: employee.id, name: employee.name, err: msg }, "EasyTeam employee registration failed");
    return { success: false, error: msg };
  }
}
