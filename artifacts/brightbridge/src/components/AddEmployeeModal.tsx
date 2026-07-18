// TODO: RETIREMENT CANDIDATE — This inline modal only covers basic fields (no state W-4, no bank setup).
// The full 4-step wizard at /clients/:companyId/employees/new is the canonical flow.
// New entry points (e.g. People page) should link to the wizard instead of using this component.
// Safe to remove once all callers have been migrated to the wizard.
import React, { useState } from "react";
import { X, CheckCircle2, AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ROLE_OPTIONS = [
  { value: "teacher", label: "Teacher" },
  { value: "assistant", label: "Teaching Assistant" },
  { value: "lead_teacher", label: "Lead Teacher" },
  { value: "admin_staff", label: "Administrative Staff" },
  { value: "director", label: "Director" },
];

const ROLE_NAMES: Record<string, string> = {
  teacher: "Teacher",
  assistant: "Teaching Assistant",
  lead_teacher: "Lead Teacher",
  admin_staff: "Administrative Staff",
  director: "Director",
};

interface AddedEmployee {
  id: string;
  name: string;
  status: string;
  easyteamSynced: boolean;
  rollfiSynced: boolean;
  easyteamError?: string;
  rollfiError?: string;
  loginCreated?: boolean;
  loginEmail?: string;
  loginPassword?: string;
}

interface Props {
  clientId: string;
  locationName: string;
  onClose: () => void;
  onSuccess?: (employee: AddedEmployee) => void;
}

export function AddEmployeeModal({ clientId, locationName, onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("teacher");
  const [wage, setWage] = useState("18.00");
  const [status, setStatus] = useState<"hired" | "onboarding" | "active">("active");
  const [submitting, setSubmitting] = useState(false);
  const [added, setAdded] = useState<AddedEmployee | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    setError("");
    try {
      const wageInCents = Math.round(parseFloat(wage) * 100);
      const res = await fetch(`/api/clients/${clientId}/employees`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || undefined,
          role,
          roleName: ROLE_NAMES[role] ?? role,
          wage: wageInCents,
          wageType: "hourly",
          timeTrackingEnabled: true,
          status,
        }),
      });
      const data = await res.json() as AddedEmployee;
      if (!res.ok) { setError("Failed to add employee. Please try again."); return; }
      setAdded(data);
      onSuccess?.(data);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-bold text-[#284362] text-base">Add Employee</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{locationName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-gray-900 transition-colors rounded-lg p-1 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {added ? (
          <div className="px-6 py-6 space-y-4">
            <div className="text-center space-y-1">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-semibold text-gray-900 mt-2">{added.name} added!</p>
              <p className="text-sm text-muted-foreground capitalize">{added.status}</p>
            </div>

            {/* Login credentials */}
            {added.loginCreated && added.loginEmail && added.loginPassword ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Login Account Created</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Email</span>
                    <span className="text-xs font-mono font-semibold text-gray-800">{added.loginEmail}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Password</span>
                    <span className="text-xs font-mono font-semibold text-gray-800">{added.loginPassword}</span>
                  </div>
                </div>
                <p className="text-[10px] text-emerald-600">Share these credentials with the employee so they can log in.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-700">No email was provided — login account not created. Edit and add an email to enable login.</p>
              </div>
            )}

            <div className="space-y-2">
              <SyncBadge label="EasyTeam" synced={added.easyteamSynced} error={added.easyteamError} active={status === "active"} />
              <SyncBadge label="Rollfi" synced={added.rollfiSynced} error={added.rollfiError} active={status === "active"} />
            </div>
            {status !== "active" && (
              <p className="text-xs text-center text-muted-foreground">
                Set status to <strong>Active</strong> when the employee is ready to sync.
              </p>
            )}
            <Button onClick={onClose} className="w-full text-white border-0" style={{ background: "#E8622A" }}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Full Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@daycare.com"
                type="email"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Role *</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Hourly Wage ($)</Label>
                <Input
                  value={wage}
                  onChange={(e) => setWage(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="18.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Starting Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hired">Hired — offer accepted, not started</SelectItem>
                  <SelectItem value="onboarding">Onboarding — completing paperwork</SelectItem>
                  <SelectItem value="active">Active — ready to clock in &amp; receive payroll</SelectItem>
                </SelectContent>
              </Select>
              {status === "active" && (
                <p className="text-[11px] text-emerald-600">Will auto-sync to EasyTeam and Rollfi on save.</p>
              )}
            </div>
            {error && (
              <p className="text-sm text-red-500 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                disabled={!name || submitting}
                className="flex-1 text-white border-0"
                style={{ background: "#E8622A" }}
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Adding…</>
                  : <><UserPlus className="h-4 w-4 mr-1.5" />Add Employee</>}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SyncBadge({ label, synced, error, active }: { label: string; synced: boolean; error?: string; active: boolean }) {
  if (!active) {
    return (
      <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">Syncs when set to Active</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {synced
        ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Synced</span>
        : <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />{error ? "Failed" : "Not synced"}</span>}
    </div>
  );
}
