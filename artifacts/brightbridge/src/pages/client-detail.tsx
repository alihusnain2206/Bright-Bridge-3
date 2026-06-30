import React, { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, Plus, DollarSign, RefreshCw, Loader2, ShieldCheck,
  Eye, EyeOff, Copy, X, KeyRound, Pause, Ban, RotateCcw, UserX, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
            <Label className="text-xs text-gray-500">Position</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} className="h-8 text-sm" />
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

// ── On Leave Modal ────────────────────────────────────────────

function OnLeaveModal({ emp, onClose, onSuccess }: { emp: Employee; onSuccess: () => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fullName = `${emp.firstName} ${emp.lastName}`;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rollfi/employees/deactivate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id, reason: reason || undefined, expectedReturnDate: returnDate || undefined }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to put employee on leave");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <Pause className="h-4 w-4 text-amber-600" />
            <h2 className="font-semibold text-gray-900">Put {fullName} On Leave</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <strong>{fullName}</strong> will be temporarily removed from payroll and unable to clock in until reactivated.
          </div>
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Reason</Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              <option value="">Select reason…</option>
              <option value="Maternity/Paternity Leave">Maternity/Paternity Leave</option>
              <option value="Medical Leave">Medical Leave</option>
              <option value="Personal Leave">Personal Leave</option>
              <option value="Unpaid Leave">Unpaid Leave</option>
              <option value="Suspended">Suspended</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Expected Return Date <span className="text-gray-400 font-normal">(optional)</span></Label>
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any additional notes…"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleConfirm(); }} disabled={loading}
            className="bg-amber-500 hover:bg-amber-600 text-white border-0 gap-1.5">
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing…</> : <><Pause className="h-3.5 w-3.5" />Confirm — Put On Leave</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Terminate Modal ───────────────────────────────────────────

function TerminateModal({ emp, onClose, onSuccess }: { emp: Employee; onSuccess: () => void; onClose: () => void }) {
  const [terminationReason, setTerminationReason] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [notes, setNotes] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fullName = `${emp.firstName} ${emp.lastName}`;
  const canSubmit = confirmText === "TERMINATE" && !!terminationReason && !!lastWorkingDay;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rollfi/employees/terminate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id, terminationReason, lastWorkingDay }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to terminate employee");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-600" />
            <h2 className="font-semibold text-gray-900">⚠️ Terminate {fullName}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-sm text-red-800 font-semibold">
            This action is PERMANENT and cannot be undone!
          </div>
          <p className="text-sm text-gray-600">
            <strong>{fullName}</strong> will be permanently removed from all future payrolls and will be unable to clock in. Their records will be kept for compliance purposes.
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Removed from all future payrolls</div>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Cannot clock in to EasyTeam</div>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Employment records kept</div>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Pay history kept</div>
            <div className="flex items-center gap-2 text-red-600"><XCircle className="h-3.5 w-3.5" />Cannot be reactivated</div>
            <div className="flex items-center gap-2 text-red-600"><XCircle className="h-3.5 w-3.5" />Cannot clock in ever again</div>
          </div>
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Termination Reason <span className="text-red-500">*</span></Label>
            <select
              value={terminationReason}
              onChange={(e) => setTerminationReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
            >
              <option value="">Select reason…</option>
              <option value="Resigned">Resigned</option>
              <option value="Terminated by employer">Terminated by employer</option>
              <option value="Contract ended">Contract ended</option>
              <option value="Retired">Retired</option>
              <option value="Mutual agreement">Mutual agreement</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Last Working Day <span className="text-red-500">*</span></Label>
            <Input type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Type <strong>TERMINATE</strong> to confirm:</Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="TERMINATE"
              className="h-9 text-sm border-red-200 focus-visible:ring-red-500/30 font-mono tracking-wider"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleConfirm(); }} disabled={!canSubmit || loading}
            className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white border-0 gap-1.5">
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Terminating…</> : <><Ban className="h-3.5 w-3.5" />Permanently Terminate</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Reactivate Modal ──────────────────────────────────────────

function ReactivateModal({ emp, onClose, onSuccess }: { emp: Employee; onSuccess: () => void; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fullName = `${emp.firstName} ${emp.lastName}`;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rollfi/employees/reactivate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to reactivate employee");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-emerald-600" />
            <h2 className="font-semibold text-gray-900">Reactivate {fullName}?</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            <strong>{fullName}</strong> will be returned to active status. They will be included in future payrolls and can clock in via EasyTeam.
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Added back to payroll</div>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Can clock in to EasyTeam</div>
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Status changed to Active</div>
          </div>
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleConfirm(); }} disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 gap-1.5">
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Reactivating…</> : <><RotateCcw className="h-3.5 w-3.5" />Confirm Reactivation</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{formatWage(emp.hourlyWage)}</td>
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

// ── US States list ────────────────────────────────────────────

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

interface StateRegistration {
  id: string; companyId: string; rollfiCompanyId: string;
  stateCode: string; stateName: string; stateEmployerId: string;
  suiAccountNumber?: string | null; suiRate?: number | null;
  status: string; rollfiResponse?: string | null;
  registeredAt: string; updatedAt: string;
}

