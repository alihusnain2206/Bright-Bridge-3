import axios from "axios";
import jwt from "jsonwebtoken";
import { store } from "../store.js";
import type { Logger } from "pino";

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
const EASYTEAM_EMBED_API   = "https://www.easyteam.io/embed/api";

export interface EasyTeamRegistrationResult {
  success: boolean;
  easyteamEmployeeId?: string;
  error?: string;
}

async function getAccessTokenForLocation(locationId: string): Promise<{ accessToken: string; internalOrgId: string; internalLocId: string } | null> {
  if (!EASYTEAM_API_KEY) return null;

  const managerUser = store.getAllStaffUsers().find((u) => u.locationId === locationId && u.role === "manager");
  if (!managerUser?.employeeId) return null;

  const adminJwt = jwt.sign(
    {
      employeeId: managerUser.employeeId,
      organizationId: "ORG-BRIGHTBRIDGE",
      locationId,
      ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
      accessRole: {
        name: "manager",
        permissions: [
          "LOCATION_ADMIN", "LOCATION_READ",
          "SHIFT_READ", "SHIFT_WRITE", "SHIFT_ADD", "SHIFT_UPDATE",
          "SCHEDULE_READ", "SCHEDULE_WRITE",
          "TIMESHEET_READ", "TIMESHEET_WRITE",
          "EMPLOYEE_READ", "EMPLOYEE_WRITE", "EMPLOYEE_ADD",
        ],
      },
      role: { name: managerUser.position ?? "Daycare Manager", hourlyWage: 2500 },
      wage: 2500, wageType: "hourly",
      features: { geolocation: false, shiftNotes: true, timesheet_badges: true, location_picker: true, timesheets_wages: true },
    },
    EASYTEAM_API_KEY,
    { algorithm: "RS256", expiresIn: "8h" }
  );

  const exchangeResp = await axios.post<{ accessToken: string }>(
    `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
    { token: adminJwt },
    { timeout: 8000 }
  );
  const accessToken = exchangeResp.data.accessToken;

  let internalOrgId = "ORG-BRIGHTBRIDGE";
  let internalLocId = locationId;
  try {
    const parts = accessToken.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
      if (typeof payload.organizationId === "string") internalOrgId = payload.organizationId;
      if (typeof payload.locationId    === "string") internalLocId  = payload.locationId;
    }
  } catch { /* keep defaults */ }

  return { accessToken, internalOrgId, internalLocId };
}

export async function registerEmployeeInEasyTeam(
  employee: { id: string; name: string; email?: string; roleName: string; wage: number; wageType: string },
  locationId: string,
  log?: Logger
): Promise<EasyTeamRegistrationResult> {
  if (!EASYTEAM_API_KEY) {
    return { success: false, error: "EasyTeam API key not configured" };
  }

  try {
    const tokenInfo = await getAccessTokenForLocation(locationId);
    if (!tokenInfo) {
      return { success: false, error: "Could not obtain EasyTeam access token — no manager found for this location" };
    }

    const { accessToken, internalOrgId, internalLocId } = tokenInfo;
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    const nameParts = employee.name.trim().split(/\s+/);
    const firstName = nameParts[0] ?? employee.name;
    const lastName  = nameParts.slice(1).join(" ") || firstName;

    const payload = {
      firstName,
      lastName,
      email:              employee.email ?? `${employee.id}@brightbridge.local`,
      externalId:         employee.id,
      role:               { name: employee.roleName },
      wage:               employee.wage,
      wageType:           employee.wageType,
      timeTrackingEnabled: true,
    };

    const candidateEndpoints = [
      `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/locations/${internalLocId}/employees`,
      `${EASYTEAM_EMBED_API}/organizations/${internalOrgId}/employees`,
      `${EASYTEAM_EMBED_API}/locations/${internalLocId}/employees`,
    ];

    for (const endpoint of candidateEndpoints) {
      try {
        const resp = await axios.post<{ id?: string; employeeId?: string; employee?: { id?: string } }>(
          endpoint,
          payload,
          { headers, timeout: 8000, validateStatus: () => true }
        );

        log?.info({ endpoint, status: resp.status, data: resp.data }, "EasyTeam employee registration attempt");

        if (resp.status >= 200 && resp.status < 300) {
          const easyteamEmployeeId =
            resp.data.id ?? resp.data.employeeId ?? resp.data.employee?.id;
          log?.info({ employeeId: employee.id, name: employee.name, easyteamEmployeeId }, "Employee registered in EasyTeam");
          return { success: true, easyteamEmployeeId };
        }

        if (resp.status === 409) {
          log?.info({ employeeId: employee.id }, "Employee already exists in EasyTeam (409 conflict) — treating as success");
          return { success: true };
        }
      } catch { /* try next endpoint */ }
    }

    return {
      success: false,
      error: "EasyTeam employee registration endpoint not available in sandbox — employee will self-register on first Time Clock use",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ employeeId: employee.id, err: msg }, "EasyTeam employee registration failed");
    return { success: false, error: msg };
  }
}
