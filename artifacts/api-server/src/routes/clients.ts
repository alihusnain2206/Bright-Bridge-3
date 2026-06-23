import { Router, type IRouter } from "express";
import { store, type EmployeeStatus } from "../store";
import { onboardClientEmployeeToRollfi } from "../lib/rollfi-employee-sync.js";
import { persistClientEmployee } from "../lib/client-employee-persist.js";
import type { Logger } from "pino";

const router: IRouter = Router();

function getRollfiCompanyForClient(clientId: string) {
  const client = store.getClient(clientId);
  if (!client?.linkedCompanyId) return undefined;
  return store.getRollfiCompany(client.linkedCompanyId);
}

async function attemptSync(employeeId: string, clientId: string, log: Logger) {
  const emp = store.getEmployee(employeeId);
  if (!emp || emp.status !== "active") return;

  const rollfiCompany = getRollfiCompanyForClient(clientId);

  const easyteamSynced = emp.status === "active";

  if (rollfiCompany && !emp.rollfiSynced) {
    const result = await onboardClientEmployeeToRollfi(emp, rollfiCompany, log);
    store.updateEmployee(employeeId, {
      rollfiSynced: result.success,
      rollfiUserId: result.rollfiUserId,
      syncError: result.success ? undefined : result.error,
      easyteamSynced,
    });
  } else {
    store.updateEmployee(employeeId, { easyteamSynced, syncError: undefined });
  }
}

router.get("/clients", (_req, res) => {
  res.json({ clients: store.listClients() });
});

router.post("/clients", (req, res) => {
  const { name, locationName, latitude, longitude, timezone } = req.body as {
    name: string;
    locationName: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };

  if (!name || !locationName) {
    res.status(400).json({ error: "name and locationName are required" });
    return;
  }

  const client = store.createClient({
    name,
    locationName,
    latitude: latitude ?? 40.7128,
    longitude: longitude ?? -74.006,
    timezone: timezone ?? "America/New_York",
  });

  res.status(201).json(client);
});

router.delete("/clients/:clientId", (req, res) => {
  const { clientId } = req.params;
  const deleted = store.deleteClient(clientId);
  if (!deleted) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json({ deleted: true, id: clientId });
});

router.get("/clients/:clientId/employees", (req, res) => {
  const { clientId } = req.params;
  const client = store.getClient(clientId);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json({ employees: store.listEmployees(clientId) });
});

router.post("/clients/:clientId/employees", async (req, res) => {
  const { clientId } = req.params;
  const client = store.getClient(clientId);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const { name, email, role, roleName, wage, wageType, timeTrackingEnabled, status } = req.body as {
    name: string;
    email?: string;
    role: string;
    roleName: string;
    wage?: number;
    wageType?: "hourly" | "weekly" | "monthly";
    timeTrackingEnabled?: boolean;
    status?: EmployeeStatus;
  };

  if (!name || !role || !roleName) {
    res.status(400).json({ error: "name, role, and roleName are required" });
    return;
  }

  const employee = store.createEmployee(clientId, {
    name,
    email,
    role,
    roleName,
    wage: wage ?? 1500,
    wageType: wageType ?? "hourly",
    timeTrackingEnabled: timeTrackingEnabled ?? true,
    status: status ?? "hired",
    easyteamSynced: false,
    rollfiSynced: false,
  });

  if (employee.status === "active") {
    await attemptSync(employee.id, clientId, req.log as unknown as Logger);
  }

  const saved = store.getEmployee(employee.id) ?? employee;
  await persistClientEmployee(saved).catch(() => { /* non-fatal */ });
  res.status(201).json(saved);
});

router.delete("/clients/:clientId/employees/:employeeId", (req, res) => {
  const { clientId, employeeId } = req.params;
  const deleted = store.deleteEmployee(clientId, employeeId);
  if (!deleted) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.json({ deleted: true, id: employeeId });
});

router.patch("/clients/:clientId/employees/:employeeId/status", async (req, res) => {
  const { clientId, employeeId } = req.params;
  const { status } = req.body as { status: EmployeeStatus };

  const VALID: EmployeeStatus[] = ["hired", "onboarding", "active", "terminated"];
  if (!VALID.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
    return;
  }

  const emp = store.getEmployee(employeeId);
  if (!emp || emp.clientId !== clientId) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  const wasNotActive = emp.status !== "active";
  store.updateEmployee(employeeId, {
    status,
    easyteamSynced: status === "active",
  });

  if (status === "active" && wasNotActive) {
    await attemptSync(employeeId, clientId, req.log as unknown as Logger);
  }

  if (status === "terminated") {
    store.updateEmployee(employeeId, { easyteamSynced: false });
  }

  const updated = store.getEmployee(employeeId);
  if (updated) await persistClientEmployee(updated).catch(() => { /* non-fatal */ });
  res.json(updated);
});

router.post("/clients/:clientId/employees/:employeeId/sync", async (req, res) => {
  const { clientId, employeeId } = req.params;

  const emp = store.getEmployee(employeeId);
  if (!emp || emp.clientId !== clientId) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  if (emp.status !== "active") {
    res.status(400).json({ error: "Only active employees can be synced. Update status to active first." });
    return;
  }

  const easyteamSynced = true;
  const rollfiCompany = getRollfiCompanyForClient(clientId);

  let rollfiSynced = emp.rollfiSynced;
  let rollfiUserId = emp.rollfiUserId;
  let syncError: string | undefined;

  if (rollfiCompany) {
    const result = await onboardClientEmployeeToRollfi(emp, rollfiCompany, req.log as unknown as Logger);
    rollfiSynced = result.success;
    rollfiUserId = result.rollfiUserId;
    syncError = result.success ? undefined : result.error;
  } else {
    syncError = "Company not yet onboarded to Rollfi";
  }

  store.updateEmployee(employeeId, { easyteamSynced, rollfiSynced, rollfiUserId, syncError });

  const synced = store.getEmployee(employeeId);
  if (synced) await persistClientEmployee(synced).catch(() => { /* non-fatal */ });

  res.json({
    success: rollfiSynced,
    easyteamSynced,
    rollfiSynced,
    rollfiUserId,
    error: syncError,
  });
});

export default router;
