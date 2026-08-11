/**
 * Users & Access — manage employee login accounts and roles.
 * Accessible to: super_admin, owner
 */
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, KeyRound, CheckCircle2, XCircle, Search,
  Lock, Eye, EyeOff, ShieldCheck, RefreshCw, UserPlus, MapPin, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const NAVY = "#1B3A6B";

interface UserRow {
  employeeId:       string;
  firstName:        string;
  lastName:         string;
  email:            string;
  position:         string;
  companyId:        string;
  locationId?:      string | null;
  status:           string;
  hasAccount:       boolean;
  accountId:        string | null;
  role:             string | null;
  accountLocationId?: string | null;
}

interface LocationRow { id: string; code: string; name: string; isActive: boolean; }

async function apiFetch(path: string, init: RequestInit = {}) {
  const r = await fetch(path, { credentials: "include", ...init });
  const data = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error((data.error as string | undefined) ?? `Request failed (${r.status})`);
  return data;
}

// ── Manage Access Modal (create OR change role) ───────────────────────────────
function ManageAccessModal({
  employee,
  mode,          // "grant" = no account yet | "change" = update existing role
  onClose,
  onSuccess,
  callerRole,
}: {
  employee:   UserRow;
  mode:       "grant" | "change";
  onClose:    () => void;
  onSuccess:  () => void;
  callerRole: string;
}) {
  const initialRole = mode === "change" && employee.role ? employee.role : "employee";
  const [role, setRole]        = useState(initialRole);
  const [locationId, setLocId] = useState(
    mode === "change" && employee.role === "manager" ? (employee.accountLocationId ?? "") : ""
  );
  const [saving, setSaving]    = useState(false);
  const [error, setError]      = useState<string | null>(null);
  const [done, setDone]        = useState(false);

  const { data: locData } = useQuery<{ locations: LocationRow[] }>({
    queryKey: ["manage-access-locs", employee.companyId],
    queryFn: () =>
      fetch(`/api/locations?companyId=${employee.companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<{ locations: LocationRow[] }>),
    staleTime: 60_000,
  });
  const activeLocations = (locData?.locations ?? []).filter(l => l.isActive);

  async function handleSubmit() {
    setError(null);
    if (role === "manager" && !locationId) {
      setError("Select a location for this manager."); return;
    }
    setSaving(true);
    try {
      if (mode === "grant") {
        await apiFetch(`/api/admin/users/${employee.employeeId}/grant-access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, locationId: role === "manager" ? locationId : undefined }),
        });
      } else {
        await apiFetch(`/api/admin/users/${employee.employeeId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, locationId: role === "manager" ? locationId : undefined }),
        });
      }
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const isGrant = mode === "grant";
  const title   = isGrant ? "Grant Access" : "Change Role";
  const btnLabel = isGrant
    ? (saving ? "Creating…" : "Grant Access")
    : (saving ? "Saving…"   : "Save Changes");

  // owners cannot assign owner role
  const roleOptions = callerRole === "owner"
    ? [{ value: "employee", label: "Employee" }, { value: "manager", label: "Manager" }]
    : [{ value: "employee", label: "Employee" }, { value: "manager", label: "Manager" }, { value: "owner", label: "Owner" }];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${NAVY}15` }}>
            {isGrant
              ? <UserPlus className="h-4 w-4" style={{ color: NAVY }} />
              : <Shield   className="h-4 w-4" style={{ color: NAVY }} />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{employee.firstName} {employee.lastName}</p>
          </div>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium text-gray-700 text-center">
              {isGrant
                ? <>Account created! Temporary password: <code className="bg-gray-100 px-1 rounded">Staff123!</code></>
                : "Role updated successfully."}
            </p>
          </div>
        ) : (
          <>
            {/* Current role indicator for change mode */}
            {!isGrant && employee.role && (
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <span>Current role:</span>
                <RoleBadge role={employee.role} />
                {employee.role === "manager" && employee.accountLocationId && (
                  <span className="text-gray-400 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />{employee.accountLocationId}
                  </span>
                )}
              </div>
            )}

            {/* Role picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-700">Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {roleOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setRole(opt.value); if (opt.value !== "manager") setLocId(""); }}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors text-left ${
                      role === opt.value
                        ? "border-[#1B3A6B] bg-[#1B3A6B]/5 text-[#1B3A6B]"
                        : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Location picker — required for manager */}
            {role === "manager" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                  Location <span className="text-red-500">*</span>
                </Label>
                {activeLocations.length === 0 ? (
                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                    No active locations found. Add a location in Company Settings first.
                  </p>
                ) : (
                  <select
                    value={locationId}
                    onChange={e => setLocId(e.target.value)}
                    className="w-full h-9 text-sm border border-gray-200 rounded-md px-2.5 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/30 bg-white"
                  >
                    <option value="">Select location…</option>
                    {activeLocations.map(l => (
                      <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-gray-400">Managers can only view employees in their assigned location.</p>
              </div>
            )}

            {/* Grant-mode notice */}
            {isGrant && (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                A temporary password <code className="bg-white border border-gray-200 px-1 rounded">Staff123!</code> will be set. Ask the employee to change it after their first login.
              </p>
            )}

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}
          </>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {!done && (
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void handleSubmit()}
              className="text-white text-xs gap-1.5"
              style={{ background: NAVY }}
            >
              {saving
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : isGrant ? <UserPlus className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
              {btnLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({
  employee,
  onClose,
  onSuccess,
}: {
  employee: UserRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [done,     setDone]     = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSave  = password.length >= 8 && password === confirm && !saving;

  async function handleSave() {
    setError(null);
    if (!password || !confirm) { setError("Both fields are required"); return; }
    if (password !== confirm)  { setError("Passwords do not match");   return; }
    if (password.length < 8)   { setError("Minimum 8 characters");     return; }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/users/${employee.employeeId}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${NAVY}15` }}>
            <KeyRound className="h-5 w-5" style={{ color: NAVY }} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Reset Password</h2>
            <p className="text-xs text-gray-500">{employee.firstName} {employee.lastName} · {employee.email}</p>
          </div>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium text-gray-800">Password updated successfully</p>
            <p className="text-xs text-gray-500">The employee can now log in with their new password.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">New password</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className={tooShort ? "border-amber-400 pr-10" : "pr-10"}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(v => !v)}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {tooShort && <p className="text-xs text-amber-600 mt-1">Must be at least 8 characters</p>}
            </div>

            <div>
              <Label className="text-xs text-gray-600 mb-1 block">Confirm new password</Label>
              <Input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                className={mismatch ? "border-red-400" : ""}
              />
              {mismatch && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button
                className="flex-1 text-white"
                style={{ background: NAVY }}
                onClick={handleSave}
                disabled={!canSave}
              >
                {saving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Set Password"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Role Badge ────────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: "bg-red-100",    text: "text-red-700"    },
  owner:       { bg: "bg-purple-100", text: "text-purple-700" },
  manager:     { bg: "bg-amber-100",  text: "text-amber-700"  },
  employee:    { bg: "bg-green-100",  text: "text-green-700"  },
};
function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  const c = ROLE_COLORS[role] ?? { bg: "bg-gray-100", text: "text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {role.replace("_", " ")}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UsersAccessPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search,   setSearch]  = useState("");
  const [resetting, setResetting]   = useState<UserRow | null>(null);
  const [managing,  setManaging]    = useState<{ employee: UserRow; mode: "grant" | "change" } | null>(null);

  const { data, isLoading } = useQuery<{ users: UserRow[] }>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/api/admin/users", { credentials: "include" })
      .then(r => r.json() as Promise<{ users: UserRow[] }>),
  });

  const rows = (data?.users ?? []).filter(u => {
    const q = search.toLowerCase();
    return !q
      || u.firstName.toLowerCase().includes(q)
      || u.lastName.toLowerCase().includes(q)
      || u.email.toLowerCase().includes(q)
      || (u.position ?? "").toLowerCase().includes(q);
  });

  const withAccount    = rows.filter(u => u.hasAccount).length;
  const withoutAccount = rows.filter(u => !u.hasAccount).length;
  const callerRole     = user?.role ?? "owner";

  function invalidate() { void qc.invalidateQueries({ queryKey: ["admin-users"] }); }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${NAVY}15` }}>
          <ShieldCheck className="h-5 w-5" style={{ color: NAVY }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Users & Access</h1>
          <p className="text-sm text-gray-500">Manage employee login accounts and roles</p>
        </div>
      </div>

      {/* Stats */}
      {!isLoading && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total employees", value: rows.length,       icon: Users,        color: NAVY       },
            { label: "Have accounts",   value: withAccount,       icon: CheckCircle2, color: "#16a34a"  },
            { label: "No account yet",  value: withoutAccount,    icon: XCircle,      color: "#9ca3af"  },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">No employees found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Employee</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Account</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(u => (
                <tr key={u.employeeId} className="hover:bg-gray-50/50 transition-colors">

                  {/* Name + position */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ background: NAVY }}
                      >
                        {u.firstName[0]}{u.lastName[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-500">{u.position ?? "—"}</p>
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{u.email}</td>

                  {/* Role */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <RoleBadge role={u.role} />
                  </td>

                  {/* Account status */}
                  <td className="px-4 py-3">
                    {u.hasAccount ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
                        <XCircle className="h-3.5 w-3.5" /> No account
                      </span>
                    )}
                  </td>

                  {/* Actions — always visible */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end flex-wrap">
                      {u.hasAccount ? (
                        <>
                          {/* Change role — only for non-owner callers changing non-protected accounts */}
                          {!(callerRole === "owner" && u.role && ["super_admin", "owner"].includes(u.role)) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs gap-1.5 border-[#1B3A6B]/20 text-[#1B3A6B] hover:bg-[#1B3A6B]/5"
                              onClick={() => setManaging({ employee: u, mode: "change" })}
                            >
                              <Shield className="h-3.5 w-3.5" />
                              Change Role
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1.5"
                            onClick={() => setResetting(u)}
                          >
                            <Lock className="h-3.5 w-3.5" />
                            Reset Password
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs gap-1.5 border-[#1B3A6B]/20 text-[#1B3A6B] hover:bg-[#1B3A6B]/5"
                          onClick={() => setManaging({ employee: u, mode: "grant" })}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Grant Access
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset Password modal */}
      {resetting && (
        <ResetPasswordModal
          employee={resetting}
          onClose={() => setResetting(null)}
          onSuccess={invalidate}
        />
      )}

      {/* Manage Access modal (grant or change role) */}
      {managing && (
        <ManageAccessModal
          employee={managing.employee}
          mode={managing.mode}
          onClose={() => setManaging(null)}
          onSuccess={invalidate}
          callerRole={callerRole}
        />
      )}
    </div>
  );
}
