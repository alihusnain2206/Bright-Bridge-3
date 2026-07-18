import React, { useState } from "react";
import { Pause, Ban, RotateCcw, CheckCircle2, XCircle, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Minimal employee fields required by all three modals
export interface ModalEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

// ── On Leave Modal ────────────────────────────────────────────

export function OnLeaveModal({ emp, onClose, onSuccess }: {
  emp: ModalEmployee; onClose: () => void; onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
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
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30">
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
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Any additional notes…"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none" />
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

export function TerminateModal({ emp, onClose, onSuccess }: {
  emp: ModalEmployee; onClose: () => void; onSuccess: () => void;
}) {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
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
          <div className="p-3 rounded-lg bg-red-50 border border-red-300 text-sm text-red-800 font-semibold">This action is PERMANENT and cannot be undone!</div>
          <p className="text-sm text-gray-600"><strong>{fullName}</strong> will be permanently removed from all future payrolls and will be unable to clock in. Their records will be kept for compliance purposes.</p>
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
            <select value={terminationReason} onChange={(e) => setTerminationReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30">
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
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">Type <strong>TERMINATE</strong> to confirm:</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="TERMINATE"
              className="h-9 text-sm border-red-200 focus-visible:ring-red-500/30 font-mono tracking-wider" />
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

export function ReactivateModal({ emp, onClose, onSuccess }: {
  emp: ModalEmployee; onClose: () => void; onSuccess: () => void;
}) {
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
      if (!res.ok) throw new Error(data.error ?? "Failed to reactivate employee");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
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
          <p className="text-sm text-gray-600"><strong>{fullName}</strong> will be returned to active status. They will be included in future payrolls and can clock in via EasyTeam.</p>
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
