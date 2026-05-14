import { Router, type IRouter } from "express";
import * as jwt from "jsonwebtoken";
import axios from "axios";
import { store } from "../store";

const router: IRouter = Router();

function normalizePemKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Replace literal \n sequences (common when stored in env vars)
  let key = raw.replace(/\\n/g, "\n").trim();

  // If the key has no proper newlines, reformat it as a valid PEM
  if (!key.includes("\n")) {
    // Extract header, body, footer
    const headerMatch = key.match(/^(-----BEGIN [^-]+-----)/);
    const footerMatch = key.match(/(-----END [^-]+-----)$/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const body = key.slice(header.length, key.length - footer.length).replace(/\s+/g, "");
      // Chunk body into 64-char lines
      const lines: string[] = [];
      for (let i = 0; i < body.length; i += 64) {
        lines.push(body.slice(i, i + 64));
      }
      key = `${header}\n${lines.join("\n")}\n${footer}`;
    }
  }

  return key;
}

const EASYTEAM_API_KEY = normalizePemKey(process.env.EASYTEAM_API_KEY);
const EASYTEAM_PARTNER_ID = process.env.EASYTEAM_PARTNER_ID;
const EASYTEAM_SANDBOX_URL = "https://www.easyteam.io/sandbox/embed";

const webhookLog: Array<{
  id: string;
  event: string;
  employee_id: string;
  timestamp: string;
  data: Record<string, unknown>;
  status: string;
}> = [];

router.get("/easyteam/status", (_req, res) => {
  const keyFirstLine = EASYTEAM_API_KEY?.split("\n")[0]?.slice(0, 40) ?? "";
  const keyLooksLikePem =
    !!EASYTEAM_API_KEY &&
    (EASYTEAM_API_KEY.includes("BEGIN RSA PRIVATE KEY") ||
      EASYTEAM_API_KEY.includes("BEGIN PRIVATE KEY"));
  res.json({
    connected: !!EASYTEAM_API_KEY,
    environment: "sandbox",
    apiKeyPresent: !!EASYTEAM_API_KEY,
    apiKeyLooksPem: keyLooksLikePem,
    apiKeyFirstLine: keyFirstLine,
    partnerIdPresent: !!EASYTEAM_PARTNER_ID,
    sdkVersion: "1.1.19",
    baseURL: EASYTEAM_SANDBOX_URL,
    lastChecked: new Date().toISOString(),
  });
});

router.post("/easyteam/token", async (req, res) => {
  const {
    employee_id,
    client_id,
    company_id,
    location_id,
    organization_id,
    role_name,
    access_role,
  } = req.body as {
    employee_id: string;
    client_id?: string;
    company_id?: string;
    location_id?: string;
    organization_id?: string;
    role_name?: string;
    access_role?: string;
  };

  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ success: false, error: "EASYTEAM_API_KEY not configured" });
    return;
  }

  // Resolve client and employee from store when client_id is provided
  let resolvedLocationId = location_id || company_id || "SANDBOX-LOC-001";
  let resolvedOrgId = organization_id || company_id || "SANDBOX-ORG-001";
  let resolvedRoleName = role_name || "Manager";
  let resolvedAccessRole = access_role || "manager";
  let resolvedWage = 1500;

  if (client_id) {
    const client = store.getClient(client_id);
    if (client) {
      resolvedLocationId = client.id;
      resolvedOrgId = client.id;
    }
  }

  if (employee_id) {
    const emp = store.getEmployee(employee_id);
    if (emp) {
      resolvedRoleName = emp.roleName;
      resolvedAccessRole = emp.role;
      resolvedWage = emp.wage;
    }
  }

  const payload = {
    employeeId: employee_id,
    locationId: resolvedLocationId,
    organizationId: resolvedOrgId,
    ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
    accessRole: {
      name: resolvedAccessRole,
      permissions: [
        "LOCATION_READ",
        "SHIFT_READ",
        "SHIFT_WRITE",
        "SHIFT_ADD",
        "SHIFT_UPDATE",
        "SCHEDULE_READ",
        "SCHEDULE_WRITE",
        "TIME_OFF_READ",
        "TIME_OFF_WRITE",
        "ORGANIZATION_ADMIN",
        "LOCATION_ADMIN",
      ],
    },
    role: {
      name: resolvedRoleName,
      hourlyWage: resolvedWage,
    },
    wage: resolvedWage,
    wageType: "hourly",
    features: {
      geolocation: false,
      shiftNotes: true,
      timesheet_badges: true,
      location_picker: true,
      timesheets_wages: true,
    },
  };

  let signedJwt: string;
  try {
    signedJwt = jwt.sign(payload, EASYTEAM_API_KEY, { algorithm: "RS256", expiresIn: "8h" });
  } catch (err) {
    const error = err as Error;
    req.log.error({ err }, "JWT signing failed");
    res.status(500).json({
      success: false,
      error: `JWT signing failed: ${error.message}`,
    });
    return;
  }

  req.log.info({ employeeId: employee_id, clientId: client_id }, "EasyTeam token generated");
  res.json({ success: true, token: signedJwt });
});

