/**
 * Account Settings — personal account preferences for the logged-in user.
 * Available to ALL roles (employees, managers, owners, super_admin).
 *
 * Sections:
 *   1. Profile Photo      — upload, preview, remove (reuses employee photo infra under the hood)
 *   2. Display Name       — updates user_accounts.name ONLY, never touches employees table
 *   3. Change Password    — requires current password; hashes new with bcrypt
 *   4. Notifications      — "Soon" placeholder
 */
import React, { useRef, useState } from "react";
import {
  UserCog, Camera, Trash2, Check, X, AlertTriangle,
  Lock, Bell, User, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

// ── helpers ───────────────────────────────────────────────────

async function apiFetch(path: string, init: RequestInit = {}) {
  const r = await fetch(path, { credentials: "include", ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data;
}

// ── Profile Photo ─────────────────────────────────────────────

function ProfilePhotoSection({
  photoUrl,
  name,
  onPhotoChanged,
}: {
  photoUrl: string | null | undefined;
  name: string;
  onPhotoChanged: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // local preview URL (blob) while uploading
  const [preview, setPreview] = useState<string | null>(null);

  const initials = name
    .split(" ")
    .map(w => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const data = await fetch("/api/account/photo", {
        method: "POST",
        credentials: "include",
        body: fd,
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d as { error?: string }).error ?? "Upload failed");
        return d as { photoUrl: string };
      });
      onPhotoChanged(data.photoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPreview(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    setError(null);
    setRemoving(true);
    try {
      await apiFetch("/api/account/photo", { method: "DELETE" });
      setPreview(null);
      onPhotoChanged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  const displayUrl = preview ?? (photoUrl ? `/api/account/photo` : null);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
          <User className="h-4 w-4 text-[#1B3A6B]" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">Profile Photo</h3>
      </div>

      <div className="flex items-center gap-5">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={name}
              className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-[#1B3A6B] flex items-center justify-center text-white text-xl font-bold">
              {initials}
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || removing}
          >
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            {displayUrl ? "Change photo" : "Upload photo"}
          </Button>
          {displayUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 block"
              onClick={handleRemove}
              disabled={uploading || removing}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {removing ? "Removing…" : "Remove photo"}
            </Button>
          )}
          <p className="text-xs text-gray-400">JPG, PNG or WebP · max 5 MB</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Display Name ──────────────────────────────────────────────

function DisplayNameSection({
  currentName,
  onNameChanged,
}: {
  currentName: string;
  onNameChanged: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (!name.trim()) { setError("Name cannot be empty"); return; }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiFetch("/api/account/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      setSuccess(true);
      setEditing(false);
      onNameChanged(name.trim());
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setName(currentName);
    setError(null);
    setEditing(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
          <UserCog className="h-4 w-4 text-[#1B3A6B]" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">Display Name</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4 ml-9">
        This is your name as it appears in the app. It does not affect your employee record or payroll.
      </p>

      {editing ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="display-name" className="text-xs text-gray-600 mb-1 block">Full name</Label>
            <Input
              id="display-name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#1B3A6B]/90 text-white h-8"
              onClick={handleSave} disabled={saving}>
              <Check className="h-3.5 w-3.5 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleCancel} disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">{currentName}</p>
            {success && (
              <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                <Check className="h-3 w-3" /> Name updated
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-[#0EA5C9] h-7 px-2"
            onClick={() => { setName(currentName); setEditing(true); }}>
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Change Password ───────────────────────────────────────────

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const tooShort  = next.length > 0 && next.length < 8;

  async function handleSave() {
    setError(null);
    if (!current || !next || !confirm) { setError("All fields are required"); return; }
    if (next !== confirm) { setError("New passwords do not match"); return; }
    if (next.length < 8)  { setError("New password must be at least 8 characters"); return; }
    setSaving(true);
    try {
      await apiFetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
      });
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
          <KeyRound className="h-4 w-4 text-[#1B3A6B]" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">Change Password</h3>
      </div>

      {success ? (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
          <Check className="h-4 w-4" />
          Password updated successfully. Use your new password next time you sign in.
        </div>
      ) : (
        <div className="space-y-4 max-w-sm">
          <div>
            <Label htmlFor="cur-pw" className="text-xs text-gray-600 mb-1 block">Current password</Label>
            <Input id="cur-pw" type="password" value={current} onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password" />
          </div>
          <div>
            <Label htmlFor="new-pw" className="text-xs text-gray-600 mb-1 block">New password</Label>
            <Input id="new-pw" type="password" value={next} onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              className={tooShort ? "border-amber-400" : ""} />
            {tooShort && <p className="text-xs text-amber-600 mt-1">Must be at least 8 characters</p>}
          </div>
          <div>
            <Label htmlFor="conf-pw" className="text-xs text-gray-600 mb-1 block">Confirm new password</Label>
            <Input id="conf-pw" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={mismatch ? "border-red-400" : ""} />
            {mismatch && <p className="text-xs text-red-600 mt-1">Passwords do not match</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#1B3A6B]/90 text-white h-8"
            onClick={handleSave} disabled={saving || mismatch || tooShort}>
            <Lock className="h-3.5 w-3.5 mr-1" />
            {saving ? "Updating…" : "Update password"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Notifications placeholder ─────────────────────────────────

function NotificationsSection() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
          <Bell className="h-4 w-4 text-[#1B3A6B]" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">Notification Preferences</h3>
      </div>
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-gray-400">Configure which events generate notifications for your account.</p>
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-400 uppercase tracking-widest">
          Coming Soon
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function AccountSettingsPage() {
  const { user, refresh } = useAuth();
  const [localName, setLocalName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null | undefined>(undefined);

  // photoUrl comes from /auth/me (we piggy-back on the auth refresh)
  // It's on the user object as an optional field injected by the backend
  const userWithPhoto = user as (typeof user & { photoUrl?: string | null }) | null;
  const effectivePhoto = photoUrl !== undefined ? photoUrl : (userWithPhoto?.photoUrl ?? null);
  const displayName = localName ?? user?.name ?? "";

  if (!user) return null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your personal profile, security settings, and preferences.
        </p>
      </div>

      <div className="space-y-4">
        <ProfilePhotoSection
          photoUrl={effectivePhoto}
          name={displayName}
          onPhotoChanged={(url) => {
            setPhotoUrl(url);
            void refresh();
          }}
        />

        <DisplayNameSection
          currentName={displayName}
          onNameChanged={(name) => {
            setLocalName(name);
            void refresh();
          }}
        />

        <ChangePasswordSection />

        <NotificationsSection />
      </div>
    </div>
  );
}
