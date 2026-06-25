import React, { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, DollarSign, RefreshCw, Loader2, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const ORANGE = "#E8622A";
const NAVY = "#284362";

interface Company {
  id: string; name: string; phone: string; industry: string; package: string; status: string;
  address1: string; address2?: string; city: string; state: string; zipcode: string;
  kybStatus: string; bankAccountAdded: boolean; payScheduleAdded: boolean; payFrequency?: string;
  rollfiCompanyId?: string; rollfiLocationId?: string; rollfiOnboardedAt?: string;
  ein?: string; employeeCount?: number; createdAt: string; rollfi?: { rollfiCompanyId?: string } | null;
}

interface Employee {
  id: string; companyId: string; firstName: string; lastName: string; email: string;
  phone: string; position: string; employmentType: string; workerType: string;
  payType: string; hourlyWage: number; status: string;
  easyteamSynced: boolean; rollfiUserId?: string; kycStatus?: string; bankAccountAdded: boolean;
  syncStatus: string; createdAt: string;
}

interface CompanyUser {
  id: string; name: string; email: string; role: string; position: string; source: string;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  active:      { label: "Active",      color: "bg-emerald-100 text-emerald-700" },
  onboarding:  { label: "Onboarding",  color: "bg-yellow-100 text-yellow-700" },
  pending_verification: { label: "Pending", color: "bg-orange-100 text-orange-700" },
  terminated:  { label: "Terminated",  color: "bg-red-100 text-red-700" },
};

function formatWage(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/hr`;
}

function SyncDot({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
      {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function OverviewTab({ company }: { company: Company }) {
  const hasRollfi = !!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId);
  const steps = [
    { done: true,                           label: "BrightBridge account created" },
    { done: hasRollfi,                      label: "Rollfi payroll registration" },
    { done: company.kybStatus === "verified", pending: company.kybStatus === "pending", label: "KYB business verification" },
    { done: company.bankAccountAdded,       label: "Company bank account connected" },
    { done: company.payScheduleAdded,       label: `Pay schedule (${company.payFrequency ?? "BiWeekly"})` },
    { done: (company.employeeCount ?? 0) > 0, label: `Employees added (${company.employeeCount ?? 0} so far)` },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Company Info</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Phone</span><span className="font-medium">{company.phone || "—"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Industry</span><span className="font-medium capitalize">{company.industry}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Package</span><span className="font-medium">{company.package.replace(/_/g, " ")}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Address</span><span className="font-medium text-right">{company.address1}, {company.city} {company.state}</span></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">Rollfi Payroll</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Status</span>
              <span className={`font-medium ${hasRollfi ? "text-emerald-600" : "text-amber-600"}`}>{hasRollfi ? "Registered" : "Not registered"}</span>
            </div>
            {hasRollfi && <div className="flex justify-between"><span className="text-gray-500">Company ID</span><span className="font-mono text-xs text-gray-600">{company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId}</span></div>}
            <div className="flex justify-between"><span className="text-gray-500">KYB Status</span>
              <span className={`font-medium capitalize ${company.kybStatus === "verified" ? "text-emerald-600" : company.kybStatus === "pending" ? "text-amber-600" : "text-gray-500"}`}>{company.kybStatus.replace(/_/g, " ")}</span>
            </div>
            <div className="flex justify-between"><span className="text-gray-500">Pay Schedule</span>
              <span className={`font-medium ${company.payScheduleAdded ? "text-emerald-600" : "text-gray-400"}`}>{company.payScheduleAdded ? company.payFrequency : "Not set"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <p className="text-sm font-bold text-gray-800 mb-4">Setup Checklist</p>
        <div className="space-y-3">
          {steps.map(({ done, pending, label }) => (
            <div key={label} className="flex items-center gap-3">
              {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : pending ? <Clock className="h-4 w-4 text-amber-500 shrink-0" /> : <XCircle className="h-4 w-4 text-gray-300 shrink-0" />}
              <span className={`text-sm ${done ? "text-gray-800" : pending ? "text-amber-700" : "text-gray-400"}`}>{label}</span>
              {pending && <Badge variant="outline" className="ml-auto text-[10px] border-amber-300 text-amber-600">Under review</Badge>}
              {!done && !pending && <span className="ml-auto text-[10px] text-red-500 font-medium">Action required</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmployeesTab({ company }: { company: Company }) {
  const { data, isLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["/api/employees", company.id],
    queryFn: () => fetch(`/api/employees?companyId=${company.id}`, { credentials: "include" }).then((r) => r.json()),
  });
  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: CompanyUser[] }>({
    queryKey: ["/api/companies/users", company.id],
    queryFn: () => fetch(`/api/companies/${company.id}/users`, { credentials: "include" }).then((r) => r.json()),
  });

  const employees = data?.employees ?? [];
  const managers = usersData?.users ?? [];

  if (isLoading || usersLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Admins / Managers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-[#284362]" />Admins & Managers
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#284362]/10 text-[#284362] text-[10px] font-bold">{managers.length}</span>
          </h3>
        </div>
        {managers.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl text-sm text-gray-400">
            No managers assigned yet
          </div>
        ) : (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Position</th>
                <th className="text-left px-4 py-2.5">Role</th>
              </tr></thead>
              <tbody className="divide-y">
                {managers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.position || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#284362]/10 text-[#284362] capitalize">{u.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employees */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[#E8622A]" />Employees
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold">{employees.length}</span>
            <span className="text-gray-400 font-normal text-xs">· {employees.filter((e) => e.status === "active").length} active</span>
          </h3>
          <Link href={`/clients/${company.id}/employees/new`}>
            <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}>
              <Plus className="h-3.5 w-3.5" />Add Employee
            </Button>
          </Link>
        </div>

        {employees.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
            <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="font-semibold text-gray-700">No employees yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Add your first employee to get started with payroll and time tracking.</p>
            <Link href={`/clients/${company.id}/employees/new`}>
              <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}><Plus className="h-3.5 w-3.5" />Add First Employee</Button>
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name / Position</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Rate</th>
                <th className="text-left px-4 py-3">EasyTeam</th>
                <th className="text-left px-4 py-3">Rollfi</th>
                <th className="text-left px-4 py-3">KYC</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr></thead>
              <tbody className="divide-y">
                {employees.map((emp) => {
                  const cfg = STATUS_CFG[emp.status] ?? STATUS_CFG.onboarding;
                  return (
                    <tr key={emp.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                        <div className="text-[11px] text-gray-400">{emp.position}</div>
                      </td>
                      <td className="px-4 py-3"><span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium">{emp.workerType}</span></td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{formatWage(emp.hourlyWage)}</td>
                      <td className="px-4 py-3"><SyncDot done={emp.easyteamSynced} label="ET" /></td>
                      <td className="px-4 py-3"><SyncDot done={!!emp.rollfiUserId} label="Rollfi" /></td>
                      <td className="px-4 py-3"><SyncDot done={emp.kycStatus === "verified"} label="KYC" /></td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PayrollTab({ company }: { company: Company }) {
  const hasRollfi = !!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 shadow-sm">
        <p className="text-sm font-bold text-gray-800 mb-3">Payroll Status</p>
        {!hasRollfi ? (
          <div className="flex items-center gap-2 text-amber-700 text-sm">
            <AlertTriangle className="h-4 w-4" />Company not yet registered with Rollfi. Complete setup first.
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Rollfi payroll account active</span>
              <span className="ml-auto font-mono text-xs text-gray-400">{company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId}</span>
            </div>
            <div className="flex items-center gap-3">
              {company.payScheduleAdded ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-gray-300" />}
              <span>Pay schedule: {company.payFrequency ?? "Not set"}</span>
            </div>
            <div className="flex items-center gap-3">
              {company.bankAccountAdded ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              <span>Bank account: {company.bankAccountAdded ? "Connected" : "Action required"}</span>
            </div>
          </div>
        )}
      </div>
      <Link href="/payroll">
        <Button variant="outline" className="gap-1.5">
          <DollarSign className="h-4 w-4" />Go to Payroll Section →
        </Button>
      </Link>
    </div>
  );
}

function SettingsTab({ company, onRefresh }: { company: Company; onRefresh: () => void }) {
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState("");

  const triggerRollfiOnboard = async () => {
    setOnboarding(true);
    setError("");
    try {
      const res = await fetch("/api/rollfi/onboard/company", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Failed"); }
      onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to onboard"); }
    finally { setOnboarding(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
        <p className="text-sm font-bold text-gray-800">Company Settings</p>
        <div className="text-sm text-gray-600 space-y-1">
          <div><span className="text-gray-400">ID: </span><span className="font-mono">{company.id}</span></div>
          <div><span className="text-gray-400">Created: </span>{new Date(company.createdAt).toLocaleDateString()}</div>
        </div>
      </div>

      {!company.rollfiCompanyId && !company.rollfi?.rollfiCompanyId && (
        <div className="bg-white rounded-xl border p-5 shadow-sm space-y-3">
          <p className="text-sm font-bold text-gray-800">Rollfi Onboarding</p>
          <p className="text-sm text-gray-500">This company hasn't been registered with Rollfi yet. Click below to trigger onboarding.</p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button onClick={triggerRollfiOnboard} disabled={onboarding} className="gap-1.5 text-white border-0" style={{ background: NAVY }}>
            {onboarding ? <><Loader2 className="h-4 w-4 animate-spin" />Onboarding…</> : <><RefreshCw className="h-4 w-4" />Register with Rollfi</>}
          </Button>
        </div>
      )}
    </div>
  );
}

type TabId = "overview" | "employees" | "payroll" | "settings";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview",   label: "Overview" },
  { id: "employees",  label: "Employees" },
  { id: "payroll",    label: "Payroll Status" },
  { id: "settings",   label: "Settings" },
];

const STATUS_CFG2: Record<string, { label: string; color: string }> = {
  active:     { label: "Active",     color: "bg-emerald-100 text-emerald-700" },
  setting_up: { label: "Setting Up", color: "bg-yellow-100 text-yellow-700" },
  pending:    { label: "Pending",    color: "bg-orange-100 text-orange-700" },
  suspended:  { label: "Suspended",  color: "bg-red-100 text-red-700" },
};

export default function ClientDetail() {
  const params = useParams<{ companyId: string }>();
  const companyId = params.companyId;
  const [tab, setTab] = useState<TabId>("overview");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    queryFn: () => fetch(`/api/companies/${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/companies", companyId] });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (!data || !data.name) return (
    <div className="text-center py-20">
      <Building2 className="h-10 w-10 mx-auto mb-3 text-gray-300" />
      <p className="font-semibold text-gray-700">Company not found</p>
      <Link href="/clients"><Button variant="outline" className="mt-3 gap-1.5"><ChevronLeft className="h-4 w-4" />Back to Clients</Button></Link>
    </div>
  );

  const statusCfg = STATUS_CFG2[data.status] ?? STATUS_CFG2.pending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-2">
            <ChevronLeft className="h-4 w-4" />Back to Clients
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${ORANGE}15` }}>
              <Building2 className="h-5 w-5" style={{ color: ORANGE }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: NAVY }}>{data.name}</h1>
              <p className="text-sm text-gray-500">{data.city}, {data.state} · {data.industry}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.color}`}>{statusCfg.label}</span>
          <Link href={`/clients/${companyId}/employees/new`}>
            <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}>
              <Plus className="h-3.5 w-3.5" />Add Employee
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === id ? "border-[#E8622A] text-[#E8622A]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview"  && <OverviewTab company={data} />}
      {tab === "employees" && <EmployeesTab company={data} />}
      {tab === "payroll"   && <PayrollTab company={data} />}
      {tab === "settings"  && <SettingsTab company={data} onRefresh={refresh} />}
    </div>
  );
}
