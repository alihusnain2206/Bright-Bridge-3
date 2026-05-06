import { Router, type IRouter } from "express";
import { store } from "../store";

const router: IRouter = Router();

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

router.post("/clients/:clientId/employees", (req, res) => {
  const { clientId } = req.params;
  const client = store.getClient(clientId);
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const { name, role, roleName, wage, wageType, timeTrackingEnabled } = req.body as {
    name: string;
    role: string;
    roleName: string;
    wage?: number;
    wageType?: "hourly" | "weekly" | "monthly";
    timeTrackingEnabled?: boolean;
  };

  if (!name || !role || !roleName) {
    res.status(400).json({ error: "name, role, and roleName are required" });
    return;
  }

  const employee = store.createEmployee(clientId, {
    name,
    role,
    roleName,
    wage: wage ?? 1500,
    wageType: wageType ?? "hourly",
    timeTrackingEnabled: timeTrackingEnabled ?? true,
  });

  res.status(201).json(employee);
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

export default router;
