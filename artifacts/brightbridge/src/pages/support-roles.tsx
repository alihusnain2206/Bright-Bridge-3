/**
 * /admin/support-roles — manage platform-level support accounts.
 * Accessible to: super_admin only.
 */
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, Plus, RotateCcw, Power, ChevronDown,
  Copy, Check, AlertTriangle, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NAVY  = "#1B3A6B";
const TEAL  = "#0EA5C9";

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path: string, init: RequestInit = {}) {
  const r = await fetch(path, { credentials: "include", ...init });
  const data = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error((data.error as string | undefined) ?? `Request failed (${r.status})`);
  return data;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlatformUser {
  id:        string;
  name:      string;
  email:     string;
  role:      string;
  isActive:  boolean;
  createdAt: string;
}

// ── Role badge ────────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const isTech = role === "technical";
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
          style={{
            background: isTech ? "#e0f2fe" : "#dbeafe",
            color:      isTech ? TEAL       : NAVY,
          }}>
      {isTech ? "Technical" : "Super Manager"}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {active ? "Active" : "Deactivated"}
    </span>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-lg" />
      ))}
    </div>
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function ConfirmModal({
  title, message, confirmLabel, danger,
  onConfirm, onCancel, loading,
}: {
  title: string; message: string; confirmLabel: string;
  danger?: boolean; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold" style={{ color: NAVY }}>{title}</h3>
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            style={{ background: danger ? "#dc2626" : NAVY, color: "white" }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Add user modal ────────────────────────────────────────────────────────────
function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [role,     setRole]     = useState<"technical" | "super_manager">("technical");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [tempPw,   setTempPw]   = useState<string | null>(null);
  const [copied,   setCopied]   = useState(false);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !email.trim()) { setError("Name and email are required"); return; }
    setSaving(true);
    try {
      const data = await apiFetch("/api/admin/platform-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      setTempPw(data.tempPassword as string);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  function copyPassword() {
    if (!tempPw) return;
    navigator.clipboard.writeText(tempPw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Success state — show temp password
  if (tempPw) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          <div className="px-6 py-5" style={{ background: NAVY }}>
            <h2 className="text-lg font-bold text-white">Account Created</h2>
            <p className="text-sm mt-0.5" style={{ color: "#a8c4e0" }}>Share this password securely</p>
          </div>
          <div className="px-6 py-6 space-y-4">
            <div className="rounded-xl p-4 border-2" style={{ borderColor: TEAL, background: "#f0f9ff" }}>
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: TEAL }}>
                Temporary password
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono break-all" style={{ color: NAVY }}>
                  {tempPw}
                </code>
                <button
                  onClick={copyPassword}
                  className="flex-shrink-0 p-2 rounded-lg hover:bg-blue-100 transition-colors"
                  title="Copy password">
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" style={{ color: TEAL }} />}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Share this securely — it will not be shown again.</span>
            </div>
            <Button className="w-full" onClick={onClose} style={{ background: NAVY, color: "white" }}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5" style={{ background: NAVY }}>
          <h2 className="text-lg font-bold text-white">Add Support User</h2>
          <p className="text-sm mt-0.5" style={{ color: "#a8c4e0" }}>
            Creates a platform-level account with no company affiliation
          </p>
        </div>
        <div className="px-6 py-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="su-name">Full name</Label>
            <Input id="su-name" value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. Ali Husnain" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="su-email">Email</Label>
            <Input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="e.g. ali@brightbridgeassist.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="su-role">Role</Label>
            <div className="relative">
              <select
                id="su-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "technical" | "super_manager")}
                className="w-full appearance-none border rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: "#e2e8f0" }}>
                <option value="technical">Technical</option>
                <option value="super_manager">Super Manager</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleCreate}
              disabled={saving || !name.trim() || !email.trim()}
              style={{ background: NAVY, color: "white" }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Account
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reset-password modal ───────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [tempPw,  setTempPw]  = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  async function handleReset() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/api/admin/platform-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPassword: true }),
      });
      setTempPw(data.tempPassword as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  function copyPassword() {
    if (!tempPw) return;
    navigator.clipboard.writeText(tempPw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (tempPw) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: NAVY }}>Password Reset</h3>
          <div className="rounded-xl p-3 border-2" style={{ borderColor: TEAL, background: "#f0f9ff" }}>
            <p className="text-xs font-semibold mb-1" style={{ color: TEAL }}>New temporary password</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono break-all" style={{ color: NAVY }}>{tempPw}</code>
              <button onClick={copyPassword} className="p-1.5 rounded hover:bg-blue-100" title="Copy">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" style={{ color: TEAL }} />}
              </button>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Share this securely — it will not be shown again.</span>
          </div>
          <Button className="w-full" onClick={onClose} style={{ background: NAVY, color: "white" }}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <ConfirmModal
      title={`Reset password for ${user.name}?`}
      message="A new temporary password will be generated. The current password will stop working immediately."
      confirmLabel="Reset Password"
      onConfirm={handleReset}
      onCancel={onClose}
      loading={loading}
    />
  );
}

