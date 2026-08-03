import React, { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, DollarSign, RefreshCw, Loader2, ShieldCheck,
  Eye, EyeOff, Copy, X, KeyRound, Pause, Ban, RotateCcw, UserX, Globe, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnLeaveModal, TerminateModal, ReactivateModal } from "@/components/EmployeeStatusModals";
import { StateRegistrationSection } from "@/components/StateRegistrationSection";

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
  payType: string; hourlyWage: number; annualSalary?: number | null; status: string;
  easyteamSynced: boolean; rollfiUserId?: string; kycStatus?: string; bankAccountAdded: boolean;
  syncStatus: string; createdAt: string;
}

interface CompanyUser {
  id: string; name: string; email: string; role: string; position: string; source: string;
}

// ── Credential Manager Modal ──────────────────────────────────

interface CredentialModalProps {
  user: CompanyUser;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}

function CredentialModal({ user, companyId, onClose, onSaved }: CredentialModalProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [position, setPosition] = useState(user.position);
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const copy = (val: string, key: string) => {
    void navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, string> = {};
      if (name !== user.name) body.name = name;
      if (email !== user.email) body.email = email;
      if (position !== user.position) body.position = position;
      if (newPassword) body.password = newPassword;
      if (Object.keys(body).length === 0) { setSaved(true); onSaved(); return; }
      const res = await fetch(`/api/companies/${companyId}/users/${user.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Failed"); }
      setSaved(true);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#284362]" />
            <h2 className="font-semibold text-gray-900">Manage Login — {user.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {saved && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">✓ Changes saved</div>}
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Full Name</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
              <button onClick={() => copy(name, "name")} className="text-gray-400 hover:text-gray-600"><Copy className="h-3.5 w-3.5" /></button>
              {copied === "name" && <span className="text-[10px] text-emerald-600 self-center">Copied!</span>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Email (login)</Label>
            <div className="flex gap-2">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-8 text-sm" />
              <button onClick={() => copy(email, "email")} className="text-gray-400 hover:text-gray-600"><Copy className="h-3.5 w-3.5" /></button>
              {copied === "email" && <span className="text-[10px] text-emerald-600 self-center">Copied!</span>}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Role</Label>
            <div className="flex items-center h-8 px-3 rounded-md border border-gray-200 bg-gray-50">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#284362]/10 text-[#284362] capitalize">{user.role}</span>
              <span className="ml-2 text-xs text-gray-400">Read-only</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">New Password (leave blank to keep current)</Label>
            <div className="flex gap-2">
              <Input type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password…" className="h-8 text-sm" />
              <button onClick={() => setShowPw((p) => !p)} className="text-gray-400 hover:text-gray-600">{showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
              {newPassword && <button onClick={() => copy(newPassword, "pw")} className="text-gray-400 hover:text-gray-600"><Copy className="h-3.5 w-3.5" /></button>}
              {copied === "pw" && <span className="text-[10px] text-emerald-600 self-center">Copied!</span>}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleSave(); }} disabled={saving} className="text-white border-0" style={{ background: NAVY }}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Status config ─────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  active:               { label: "Active",      color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  onboarding:           { label: "Onboarding",  color: "bg-yellow-100 text-yellow-700",  dot: "bg-yellow-500" },
  hired:                { label: "Setting Up",  color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500" },
  invited:              { label: "Setting Up",  color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500" },
  pending_verification: { label: "Pending",     color: "bg-orange-100 text-orange-700",  dot: "bg-orange-500" },
  on_leave:             { label: "On Leave",    color: "bg-amber-100 text-amber-700",    dot: "bg-amber-500" },
  terminated:           { label: "Terminated",  color: "bg-red-100 text-red-700",        dot: "bg-red-400" },
};


function formatWage(emp: Pick<Employee, "payType" | "hourlyWage" | "annualSalary">): string {
  if (emp.payType === "salary" || emp.payType?.startsWith("salary_")) {
    if (!emp.annualSalary) return "$—/yr";
    return `$${(emp.annualSalary / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr`;
  }
  return `$${((emp.hourlyWage ?? 0) / 100).toFixed(2)}/hr`;
}

function SyncDot({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
      {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

// ── Success toast state ───────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 right-6 z-[60] bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm flex items-center gap-2 animate-in slide-in-from-bottom-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
      {message}
      <button onClick={onDismiss} className="ml-2 text-white/50 hover:text-white"><X className="h-3.5 w-3.5" /></button>
    </div>
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
  const queryClient = useQueryClient();
  const [credentialUser, setCredentialUser] = useState<CompanyUser | null>(null);
  const [onLeaveEmp, setOnLeaveEmp] = useState<Employee | null>(null);
  const [terminateEmp, setTerminateEmp] = useState<Employee | null>(null);
  const [syncingRollfi, setSyncingRollfi] = useState(false);
  const [reactivateEmp, setReactivateEmp] = useState<Employee | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const refreshEmployees = () => void queryClient.invalidateQueries({ queryKey: ["/api/employees", company.id] });

  const syncFromRollfi = async () => {
    setSyncingRollfi(true);
    try {
      const res = await fetch(`/api/rollfi/companies/${company.id}/sync-employees`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json() as { linked?: number; alreadyLinked?: number; total?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      refreshEmployees();
      if ((data.linked ?? 0) > 0) {
        setToast(`✅ Synced ${data.linked} employee${(data.linked ?? 0) > 1 ? "s" : ""} from Rollfi. Terminate and On Leave buttons are now available.`);
      } else {
        setToast(`ℹ️ No new employees linked — ${data.alreadyLinked ?? 0} already connected, ${(data.total ?? 0) - (data.alreadyLinked ?? 0) - (data.linked ?? 0)} not found in Rollfi.`);
      }
    } catch (e) {
      setToast(`❌ ${e instanceof Error ? e.message : "Sync failed"}`);
    } finally {
      setSyncingRollfi(false);
    }
  };

  if (isLoading || usersLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Modals */}
      {credentialUser && (
        <CredentialModal
          user={credentialUser}
          companyId={company.id}
          onClose={() => setCredentialUser(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/companies/users", company.id] });
            setCredentialUser(null);
          }}
        />
      )}
      {onLeaveEmp && (
        <OnLeaveModal
          emp={onLeaveEmp}
          onClose={() => setOnLeaveEmp(null)}
          onSuccess={() => {
            setOnLeaveEmp(null);
            refreshEmployees();
            setToast(`✅ ${onLeaveEmp.firstName} ${onLeaveEmp.lastName} has been put on leave. They will be removed from payroll and cannot clock in.`);
          }}
        />
      )}
      {terminateEmp && (
        <TerminateModal
          emp={terminateEmp}
          onClose={() => setTerminateEmp(null)}
          onSuccess={() => {
            const name = `${terminateEmp.firstName} ${terminateEmp.lastName}`;
            setTerminateEmp(null);
            refreshEmployees();
            setToast(`✅ ${name} has been terminated. They have been removed from all future payrolls.`);
          }}
        />
      )}
      {reactivateEmp && (
        <ReactivateModal
          emp={reactivateEmp}
          onClose={() => setReactivateEmp(null)}
          onSuccess={() => {
            const name = `${reactivateEmp.firstName} ${reactivateEmp.lastName}`;
            setReactivateEmp(null);
            refreshEmployees();
            setToast(`✅ ${name} has been reactivated! They can now clock in and will be included in payroll.`);
          }}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

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
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody className="divide-y">
                {managers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.position || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#284362]/10 text-[#284362] capitalize">{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setCredentialUser(u)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#284362] hover:text-[#E8622A] border border-[#284362]/20 hover:border-[#E8622A]/40 rounded-lg px-2.5 py-1 transition-colors"
                      >
                        <KeyRound className="h-3 w-3" />Login
                      </button>
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
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void syncFromRollfi()} disabled={syncingRollfi} className="gap-1.5 text-gray-600 text-xs">
              {syncingRollfi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncingRollfi ? "Syncing…" : "Sync from Rollfi"}
            </Button>
            <Link href={`/clients/${company.id}/employees/new`}>
              <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}>
                <Plus className="h-3.5 w-3.5" />Add Employee
              </Button>
            </Link>
          </div>
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
                <th className="text-right px-4 py-3">Actions</th>
              </tr></thead>
              <tbody className="divide-y">
                {employees.map((emp) => {
                  const cfg = STATUS_CFG[emp.status] ?? STATUS_CFG.onboarding;
                  const isTerminated = emp.status === "terminated";
                  const isOnLeave = emp.status === "on_leave";
                  const isActive = emp.status === "active";
                  const hasRollfi = !!emp.rollfiUserId;
                  return (
                    <tr key={emp.id} className={`hover:bg-gray-50/50 transition-colors ${isTerminated ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className={`font-medium ${isTerminated ? "text-gray-400 line-through" : ""}`}>{emp.firstName} {emp.lastName}</div>
                        <div className="text-[11px] text-gray-400">{emp.position}</div>
                      </td>
                      <td className="px-4 py-3"><span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium">{emp.workerType}</span></td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{formatWage(emp)}</td>
                      <td className="px-4 py-3"><SyncDot done={emp.easyteamSynced} label="ET" /></td>
                      <td className="px-4 py-3"><SyncDot done={hasRollfi} label="Rollfi" /></td>
                      <td className="px-4 py-3"><SyncDot done={emp.kycStatus === "verified"} label="KYC" /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isTerminated && (
                            <span className="text-[10px] text-gray-400 italic">No actions available</span>
                          )}
                          {isOnLeave && hasRollfi && (
                            <button
                              onClick={() => setReactivateEmp(emp)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 border border-emerald-300 hover:border-emerald-400 rounded-lg px-2.5 py-1 transition-colors"
                            >
                              <RotateCcw className="h-3 w-3" />Reactivate
                            </button>
                          )}
                          {isActive && hasRollfi && (
                            <>
                              <button
                                onClick={() => setOnLeaveEmp(emp)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800 border border-amber-300 hover:border-amber-400 rounded-lg px-2.5 py-1 transition-colors"
                              >
                                <Pause className="h-3 w-3" />On Leave
                              </button>
                              <button
                                onClick={() => setTerminateEmp(emp)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-2.5 py-1 transition-colors"
                              >
                                <UserX className="h-3 w-3" />Terminate
                              </button>
                            </>
                          )}
                          <a
                            href={`/people/${emp.id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#284362] hover:text-[#1a2f47] border border-[#284362]/30 hover:border-[#284362] rounded-lg px-2.5 py-1 transition-colors"
                          >
                            View Profile
                          </a>
                          {!hasRollfi && !isTerminated && (
                            <span className="text-[10px] text-gray-300 italic">Not on Rollfi</span>
                          )}
                        </div>
                      </td>
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

function OwnerAccessSection({ company }: { company: Company }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newForm, setNewForm] = useState({ name: "", email: "", password: "" });
  const [showPw, setShowPw] = useState(false);

  // Auto-generate a password whenever the creation form opens
  useEffect(() => {
    if (showForm) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
      const pw = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      setNewForm(f => ({ ...f, password: pw }));
    }
  }, [showForm]);
  const [createdUser, setCreatedUser] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [credUser, setCredUser] = useState<CompanyUser | null>(null);

  const copyField = (val: string, field: string) => {
    void navigator.clipboard.writeText(val);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const { data, isLoading, refetch } = useQuery<{ users: CompanyUser[] }>({
    queryKey: ["/api/companies/users/settings", company.id],
    queryFn: () => fetch(`/api/companies/${company.id}/users`, { credentials: "include" }).then((r) => r.json()),
  });
  const managers = (data?.users ?? []).filter((u) => u.role === "manager" || u.role === "owner");

  const handleCreate = async () => {
    if (!newForm.name || !newForm.email || !newForm.password) {
      setCreateError("Name, email, and password are all required");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/auth/create-manager", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newForm.name, email: newForm.email, companyId: company.id, position: "Daycare Manager" }),
      });
      const d = await res.json() as { name?: string; email?: string; password?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed to create login");
      setCreatedUser({ name: d.name ?? newForm.name, email: d.email ?? newForm.email, password: d.password ?? newForm.password });
      setShowForm(false);
      setNewForm({ name: "", email: "", password: "" });
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ["/api/companies/users", company.id] });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create login");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
      {credUser && (
        <CredentialModal
          user={credUser}
          companyId={company.id}
          onClose={() => setCredUser(null)}
          onSaved={() => { setCredUser(null); void refetch(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#284362]" />Owner &amp; Manager Logins
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Accounts that can log in and manage this company</p>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => { setShowForm(true); setCreateError(""); setCreatedUser(null); }} className="gap-1.5 text-xs">
            <UserPlus className="h-3.5 w-3.5" />Add Login
          </Button>
        )}
      </div>

      {createdUser && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-700 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Login created</p>
          {[
            { label: "Name", val: createdUser.name, field: "name" },
            { label: "Email", val: createdUser.email, field: "email" },
            { label: "Password", val: createdUser.password, field: "pw" },
          ].map(({ label, val, field }) => (
            <div key={field} className="flex items-center justify-between text-sm">
              <span className="text-gray-500 text-xs">{label}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-gray-800">{field === "pw" ? (showPw ? val : "••••••••") : val}</span>
                {field === "pw" && <button onClick={() => setShowPw((p) => !p)} className="text-gray-400 hover:text-gray-600">{showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</button>}
                <button onClick={() => copyField(val, field)} className="text-gray-400 hover:text-[#284362]"><Copy className="h-3 w-3" /></button>
                {copiedField === field && <span className="text-[10px] text-emerald-600">Copied!</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-12 rounded-lg" />
      ) : managers.length === 0 && !showForm ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
          <KeyRound className="h-7 w-7 mx-auto mb-2 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">No manager logins yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-3">Create a login so the daycare owner can access their company's payroll and staff data.</p>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5 text-xs">
            <UserPlus className="h-3.5 w-3.5" />Create First Login
          </Button>
        </div>
      ) : managers.length > 0 ? (
        <div className="divide-y border rounded-xl overflow-hidden">
          {managers.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50/50">
              <div>
                <p className="text-sm font-medium text-gray-800">{u.name}</p>
                <p className="text-xs text-gray-400 font-mono">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#284362]/10 text-[#284362] capitalize">{u.role}</span>
                <button onClick={() => setCredUser(u)} className="inline-flex items-center gap-1 text-xs font-medium text-[#284362] hover:text-[#E8622A] border border-[#284362]/20 hover:border-[#E8622A]/40 rounded-lg px-2.5 py-1 transition-colors">
                  <KeyRound className="h-3 w-3" />Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Create Manager Login</p>
          {createError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />{createError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Full Name</Label>
              <Input value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" placeholder="Jane Smith" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Email (login)</Label>
              <Input value={newForm.email} onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} className="h-8 text-sm" type="email" placeholder="jane@daycare.com" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-gray-500">Password <span className="text-gray-400 font-normal">(auto-generated)</span></Label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Input readOnly type={showPw ? "text" : "password"} value={newForm.password} className="h-8 text-sm pr-9 bg-gray-50 font-mono" />
                  <button type="button" onClick={() => setShowPw((p) => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button type="button" onClick={() => copyField(newForm.password, "gen-pw")} className="h-8 w-8 flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-400 hover:text-[#284362] transition-colors shrink-0" title="Copy password">
                  {copiedField === "gen-pw" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setCreateError(""); }}>
              <X className="h-3.5 w-3.5 mr-1" />Cancel
            </Button>
            <Button size="sm" onClick={() => { void handleCreate(); }} disabled={creating} className="gap-1.5 text-white border-0" style={{ background: NAVY }}>
              {creating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : <><KeyRound className="h-3.5 w-3.5" />Create Login</>}
            </Button>
          </div>
        </div>
      )}
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

      <OwnerAccessSection company={company} />
      <StateRegistrationSection
        companyId={company.id}
        hasRollfi={!!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId)}
        registrationsUrl={`/api/rollfi/state-registrations?companyId=${company.id}`}
      />
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
  const [location] = useLocation();
  const [tab, setTab] = useState<TabId>(() => location.endsWith("/employees") ? "employees" : "overview");
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
