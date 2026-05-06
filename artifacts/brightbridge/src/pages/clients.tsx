import React, { useState } from "react";
import { Link } from "wouter";
import {
  useListClients,
  useCreateClient,
  useDeleteClient,
  useListClientEmployees,
  useCreateClientEmployee,
  useDeleteClientEmployee,
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Users,
  UserPlus,
  Plus,
  Trash2,
  Clock,
  CalendarDays,
  Calendar,
  ChevronDown,
  ChevronUp,
  MapPin,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)" } as const;
const PANEL_DIVIDER = { borderColor: "rgba(255,255,255,0.1)" } as const;

const ROLE_OPTIONS = [
  { value: "manager", label: "Manager" },
  { value: "teacher", label: "Teacher" },
  { value: "assistant", label: "Teaching Assistant" },
  { value: "cashier", label: "Cashier" },
  { value: "supervisor", label: "Supervisor" },
  { value: "staff", label: "Staff" },
];

const ROLE_NAMES: Record<string, string> = {
  manager: "Center Manager",
  teacher: "Lead Teacher",
  assistant: "Teaching Assistant",
  cashier: "Cashier",
  supervisor: "Supervisor",
  staff: "Staff Member",
};

function AddClientForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const createClient = useCreateClient();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !locationName) return;
    createClient.mutate(
      { data: { name, locationName, timezone, latitude: 40.7128, longitude: -74.006 } },
      { onSuccess: onDone }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Center Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunshine Daycare" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Location Name *</Label>
          <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Main Branch" className="h-8 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="America/New_York">Eastern (New York)</SelectItem>
            <SelectItem value="America/Chicago">Central (Chicago)</SelectItem>
            <SelectItem value="America/Denver">Mountain (Denver)</SelectItem>
            <SelectItem value="America/Los_Angeles">Pacific (Los Angeles)</SelectItem>
            <SelectItem value="America/Phoenix">Arizona</SelectItem>
            <SelectItem value="America/Anchorage">Alaska</SelectItem>
            <SelectItem value="Pacific/Honolulu">Hawaii</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={!name || !locationName || createClient.isPending} className="flex-1">
          {createClient.isPending ? "Adding…" : "Add Client"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function AddEmployeeForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("teacher");
  const [wage, setWage] = useState("1500");
  const createEmployee = useCreateClientEmployee();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !role) return;
    createEmployee.mutate(
      {
        clientId,
        data: { name, role, roleName: ROLE_NAMES[role] || role, wage: Number(wage) || 1500, wageType: "hourly", timeTrackingEnabled: true },
      },
      { onSuccess: onDone }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg border border-dashed border-white/20 space-y-2" style={{ background: "rgba(255,255,255,0.05)" }}>
      <div className="text-xs font-medium text-white/50 mb-2">Add Employee</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-white/70">Full Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" className="h-7 text-xs bg-white/10 border-white/20 text-white placeholder:text-white/30" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-white/70">Role *</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-7 text-xs bg-white/10 border-white/20 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-white/70">Hourly Wage (cents, e.g. 1500 = $15.00)</Label>
        <Input value={wage} onChange={(e) => setWage(e.target.value)} placeholder="1500" className="h-7 text-xs bg-white/10 border-white/20 text-white" type="number" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!name || createEmployee.isPending} className="h-7 text-xs flex-1 bg-[#E8622A] hover:bg-[#d4571f] text-white border-0">
          {createEmployee.isPending ? "Adding…" : "Add Employee"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} className="h-7 text-xs border-white/20 text-white/70 hover:bg-white/10 bg-transparent">Cancel</Button>
      </div>
    </form>
  );
}

