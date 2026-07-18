import React, { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Plus, Download, Search, ChevronUp, ChevronDown, ChevronsUpDown,
  MoreHorizontal, Eye, Pencil, ShieldCheck, Pause, Ban, RotateCcw, Building2,
  UserX, AlertTriangle, X, CheckCircle2, Clock, XCircle, ClipboardList, FolderOpen, Phone,
} from "lucide-react";
import EmergencyContactForm from "@/components/EmergencyContactForm";
import EmployeeDocuments from "@/components/EmployeeDocuments";
import TaskActionModal from "@/components/TaskActionModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { OnLeaveModal, TerminateModal, ReactivateModal, type ModalEmployee } from "@/components/EmployeeStatusModals";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

// ── Types ─────────────────────────────────────────────────────

interface PeopleEmployee {
  id: string; companyId: string;
  firstName: string; lastName: string; email: string; phone: string;
  position: string; employmentType: string; workerType: string; status: string;
  startDate?: string | null;
  employeeDisplayId?: string | null;
  department?: string | null;
  managerId?: string | null;
  managerName?: string | null;
  jobTitle?: string | null;
  complianceScore?: number | null;
  onboardingProgress?: number | null;
  payrollReady?: boolean | null;
  rollfiUserId?: string | null;
  hourlyWage?: number | null;
  bankAccountAdded?: boolean | null;
  photoUrl?: string | null;
  kycStatus?: string | null;
  createdAt: string;
}

interface Company { id: string; name: string; }
interface Department { id: string; name: string; }
interface ComplianceItem { id: string; type: string; name: string; status: string; isRequired: boolean; }

// ── Helpers ───────────────────────────────────────────────────

const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tenure(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}m`;
  const yr = Math.floor(mo / 12);
  const rem = mo % 12;
  return rem > 0 ? `${yr}y ${rem}m` : `${yr}y`;
}

function isNewHire(emp: PeopleEmployee): boolean {
  if (emp.status === "onboarding" || emp.status === "pending") return true;
  if (!emp.startDate) return false;
  return (Date.now() - new Date(emp.startDate).getTime()) < 30 * 86400000;
}

function payrollChip(emp: PeopleEmployee): { label: string; cls: string } {
  if (emp.rollfiUserId && emp.bankAccountAdded && (emp.hourlyWage ?? 0) > 0)
    return { label: "Ready", cls: "bg-emerald-100 text-emerald-700" };
  if (emp.rollfiUserId || emp.bankAccountAdded)
    return { label: "Pending", cls: "bg-amber-100 text-amber-700" };
  return { label: "Not Started", cls: "bg-gray-100 text-gray-500" };
}

const STATUS_CFG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  active:     { label: "Active",     dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700" },
  on_leave:   { label: "On Leave",   dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700"   },
  onboarding: { label: "Onboarding", dot: "bg-blue-500",    bg: "bg-blue-50",     text: "text-blue-700"    },
  pending:    { label: "Pending",    dot: "bg-gray-400",    bg: "bg-gray-100",    text: "text-gray-500"    },
  terminated: { label: "Terminated", dot: "bg-red-400",     bg: "bg-red-50",      text: "text-red-600"     },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-500" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function complianceRing(score: number): string {
  if (score >= 90) return "border-emerald-500 text-emerald-600";
  if (score >= 70) return "border-amber-500 text-amber-600";
  return "border-red-500 text-red-600";
}

// ── Compliance Popover Cell ───────────────────────────────────

function ComplianceCell({ emp }: { emp: PeopleEmployee }) {
  const [open, setOpen] = useState(false);
  const score = emp.complianceScore;

  const { data, isLoading } = useQuery<{ items: ComplianceItem[]; score: number }>({
    queryKey: ["compliance", emp.id],
    queryFn: () => fetch(`/api/compliance?employeeId=${emp.id}`, { credentials: "include" }).then(r => r.json() as Promise<{ items: ComplianceItem[]; score: number }>),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  if (score == null) return <span className="text-gray-400 text-sm">—</span>;

  const ring = complianceRing(score);
  const statusIcon = (s: string) => {
    if (s === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    if (s === "waived")    return <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
    return <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all hover:scale-105 ${ring}`}
          title={`Compliance: ${score}%`}
        >
          {score}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 shadow-lg" align="center">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
            <span className="font-semibold text-sm text-gray-900">{emp.firstName} {emp.lastName}</span>
          </div>
          <span className={`text-sm font-bold ${complianceRing(score).split(" ")[1]}`}>{score}%</span>
        </div>
        <div className="p-3 max-h-64 overflow-y-auto space-y-1.5">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full rounded" />)
          ) : (data?.items ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No compliance items found</p>
          ) : (
            (data?.items ?? []).map(item => (
              <div key={item.id} className="flex items-center gap-2 py-1">
                {statusIcon(item.status)}
                <span className="text-xs text-gray-700 flex-1 truncate">{item.name}</span>
                {item.isRequired && (
                  <span className="text-[10px] text-gray-400 font-medium shrink-0">REQ</span>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100">
          <td className="px-4 py-4"><div className="flex items-center gap-3"><Skeleton className="w-10 h-10 rounded-full" /><div className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-16" /></div></div></td>
          <td className="px-4 py-4"><Skeleton className="h-3.5 w-24" /></td>
          <td className="px-4 py-4"><Skeleton className="h-3.5 w-20" /></td>
          <td className="px-4 py-4"><Skeleton className="h-3.5 w-20" /></td>
          <td className="px-4 py-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
          <td className="px-4 py-4"><Skeleton className="h-3.5 w-20" /></td>
          <td className="px-4 py-4"><Skeleton className="w-9 h-9 rounded-full" /></td>
          <td className="px-4 py-4"><Skeleton className="h-5 w-16 rounded-full" /></td>
          <td className="px-4 py-4"><Skeleton className="w-7 h-7 rounded" /></td>
        </tr>
      ))}
    </>
  );
}