// ── Row actions menu ──────────────────────────────────────────────────────────
function RowActions({
  user,
  onRefresh,
}: {
  user: PlatformUser;
  onRefresh: () => void;
}) {
  const [open,          setOpen]          = useState(false);
  const [confirm,       setConfirm]       = useState<"deactivate" | "reactivate" | "role" | null>(null);
  const [showResetPw,   setShowResetPw]   = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const newRole = user.role === "technical" ? "super_manager" : "technical";

  async function patchUser(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/platform-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
      setConfirm(null);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      {error && <p className="text-xs text-red-600 mb-1">{error}</p>}
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 transition-colors flex items-center gap-1"
        style={{ borderColor: "#e2e8f0", color: NAVY }}>
        Actions <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border z-20 py-1"
             style={{ borderColor: "#e2e8f0" }}>
          <button
            onClick={() => { setOpen(false); setShowResetPw(true); }}
            className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-gray-400" />
            Reset password
          </button>
          <button
            onClick={() => { setOpen(false); setConfirm("role"); }}
            className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-400" />
            Switch to {newRole === "technical" ? "Technical" : "Super Manager"}
          </button>
          <hr className="my-1" style={{ borderColor: "#e2e8f0" }} />
          <button
            onClick={() => { setOpen(false); setConfirm(user.isActive ? "deactivate" : "reactivate"); }}
            className={`w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2 ${
              user.isActive ? "text-red-600" : "text-green-700"
            }`}>
            <Power className="w-4 h-4" />
            {user.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      )}

      {/* Click-away */}
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}

      {showResetPw && (
        <ResetPasswordModal user={user} onClose={() => { setShowResetPw(false); onRefresh(); }} />
      )}

      {confirm === "deactivate" && (
        <ConfirmModal
          title={`Deactivate ${user.name}?`}
          message="They will be blocked from logging in immediately. You can reactivate at any time."
          confirmLabel="Deactivate"
          danger
          loading={loading}
          onConfirm={() => patchUser({ isActive: false })}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "reactivate" && (
        <ConfirmModal
          title={`Reactivate ${user.name}?`}
          message="They will be able to log in again immediately."
          confirmLabel="Reactivate"
          loading={loading}
          onConfirm={() => patchUser({ isActive: true })}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "role" && (
        <ConfirmModal
          title="Change role?"
          message={`Switch ${user.name} from ${user.role === "technical" ? "Technical" : "Super Manager"} to ${newRole === "technical" ? "Technical" : "Super Manager"}?`}
          confirmLabel="Change Role"
          loading={loading}
          onConfirm={() => patchUser({ role: newRole })}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SupportRolesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ users: PlatformUser[] }>({
    queryKey: ["platform-users"],
    queryFn: () => apiFetch("/api/admin/platform-users") as Promise<{ users: PlatformUser[] }>,
    staleTime: 30_000,
  });

  const users = data?.users ?? [];

  function handleCreated() {
    qc.invalidateQueries({ queryKey: ["platform-users"] });
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
               style={{ background: NAVY }}>
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: NAVY }}>Support Roles</h1>
            <p className="text-sm text-gray-500">Platform-level support accounts</p>
          </div>
        </div>
        <Button
          onClick={() => setShowAdd(true)}
          style={{ background: NAVY, color: "white" }}
          className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Support User
        </Button>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl shadow-sm border" style={{ borderColor: "#e2e8f0" }}>
        {isLoading ? (
          <div className="p-6"><TableSkeleton /></div>
        ) : isError ? (
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-gray-600 font-medium">Failed to load accounts</p>
            <Button variant="outline" onClick={() => refetch()} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Retry
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <ShieldCheck className="w-10 h-10 text-gray-300" />
            <div>
              <p className="font-medium text-gray-700">No support accounts yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Create a Technical or Super Manager account to get started.
              </p>
            </div>
            <Button
              onClick={() => setShowAdd(true)}
              style={{ background: NAVY, color: "white" }}
              className="mt-2 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Support User
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "#f1f5f9" }}>
                  {["Name", "Email", "Role", "Status", "Created", ""].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id}
                      className={`border-b transition-colors hover:bg-gray-50/50 ${
                        i === users.length - 1 ? "border-transparent" : ""
                      }`}
                      style={{ borderColor: "#f1f5f9" }}>
                    <td className="px-5 py-3.5">
                      <span className="font-medium" style={{ color: NAVY }}>{u.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{u.email}</td>
                    <td className="px-5 py-3.5"><RoleBadge role={u.role} /></td>
                    <td className="px-5 py-3.5"><StatusBadge active={u.isActive} /></td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <RowActions user={u} onRefresh={() => qc.invalidateQueries({ queryKey: ["platform-users"] })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