function EmployeeList({ clientId }: { clientId: string }) {
  const { data, isLoading, refetch } = useListClientEmployees(clientId);
  const deleteEmployee = useDeleteClientEmployee();
  const [addingEmployee, setAddingEmployee] = useState(false);

  const handleDelete = (employeeId: string) => {
    deleteEmployee.mutate({ clientId, employeeId }, { onSuccess: () => refetch() });
  };

  if (isLoading) {
    return <div className="space-y-1 mt-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full opacity-20" />)}</div>;
  }

  const employees = data?.employees ?? [];

  return (
    <div className="mt-3 space-y-2">
      {employees.length === 0 && !addingEmployee && (
        <div className="text-xs text-white/40 text-center py-3 rounded-md border border-dashed border-white/15">
          No employees yet — add your first staff member.
        </div>
      )}

      {employees.map((emp) => (
        <div key={emp.id} className="flex items-center justify-between p-2 rounded-md border group" style={PANEL_INNER}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "#E8622A" }}>
              {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate text-white">{emp.name}</div>
              <div className="text-xs text-white/50">{emp.roleName}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <Link href={`/timeclock?clientId=${clientId}&employeeId=${emp.id}`}>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 border-white/20 text-white/70 hover:bg-[#E8622A] hover:text-white hover:border-[#E8622A] bg-transparent">
                <Clock className="h-3 w-3" /> Clock
              </Button>
            </Link>
            <Link href={`/timesheets?clientId=${clientId}&employeeId=${emp.id}`}>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 border-white/20 text-white/70 hover:bg-[#E8622A] hover:text-white hover:border-[#E8622A] bg-transparent">
                <CalendarDays className="h-3 w-3" /> Sheets
              </Button>
            </Link>
            <Link href={`/schedule?clientId=${clientId}&employeeId=${emp.id}`}>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1 border-white/20 text-white/70 hover:bg-[#E8622A] hover:text-white hover:border-[#E8622A] bg-transparent">
                <Calendar className="h-3 w-3" /> Sched
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-transparent"
              onClick={() => handleDelete(emp.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {addingEmployee ? (
        <AddEmployeeForm clientId={clientId} onDone={() => { setAddingEmployee(false); refetch(); }} />
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1 border-dashed border-white/20 text-white/50 hover:text-white hover:bg-white/10 bg-transparent"
          onClick={() => setAddingEmployee(true)}
        >
          <UserPlus className="h-3 w-3" /> Add Employee
        </Button>
      )}
    </div>
  );
}

function ClientCard({ client, onDelete }: { client: { id: string; name: string; locationName: string; timezone: string }; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const deleteClient = useDeleteClient();
  const qc = useQueryClient();

  const handleDelete = () => {
    if (!confirm(`Delete "${client.name}" and all their employees?`)) return;
    deleteClient.mutate({ clientId: client.id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/clients"] }); onDelete(); },
    });
  };

  return (
    <div className="rounded-xl border overflow-hidden" style={PANEL}>
      {/* Card header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ ...PANEL_DIVIDER, background: "rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded shrink-0" style={{ background: "rgba(232,98,42,0.2)" }}>
            <Building2 className="h-4 w-4 text-[#E8622A]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{client.name}</div>
            <div className="flex items-center gap-1 text-xs text-white/40 mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{client.locationName}</span>
              <span className="text-white/20 mx-1">·</span>
              <span className="truncate">{client.timezone.replace("America/", "")}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-mono border-white/20 text-white/40 bg-transparent">
            {client.id.slice(0, 10)}…
          </Badge>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white/30 hover:text-red-400 bg-transparent" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white/40 hover:text-white bg-transparent" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-white/40 mb-1">
            <Users className="h-3.5 w-3.5" />
            Staff
          </div>
          <EmployeeList clientId={client.id} />
        </div>
      )}
    </div>
  );
}

export default function Clients() {
  const { data, isLoading, refetch } = useListClients();
  const [addingClient, setAddingClient] = useState(false);
  const clients = data?.clients ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Clients</h1>
          <p className="text-muted-foreground mt-1">Manage daycare centers and their staff. Launch EasyTeam sessions per employee.</p>
        </div>
        <Button onClick={() => setAddingClient(true)} disabled={addingClient} className="gap-2 bg-[#E8622A] hover:bg-[#d4571f] text-white border-0">
          <Plus className="h-4 w-4" /> Add Client
        </Button>
      </div>

      {addingClient && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-accent" />
              New Daycare Client
            </CardTitle>
            <CardDescription>Fill in the center details. You can add staff after creating the client.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddClientForm onDone={() => { setAddingClient(false); refetch(); }} />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <Building2 className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Click "Add Client" to create your first daycare center.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {clients.map((client) => (
            <ClientCard key={client.id} client={client} onDelete={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