// ── Sort header ───────────────────────────────────────────────

function SortTh({ col, label, current, dir, onSort, className = "" }: {
  col: string; label: string; current: string; dir: "asc" | "desc";
  onSort: (col: string) => void; className?: string;
}) {
  const active = current === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-900 whitespace-nowrap ${className}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {active
          ? (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
      </div>
    </th>
  );
}

// ── Actions Dropdown ──────────────────────────────────────────

function ActionsDropdown({ emp, hasRollfi, onLeave, terminate, reactivate, onTasks, onContacts, onDocuments, onProfile, onEdit, onCompliance }: {
  emp: PeopleEmployee;
  hasRollfi: boolean;
  onLeave: () => void;
  terminate: () => void;
  reactivate: () => void;
  onTasks: () => void;
  onContacts: () => void;
  onDocuments: () => void;
  onProfile: () => void;
  onEdit: () => void;
  onCompliance: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isTerminated = emp.status === "terminated";
  const isOnLeave    = emp.status === "on_leave";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1 text-sm">
            <button
              onClick={() => { setOpen(false); onProfile(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <Eye className="h-3.5 w-3.5 text-gray-400" /> View Profile
            </button>
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit
            </button>
            <button
              onClick={() => { setOpen(false); onCompliance(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-gray-400" /> View Compliance
            </button>
            <button
              onClick={() => { setOpen(false); onTasks(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <ClipboardList className="h-3.5 w-3.5 text-gray-400" /> Onboarding Tasks
            </button>
            <button
              onClick={() => { setOpen(false); onContacts(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <Phone className="h-3.5 w-3.5 text-gray-400" /> Emergency Contacts
            </button>
            <button
              onClick={() => { setOpen(false); onDocuments(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-3.5 w-3.5 text-gray-400" /> Documents
            </button>
            {!isTerminated && (
              <>
                <div className="my-1 border-t border-gray-100" />
                {isOnLeave && hasRollfi && (
                  <button onClick={() => { setOpen(false); reactivate(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50">
                    <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                  </button>
                )}
                {!isOnLeave && hasRollfi && (
                  <button onClick={() => { setOpen(false); onLeave(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-amber-700 hover:bg-amber-50">
                    <Pause className="h-3.5 w-3.5" /> Put On Leave
                  </button>
                )}
                {hasRollfi && (
                  <button onClick={() => { setOpen(false); terminate(); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50">
                    <UserX className="h-3.5 w-3.5" /> Terminate
                  </button>
                )}
                {!hasRollfi && (
                  <div className="px-3 py-1.5 text-xs text-gray-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Rollfi sync required for leave/terminate
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── CSV Export ────────────────────────────────────────────────

function exportCsv(employees: PeopleEmployee[]) {
  const headers = ["Display ID","Name","Email","Job Title","Department","Manager","Status","Hire Date","Compliance Score"];
  const rows = employees.map(e => [
    e.employeeDisplayId ?? "",
    `${e.firstName} ${e.lastName}`,
    e.email,
    e.jobTitle ?? e.position ?? "",
    e.department ?? "",
    e.managerName ?? "",
    e.status,
    e.startDate ? fmtDate(e.startDate) : "",
    e.complianceScore != null ? String(e.complianceScore) : "",
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: "employees.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Profile Modal ─────────────────────────────────────────────

function EmployeeProfileModal({ emp, onClose, onEdit, onCompliance }: {
  emp: PeopleEmployee;
  onClose: () => void;
  onEdit: () => void;
  onCompliance: () => void;
}) {
  const color = avatarColor(`${emp.firstName} ${emp.lastName}`);
  const status = STATUS_CFG[emp.status] ?? { label: emp.status, dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-500" };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-gray-900">Employee Profile</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Identity */}
          <div className="px-5 py-5 flex items-center gap-4 border-b">
            {emp.photoUrl ? (
              <img src={emp.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 text-white text-xl font-semibold" style={{ background: color }}>
                {initials(emp.firstName, emp.lastName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-lg font-semibold text-gray-900">{emp.firstName} {emp.lastName}</div>
              {emp.employeeDisplayId && <div className="text-xs text-gray-400">{emp.employeeDisplayId}</div>}
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
                </span>
                {emp.jobTitle && <span className="text-xs text-gray-500">{emp.jobTitle}</span>}
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="px-5 py-4 space-y-4">
            <Section label="Contact">
              <Row label="Email" value={emp.email || "—"} />
              <Row label="Phone" value={emp.phone || "—"} />
            </Section>
            <Section label="Employment">
              <Row label="Position" value={emp.position || "—"} />
              <Row label="Type" value={emp.employmentType || "—"} />
              <Row label="Worker" value={emp.workerType || "—"} />
              <Row label="Start Date" value={fmtDate(emp.startDate)} />
            </Section>
            <Section label="Organisation">
              <Row label="Department" value={emp.department || "—"} />
              <Row label="Manager" value={emp.managerName || "—"} />
            </Section>
            {(emp.complianceScore != null || emp.onboardingProgress != null) && (
              <Section label="Progress">
                {emp.complianceScore != null && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-500 shrink-0">Compliance</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${emp.complianceScore}%`, background: emp.complianceScore >= 80 ? "#10b981" : emp.complianceScore >= 50 ? "#f59e0b" : "#ef4444" }} />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{emp.complianceScore}%</span>
                    </div>
                  </div>
                )}
                {emp.onboardingProgress != null && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-500 shrink-0">Onboarding</span>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${emp.onboardingProgress}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{emp.onboardingProgress}%</span>
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t flex gap-2 justify-end shrink-0">
          <button onClick={() => { onClose(); onCompliance(); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5 text-gray-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Compliance
          </button>
          <button onClick={() => { onClose(); onEdit(); }} className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 text-white" style={{ background: NAVY }}>
            <Pencil className="h-3.5 w-3.5" /> Edit Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between text-sm gap-3">
      <span className="text-gray-500 shrink-0 w-28">{label}</span>
      <span className="text-gray-800 text-right break-all">{value}</span>
    </div>
  );
}

// ── Edit Employee Modal ────────────────────────────────────────

function EmployeeEditModal({ emp, onClose, onSaved }: {
  emp: PeopleEmployee;
  onClose: () => void;
  onSaved: (updated: PeopleEmployee) => void;
}) {
  const [form, setForm] = useState({
    firstName:      emp.firstName,
    lastName:       emp.lastName,
    email:          emp.email,
    phone:          emp.phone ?? "",
    position:       emp.position ?? "",
    jobTitle:       emp.jobTitle ?? "",
    employmentType: emp.employmentType ?? "",
    workerType:     emp.workerType ?? "",
    department:     emp.department ?? "",
    startDate:      emp.startDate ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/employees/${emp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await r.json() as { employee?: PeopleEmployee; error?: string };
      if (!r.ok) { setError(data.error ?? "Failed to save"); return; }
      onSaved(data.employee!);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  const EMP_TYPES = ["Full Time (30+ Hours per week)","Part Time (Under 30 Hours per week)","PRN / Casual","Seasonal"];
  const WORKER_TYPES = ["W2","1099 Contractor","Volunteer","Intern"];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Edit Employee</h2>
            <p className="text-xs text-gray-400">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">First Name *</span>
              <Input value={form.firstName} onChange={e => set("firstName", e.target.value)} className="mt-1 h-9 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Last Name *</span>
              <Input value={form.lastName} onChange={e => set("lastName", e.target.value)} className="mt-1 h-9 text-sm" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-500 font-medium">Email *</span>
            <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} className="mt-1 h-9 text-sm" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Phone</span>
              <Input value={form.phone} onChange={e => set("phone", e.target.value)} className="mt-1 h-9 text-sm" placeholder="(555) 000-0000" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Start Date</span>
              <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} className="mt-1 h-9 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Position</span>
              <Input value={form.position} onChange={e => set("position", e.target.value)} className="mt-1 h-9 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Job Title</span>
              <Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} className="mt-1 h-9 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Employment Type</span>
              <select value={form.employmentType} onChange={e => set("employmentType", e.target.value)} className="mt-1 w-full h-9 text-sm border border-gray-200 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]">
                {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 font-medium">Worker Type</span>
              <select value={form.workerType} onChange={e => set("workerType", e.target.value)} className="mt-1 w-full h-9 text-sm border border-gray-200 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]">
                {WORKER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-500 font-medium">Department</span>
            <Input value={form.department} onChange={e => set("department", e.target.value)} className="mt-1 h-9 text-sm" placeholder="e.g. Teaching Staff" />
          </label>
        </div>

        <div className="px-5 py-3 border-t flex gap-2 justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="px-4 py-1.5 text-sm rounded-lg text-white disabled:opacity-50" style={{ background: NAVY }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Compliance Modal ───────────────────────────────────────────

interface ComplianceItemFull {
  id: string; employeeId: string; type: string; name: string;
  status: string; isRequired: boolean; completedAt?: string | null; notes?: string | null;
}

function EmployeeComplianceModal({ emp, onClose }: { emp: PeopleEmployee; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ items: ComplianceItemFull[]; score: number }>({
    queryKey: ["compliance", emp.id],
    queryFn: () => fetch(`/api/compliance?employeeId=${emp.id}`, { credentials: "include" }).then(r => r.json() as Promise<{ items: ComplianceItemFull[]; score: number }>),
    staleTime: 0,
  });

  const items = data?.items ?? [];
  const score = data?.score ?? emp.complianceScore ?? 0;

  const groups = items.reduce<Record<string, ComplianceItemFull[]>>((acc, item) => {
    const g = item.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    (acc[g] ??= []).push(item);
    return acc;
  }, {});

  const STATUS_STYLES: Record<string, string> = {
    completed: "bg-emerald-50 text-emerald-700",
    in_progress: "bg-blue-50 text-blue-700",
    pending: "bg-gray-100 text-gray-500",
    overdue: "bg-red-50 text-red-600",
    waived: "bg-purple-50 text-purple-700",
  };
  const STATUS_ICONS: Record<string, React.ReactNode> = {
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
    in_progress: <Clock className="h-3.5 w-3.5 text-blue-500" />,
    pending: <Clock className="h-3.5 w-3.5 text-gray-400" />,
    overdue: <XCircle className="h-3.5 w-3.5 text-red-500" />,
    waived: <Ban className="h-3.5 w-3.5 text-purple-500" />,
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Compliance</h2>
            <p className="text-xs text-gray-400">{emp.firstName} {emp.lastName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>

        {/* Score bar */}
        <div className="px-5 py-3 border-b shrink-0 flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444" }} />
          </div>
          <span className="text-sm font-semibold text-gray-700 shrink-0">{score}%</span>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No compliance items found</div>
          ) : (
            Object.entries(groups).map(([group, groupItems]) => (
              <div key={group}>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group}</div>
                <div className="space-y-1.5">
                  {groupItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                      <span className="shrink-0">{STATUS_ICONS[item.status] ?? <Clock className="h-3.5 w-3.5 text-gray-400" />}</span>
                      <span className="flex-1 text-sm text-gray-700 min-w-0 truncate">{item.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.isRequired && <span className="text-[10px] text-orange-500 font-medium">Required</span>}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[item.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {item.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

const PAGE_SIZE = 20;
const SUB_TABS = ["Employee Directory", "New Hires", "Onboarding"] as const;
type SubTab = typeof SUB_TABS[number];

export default function PeoplePage() {
  const { user, isLoading: authLoading } = useAuth();
  const qc = useQueryClient();

  // Company selection: super_admin gets a picker; managers are auto-scoped
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const companyId = user?.role === "super_admin" ? selectedCompanyId : (user?.companyId ?? "");

  // Sub-nav
  const [subTab, setSubTab] = useState<SubTab>("Employee Directory");

  // Filters
  const [search, setSearch]       = useState("");
  const [filterDept, setFilterDept]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterEmpType, setFilterEmpType] = useState("");
  const [filterComp, setFilterComp]   = useState("");

  // Sort
  const [sortCol, setSortCol] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Pagination
  const [page, setPage] = useState(1);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Modals
  const [onLeaveEmp,   setOnLeaveEmp]   = useState<ModalEmployee | null>(null);
  const [terminateEmp, setTerminateEmp] = useState<ModalEmployee | null>(null);
  const [reactivateEmp, setReactivateEmp] = useState<ModalEmployee | null>(null);
  const [empContacts,  setEmpContacts]  = useState<PeopleEmployee | null>(null);
  const [empDocuments, setEmpDocuments] = useState<PeopleEmployee | null>(null);
  const [empTasks,     setEmpTasks]     = useState<PeopleEmployee | null>(null);
  const [empProfile,   setEmpProfile]   = useState<PeopleEmployee | null>(null);
  const [empEdit,      setEmpEdit]      = useState<PeopleEmployee | null>(null);
  const [empCompliance,setEmpCompliance]= useState<PeopleEmployee | null>(null);

  // ── Data fetches ───────────────────────────────────────────

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ["companies-list"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then(r => r.json() as Promise<{ companies: Company[] }>),
    enabled: user?.role === "super_admin",
    staleTime: 5 * 60 * 1000,
    select: d => d,
  });
  const allCompanies = companiesData?.companies ?? [];

  const { data: empData, isLoading: empLoading, isError: empError } = useQuery<{ employees: PeopleEmployee[] }>({
    queryKey: ["people-employees", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/employees?companyId=${companyId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load employees (${r.status})`);
      return r.json() as Promise<{ employees: PeopleEmployee[] }>;
    },
    enabled: !!companyId && !authLoading,
    staleTime: 60 * 1000,
  });
  const allEmployees: PeopleEmployee[] = empData?.employees ?? [];

  const { data: deptData } = useQuery<{ departments: Department[] }>({
    queryKey: ["people-departments", companyId],
    queryFn: () => fetch(`/api/departments?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ departments: Department[] }>),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const departments = deptData?.departments ?? [];

  // ── Filtering ─────────────────────────────────────────────

  const activeFilterCount = [filterDept, filterStatus, filterEmpType, filterComp].filter(Boolean).length;

  const clearFilters = () => {
    setFilterDept(""); setFilterStatus(""); setFilterEmpType(""); setFilterComp(""); setSearch(""); setPage(1);
  };

  const filtered = useMemo(() => {
    let list = allEmployees;

    // Sub-tab scope
    if (subTab === "New Hires") {
      list = list.filter(isNewHire);
    }

    // Hide terminated by default unless status filter explicitly selects them
    const showTerminated = filterStatus === "terminated" || filterStatus === "all";
    if (!showTerminated) list = list.filter(e => e.status !== "terminated");

    // Status filter (skip 'all' since that's the default set above)
    if (filterStatus && filterStatus !== "all") {
      list = list.filter(e => e.status === filterStatus);
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        (e.employeeDisplayId ?? "").toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.jobTitle ?? e.position ?? "").toLowerCase().includes(q)
      );
    }

    if (filterDept)    list = list.filter(e => e.department === filterDept);
    if (filterEmpType) list = list.filter(e => e.employmentType === filterEmpType);

    if (filterComp === "90+")     list = list.filter(e => (e.complianceScore ?? 0) >= 90);
    if (filterComp === "70-89")   list = list.filter(e => { const s = e.complianceScore ?? 0; return s >= 70 && s < 90; });
    if (filterComp === "below70") list = list.filter(e => (e.complianceScore ?? 0) < 70);

    return list;
  }, [allEmployees, subTab, search, filterStatus, filterDept, filterEmpType, filterComp]);

  // ── Sorting ───────────────────────────────────────────────

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (sortCol === "name")       { va = `${a.firstName} ${a.lastName}`; vb = `${b.firstName} ${b.lastName}`; }
      if (sortCol === "department") { va = a.department ?? ""; vb = b.department ?? ""; }
      if (sortCol === "status")     { va = a.status; vb = b.status; }
      if (sortCol === "hireDate")   { va = a.startDate ?? ""; vb = b.startDate ?? ""; }
      if (sortCol === "compliance") { va = a.complianceScore ?? -1; vb = b.complianceScore ?? -1; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortCol, sortDir]);

  // ── Pagination ────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  };

  const refetchEmployees = () => {
    void qc.invalidateQueries({ queryKey: ["people-employees", companyId] });
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ── Derived company name ──────────────────────────────────

  const selectedCompanyName = user?.role === "manager"
    ? (user?.name ? "Your Company" : "")
    : allCompanies.find(c => c.id === selectedCompanyId)?.name ?? "";

  // ── Add-employee link ─────────────────────────────────────

  const addEmpHref = companyId ? `/clients/${companyId}/employees/new` : "/clients";

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-7xl">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-xl">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          {toast}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: `${NAVY}15` }}>
            <Users className="h-5 w-5" style={{ color: NAVY }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: NAVY }}>People</h1>
            <p className="text-sm text-muted-foreground">Manage your workforce</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            onClick={() => exportCsv(sorted)}
            disabled={sorted.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Link href={addEmpHref}>
            <Button size="sm" className="gap-1.5 text-sm text-white" style={{ background: NAVY }}>
              <Plus className="h-3.5 w-3.5" /> Add Employee
            </Button>
          </Link>
        </div>
      </div>

      {/* Company selector — super_admin only */}
      {user?.role === "super_admin" && (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-white shadow-sm">
          <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-600 font-medium shrink-0">Company:</span>
          <select
            value={selectedCompanyId}
            onChange={e => { setSelectedCompanyId(e.target.value); setPage(1); clearFilters(); }}
            className="flex-1 max-w-xs h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
          >
            <option value="">— Select a company —</option>
            {allCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selectedCompanyName && (
            <span className="text-xs text-gray-400">
              {allEmployees.length} employee{allEmployees.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* No company selected */}
      {!companyId && user?.role === "super_admin" && (
        <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
          <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Select a company to view employees</p>
        </div>
      )}

      {companyId && (
        <>
          {/* Sub-nav */}
          <div className="flex items-center gap-1 border-b border-gray-200">
            {SUB_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => { setSubTab(tab); setPage(1); }}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  subTab === tab
                    ? "border-[#0EA5C9] text-[#0EA5C9]"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                {tab}
                {tab === "New Hires" && allEmployees.filter(isNewHire).length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#0EA5C9]/10 text-[#0EA5C9]">
                    {allEmployees.filter(isNewHire).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Onboarding placeholder */}
          {subTab === "Onboarding" ? (
            <div className="rounded-xl border bg-white shadow-sm p-16 text-center">
              <ShieldCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-gray-700 font-semibold mb-1">Onboarding Pipeline</h3>
              <p className="text-gray-400 text-sm">Coming soon — track onboarding tasks and progress per employee</p>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="rounded-xl border bg-white shadow-sm p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-center">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <Input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      placeholder="Search name, ID, email, title…"
                      className="pl-8 h-8 text-sm"
                    />
                  </div>

                  {/* Department */}
                  <select value={filterDept} onChange={e => { setFilterDept(e.target.value); setPage(1); }}
                    className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30">
                    <option value="">All Departments</option>
                    {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>

                  {/* Status */}
                  <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
                    className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30">
                    <option value="">All Statuses</option>
                    <option value="all">All (incl. Terminated)</option>
                    <option value="active">Active</option>
                    <option value="on_leave">On Leave</option>
                    <option value="onboarding">Onboarding</option>
                    <option value="pending">Pending</option>
                    <option value="terminated">Terminated only</option>
                  </select>

                  {/* Employment Type */}
                  <select value={filterEmpType} onChange={e => { setFilterEmpType(e.target.value); setPage(1); }}
                    className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30">
                    <option value="">All Types</option>
                    <option value="Full Time (30+ Hours per week)">Full Time</option>
                    <option value="Part Time (Less than 30 Hours per week)">Part Time</option>
                    <option value="Contractor">Contractor</option>
                    <option value="Seasonal">Seasonal</option>
                  </select>

                  {/* Compliance */}
                  <select value={filterComp} onChange={e => { setFilterComp(e.target.value); setPage(1); }}
                    className="h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30">
                    <option value="">All Compliance</option>
                    <option value="90+">90%+ (Good)</option>
                    <option value="70-89">70–89% (Fair)</option>
                    <option value="below70">Below 70% (At Risk)</option>
                  </select>

                  {/* Clear filters */}
                  {(activeFilterCount > 0 || search) && (
                    <button onClick={clearFilters}
                      className="h-8 flex items-center gap-1.5 px-3 text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                      <X className="h-3 w-3" />
                      Clear {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
                    </button>
                  )}
                </div>

                {/* Results count */}
                <div className="text-xs text-gray-500">
                  Showing <strong className="text-gray-700">{sorted.length === allEmployees.length
                    ? `${sorted.length}`
                    : `${sorted.length} of ${allEmployees.filter(e => e.status !== "terminated").length}`
                  }</strong> employee{sorted.length !== 1 ? "s" : ""}
                  {activeFilterCount > 0 && " — filtered"}
                </div>
              </div>

              {/* Table */}
              <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead className="bg-gray-50/80 border-b border-gray-100">
                      <tr>
                        <SortTh col="name"       label="Employee"   current={sortCol} dir={sortDir} onSort={handleSort} className="min-w-[180px]" />
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Job Title</th>
                        <SortTh col="department" label="Department" current={sortCol} dir={sortDir} onSort={handleSort} />
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Manager</th>
                        <SortTh col="status"     label="Status"     current={sortCol} dir={sortDir} onSort={handleSort} />
                        <SortTh col="hireDate"   label="Hire Date"  current={sortCol} dir={sortDir} onSort={handleSort} />
                        <SortTh col="compliance" label="Compliance" current={sortCol} dir={sortDir} onSort={handleSort} />
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Payroll</th>
                        <th className="px-4 py-3 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(authLoading || empLoading) ? (
                        <SkeletonRows />
                      ) : empError ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-16 text-center">
                            <div className="space-y-3">
                              <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto" />
                              <p className="text-gray-600 font-medium">Couldn't load employees</p>
                              <p className="text-xs text-gray-400">Your session may have expired — try logging out and back in</p>
                              <Button size="sm" variant="outline" onClick={refetchEmployees}>Retry</Button>
                            </div>
                          </td>
                        </tr>
                      ) : paginated.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-16 text-center">
                            {allEmployees.length === 0 ? (
                              <div className="space-y-3">
                                <Users className="h-10 w-10 text-gray-300 mx-auto" />
                                <p className="text-gray-500 font-medium">No employees yet</p>
                                <Link href={addEmpHref}>
                                  <Button size="sm" style={{ background: NAVY }} className="text-white gap-1.5">
                                    <Plus className="h-3.5 w-3.5" /> Add First Employee
                                  </Button>
                                </Link>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <XCircle className="h-8 w-8 text-gray-300 mx-auto" />
                                <p className="text-gray-500 font-medium">No employees match your filters</p>
                                <button onClick={clearFilters} className="text-sm text-[#0EA5C9] hover:underline">Clear filters</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        paginated.map(emp => {
                          const isTerminated = emp.status === "terminated";
                          const hasRollfi    = !!emp.rollfiUserId;
                          const chip         = payrollChip(emp);
                          const title        = emp.jobTitle ?? emp.position ?? "—";
                          const color        = avatarColor(`${emp.firstName} ${emp.lastName}`);

                          return (
                            <tr
                              key={emp.id}
                              className={`hover:bg-gray-50/50 transition-colors group ${isTerminated ? "opacity-60" : ""}`}
                            >
                              {/* Photo + Name + ID */}
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-3">
                                  {emp.photoUrl ? (
                                    <img src={emp.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-semibold" style={{ background: color }}>
                                      {initials(emp.firstName, emp.lastName)}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <button
                                      onClick={() => setEmpProfile(emp)}
                                      className={`font-medium text-sm truncate text-left hover:underline ${isTerminated ? "line-through text-gray-400" : "text-[#1B3A6B] hover:text-[#0EA5C9]"}`}
                                    >
                                      {emp.firstName} {emp.lastName}
                                    </button>
                                    {emp.employeeDisplayId && (
                                      <div className="text-xs text-gray-400">{emp.employeeDisplayId}</div>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Job Title */}
                              <td className="px-4 py-4 text-sm text-gray-700 max-w-[160px] truncate" title={title}>{title}</td>

                              {/* Department */}
                              <td className="px-4 py-4 text-sm text-gray-600">{emp.department ?? <span className="text-gray-300">—</span>}</td>

                              {/* Manager */}
                              <td className="px-4 py-4 text-sm text-gray-600">{emp.managerName ?? <span className="text-gray-300">—</span>}</td>

                              {/* Status */}
                              <td className="px-4 py-4"><StatusBadge status={emp.status} /></td>

                              {/* Hire Date + Tenure */}
                              <td className="px-4 py-4">
                                <div className="text-sm text-gray-700">{fmtDate(emp.startDate)}</div>
                                {emp.startDate && (
                                  <div className="text-xs text-gray-400">{tenure(emp.startDate)}</div>
                                )}
                              </td>

                              {/* Compliance */}
                              <td className="px-4 py-4">
                                <ComplianceCell emp={emp} />
                              </td>

                              {/* Payroll */}
                              <td className="px-4 py-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${chip.cls}`}>
                                  {chip.label}
                                </span>
                              </td>

                              {/* Actions */}
                              <td className="px-4 py-4">
                                <ActionsDropdown
                                  emp={emp}
                                  hasRollfi={hasRollfi}
                                  onLeave={() => setOnLeaveEmp(emp)}
                                  terminate={() => setTerminateEmp(emp)}
                                  reactivate={() => setReactivateEmp(emp)}
                                  onTasks={() => setEmpTasks(emp)}
                                  onContacts={() => setEmpContacts(emp)}
                                  onDocuments={() => setEmpDocuments(emp)}
                                  onProfile={() => setEmpProfile(emp)}
                                  onEdit={() => setEmpEdit(emp)}
                                  onCompliance={() => setEmpCompliance(emp)}
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                    <span className="text-xs text-gray-500">
                      Page {page} of {totalPages} · {sorted.length} result{sorted.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ← Prev
                      </button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const p = Math.min(Math.max(1, page - 2), totalPages - 4) + i;
                        return p > 0 && p <= totalPages ? (
                          <button
                            key={p}
                            onClick={() => setPage(p)}
                            className={`w-7 h-7 text-xs rounded-md border transition-colors ${
                              p === page
                                ? "border-[#0EA5C9] bg-[#0EA5C9] text-white"
                                : "border-gray-200 hover:bg-white text-gray-600"
                            }`}
                          >
                            {p}
                          </button>
                        ) : null;
                      })}
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Manager auto-loads (no company selector needed) */}
      {!companyId && user?.role !== "super_admin" && (
        <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Loading your team…</p>
        </div>
      )}

      {/* Profile placeholder route */}
      {/* /people/:employeeId is handled in App.tsx — shows "Profile coming soon" */}

      {/* Status Modals */}
      {onLeaveEmp && (
        <OnLeaveModal
          emp={onLeaveEmp}
          onClose={() => setOnLeaveEmp(null)}
          onSuccess={() => {
            showToast(`✅ ${onLeaveEmp.firstName} ${onLeaveEmp.lastName} has been put on leave.`);
            setOnLeaveEmp(null);
            refetchEmployees();
          }}
        />
      )}
      {terminateEmp && (
        <TerminateModal
          emp={terminateEmp}
          onClose={() => setTerminateEmp(null)}
          onSuccess={() => {
            showToast(`✅ ${terminateEmp.firstName} ${terminateEmp.lastName} has been terminated.`);
            setTerminateEmp(null);
            refetchEmployees();
          }}
        />
      )}
      {reactivateEmp && (
        <ReactivateModal
          emp={reactivateEmp}
          onClose={() => setReactivateEmp(null)}
          onSuccess={() => {
            showToast(`✅ ${reactivateEmp.firstName} ${reactivateEmp.lastName} has been reactivated.`);
            setReactivateEmp(null);
            refetchEmployees();
          }}
        />
      )}

      {/* Emergency Contacts modal */}
      {empContacts && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">Emergency Contacts</h2>
                <p className="text-xs text-gray-400">{empContacts.firstName} {empContacts.lastName}</p>
              </div>
              <button onClick={() => setEmpContacts(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <EmergencyContactForm
                employeeId={empContacts.id}
                companyId={empContacts.companyId}
                onFirstSave={() => void qc.invalidateQueries({ queryKey: ["people-employees", companyId] })}
              />
            </div>
          </div>
        </div>
      )}

      {/* Documents modal */}
      {empDocuments && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">Documents</h2>
                <p className="text-xs text-gray-400">{empDocuments.firstName} {empDocuments.lastName}</p>
              </div>
              <button onClick={() => setEmpDocuments(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <EmployeeDocuments
                employeeId={empDocuments.id}
                companyId={empDocuments.companyId}
              />
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Tasks modal */}
      {empTasks && (
        <TaskActionModal
          employee={empTasks}
          onClose={() => setEmpTasks(null)}
          onRefresh={refetchEmployees}
        />
      )}

      {/* View Profile modal */}
      {empProfile && (
        <EmployeeProfileModal
          emp={empProfile}
          onClose={() => setEmpProfile(null)}
          onEdit={() => { setEmpProfile(null); setEmpEdit(empProfile); }}
          onCompliance={() => { setEmpProfile(null); setEmpCompliance(empProfile); }}
        />
      )}

      {/* Edit Employee modal */}
      {empEdit && (
        <EmployeeEditModal
          emp={empEdit}
          onClose={() => setEmpEdit(null)}
          onSaved={(updated) => {
            setEmpEdit(null);
            showToast(`✅ ${updated.firstName} ${updated.lastName} updated successfully.`);
            void qc.invalidateQueries({ queryKey: ["people-employees", companyId] });
          }}
        />
      )}

      {/* View Compliance modal */}
      {empCompliance && (
        <EmployeeComplianceModal
          emp={empCompliance}
          onClose={() => setEmpCompliance(null)}
        />
      )}
    </div>
  );
}
