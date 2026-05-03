import { Router, type IRouter } from "express";
import axios from "axios";

const router: IRouter = Router();

const EASYTEAM_API_KEY = process.env.EASYTEAM_API_KEY;
const EASYTEAM_BASE_URL = "https://api.easyteam.com/v1";

const webhookLog: Array<{
  id: string;
  event: string;
  employee_id: string;
  timestamp: string;
  data: Record<string, unknown>;
  status: string;
}> = [];

router.get("/easyteam/status", (req, res) => {
  const apiKeyPresent = !!EASYTEAM_API_KEY;
  res.json({
    connected: apiKeyPresent,
    environment: "sandbox",
    apiKeyPresent,
    sdkVersion: "1.x",
    lastChecked: new Date().toISOString(),
  });
});

router.post("/easyteam/token", async (req, res) => {
  const { employee_id, company_id } = req.body as {
    employee_id: string;
    company_id: string;
  };

  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ success: false, error: "EASYTEAM_API_KEY not configured" });
    return;
  }

  try {
    const response = await axios.post(
      `${EASYTEAM_BASE_URL}/auth/token`,
      {
        api_key: EASYTEAM_API_KEY,
        employee_id,
        company_id,
      },
      { timeout: 10000 }
    );
    res.json({ success: true, token: response.data.token });
  } catch (err) {
    const error = err as { message?: string; response?: { data?: unknown } };
    req.log.error({ err }, "EasyTeam token request failed");
    res.status(500).json({
      success: false,
      error: `EasyTeam API error: ${error.message ?? "Unknown error"}`,
      details: JSON.stringify(error.response?.data ?? {}),
    });
  }
});

router.get("/easyteam/employees", async (req, res) => {
  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ success: false, error: "EASYTEAM_API_KEY not configured", employees: [] });
    return;
  }

  try {
    const response = await axios.get(`${EASYTEAM_BASE_URL}/employees`, {
      headers: { Authorization: `Bearer ${EASYTEAM_API_KEY}` },
      timeout: 10000,
    });
    res.json({ success: true, employees: response.data.employees ?? response.data });
  } catch (err) {
    const error = err as { message?: string; response?: { data?: unknown } };
    req.log.error({ err }, "EasyTeam employees request failed");
    const testEmployees = [
      { id: "EMP-TEST-001", name: "John Smith", position: "Teacher", company_id: "SUNSHINE-TEST", status: "active" },
      { id: "EMP-TEST-002", name: "Mary Johnson", position: "Assistant", company_id: "SUNSHINE-TEST", status: "active" },
    ];
    res.json({
      success: false,
      error: `Could not fetch from EasyTeam API: ${error.message ?? "Unknown error"}. Showing test data.`,
      employees: testEmployees,
    });
  }
});

router.get("/easyteam/timesheets", async (req, res) => {
  if (!EASYTEAM_API_KEY) {
    res.status(500).json({ success: false, error: "EASYTEAM_API_KEY not configured", timesheets: [] });
    return;
  }

  try {
    const response = await axios.get(`${EASYTEAM_BASE_URL}/timesheets`, {
      headers: { Authorization: `Bearer ${EASYTEAM_API_KEY}` },
      timeout: 10000,
    });
    res.json({ success: true, timesheets: response.data.timesheets ?? response.data, raw: response.data });
  } catch (err) {
    const error = err as { message?: string; response?: { data?: unknown } };
    req.log.error({ err }, "EasyTeam timesheets request failed");
    res.json({
      success: false,
      error: `Could not fetch timesheets: ${error.message ?? "Unknown error"}`,
      timesheets: [],
      raw: {},
    });
  }
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
  const apiConnection = !!EASYTEAM_API_KEY;
  let authentication = false;
  const details: Record<string, unknown> = {};

  if (EASYTEAM_API_KEY) {
    try {
      await axios.get(`${EASYTEAM_BASE_URL}/employees`, {
        headers: { Authorization: `Bearer ${EASYTEAM_API_KEY}` },
        timeout: 8000,
      });
      authentication = true;
      details.authMessage = "Successfully authenticated";
    } catch (err) {
      const error = err as { message?: string; response?: { status?: number; data?: unknown } };
      details.authError = error.message ?? "Unknown error";
      details.authStatus = error.response?.status;
      details.authData = error.response?.data;
    }
  } else {
    details.apiKeyError = "EASYTEAM_API_KEY environment variable not set";
  }

  res.json({
    apiConnection,
    authentication,
    webhook: true,
    details,
  });
});

export default router;