router.get("/easyteam/employees", (_req, res) => {
  const employees = [
    {
      id: "EMP-TEST-001",
      name: "John Smith",
      role: "manager",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1500,
      wageType: "hourly",
    },
    {
      id: "EMP-TEST-002",
      name: "Mary Johnson",
      role: "assistant",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1200,
      wageType: "hourly",
    },
    {
      id: "EMP-TEST-003",
      name: "Carlos Rivera",
      role: "cashier",
      locationId: "SANDBOX-LOC-001",
      timeTrackingEnabled: true,
      wage: 1000,
      wageType: "hourly",
    },
  ];
  res.json({ success: true, employees });
});

router.get("/easyteam/timesheets", (_req, res) => {
  res.json({
    success: true,
    timesheets: [],
    note: "Timesheet data is loaded inside the EasyTeam iframe via the SDK.",
  });
});

router.post("/easyteam/webhook", (req, res) => {
  const payload = req.body as {
    event?: string;
    employee_id?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  };

  const entry = {
    id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event: payload.event ?? "unknown",
    employee_id: payload.employee_id ?? "",
    timestamp: payload.timestamp ?? new Date().toISOString(),
    data: payload.data ?? (payload as Record<string, unknown>),
    status: "received",
  };

  webhookLog.unshift(entry);
  if (webhookLog.length > 50) webhookLog.splice(50);

  req.log.info({ event: entry.event, employee_id: entry.employee_id }, "Webhook received");
  res.json({ received: true, id: entry.id });
});

router.get("/easyteam/webhooks", (_req, res) => {
  res.json({ events: webhookLog, total: webhookLog.length });
});

router.post("/easyteam/test-connection", async (req, res) => {
  const apiKeyPresent = !!EASYTEAM_API_KEY;
  const partnerIdPresent = !!EASYTEAM_PARTNER_ID;
  let jwtSigning = false;
  let tokenExchange = false;
  const details: Record<string, unknown> = {};

  if (apiKeyPresent) {
    try {
      jwt.sign({ test: true }, EASYTEAM_API_KEY!, { algorithm: "RS256" });
      jwtSigning = true;
      details.signingMessage = "RS256 JWT signing with private key succeeded";
    } catch (err) {
      const error = err as Error;
      details.signingError = error.message;
    }
  }

  if (jwtSigning) {
    try {
      const testPayload = {
        employeeId: "TEST-EMP",
        locationId: "TEST-LOC",
        organizationId: "TEST-ORG",
        ...(EASYTEAM_PARTNER_ID ? { partnerId: EASYTEAM_PARTNER_ID } : {}),
        accessRole: { name: "manager", permissions: ["SHIFT_READ"] },
      };
      const testJwt = jwt.sign(testPayload, EASYTEAM_API_KEY!, { algorithm: "RS256" });
      const response = await axios.post<{ accessToken: string }>(
        `${EASYTEAM_SANDBOX_URL}/api/auth/exchangeToken`,
        { token: testJwt },
        { timeout: 8000 }
      );
      tokenExchange = !!response.data.accessToken;
      details.exchangeMessage = "Token exchange with EasyTeam sandbox succeeded";
    } catch (err) {
      const error = err as { message?: string; response?: { status?: number; data?: unknown } };
      details.exchangeError = error.message;
      details.exchangeStatus = error.response?.status;
      details.exchangeHint = partnerIdPresent
        ? "Exchange failed even with PARTNER_ID — check your key registration with EasyTeam"
        : "Set EASYTEAM_PARTNER_ID to enable full token exchange";
    }
  }

  res.json({
    apiConnection: apiKeyPresent,
    authentication: jwtSigning,
    tokenExchange,
    webhook: true,
    partnerIdPresent,
    details,
  });
});

export default router;
