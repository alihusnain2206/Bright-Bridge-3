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

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const clients: Client[] = [
  {
    id: "client-sunshine-001",
    name: "Sunshine Daycare Center",
    locationName: "Main Branch",
    latitude: 40.7128,
    longitude: -74.006,
    timezone: "America/New_York",
    createdAt: new Date().toISOString(),
  },
];

const employees: ClientEmployee[] = [
  {
    id: "emp-sunshine-001",
    clientId: "client-sunshine-001",
    name: "Sarah Mitchell",
    role: "manager",
    roleName: "Center Manager",
    wage: 2500,
    wageType: "hourly",
    timeTrackingEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "emp-sunshine-002",
    clientId: "client-sunshine-001",
    name: "James Lee",
    role: "teacher",
    roleName: "Lead Teacher",
    wage: 1800,
    wageType: "hourly",
    timeTrackingEnabled: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "emp-sunshine-003",
    clientId: "client-sunshine-001",
    name: "Maria Gonzalez",
    role: "assistant",
    roleName: "Teaching Assistant",
    wage: 1400,
    wageType: "hourly",
    timeTrackingEnabled: true,
    createdAt: new Date().toISOString(),
  },
];

export const store = {
  listClients(): Client[] {
    return clients;
  },

  getClient(id: string): Client | undefined {
    return clients.find((c) => c.id === id);
  },

  createClient(data: Omit<Client, "id" | "createdAt">): Client {
    const client: Client = {
      id: `client-${uid()}`,
      ...data,
      createdAt: new Date().toISOString(),
    };
    clients.push(client);
    return client;
  },

  deleteClient(id: string): boolean {
    const idx = clients.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    clients.splice(idx, 1);
    // also remove their employees
    const empIdxs = employees
      .map((e, i) => (e.clientId === id ? i : -1))
      .filter((i) => i !== -1)
      .reverse();
    empIdxs.forEach((i) => employees.splice(i, 1));
    return true;
  },

  listEmployees(clientId: string): ClientEmployee[] {
    return employees.filter((e) => e.clientId === clientId);
  },

  getEmployee(id: string): ClientEmployee | undefined {
    return employees.find((e) => e.id === id);
  },

  createEmployee(clientId: string, data: Omit<ClientEmployee, "id" | "clientId" | "createdAt">): ClientEmployee {
    const employee: ClientEmployee = {
      id: `emp-${uid()}`,
      clientId,
      ...data,
      createdAt: new Date().toISOString(),
    };
    employees.push(employee);
    return employee;
  },

  deleteEmployee(clientId: string, employeeId: string): boolean {
    const idx = employees.findIndex((e) => e.id === employeeId && e.clientId === clientId);
    if (idx === -1) return false;
    employees.splice(idx, 1);
    return true;
  },
};
