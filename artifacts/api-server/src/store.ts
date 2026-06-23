export interface Client {
  id: string;
  name: string;
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  createdAt: string;
  linkedCompanyId?: string;
}

export type EmployeeStatus = "hired" | "onboarding" | "active" | "terminated";

export interface ClientEmployee {
  id: string;
  clientId: string;
  name: string;
  role: string;
  roleName: string;
  wage: number;
  wageType: "hourly" | "weekly" | "monthly";
  timeTrackingEnabled: boolean;
  createdAt: string;
  email?: string;
  status: EmployeeStatus;
  easyteamSynced: boolean;
  rollfiSynced: boolean;
  rollfiUserId?: string;
  syncError?: string;
}

// ─── ROLE-BASED DATA ────────────────────────────────────────

export type UserRole = "super_admin" | "manager" | "employee" | "parent";

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  companyId: string;
  locationId?: string;
  employeeId: string | null;
  position: string;
  hourlyWage?: number;
}

export interface Company {
  id: string;
  name: string;
  type: "headquarters" | "daycare";
  locationId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface Location {
  id: string;
  name: string;
  organizationId: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface Child {
  id: string;
  name: string;
  parentId: string;
  age: number;
  checkedIn: boolean;
  checkInTime?: string;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── EASYTEAM HOURS BRIDGE ───────────────────────────────────

export interface TimesheetEntry {
  employeeId: string;
  companyId: string;
  periodKey: string; // "YYYY-MM-DD/YYYY-MM-DD"
  hoursWorked: number;
  breakDeduction: number;
  approvedHours: number;
  source: "easyteam" | "seeded" | "estimated";
  syncedAt: string;
  managerApproved?: boolean;
  approvedAt?: string;
  approvedByUserId?: string;
}

const timesheetHours = new Map<string, TimesheetEntry>(); // key: `${employeeId}::${periodKey}`

// ─── ROLLFI INTEGRATION STATE ─────────────────────────────────

export interface RollfiCompanyRecord {
  rollfiCompanyId: string;
  rollfiLocationId: string;
  onboardedAt: string;
  ein?: string;
  ownerSsn?: string;
}

export interface RollfiEmployeeRecord {
  rollfiUserId: string;
  rollfiWageId?: string;
  onboardedAt: string;
}

const rollfiCompanies = new Map<string, RollfiCompanyRecord>();
const rollfiEmployees = new Map<string, RollfiEmployeeRecord>();

// ─── CLIENTS (existing + Rainbow) ───────────────────────────

const clients: Client[] = [
  {
    id: "client-sunshine-001",
    name: "Sunshine Daycare Center",
    locationName: "Main Branch",
    latitude: 40.7357,
    longitude: -74.1724,
    timezone: "America/New_York",
    createdAt: new Date().toISOString(),
    linkedCompanyId: "ORG-SUNSHINE",
  },
  {
    id: "client-rainbow-001",
    name: "Rainbow Kids Daycare",
    locationName: "Jersey City Branch",
    latitude: 40.7178,
    longitude: -74.0431,
    timezone: "America/New_York",
    createdAt: new Date().toISOString(),
    linkedCompanyId: "ORG-RAINBOW",
  },
];

const employees: ClientEmployee[] = [
  { id: "emp-sunshine-001", clientId: "client-sunshine-001", name: "Sarah Mitchell", email: "sarah.mitchell@sunshine.com", role: "manager", roleName: "Center Manager", wage: 2500, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString(), status: "active", easyteamSynced: true, rollfiSynced: false },
  { id: "emp-sunshine-002", clientId: "client-sunshine-001", name: "James Lee", email: "james.lee@sunshine.com", role: "teacher", roleName: "Lead Teacher", wage: 1800, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString(), status: "active", easyteamSynced: true, rollfiSynced: false },
  { id: "emp-sunshine-003", clientId: "client-sunshine-001", name: "Maria Gonzalez", email: "maria.gonzalez@sunshine.com", role: "assistant", roleName: "Teaching Assistant", wage: 1400, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString(), status: "active", easyteamSynced: true, rollfiSynced: false },
  { id: "emp-rainbow-001", clientId: "client-rainbow-001", name: "Tom Wilson", email: "tom@rainbow.com", role: "teacher", roleName: "Lead Teacher", wage: 1800, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString(), status: "active", easyteamSynced: true, rollfiSynced: false },
  { id: "emp-rainbow-002", clientId: "client-rainbow-001", name: "Lisa Chen", email: "lisa.chen@rainbow.com", role: "assistant", roleName: "Teaching Assistant", wage: 1400, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString(), status: "active", easyteamSynced: true, rollfiSynced: false },
];

// ─── TEST USERS ──────────────────────────────────────────────

const testUsers: TestUser[] = [
  { id: "USER-001", name: "Joanne Indiviglio", email: "joanne@brightbridgeassist.com", password: "Admin123!", role: "super_admin", companyId: "ORG-BRIGHTBRIDGE", employeeId: "ADMIN-JOANNE", position: "Super Admin" },
  { id: "USER-002", name: "Susan Manager", email: "manager@sunshine.com", password: "Manager123!", role: "manager", companyId: "ORG-SUNSHINE", locationId: "LOC-SUNSHINE", employeeId: "MGR-SUNSHINE-001", position: "Daycare Manager" },
  { id: "USER-003", name: "Mike Manager", email: "manager@rainbow.com", password: "Manager123!", role: "manager", companyId: "ORG-RAINBOW", locationId: "LOC-RAINBOW", employeeId: "MGR-RAINBOW-001", position: "Daycare Manager" },
  { id: "USER-004", name: "John Smith", email: "john@sunshine.com", password: "Staff123!", role: "employee", companyId: "ORG-SUNSHINE", locationId: "LOC-SUNSHINE", employeeId: "EMP-SUNSHINE-001", position: "Teacher", hourlyWage: 1800 },
  { id: "USER-005", name: "Mary Johnson", email: "mary@sunshine.com", password: "Staff123!", role: "employee", companyId: "ORG-SUNSHINE", locationId: "LOC-SUNSHINE", employeeId: "EMP-SUNSHINE-002", position: "Assistant", hourlyWage: 1500 },
  { id: "USER-006", name: "Tom Wilson", email: "tom@rainbow.com", password: "Staff123!", role: "employee", companyId: "ORG-RAINBOW", locationId: "LOC-RAINBOW", employeeId: "EMP-RAINBOW-001", position: "Teacher", hourlyWage: 1800 },
  { id: "USER-007", name: "Sarah Parent", email: "sarah@parent.com", password: "Parent123!", role: "parent", companyId: "ORG-SUNSHINE", employeeId: null, position: "Parent" },
];

// ─── COMPANIES ───────────────────────────────────────────────

const companies: Company[] = [
  { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist", type: "headquarters" },
  { id: "ORG-SUNSHINE", name: "Sunshine Daycare Centre", type: "daycare", locationId: "LOC-SUNSHINE", address: "123 Main St, Newark NJ", latitude: 40.7357, longitude: -74.1724 },
  { id: "ORG-RAINBOW", name: "Rainbow Kids Daycare", type: "daycare", locationId: "LOC-RAINBOW", address: "456 Oak Ave, Jersey City NJ", latitude: 40.7178, longitude: -74.0431 },
];

// ─── LOCATIONS ───────────────────────────────────────────────

const locations: Location[] = [
  { id: "LOC-SUNSHINE", name: "Sunshine Daycare Centre", organizationId: "ORG-SUNSHINE", address: "123 Main St, Newark NJ", latitude: 40.7357, longitude: -74.1724 },
  { id: "LOC-RAINBOW", name: "Rainbow Kids Daycare", organizationId: "ORG-RAINBOW", address: "456 Oak Ave, Jersey City NJ", latitude: 40.7178, longitude: -74.0431 },
];

// ─── CHILDREN ────────────────────────────────────────────────

const children: Child[] = [
  { id: "CHILD-001", name: "Emma Johnson", parentId: "USER-007", age: 4, checkedIn: false },
  { id: "CHILD-002", name: "Liam Johnson", parentId: "USER-007", age: 6, checkedIn: false },
];

// ─── STORE ───────────────────────────────────────────────────

export const store = {
  // ── Clients ──
  listClients(): Client[] { return clients; },
  getClient(id: string): Client | undefined { return clients.find((c) => c.id === id); },
  createClient(data: Omit<Client, "id" | "createdAt">): Client {
    const client: Client = { id: `client-${uid()}`, ...data, createdAt: new Date().toISOString() };
    clients.push(client);
    return client;
  },
  deleteClient(id: string): boolean {
    const idx = clients.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    clients.splice(idx, 1);
    const empIdxs = employees.map((e, i) => (e.clientId === id ? i : -1)).filter((i) => i !== -1).reverse();
    empIdxs.forEach((i) => employees.splice(i, 1));
    return true;
  },

  // ── Client Employees ──
  listEmployees(clientId: string): ClientEmployee[] { return employees.filter((e) => e.clientId === clientId); },
  getEmployee(id: string): ClientEmployee | undefined { return employees.find((e) => e.id === id); },
  createEmployee(clientId: string, data: Omit<ClientEmployee, "id" | "clientId" | "createdAt">): ClientEmployee {
    const employee: ClientEmployee = {
      id: `emp-${uid()}`,
      clientId,
      ...data,
      status: data.status ?? "hired",
      easyteamSynced: data.easyteamSynced ?? false,
      rollfiSynced: data.rollfiSynced ?? false,
      createdAt: new Date().toISOString(),
    };
    employees.push(employee);
    return employee;
  },
  insertEmployee(emp: ClientEmployee): void {
    if (!employees.find((e) => e.id === emp.id)) {
      employees.push(emp);
    }
  },
  updateEmployee(id: string, updates: Partial<Omit<ClientEmployee, "id" | "clientId" | "createdAt">>): ClientEmployee | undefined {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return undefined;
    Object.assign(emp, updates);
    return emp;
  },
  deleteEmployee(clientId: string, employeeId: string): boolean {
    const idx = employees.findIndex((e) => e.id === employeeId && e.clientId === clientId);
    if (idx === -1) return false;
    employees.splice(idx, 1);
    return true;
  },

  // ── Auth Users ──
  getUserByEmail(email: string): TestUser | undefined {
    return testUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  getUserById(id: string): Omit<TestUser, "password"> | undefined {
    const user = testUsers.find((u) => u.id === id);
    if (!user) return undefined;
    const { password: _p, ...safe } = user;
    return safe;
  },
  getAllUsersPublic(): Omit<TestUser, "password">[] {
    return testUsers.map(({ password: _p, ...safe }) => safe);
  },
  getUsersForCompany(companyId: string): Omit<TestUser, "password">[] {
    return testUsers.filter((u) => u.companyId === companyId && u.employeeId !== null).map(({ password: _p, ...safe }) => safe);
  },
  getAllStaffUsers(): Omit<TestUser, "password">[] {
    return testUsers.filter((u) => u.employeeId !== null).map(({ password: _p, ...safe }) => safe);
  },
  getRawUser(id: string): TestUser | undefined {
    return testUsers.find((u) => u.id === id);
  },

  // ── EasyTeam Hours Bridge ──
  getTimesheetKey(employeeId: string, periodKey: string): string { return `${employeeId}::${periodKey}`; },
  getTimesheetEntry(employeeId: string, periodKey: string): TimesheetEntry | undefined {
    return timesheetHours.get(`${employeeId}::${periodKey}`);
  },
  setTimesheetEntry(entry: TimesheetEntry): void {
    timesheetHours.set(`${entry.employeeId}::${entry.periodKey}`, entry);
  },
  getTimesheetEntriesForPeriod(periodKey: string): TimesheetEntry[] {
    return Array.from(timesheetHours.values()).filter((e) => e.periodKey === periodKey);
  },
  seedTimesheetHours(periodKey: string): TimesheetEntry[] {
    // Only seed hourly employees (not managers/admins) with realistic hours.
    // Tom Wilson's hours match EasyTeam sandbox data (1.95 h clock-in).
    // All other employees get plausible part-shift hours so the demo looks real.
    const realisticHours: Record<string, { h: number; b: number }> = {
      "EMP-RAINBOW-001": { h: 1.95, b: 0 },    // Tom Wilson — matches EasyTeam sandbox
      "EMP-SUNSHINE-001": { h: 3.5,  b: 0.5 }, // John Smith
      "EMP-SUNSHINE-002": { h: 4.0,  b: 0.5 }, // Mary Johnson
    };
    const staff = testUsers.filter(
      (u) => u.employeeId && u.role === "employee"
    );
    const seeded: TimesheetEntry[] = [];
    staff.forEach((u) => {
      const defaults = realisticHours[u.employeeId!] ?? { h: 2.0, b: 0 };
      const hoursWorked    = defaults.h;
      const breakDeduction = defaults.b;
      const approvedHours  = Math.max(0, hoursWorked - breakDeduction);
      const entry: TimesheetEntry = {
        employeeId: u.employeeId!,
        companyId: u.companyId,
        periodKey,
        hoursWorked,
        breakDeduction,
        approvedHours,
        source: "seeded",
        syncedAt: new Date().toISOString(),
      };
      timesheetHours.set(`${u.employeeId!}::${periodKey}`, entry);
      seeded.push(entry);
    });
    return seeded;
  },
  approveTimesheetEntries(periodKey: string, companyId: string, approvedByUserId: string): TimesheetEntry[] {
    const entries = Array.from(timesheetHours.values()).filter(
      (e) => e.periodKey === periodKey && e.companyId === companyId
    );
    const now = new Date().toISOString();
    for (const entry of entries) {
      entry.managerApproved = true;
      entry.approvedAt = now;
      entry.approvedByUserId = approvedByUserId;
      timesheetHours.set(`${entry.employeeId}::${periodKey}`, entry);
    }
    return entries;
  },
  clearTimesheetHours(periodKey?: string): void {
    if (periodKey) {
      for (const key of timesheetHours.keys()) { if (key.endsWith(`::${periodKey}`)) timesheetHours.delete(key); }
    } else {
      timesheetHours.clear();
    }
  },

  // ── Staff Users (payroll employees) ──
  createStaffUser(data: { name: string; email: string; position: string; hourlyWage: number; companyId: string }): Omit<TestUser, "password"> {
    const id = `USER-${uid().toUpperCase()}`;
    const employeeId = `EMP-${uid().toUpperCase()}`;
    const company = companies.find((c) => c.id === data.companyId);
    const locationId = company?.locationId;
    const newUser: TestUser = {
      id,
      name: data.name,
      email: data.email,
      password: "Staff123!",
      role: "employee",
      companyId: data.companyId,
      locationId,
      employeeId,
      position: data.position,
      hourlyWage: data.hourlyWage,
    };
    testUsers.push(newUser);
    const { password: _p, ...safe } = newUser;
    return safe;
  },
  deleteStaffUser(userId: string): boolean {
    const idx = testUsers.findIndex((u) => u.id === userId && u.role === "employee");
    if (idx === -1) return false;
    testUsers.splice(idx, 1);
    return true;
  },

  // ── Companies ──
  getCompany(id: string): Company | undefined { return companies.find((c) => c.id === id); },
  getCompanies(): Company[] { return companies; },
  getDaycareCompanies(): Company[] { return companies.filter((c) => c.type === "daycare"); },

  // ── Locations ──
  getLocation(id: string): Location | undefined { return locations.find((l) => l.id === id); },
  getLocations(): Location[] { return locations; },

  // ── Rollfi ──
  getRollfiCompany(companyId: string): RollfiCompanyRecord | undefined { return rollfiCompanies.get(companyId); },
  setRollfiCompany(companyId: string, record: RollfiCompanyRecord): void { rollfiCompanies.set(companyId, record); },
  getRollfiEmployee(employeeId: string): RollfiEmployeeRecord | undefined { return rollfiEmployees.get(employeeId); },
  setRollfiEmployee(employeeId: string, record: RollfiEmployeeRecord): void { rollfiEmployees.set(employeeId, record); },

  // ── Children ──
  getChildrenForParent(parentId: string): Child[] { return children.filter((c) => c.parentId === parentId); },
  checkInChild(childId: string): boolean {
    const child = children.find((c) => c.id === childId);
    if (!child) return false;
    child.checkedIn = true;
    child.checkInTime = new Date().toISOString();
    return true;
  },
  checkOutChild(childId: string): boolean {
    const child = children.find((c) => c.id === childId);
    if (!child) return false;
    child.checkedIn = false;
    child.checkInTime = undefined;
    return true;
  },
};