const STATE_REG_STATUS: Record<string, { label: string; color: string }> = {
  active:  { label: "Registered", color: "bg-emerald-100 text-emerald-700" },
  pending: { label: "Pending",    color: "bg-yellow-100 text-yellow-700" },
  failed:  { label: "Failed",     color: "bg-red-100 text-red-700" },
};

function StateRegistrationSection({ company }: { company: Company }) {
  const [showForm, setShowForm] = useState(false);
  const [stateCode, setStateCode] = useState("");
  const [stateEmployerId, setStateEmployerId] = useState("");
  const [suiAccount, setSuiAccount] = useState("");
  const [suiRate, setSuiRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const hasRollfi = !!(company.rollfiCompanyId ?? company.rollfi?.rollfiCompanyId);

  const { data, isLoading, refetch } = useQuery<{ registrations: StateRegistration[] }>({
    queryKey: ["/api/rollfi/state-registrations", company.id],
    queryFn: () => fetch(`/api/rollfi/state-registrations?companyId=${company.id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: hasRollfi,
  });

  const registrations = data?.registrations ?? [];

  const handleSubmit = async () => {
    if (!stateCode || !stateEmployerId) return;
    setSaving(true); setSaveError(""); setSaveSuccess(false);
    try {
      const selectedState = US_STATES.find((s) => s.code === stateCode);
      const res = await fetch("/api/rollfi/onboard/state-registration", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id, stateCode, stateName: selectedState?.name ?? stateCode,
          stateEmployerId, suiAccountNumber: suiAccount || undefined,
          suiRate: suiRate ? parseFloat(suiRate) : undefined,
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Registration failed");
      setSaveSuccess(true);
      setShowForm(false); setStateCode(""); setStateEmployerId(""); setSuiAccount(""); setSuiRate("");
      void refetch();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#284362]" />State Tax Registrations
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Required by Rollfi to withhold and file state taxes at year-end</p>
        </div>
        {hasRollfi && !showForm && (
          <Button size="sm" variant="outline" onClick={() => { setShowForm(true); setSaveError(""); setSaveSuccess(false); }} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />Add State
          </Button>
        )}
      </div>

      {!hasRollfi && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3 border border-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />Complete Rollfi onboarding before adding state registrations.
        </div>
      )}

      {hasRollfi && isLoading && <Skeleton className="h-12 rounded-lg" />}

      {hasRollfi && !isLoading && registrations.length === 0 && !showForm && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
          <Globe className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">No states registered yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-3">Add the states where this company employs people so Rollfi can correctly withhold and file state taxes.</p>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />Register First State
          </Button>
        </div>
      )}

      {registrations.length > 0 && (
        <div className="divide-y border rounded-xl overflow-hidden">
          {registrations.map((reg) => {
            const sc = STATE_REG_STATUS[reg.status] ?? STATE_REG_STATUS.pending;
            return (
              <div key={reg.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50/50">
                <div>
                  <div className="text-sm font-medium text-gray-800">{reg.stateName} <span className="text-gray-400">({reg.stateCode})</span></div>
                  <div className="text-[11px] text-gray-400 mt-0.5 space-x-2">
                    <span>Employer ID: <span className="font-mono text-gray-600">{reg.stateEmployerId}</span></span>
                    {reg.suiAccountNumber && <span>· SUI: <span className="font-mono text-gray-600">{reg.suiAccountNumber}</span></span>}
                    {reg.suiRate != null && <span>· Rate: {reg.suiRate}%</span>}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.color}`}>{sc.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {saveSuccess && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />State registration submitted to Rollfi successfully.
        </div>
      )}

      {showForm && (
        <div className="border rounded-xl p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-semibold text-gray-800">Register a State</p>
          {saveError && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{saveError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-gray-600 font-medium">State <span className="text-red-500">*</span></Label>
              <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#284362]/20">
                <option value="">Select state…</option>
                {US_STATES.filter((s) => !registrations.some((r) => r.stateCode === s.code)).map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-gray-600 font-medium">State Employer ID <span className="text-red-500">*</span></Label>
              <Input value={stateEmployerId} onChange={(e) => setStateEmployerId(e.target.value)}
                placeholder="e.g. NJ-123456789" className="h-9 text-sm" />
              <p className="text-[10px] text-gray-400">The employer account number issued by the state's Department of Revenue or Labor.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600 font-medium">SUI Account # <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input value={suiAccount} onChange={(e) => setSuiAccount(e.target.value)}
                placeholder="e.g. 987654321" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600 font-medium">SUI Rate % <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input type="number" step="0.01" min="0" max="20" value={suiRate}
                onChange={(e) => setSuiRate(e.target.value)} placeholder="e.g. 2.80" className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setSaveError(""); }}>Cancel</Button>
            <Button size="sm" onClick={() => { void handleSubmit(); }} disabled={!stateCode || !stateEmployerId || saving}
              className="text-white border-0 gap-1.5" style={{ background: NAVY }}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Registering…</> : <><Globe className="h-3.5 w-3.5" />Register State</>}
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

      <StateRegistrationSection company={company} />
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
