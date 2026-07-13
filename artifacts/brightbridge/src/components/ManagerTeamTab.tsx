import React, { useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Plus, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Pause, Ban, RotateCcw, UserX, KeyRound,
  Eye, EyeOff, Copy, X, ChevronRight, DollarSign, Calendar,
  Phone, Mail, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const ORANGE = "#E8622A";
const NAVY = "#284362";
const PANEL_BG = "#284362";

// ── Types ─────────────────────────────────────────────────────

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

// ── Status config ─────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; dot: string }> = {
  active:               { label: "Active",      color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  onboarding:           { label: "Onboarding",  color: "bg-yellow-100 text-yellow-700",  dot: "bg-yellow-500" },
  hired:                { label: "Setting Up",  color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500"   },
  invited:              { label: "Setting Up",  color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500"   },
  pending_verification: { label: "Pending",     color: "bg-orange-100 text-orange-700",  dot: "bg-orange-500" },
  on_leave:             { label: "On Leave",    color: "bg-amber-100 text-amber-700",    dot: "bg-amber-500"  },
  terminated:           { label: "Terminated",  color: "bg-red-100 text-red-700",        dot: "bg-red-400"    },
};

function formatWage(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/hr`;
}

// ── Toast ─────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 right-6 z-[60] bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
      {message}
      <button onClick={onDismiss} className="ml-2 text-white/50 hover:text-white"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// ── Sync Dot ──────────────────────────────────────────────────

function SyncBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
      {done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

// ── Credential Modal ──────────────────────────────────────────

interface CredentialModalProps {
  user: CompanyUser; companyId: string; onClose: () => void; onSaved: () => void;
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
    setSaving(true); setError("");
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
      setSaved(true); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" style={{ color: NAVY }} />
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

// ── On Leave Modal ────────────────────────────────────────────

function OnLeaveModal({ emp, onClose, onSuccess }: { emp: Employee; onSuccess: () => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fullName = `${emp.firstName} ${emp.lastName}`;

  const handleConfirm = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/rollfi/employees/deactivate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id, reason: reason || undefined, expectedReturnDate: returnDate || undefined }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to put employee on leave");
      onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setLoading(false); }
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
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none">
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
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleConfirm(); }} disabled={loading}
            className="bg-amber-500 hover:bg-amber-600 text-white border-0 gap-1.5">
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing…</> : <><Pause className="h-3.5 w-3.5" />Put On Leave</>}
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
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fullName = `${emp.firstName} ${emp.lastName}`;
  const canSubmit = confirmText === "TERMINATE" && !!terminationReason && !!lastWorkingDay;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/rollfi/employees/terminate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id, terminationReason, lastWorkingDay }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to terminate employee");
      onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setLoading(false); }
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
            <strong>{fullName}</strong> will be permanently removed from all future payrolls and unable to clock in.
          </p>
          {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Termination Reason <span className="text-red-500">*</span></Label>
            <select value={terminationReason} onChange={(e) => setTerminationReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none">
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
            <Label className="text-xs text-gray-600 font-medium">Type <strong>TERMINATE</strong> to confirm:</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder="TERMINATE" className="h-9 text-sm border-red-200 font-mono tracking-wider" />
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
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/rollfi/employees/reactivate", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: emp.id }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to reactivate");
      onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setLoading(false); }
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

// ── Employee Detail Panel ─────────────────────────────────────

interface EmployeeDetailPanelProps {
  emp: Employee;
  companyId: string;
  onClose: () => void;
  onAction: (action: "on_leave" | "terminate" | "reactivate") => void;
}

function EmployeeDetailPanel({ emp, companyId, onClose, onAction }: EmployeeDetailPanelProps) {
  const cfg = STATUS_CFG[emp.status] ?? STATUS_CFG.onboarding!;
  const isTerminated = emp.status === "terminated";
  const isOnLeave    = emp.status === "on_leave";
  const isActive     = emp.status === "active";
  const hasRollfi    = !!emp.rollfiUserId;
  const fullName     = `${emp.firstName} ${emp.lastName}`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: NAVY }}>
              {emp.firstName[0]}{emp.lastName[0]}
            </div>
            <div>
              <p className={`font-bold text-gray-900 ${isTerminated ? "line-through text-gray-400" : ""}`}>{fullName}</p>
              <p className="text-xs text-gray-500">{emp.position}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><X className="h-4 w-4" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            {isTerminated && (
              <span className="text-xs text-red-500">No further actions available</span>
            )}
          </div>

          {/* Contact */}
          <div className="rounded-xl border p-4 space-y-2.5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Contact</p>
            {emp.email && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Mail className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <span className="font-mono text-xs">{emp.email}</span>
              </div>
            )}
            {emp.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                {emp.phone}
              </div>
            )}
          </div>

          {/* Employment */}
          <div className="rounded-xl border p-4 space-y-2.5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Employment</p>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-gray-500">Type</span>
              <span className="font-medium">{emp.workerType || emp.employmentType || "—"}</span>
              <span className="text-gray-500">Pay rate</span>
              <span className="font-medium font-mono flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5 text-gray-400" />{formatWage(emp.hourlyWage)}
              </span>
              <span className="text-gray-500">Pay type</span>
              <span className="font-medium capitalize">{emp.payType || "hourly"}</span>
              <span className="text-gray-500">Joined</span>
              <span className="font-medium flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                {new Date(emp.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>

          {/* Integration status */}
          <div className="rounded-xl border p-4 space-y-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Integrations</p>
            <div className="space-y-2">
              {[
                { label: "EasyTeam (time tracking)", done: emp.easyteamSynced },
                { label: "Rollfi (payroll)",         done: hasRollfi },
                { label: "KYC identity verified",    done: emp.kycStatus === "verified" || emp.kycStatus === "approved" },
                { label: "Bank account connected",   done: emp.bankAccountAdded },
              ].map(({ label, done }) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  {done
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    : <XCircle    className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                  <span className={done ? "text-gray-800" : "text-gray-400"}>{label}</span>
                  {!done && (
                    <span className="ml-auto text-[10px] text-amber-600 font-medium">Pending</span>
                  )}
                </div>
              ))}
            </div>

            {/* Onboarding progress nudge */}
            {!hasRollfi && !isTerminated && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <strong>{emp.firstName}</strong> hasn't been linked to Rollfi yet. Ask them to complete onboarding so they can receive payroll.
              </div>
            )}
          </div>

          {/* Actions */}
          {!isTerminated && (
            <div className="rounded-xl border p-4 space-y-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Actions</p>

              {isActive && hasRollfi && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onAction("on_leave")}
                    className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50 text-xs">
                    <Pause className="h-3 w-3" />Put On Leave
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onAction("terminate")}
                    className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 text-xs">
                    <UserX className="h-3 w-3" />Terminate
                  </Button>
                </div>
              )}

              {isOnLeave && hasRollfi && (
                <Button size="sm" variant="outline" onClick={() => onAction("reactivate")}
                  className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-xs">
                  <RotateCcw className="h-3 w-3" />Reactivate
                </Button>
              )}

              {!hasRollfi && (
                <p className="text-xs text-gray-400 italic">
                  On Leave / Terminate / Reactivate are available once this employee is linked to Rollfi.
                  Use <strong>Sync from Rollfi</strong> to link them.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t bg-gray-50 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────

interface ManagerTeamTabProps {
  companyId: string;
  clientId: string | null;
}

export function ManagerTeamTab({ companyId, clientId }: ManagerTeamTabProps) {
  const queryClient = useQueryClient();
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewEmp, setViewEmp]         = useState<Employee | null>(null);
  const [onLeaveEmp, setOnLeaveEmp]   = useState<Employee | null>(null);
  const [terminateEmp, setTerminateEmp] = useState<Employee | null>(null);
  const [reactivateEmp, setReactivateEmp] = useState<Employee | null>(null);
  const [credentialUser, setCredentialUser] = useState<CompanyUser | null>(null);
  const [syncingRollfi, setSyncingRollfi]   = useState(false);
  const [toast, setToast]             = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["/api/employees", companyId],
    queryFn: () => fetch(`/api/employees?companyId=${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const { data: usersData } = useQuery<{ users: CompanyUser[] }>({
    queryKey: ["/api/companies/users", companyId],
    queryFn: () => fetch(`/api/companies/${companyId}/users`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });

  const employees = data?.employees ?? [];
  const managers  = usersData?.users ?? [];

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["/api/employees", companyId] });
  }, [queryClient, companyId]);

  const syncFromRollfi = async () => {
    setSyncingRollfi(true);
    try {
      const res = await fetch(`/api/rollfi/companies/${companyId}/sync-employees`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json() as { linked?: number; alreadyLinked?: number; total?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      refresh();
      setToast(
        (data.linked ?? 0) > 0
          ? `✅ Synced ${data.linked} employee${(data.linked ?? 0) > 1 ? "s" : ""} from Rollfi.`
          : `ℹ️ No new employees linked — ${data.alreadyLinked ?? 0} already connected.`
      );
    } catch (e) {
      setToast(`❌ ${e instanceof Error ? e.message : "Sync failed"}`);
    } finally {
      setSyncingRollfi(false);
    }
  };

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    const matchSearch = !q || `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.position.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = {
    total:      employees.length,
    active:     employees.filter(e => e.status === "active").length,
    onboarding: employees.filter(e => ["onboarding", "hired", "invited", "pending_verification"].includes(e.status)).length,
    on_leave:   employees.filter(e => e.status === "on_leave").length,
    terminated: employees.filter(e => e.status === "terminated").length,
  };

  const onboardingAlert = employees.find(e => ["onboarding", "hired", "invited"].includes(e.status) && (!e.rollfiUserId || !e.bankAccountAdded));

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Modals */}
      {onLeaveEmp && (
        <OnLeaveModal emp={onLeaveEmp} onClose={() => setOnLeaveEmp(null)}
          onSuccess={() => { const n = `${onLeaveEmp.firstName} ${onLeaveEmp.lastName}`; setOnLeaveEmp(null); setViewEmp(null); refresh(); setToast(`✅ ${n} has been put on leave.`); }} />
      )}
      {terminateEmp && (
        <TerminateModal emp={terminateEmp} onClose={() => setTerminateEmp(null)}
          onSuccess={() => { const n = `${terminateEmp.firstName} ${terminateEmp.lastName}`; setTerminateEmp(null); setViewEmp(null); refresh(); setToast(`✅ ${n} has been terminated.`); }} />
      )}
      {reactivateEmp && (
        <ReactivateModal emp={reactivateEmp} onClose={() => setReactivateEmp(null)}
          onSuccess={() => { const n = `${reactivateEmp.firstName} ${reactivateEmp.lastName}`; setReactivateEmp(null); setViewEmp(null); refresh(); setToast(`✅ ${n} has been reactivated!`); }} />
      )}
      {credentialUser && (
        <CredentialModal user={credentialUser} companyId={companyId} onClose={() => setCredentialUser(null)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["/api/companies/users", companyId] }); setCredentialUser(null); setToast("✅ Login credentials updated."); }} />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Employee detail slide-in panel */}
      {viewEmp && (
        <EmployeeDetailPanel
          emp={viewEmp}
          companyId={companyId}
          onClose={() => setViewEmp(null)}
          onAction={(action) => {
            if (action === "on_leave")   setOnLeaveEmp(viewEmp);
            if (action === "terminate")  setTerminateEmp(viewEmp);
            if (action === "reactivate") setReactivateEmp(viewEmp);
          }}
        />
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Staff",  value: counts.total,      active: statusFilter === "all",         filter: "all",        ring: "ring-[#284362]" },
          { label: "Active",       value: counts.active,     active: statusFilter === "active",       filter: "active",     ring: "ring-emerald-500" },
          { label: "Onboarding",   value: counts.onboarding, active: statusFilter === "onboarding",   filter: "onboarding", ring: "ring-yellow-500" },
          { label: "On Leave",     value: counts.on_leave,   active: statusFilter === "on_leave",     filter: "on_leave",   ring: "ring-amber-500" },
        ].map(s => (
          <button key={s.label} onClick={() => setStatusFilter(statusFilter === s.filter ? "all" : s.filter)}
            className={`text-left rounded-xl border p-3.5 shadow-sm transition-all bg-white hover:shadow-md ${s.active ? `ring-2 ${s.ring}` : ""}`}>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Onboarding nudge */}
      {onboardingAlert && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-yellow-300 bg-yellow-50 text-xs">
          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-800">
              {counts.onboarding} team member{counts.onboarding > 1 ? "s are" : " is"} still completing onboarding
            </p>
            <p className="text-yellow-700 mt-0.5">
              {onboardingAlert.firstName} {onboardingAlert.lastName} hasn't finished payroll setup. They need to complete their bank info to be included in payroll.
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or position…"
          className="flex-1 min-w-[180px] h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#284362]/20" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none text-gray-700">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="onboarding">Onboarding</option>
          <option value="on_leave">On Leave</option>
          <option value="terminated">Terminated</option>
        </select>
        <Button size="sm" variant="outline" onClick={() => void syncFromRollfi()} disabled={syncingRollfi}
          className="gap-1.5 text-gray-600 text-xs">
          {syncingRollfi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {syncingRollfi ? "Syncing…" : "Sync from Rollfi"}
        </Button>
        <Link href={`/clients/${clientId ?? companyId}/employees/new`}>
          <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}>
            <Plus className="h-3.5 w-3.5" />Add Team Member
          </Button>
        </Link>
      </div>

      {/* Employees table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-700">{employees.length === 0 ? "No team members yet" : "No results"}</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            {employees.length === 0 ? "Add your first team member to get started." : "Try a different search or filter."}
          </p>
          {employees.length === 0 && (
            <Link href={`/clients/${clientId ?? companyId}/employees/new`}>
              <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: ORANGE }}>
                <Plus className="h-3.5 w-3.5" />Add First Team Member
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name / Position</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Rate</th>
                <th className="text-left px-4 py-3">EasyTeam</th>
                <th className="text-left px-4 py-3">Rollfi</th>
                <th className="text-left px-4 py-3">KYC</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((emp) => {
                const cfg = STATUS_CFG[emp.status] ?? STATUS_CFG.onboarding!;
                const isTerminated = emp.status === "terminated";
                const isOnLeave    = emp.status === "on_leave";
                const isActive     = emp.status === "active";
                const hasRollfi    = !!emp.rollfiUserId;

                return (
                  <tr key={emp.id} className={`hover:bg-gray-50/50 transition-colors ${isTerminated ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className={`font-medium text-gray-900 ${isTerminated ? "line-through text-gray-400" : ""}`}>
                        {emp.firstName} {emp.lastName}
                      </div>
                      <div className="text-[11px] text-gray-400">{emp.position}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium">{emp.workerType || emp.employmentType}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{formatWage(emp.hourlyWage)}</td>
                    <td className="px-4 py-3"><SyncBadge done={emp.easyteamSynced} label="ET" /></td>
                    <td className="px-4 py-3"><SyncBadge done={hasRollfi} label="Rollfi" /></td>
                    <td className="px-4 py-3"><SyncBadge done={emp.kycStatus === "verified" || emp.kycStatus === "approved"} label="KYC" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setViewEmp(emp)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#284362] hover:text-[#E8622A] border border-[#284362]/20 hover:border-[#E8622A]/40 rounded-lg px-2.5 py-1 transition-colors"
                        >
                          <ChevronRight className="h-3 w-3" />View
                        </button>
                        {isTerminated && <span className="text-[10px] text-gray-400 italic">Terminated</span>}
                        {isOnLeave && hasRollfi && (
                          <button onClick={() => setReactivateEmp(emp)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 border border-emerald-300 hover:border-emerald-400 rounded-lg px-2.5 py-1 transition-colors">
                            <RotateCcw className="h-3 w-3" />Reactivate
                          </button>
                        )}
                        {isActive && hasRollfi && (
                          <>
                            <button onClick={() => setOnLeaveEmp(emp)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800 border border-amber-300 hover:border-amber-400 rounded-lg px-2.5 py-1 transition-colors">
                              <Pause className="h-3 w-3" />Leave
                            </button>
                            <button onClick={() => setTerminateEmp(emp)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg px-2.5 py-1 transition-colors">
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

      {/* Managers / Login Accounts section */}
      {managers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
            <ShieldCheck className="h-4 w-4" style={{ color: NAVY }} />
            Manager Login Accounts
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${NAVY}15`, color: NAVY }}>{managers.length}</span>
          </h3>
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">Email</th>
                  <th className="text-left px-4 py-2.5">Position</th>
                  <th className="text-left px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {managers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.position || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize" style={{ background: `${NAVY}15`, color: NAVY }}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setCredentialUser(u)}
                        className="inline-flex items-center gap-1 text-xs font-medium hover:text-[#E8622A] border border-[#284362]/20 hover:border-[#E8622A]/40 rounded-lg px-2.5 py-1 transition-colors"
                        style={{ color: NAVY }}>
                        <KeyRound className="h-3 w-3" />Login
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
