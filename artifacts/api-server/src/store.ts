export interface Client {
  id: string;
  name: string;
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  createdAt: string;
}

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
  },
  {
    id: "client-rainbow-001",
    name: "Rainbow Kids Daycare",
    locationName: "Jersey City Branch",
    latitude: 40.7178,
    longitude: -74.0431,
    timezone: "America/New_York",
    createdAt: new Date().toISOString(),
  },
];

const employees: ClientEmployee[] = [
  { id: "emp-sunshine-001", clientId: "client-sunshine-001", name: "Sarah Mitchell", role: "manager", roleName: "Center Manager", wage: 2500, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString() },
  { id: "emp-sunshine-002", clientId: "client-sunshine-001", name: "James Lee", role: "teacher", roleName: "Lead Teacher", wage: 1800, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString() },
  { id: "emp-sunshine-003", clientId: "client-sunshine-001", name: "Maria Gonzalez", role: "assistant", roleName: "Teaching Assistant", wage: 1400, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString() },
  { id: "emp-rainbow-001", clientId: "client-rainbow-001", name: "Tom Wilson", role: "teacher", roleName: "Lead Teacher", wage: 1800, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString() },
  { id: "emp-rainbow-002", clientId: "client-rainbow-001", name: "Lisa Chen", role: "assistant", roleName: "Teaching Assistant", wage: 1400, wageType: "hourly", timeTrackingEnabled: true, createdAt: new Date().toISOString() },
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
    const employee: ClientEmployee = { id: `emp-${uid()}`, clientId, ...data, createdAt: new Date().toISOString() };
    employees.push(employee);
    return employee;
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

  // ── Companies ──
  getCompany(id: string): Company | undefined { return companies.find((c) => c.id === id); },
  getCompanies(): Company[] { return companies; },
  getDaycareCompanies(): Company[] { return companies.filter((c) => c.type === "daycare"); },

  // ── Locations ──
  getLocation(id: string): Location | undefined { return locations.find((l) => l.id === id); },
  getLocations(): Location[] { return locations; },

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
