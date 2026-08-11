import React, { useState, useRef, useEffect } from "react";
import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Pencil, MoreVertical, Pause, Ban, RotateCcw, AlertCircle,
  Mail, Phone, MapPin, Calendar, Briefcase, User, DollarSign, Building2,
  ClipboardList, ShieldCheck, FolderOpen, PhoneCall, CreditCard, Activity,
  Camera, X, Loader2, CheckCircle2, Clock, RefreshCw,
  AlertTriangle, XCircle, Wrench, KeyRound, Eye, EyeOff, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import Avatar from "@/components/Avatar";
import EmployeeTasksPanel from "@/components/panels/EmployeeTasksPanel";
import EmployeeCompliancePanel from "@/components/panels/EmployeeCompliancePanel";
import EmployeeDocuments from "@/components/EmployeeDocuments";
import EmergencyContactForm from "@/components/EmergencyContactForm";
import { OnLeaveModal, TerminateModal, ReactivateModal } from "@/components/EmployeeStatusModals";

const NAVY  = "#2C4562";
const ACCENT = "#0EA5C9";

// ── Types ──────────────────────────────────────────────────────
interface EmployeeDetail {
  id: string; companyId: string;
  firstName: string; lastName: string; email: string; phone: string;
  position: string; jobTitle?: string|null; employmentType: string; workerType: string;
  startDate?: string|null; status: string; employeeDisplayId?: string|null;
  department?: string|null; locationId?: string|null; managerId?: string|null; managerName?: string|null;
  payType?: string|null; hourlyWage?: number|null; annualSalary?: number|null; overtimeEligible?: boolean|null; paymentMethod?: string|null;
  homeAddress?: string|null; homeCity?: string|null; homeState?: string|null; homeZip?: string|null;
  complianceScore?: number|null; onboardingProgress?: number|null;
  rollfiUserId?: string|null; easyteamId?: string|null; kycStatus?: string|null;
  rollfiAccountStatus?: string|null;
  bankAccountAdded?: boolean|null; w4Submitted?: boolean|null; payrollReady?: boolean|null;
  photoUrl?: string|null; notes?: string|null; createdAt: string; updatedAt?: string|null;
}
interface ActivityEntry {
  id: string; action: string; description: string; category: string;
  createdAt: string; performedByName?: string|null;
}
interface TaxRow { taxName: string; taxAmount: number; taxAmountYtd: number; isEmployerTax: boolean }
interface PayStub {
  employeeId?: string | null; rollfiUserId?: string | null;
  name: string; position: string; hourlyRate: number; hoursWorked: number;
  grossPay: number; baseTotal: number | null; netPay: number;
  federalTax: number; stateTax: number; fica: number; deductions: number; ytdGross: number;
  fromRollfi: boolean; isProcessed: boolean;
  employeeTaxDetails: TaxRow[] | null;
  employerTaxDetails: TaxRow[] | null;
  additionalCompensations: { payrollLineItemAdditionalCompensationVertexCompensationIdentifier: { compensationDescription: string }; amount: number }[] | null;
  overTimes: { type: string; amount: number; numberOfHours: number }[] | null;
  period?: string;
}
interface PayStubsData { payPeriodId: string | null; stubs: PayStub[]; periodTotal: number | null; employeeTaxSum: number | null; employerTaxSum: number | null; isProcessed: boolean; }
interface PayPeriod { payPeriodId?: string; payBeginDate?: string; payEndDate?: string; payDate?: string; payPeriodStatus?: string; label?: string; }

// ── Helpers ────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  active:     { label: "Active",      dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700" },
  on_leave:   { label: "On Leave",    dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700"   },
  onboarding: { label: "Onboarding",  dot: "bg-blue-500",    bg: "bg-blue-50",     text: "text-blue-700"    },
  pending:    { label: "Pending",     dot: "bg-gray-400",    bg: "bg-gray-100",    text: "text-gray-500"    },
  terminated: { label: "Terminated",  dot: "bg-red-400",     bg: "bg-red-50",      text: "text-red-600"     },
};

function fmtDate(iso?: string|null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function tenure(iso?: string|null) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "Today"; if (d < 30) return `${d}d`;
  const m = Math.floor(d/30); if (m < 12) return `${m}mo`;
  const y = Math.floor(m/12); const r = m % 12;
  return r ? `${y}y ${r}mo` : `${y}y`;
}
function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      {icon && <span className="mt-0.5 text-gray-400 shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
        <div className="text-sm text-gray-800 font-medium">
          {value || <span className="text-gray-300 font-normal">—</span>}
        </div>
      </div>
    </div>
  );
}
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function MiniRing({ score }: { score: number }) {
  const r = 16; const circ = 2 * Math.PI * r; const dash = (score / 100) * circ;
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-10 h-10 shrink-0">
      <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#f3f4f6" strokeWidth="5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold text-gray-800">{score}%</span>
      </div>
    </div>
  );
}

// ── Photo Change Modal ─────────────────────────────────────────
function PhotoModal({ emp, onClose, onSuccess }: {
  emp: EmployeeDetail; onClose: () => void; onSuccess: (url: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const pickFile = (f: File) => {
    if (!["image/jpeg","image/jpg","image/png","image/webp"].includes(f.type)) {
      setError("Please choose JPG, PNG, or WebP"); return;
    }
    if (f.size > 5 * 1024 * 1024) { setError("File must be under 5MB"); return; }
    setError("");
    // Canvas crop to 512×512
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2; const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
      canvas.toBlob(blob => {
        if (blob) {
          const croppedFile = new File([blob], f.name, { type: f.type });
          setFile(croppedFile);
          setPreview(canvas.toDataURL(f.type));
        }
      }, f.type, 0.9);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true); setError("");
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const r = await fetch(`/api/employees/${emp.id}/photo`, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Upload failed"); }
      const d = await r.json() as { photoUrl: string };
      void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] });
      onSuccess(d.photoUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const remove = async () => {
    setUploading(true); setError("");
    try {
      await fetch(`/api/employees/${emp.id}/photo`, { method: "DELETE", credentials: "include" });
      void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] });
      onSuccess("");
    } catch { setError("Failed to remove"); }
    finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Profile Photo</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-gray-400" /></button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          {/* Preview */}
          <div className="relative w-24 h-24 cursor-pointer group" onClick={() => fileRef.current?.click()}>
            {preview ? (
              <img src={preview} className="w-24 h-24 rounded-full object-cover" alt="preview" />
            ) : (
              <Avatar firstName={emp.firstName} lastName={emp.lastName} photoUrl={emp.photoUrl} size="lg" />
            )}
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="h-6 w-6 text-white" />
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
          <div className="flex gap-2 w-full">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
              Choose Photo
            </Button>
            {emp.photoUrl && !file && (
              <Button variant="outline" size="sm" onClick={() => void remove()} disabled={uploading}
                className="text-red-500 hover:text-red-600 border-red-200">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remove"}
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 w-full">{error}</p>}
          <p className="text-[11px] text-gray-400 text-center">JPG, PNG, or WebP · Max 5 MB · Auto-cropped to square</p>
        </div>
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!file || uploading} onClick={() => void upload()}
            className="text-white" style={{ background: NAVY }}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Save Photo
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── TABS ───────────────────────────────────────────────────────
const TABS = [
  { id: "overview",    label: "Overview",    icon: User },
  { id: "job",         label: "Job & Pay",   icon: Briefcase },
  { id: "onboarding",  label: "Onboarding",  icon: ClipboardList },
  { id: "compliance",  label: "Compliance",  icon: ShieldCheck },
  { id: "documents",   label: "Documents",   icon: FolderOpen },
  { id: "contacts",    label: "Contacts",    icon: PhoneCall },
  { id: "payroll",     label: "Payroll",     icon: CreditCard },
  { id: "activity",    label: "Activity",    icon: Activity },
  { id: "account",     label: "Account",     icon: KeyRound },
];

// ── Account Tab ───────────────────────────────────────────────
function AccountTab({ emp }: { emp: EmployeeDetail }) {
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [success,   setSuccess]   = useState(false);
  const [acctInfo,  setAcctInfo]  = useState<{ hasAccount: boolean; role: string | null } | null>(null);
  const [loading,   setLoading]   = useState(true);

  React.useEffect(() => {
    fetch("/api/admin/users", { credentials: "include" })
      .then(r => r.json() as Promise<{ users: Array<{ employeeId: string; hasAccount: boolean; role: string | null }> }>)
      .then(d => {
        const row = d.users?.find(u => u.employeeId === emp.id);
        setAcctInfo(row ? { hasAccount: row.hasAccount, role: row.role } : { hasAccount: false, role: null });
      })
      .catch(() => setAcctInfo({ hasAccount: false, role: null }))
      .finally(() => setLoading(false));
  }, [emp.id]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSave  = password.length >= 8 && password === confirm && !saving;

  async function handleReset() {
    setError(null);
    if (!password || !confirm) { setError("Both fields are required"); return; }
    if (password !== confirm)  { setError("Passwords do not match");    return; }
    if (password.length < 8)   { setError("Minimum 8 characters");       return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/users/${emp.id}/set-password`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed");
      setSuccess(true); setPassword(""); setConfirm("");
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 max-w-lg">
      {/* Login info card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${NAVY}15` }}>
            <User className="h-4 w-4" style={{ color: NAVY }} />
          </div>
          <h3 className="text-sm font-semibold text-gray-800">Login Account</h3>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Checking account status…</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">Email</span>
              <span className="text-gray-900 font-medium">{emp.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-24">Status</span>
              {acctInfo?.hasAccount ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Has account
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  <XCircle className="h-3.5 w-3.5" /> No account yet
                </span>
              )}
            </div>
            {acctInfo?.role && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Role</span>
                <span className="text-gray-800 capitalize">{acctInfo.role.replace("_", " ")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin reset password card */}
      {acctInfo?.hasAccount && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${NAVY}15` }}>
              <KeyRound className="h-4 w-4" style={{ color: NAVY }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Reset Password</h3>
              <p className="text-xs text-gray-500">Set a new password on behalf of this employee. No current password required.</p>
            </div>
          </div>

          {success ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Password updated. The employee can now sign in with the new password.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">New password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    className={`w-full rounded-md border px-3 py-2 text-sm pr-10 outline-none focus:ring-2 focus:ring-[#0EA5C9]/30 ${tooShort ? "border-amber-400" : "border-gray-200"}`}
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {tooShort && <p className="text-xs text-amber-600 mt-1">Must be at least 8 characters</p>}
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Confirm new password</label>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5C9]/30 ${mismatch ? "border-red-400" : "border-gray-200"}`}
                />
                {mismatch && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
              )}
              <button
                onClick={handleReset}
                disabled={!canSave}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40"
                style={{ background: NAVY }}
              >
                {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</> : <><Lock className="h-4 w-4" /> Set New Password</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────
function OverviewTab({ emp, onTabChange }: { emp: EmployeeDetail; onTabChange: (t: string) => void }) {
  const { data: locData } = useQuery<{ locations: Array<{ id: string; code: string; name: string }> }>({
    queryKey: ["loc-overview", emp.companyId],
    queryFn: () => fetch(`/api/locations?companyId=${emp.companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ locations: Array<{ id: string; code: string; name: string }> }>),
    enabled: !!emp.companyId && !!emp.locationId,
    staleTime: 5 * 60_000,
  });
  const locationLabel = emp.locationId
    ? (() => { const l = (locData?.locations ?? []).find(x => x.id === emp.locationId); return l ? `${l.code} — ${l.name}` : null; })()
    : null;

  const { data: compData } = useQuery<{ items: Array<{ name: string; status: string; isRequired: boolean }>; score: number }>({
    queryKey: ["compliance", emp.id],
    queryFn: () => fetch(`/api/compliance?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ items: Array<{ name: string; status: string; isRequired: boolean }>; score: number }>),
    staleTime: 30_000,
  });
  const { data: tasksData } = useQuery<{ tasks: Array<{ id: string; taskName: string; status: string; isRequired: boolean; dueDate?: string|null; stage: string }>; completionPercentage: number }>({
    queryKey: ["onboarding-tasks", emp.id],
    queryFn: () => fetch(`/api/onboarding-tasks?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ tasks: Array<{ id: string; taskName: string; status: string; isRequired: boolean; dueDate?: string|null; stage: string }>; completionPercentage: number }>),
    staleTime: 30_000,
  });
  const { data: actData } = useQuery<{ entries: ActivityEntry[] }>({
    queryKey: ["activity", emp.id, "recent"],
    queryFn: () => fetch(`/api/activity-log?companyId=${emp.companyId}&employeeId=${emp.id}&limit=5`, { credentials: "include" })
      .then(r => r.json() as Promise<{ entries: ActivityEntry[] }>),
    staleTime: 30_000,
  });

  const compItems = compData?.items ?? [];
  const compScore = compData?.score ?? emp.complianceScore ?? 0;
  const outstanding = compItems.filter(i => i.isRequired && i.status !== "completed").slice(0, 3);
  const tasks = tasksData?.tasks ?? [];
  const taskPct = tasksData?.completionPercentage ?? emp.onboardingProgress ?? 0;
  const pendingTasks = tasks.filter(t => t.status !== "completed" && t.status !== "skipped" && t.isRequired).slice(0, 3);
  const activity = actData?.entries ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Key Info */}
      <Card title="Key Information">
        <InfoRow label="Email" value={emp.email} icon={<Mail className="h-3.5 w-3.5" />} />
        <InfoRow label="Phone" value={emp.phone} icon={<Phone className="h-3.5 w-3.5" />} />
        <InfoRow label="Start Date" value={emp.startDate ? `${fmtDate(emp.startDate)} · ${tenure(emp.startDate)}` : "—"} icon={<Calendar className="h-3.5 w-3.5" />} />
        <InfoRow label="Employment Type" value={emp.employmentType} icon={<Briefcase className="h-3.5 w-3.5" />} />
        <InfoRow label="Worker Type" value={emp.workerType} />
        <InfoRow label="Department" value={emp.department} icon={<Building2 className="h-3.5 w-3.5" />} />
        {locationLabel && <InfoRow label="Location" value={locationLabel} icon={<MapPin className="h-3.5 w-3.5" />} />}
        {emp.managerName && <InfoRow label="Reports To" value={emp.managerName} icon={<User className="h-3.5 w-3.5" />} />}
      </Card>

      {/* Compliance Summary */}
      <Card title="Compliance" action={
        <button onClick={() => onTabChange("compliance")} className="text-xs text-[#0EA5C9] hover:underline">View all →</button>
      }>
        <div className="flex items-center gap-3 mb-3">
          <MiniRing score={compScore} />
          <div>
            <p className="text-sm font-semibold text-gray-800">{compScore}% compliant</p>
            <p className="text-xs text-gray-400">{compItems.filter(i=>i.status==="completed").length} of {compItems.length} items complete</p>
          </div>
        </div>
        {outstanding.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Outstanding</p>
            {outstanding.map((i, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {i.name}
              </div>
            ))}
          </div>
        )}
        {outstanding.length === 0 && compItems.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />All required items complete
          </div>
        )}
      </Card>

      {/* Onboarding Summary — hide when 100% */}
      {taskPct < 100 && (
        <Card title="Onboarding Progress" action={
          <button onClick={() => onTabChange("onboarding")} className="text-xs text-[#0EA5C9] hover:underline">View all →</button>
        }>
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Progress</span><span className="font-semibold text-gray-800">{taskPct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${taskPct}%` }} />
            </div>
          </div>
          {pendingTasks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Next up</p>
              {pendingTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs text-gray-600">
                  <Clock className="h-3 w-3 text-gray-300 shrink-0" />
                  <span className="truncate">{t.taskName}</span>
                  {t.dueDate && <span className="text-gray-400 shrink-0">Due {fmtDate(t.dueDate)}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Recent Activity */}
      <Card title="Recent Activity" action={
        <button onClick={() => onTabChange("activity")} className="text-xs text-[#0EA5C9] hover:underline">View all →</button>
      }>
        {activity.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No activity recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {activity.map(e => (
              <div key={e.id} className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0EA5C9] mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-tight">{e.description}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{relTime(e.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Job & Pay Tab ──────────────────────────────────────────────
function JobPayTab({ emp, navigate }: { emp: EmployeeDetail; navigate: (p: string) => void }) {
  const { data: locData } = useQuery<{ locations: Array<{ id: string; code: string; name: string }> }>({
    queryKey: ["loc-jobpay", emp.companyId],
    queryFn: () => fetch(`/api/locations?companyId=${emp.companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ locations: Array<{ id: string; code: string; name: string }> }>),
    enabled: !!emp.companyId && !!emp.locationId,
    staleTime: 5 * 60_000,
  });
  const locationLabel = emp.locationId
    ? (() => { const l = (locData?.locations ?? []).find(x => x.id === emp.locationId); return l ? `${l.code} — ${l.name}` : null; })()
    : null;

  const _isSalary = emp.payType === "salary" || emp.payType?.startsWith("salary_");
  const wageDisplay = _isSalary
    ? (emp.annualSalary != null ? `$${(emp.annualSalary / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}/yr` : null)
    : (emp.hourlyWage != null ? `$${(emp.hourlyWage / 100).toFixed(2)}/hr` : null);
  // Salary employee with no annualSalary set — show a visible warning instead of blank "—"
  const wageMissing = _isSalary && emp.annualSalary == null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Position">
        <InfoRow label="Job Title" value={emp.jobTitle ?? emp.position} icon={<Briefcase className="h-3.5 w-3.5" />} />
        <InfoRow label="Department" value={emp.department} icon={<Building2 className="h-3.5 w-3.5" />} />
        {locationLabel && <InfoRow label="Location" value={locationLabel} icon={<MapPin className="h-3.5 w-3.5" />} />}
        <InfoRow label="Manager" value={emp.managerName} icon={<User className="h-3.5 w-3.5" />} />
        <InfoRow label="Employment Type" value={emp.employmentType} />
        <InfoRow label="Worker Type" value={emp.workerType} />
        <InfoRow label="Start Date" value={fmtDate(emp.startDate)} icon={<Calendar className="h-3.5 w-3.5" />} />
      </Card>
      <Card title="Compensation">
        <InfoRow
          label="Pay Rate"
          value={wageMissing
            ? <span className="flex items-center gap-1 text-amber-600 text-xs font-medium"><AlertCircle className="h-3 w-3 shrink-0" />Not set — use Edit to add annual salary</span>
            : wageDisplay}
          icon={<DollarSign className="h-3.5 w-3.5" />}
        />
        <InfoRow label="Pay Type" value={emp.payType} />
        <InfoRow label="Payment Method" value={emp.paymentMethod} />
        <InfoRow label="Overtime Eligible" value={emp.overtimeEligible === true ? "Yes" : emp.overtimeEligible === false ? "No" : null} />
        {emp.rollfiUserId && (
          <div className="mt-2 pt-2 border-t border-gray-50">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${emp.kycStatus === "verified" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {emp.kycStatus === "verified" ? "Payroll Connected" : "Payroll Registered — KYC Pending"}
            </span>
          </div>
        )}
      </Card>
      <Card title="System Status">
        <InfoRow label="Employee ID" value={emp.employeeDisplayId} />
        <InfoRow label="Internal ID" value={<span className="font-mono text-xs text-gray-500">{emp.id.slice(0, 8)}…</span>} />
        <InfoRow label="Payroll Provider" value={emp.rollfiUserId ? <span className="text-emerald-600">Synced ✓</span> : <span className="text-gray-400">Not synced</span>} />
        <InfoRow label="EasyTeam" value={emp.easyteamId ? <span className="text-emerald-600">Synced ✓</span> : <span className="text-gray-400">Not synced</span>} />
        <InfoRow label="Verification Status" value={emp.kycStatus ?? "—"} />
        <InfoRow label="Bank Account" value={emp.bankAccountAdded ? "Added ✓" : "Not added"} />
        <InfoRow label="W-4 Submitted" value={emp.w4Submitted ? "Yes ✓" : "No"} />
      </Card>
    </div>
  );
}

// ── Payroll Readiness Panel ────────────────────────────────────

function fmtAgo(isoDate?: string | null): string {
  if (!isoDate) return "never";
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1 hr ago";
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface ComplianceItemP { id: string; type: string; name: string; status: string; isRequired: boolean; }

const PAYROLL_ITEMS = [
  { type: "w4",             label: "W-4 Form" },
  { type: "state_w4",       label: "State Tax Form" },
  { type: "direct_deposit", label: "Direct Deposit" },
  { type: "i9",             label: "I-9 Verification" },
];
const STATUS_ITEMS = [
  { type: "background_check", label: "Background Check" },
  { type: "handbook",         label: "Handbook Acknowledgment" },
  { type: "policy",           label: "Policy Acknowledgment" },
];

// ── Payroll Setup Modal ────────────────────────────────────────────────────

type RepairStep = {
  step: string;
  result: "success" | "already_done" | "skipped" | "error";
  detail?: string;
};
type RepairResult = {
  alreadyComplete?: boolean;
  needsBankAccount?: boolean;
  message?: string;
  stepsRun: RepairStep[];
  liveKycStatus?: string | null;
  liveUserStatus?: string | null;
  isTermsAccepted?: boolean;
  hasBankInRollfi?: boolean;
  success?: boolean;
};
type PreflightResult = {
  liveKycStatus: string | null;
  liveUserStatus: string | null;
  isTermsAccepted: boolean;
  kycAlreadyInitiated: boolean;
  hasBankInRollfi: boolean;
};

const STEP_LABELS: Record<string, string> = {
  addKycInformation:        "Submit identity information",
  acceptTermsAndCondition:  "Accept terms & conditions",
  initiateUserKyc:          "Initiate identity verification",
  addUserBankAccount:       "Add direct deposit account",
};

function StepIcon({ result }: { result: RepairStep["result"] }) {
  if (result === "success")     return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (result === "already_done") return <CheckCircle2 className="h-4 w-4 text-gray-400 shrink-0" />;
  if (result === "skipped")     return <Clock className="h-4 w-4 text-gray-300 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

function PayrollSetupModal({
  emp,
  isSuperAdmin,
  onClose,
  onComplete,
}: {
  emp: EmployeeDetail;
  isSuperAdmin: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [phase, setPhase]   = useState<"loading" | "ready" | "running" | "done" | "error">("loading");
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const [bankName,      setBankName]      = useState("");
  const [accountName,   setAccountName]   = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType,   setAccountType]   = useState("checking");
  const [skipBank,      setSkipBank]      = useState(false);

  // Fetch live status on open so we know what's needed before the user clicks "Run Setup"
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    (async () => {
      try {
        const r = await fetch(`/api/rollfi/repair/preflight-status?employeeId=${encodeURIComponent(emp.id)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const data = await r.json() as PreflightResult & { error?: string };
        if (!r.ok) {
          setPreflightError(data.error ?? "Could not check current status — you can still run setup manually.");
          setPhase("ready");
          return;
        }
        setPreflight(data);
        // Pre-set skipBank = true only when Rollfi already has a bank account on file
        if (data.hasBankInRollfi) setSkipBank(true);
        setPhase("ready");
      } catch (err: unknown) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        setPreflightError(isAbort
          ? "Status check timed out — you can still run setup manually."
          : "Could not reach payroll provider — you can still run setup manually.");
        setPhase("ready");
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [emp.id]);

  // Address warning: homeAddress field appears to embed city or zip
  const a1 = emp.homeAddress ?? "";
  const addressHasEmbedded = /\b\d{5}\b/.test(a1) || (a1.includes(",") && a1.length > 40);

  const providerLabel = isSuperAdmin ? "Rollfi" : "payroll provider";

  async function handleRun() {
    setPhase("running");
    setApiError(null);
    try {
      const body: Record<string, unknown> = { employeeId: emp.id };
      if (!skipBank && accountNumber && routingNumber && bankName) {
        body.bankName      = bankName;
        body.accountName   = accountName;
        body.routingNumber = routingNumber;
        body.accountNumber = accountNumber;
        body.accountType   = accountType;
      }
      const r = await fetch("/api/rollfi/repair/employee-payroll-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json() as RepairResult & { error?: string; stepsRun?: RepairStep[] };
      if (!r.ok) {
        setApiError(data.error ?? "An error occurred. Please try again.");
        setResult({ stepsRun: data.stepsRun ?? [] });
        setPhase("error");
      } else {
        setResult(data);
        setPhase("done");
        onComplete();
      }
    } catch {
      setApiError("Network error — please try again.");
      setResult({ stepsRun: [] });
      setPhase("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[#2C4562]" />
            <h2 className="font-semibold text-gray-900 text-base">Complete Payroll Setup</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 min-h-[120px]">
          {/* Loading preflight */}
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="h-8 w-8 text-[#2C4562] animate-spin" />
              <p className="text-sm text-gray-500">Checking current setup status…</p>
            </div>
          )}

          {/* Info */}
          {phase === "ready" && (
            <>
              <p className="text-sm text-gray-600 leading-relaxed">
                This will run any missing setup steps for {emp.firstName} —
                identity verification and/or direct deposit.
                Steps already completed in {providerLabel} will be skipped automatically.
              </p>

              {/* Preflight summary */}
              {preflight && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-200 text-xs space-y-1.5">
                  <p className="font-semibold text-gray-600 mb-1">Current status in {providerLabel}</p>
                  <div className="flex items-center gap-2">
                    {preflight.kycAlreadyInitiated
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    <span className={preflight.kycAlreadyInitiated ? "text-emerald-700" : "text-amber-700"}>
                      Identity verification: {preflight.kycAlreadyInitiated ? `${preflight.liveKycStatus ?? "done"}` : "not started"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {preflight.hasBankInRollfi
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    <span className={preflight.hasBankInRollfi ? "text-emerald-700" : "text-amber-700"}>
                      Bank account: {preflight.hasBankInRollfi ? "on file" : "not found"}
                    </span>
                  </div>
                </div>
              )}

              {/* Preflight error (non-fatal) */}
              {preflightError && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {preflightError}
                </div>
              )}

              {/* Address warning */}
              {addressHasEmbedded && (
                <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Check home address before continuing</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      The home address field (<span className="font-mono">{a1}</span>) may contain an
                      embedded city name or zip code. Only the street address should go in that field —
                      city, state, and zip each have their own fields.
                    </p>
                    <button onClick={onClose} className="mt-2 text-xs font-medium text-amber-800 underline underline-offset-2">
                      Fix address first →
                    </button>
                  </div>
                </div>
              )}

              {/* Bank account section — check first, form only if needed */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-800">Direct deposit account</p>
                  {preflight && (
                    <button
                      onClick={() => setSkipBank(v => !v)}
                      className="text-xs underline underline-offset-2 text-gray-400"
                    >
                      {skipBank ? (preflight.hasBankInRollfi ? "Replace bank account" : "Add bank account") : "Skip"}
                    </button>
                  )}
                </div>

                {/* Bank on file — default to skipping */}
                {preflight?.hasBankInRollfi && skipBank ? (
                  <div className="flex items-center gap-2 bg-emerald-50 rounded-xl p-3 border border-emerald-200 text-xs text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Bank account already on file in {providerLabel}. No action needed.
                  </div>
                ) : !skipBank ? (
                  // Show form when: bank is missing, or user toggled to replace/add
                  <div className="space-y-3 bg-gray-50 rounded-xl p-4 border border-gray-200">
                    {preflight && !preflight.hasBankInRollfi && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        No bank account found in {providerLabel} — direct deposit details required.
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name</label>
                        <input
                          value={bankName}
                          onChange={e => setBankName(e.target.value)}
                          placeholder="e.g. Chase, Bank of America"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2C4562]/30"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Holder Name</label>
                        <input
                          value={accountName}
                          onChange={e => setAccountName(e.target.value)}
                          placeholder="Name on account (e.g. Jane Smith)"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2C4562]/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Routing Number</label>
                        <input
                          value={routingNumber}
                          onChange={e => setRoutingNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
                          placeholder="9 digits"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2C4562]/30 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                        <input
                          value={accountNumber}
                          onChange={e => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 17))}
                          placeholder="4–17 digit account number"
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2C4562]/30 font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                        <select
                          value={accountType}
                          onChange={e => setAccountType(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2C4562]/30 bg-white"
                        >
                          <option value="checking">Checking</option>
                          <option value="savings">Savings</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  // skipBank=true but no bank on file (e.g. preflight failed) — show skip notice
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 text-xs text-gray-500">
                    Bank step will be skipped for this run.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Running */}
          {phase === "running" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 text-[#2C4562] animate-spin" />
              <p className="text-sm text-gray-600">Running setup steps…</p>
            </div>
          )}

          {/* Done / Error */}
          {(phase === "done" || phase === "error") && result && (
            <div className="space-y-4">
              {/* Already complete */}
              {result.alreadyComplete && (
                <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Already complete</p>
                    <p className="text-xs text-emerald-700 mt-0.5">{result.message}</p>
                  </div>
                </div>
              )}

              {/* Needs bank account (KYC done but no bank found) */}
              {result.needsBankAccount && (
                <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Bank account required</p>
                    <p className="text-xs text-amber-700 mt-0.5">{result.message}</p>
                  </div>
                </div>
              )}

              {/* Error banner */}
              {phase === "error" && apiError && (
                <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Setup did not complete</p>
                    <p className="text-xs text-red-700 mt-0.5">{apiError}</p>
                  </div>
                </div>
              )}

              {/* Success banner */}
              {phase === "done" && !result.alreadyComplete && !result.needsBankAccount && (
                <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium text-emerald-800">Setup steps completed successfully.</p>
                </div>
              )}

              {/* Step timeline */}
              {result.stepsRun.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Steps run</p>
                  <div className="space-y-2">
                    {result.stepsRun.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <StepIcon result={s.result} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800">{STEP_LABELS[s.step] ?? s.step}</p>
                          {s.result === "already_done" && (
                            <p className="text-xs text-gray-400">Already on file — no change made</p>
                          )}
                          {s.detail && s.result !== "success" && (
                            <p className="text-xs text-red-600 mt-0.5">{s.detail}</p>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                          s.result === "success"      ? "bg-emerald-100 text-emerald-700" :
                          s.result === "already_done" ? "bg-gray-100 text-gray-500"       :
                          s.result === "error"        ? "bg-red-100 text-red-600"         :
                                                        "bg-gray-100 text-gray-400"
                        }`}>
                          {s.result === "already_done" ? "already done" : s.result}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live status */}
              {(result.liveKycStatus || result.liveUserStatus) && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                  <p className="font-medium text-gray-700 mb-1">Current {providerLabel} status</p>
                  {result.liveUserStatus && <p>Account: <span className="font-medium">{result.liveUserStatus}</span></p>}
                  {result.liveKycStatus  && <p>Identity: <span className="font-medium">{result.liveKycStatus}</span></p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {(phase === "ready" || phase === "error") && (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                {phase === "error" ? "Close" : "Cancel"}
              </Button>
              {phase === "ready" && (
                <Button
                  size="sm"
                  onClick={handleRun}
                  disabled={addressHasEmbedded}
                  className="bg-[#2C4562] hover:bg-[#3a5878] text-white"
                >
                  Run Setup
                </Button>
              )}
            </>
          )}
          {phase === "done" && (
            <Button size="sm" onClick={onClose} className="bg-[#2C4562] hover:bg-[#3a5878] text-white">
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PayrollReadinessPanel({ emp, isSuperAdmin }: { emp: EmployeeDetail; isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [setupModalOpen, setSetupModalOpen] = useState(false);

  const { data: compData, isLoading: compLoading } = useQuery<{ items: ComplianceItemP[]; score: number }>({
    queryKey: ["compliance", emp.id],
    queryFn: () => fetch(`/api/compliance?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ items: ComplianceItemP[]; score: number }>),
    staleTime: 30_000,
  });

  const items = compData?.items ?? [];
  const done = (type: string) => items.some(i => i.type === type && i.status === "completed");

  const providerLabel = isSuperAdmin ? "Rollfi" : "Payroll Provider";
  const accountStatus = emp.rollfiAccountStatus;
  const kycStatus     = emp.kycStatus;

  const appReady    = PAYROLL_ITEMS.every(i => done(i.type));
  const rollfiReady = accountStatus === "Active" && kycStatus === "passed";
  // Use the DB-persisted payrollReady flag as the authoritative source so the
  // panel matches the employee-list badge (both reflect Active + KYC passed).
  // Imported employees may never have an I-9 compliance record, so appReady
  // alone would permanently show "In Progress" even when Rollfi is fully live.
  const fullyReady  = !!emp.rollfiUserId && (emp.payrollReady === true || (appReady && rollfiReady));
  const needsKyc    = !!emp.rollfiUserId && (kycStatus === "new" || kycStatus === "pending" || kycStatus === "not_started");

  async function handleRefresh() {
    if (!emp.rollfiUserId) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await fetch(`/api/rollfi/employees/${emp.rollfiUserId}/live-status`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json() as { error?: string }).error ?? "Failed");
      await qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] });
    } catch {
      setRefreshError("Could not reach payroll provider — showing last known status");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-5">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {fullyReady
            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            : <Clock className="h-4 w-4 text-amber-500" />
          }
          <span className="font-semibold text-gray-800 text-sm">Payroll Readiness</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${fullyReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {fullyReady ? "Ready" : "In Progress"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {emp.updatedAt && (
            <span className="text-xs text-gray-400">Updated {fmtAgo(emp.updatedAt)}</span>
          )}
          {emp.rollfiUserId && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-[#0EA5C9] hover:text-[#0284a8] disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {refreshError && (
        <div className="mx-5 mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ {refreshError}
        </div>
      )}

      {/* Two-gate body */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        {/* Gate 1 — Our Records */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Our Records</p>
          {compLoading ? (
            <div className="space-y-2">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
          ) : (
            <>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Payroll-critical</p>
              <div className="space-y-2 mb-4">
                {PAYROLL_ITEMS.map(item => (
                  <div key={item.type} className="flex items-center gap-2">
                    {done(item.type)
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <AlertCircle  className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    }
                    <span className={`text-sm ${done(item.type) ? "text-gray-700" : "text-gray-500"}`}>{item.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Employment-required</p>
              <div className="space-y-2">
                {STATUS_ITEMS.map(item => (
                  <div key={item.type} className="flex items-center gap-2">
                    {done(item.type)
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <AlertCircle  className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                    }
                    <span className={`text-sm ${done(item.type) ? "text-gray-700" : "text-gray-400"}`}>{item.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Gate 2 — Provider Verification */}
        <div className="px-5 py-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {providerLabel} Verification
          </p>
          {!emp.rollfiUserId ? (
            <div className="text-sm text-gray-400 flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              Not connected to payroll provider
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  accountStatus === "Active"      ? "bg-emerald-100 text-emerald-700" :
                  accountStatus === "Invite Sent" ? "bg-amber-100 text-amber-700"    :
                                                   "bg-gray-100 text-gray-500"
                }`}>
                  {accountStatus ?? "Unknown"}
                </span>
                <span className="text-sm text-gray-600">Account status</span>
              </div>
              <div className="flex items-center gap-2">
                {kycStatus === "passed"
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <AlertCircle  className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                }
                <span className="text-sm text-gray-600">
                  Verification:{" "}
                  <span className={`font-medium ${kycStatus === "passed" ? "text-emerald-700" : "text-amber-700"}`}>
                    {kycStatus === "passed"       ? "Passed"
                   : kycStatus === "new"          ? "Not started"
                   : kycStatus === "not_started"  ? "Not started"
                   : kycStatus === "pending"       ? "In progress"
                   : (kycStatus ?? "Unknown")}
                  </span>
                </span>
              </div>
              {isSuperAdmin && (
                <p className="text-[11px] text-gray-400 font-mono truncate">ID: {emp.rollfiUserId}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {needsKyc && (
                  <Link href="/payroll"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#2C4562] text-white hover:bg-[#3a5878] transition-colors">
                    {isSuperAdmin ? "Complete KYC →" : "Complete Verification →"}
                  </Link>
                )}
                {/* Complete Payroll Setup — for imported employees missing KYC initiation or bank */}
                {!!emp.rollfiUserId && accountStatus !== "Active" && (user?.role === "owner" || user?.role === "super_admin") && (
                  <button
                    onClick={() => setSetupModalOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#2C4562] text-[#2C4562] hover:bg-[#2C4562] hover:text-white transition-colors"
                  >
                    <Wrench className="h-3 w-3" />
                    Complete Payroll Setup
                  </button>
                )}
                <Link href="/payroll"
                  className="inline-flex items-center gap-1.5 text-xs text-[#0EA5C9] hover:underline">
                  Open in Payroll →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      {setupModalOpen && (
        <PayrollSetupModal
          emp={emp}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setSetupModalOpen(false)}
          onComplete={() => {
            setSetupModalOpen(false);
            void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] });
          }}
        />
      )}
    </div>
  );
}

// ── Payroll Tab ────────────────────────────────────────────────
function fmtMoney(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPayDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function periodLabel(p: PayPeriod) {
  if (p.label) return p.label;
  const begin = p.payBeginDate ? fmtPayDate(p.payBeginDate) : "";
  const end   = p.payEndDate   ? fmtPayDate(p.payEndDate)   : "";
  if (begin && end) return `${begin} → ${end}`;
  return p.payPeriodId ?? "Period";
}

function PayrollTab({ emp, isSuperAdmin }: { emp: EmployeeDetail; isSuperAdmin: boolean }) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [selectedPayDate, setSelectedPayDate] = useState<string | undefined>();

  const { data: historyData, isLoading: histLoading } = useQuery<{ periods: PayPeriod[] }>({
    queryKey: ["payperiod-history", emp.companyId],
    queryFn: () => fetch(`/api/rollfi/payperiod/history?companyId=${emp.companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ periods: PayPeriod[] }>),
    enabled: !!emp.rollfiUserId && !!emp.companyId,
    staleTime: 120_000,
  });

  const periods = historyData?.periods ?? [];

  React.useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      const first = periods[0];
      setSelectedPeriodId(first.payPeriodId ?? "");
      setSelectedPayDate(first.payDate ?? first.payEndDate);
    }
  }, [periods, selectedPeriodId]);

  const { data: stubData, isLoading: stubLoading } = useQuery<PayStubsData>({
    queryKey: ["paystubs-period", emp.companyId, selectedPeriodId],
    queryFn: () => fetch(`/api/rollfi/paystubs?companyId=${emp.companyId}&payPeriodId=${encodeURIComponent(selectedPeriodId)}`, { credentials: "include" })
      .then(r => r.json() as Promise<PayStubsData>),
    enabled: !!emp.rollfiUserId && !!emp.companyId && !!selectedPeriodId,
    staleTime: 120_000,
  });

  const myStub = stubData?.stubs.find(s =>
    (s.employeeId && s.employeeId === emp.id) ||
    (s.rollfiUserId && emp.rollfiUserId && s.rollfiUserId.toUpperCase() === emp.rollfiUserId.toUpperCase())
  ) ?? null;

  const totalEmpTax = (myStub?.employeeTaxDetails ?? []).reduce((s, t) => s + t.taxAmount, 0);
  const totalErTax  = (myStub?.employerTaxDetails ?? []).reduce((s, t) => s + t.taxAmount, 0);
  const addComp     = (myStub?.additionalCompensations ?? []).reduce((s, a) => s + a.amount, 0);

  return (
    <div className="space-y-5">
      {/* Readiness panel — always shown */}
      <PayrollReadinessPanel emp={emp} isSuperAdmin={isSuperAdmin} />

      {/* Pay stubs — only when connected to payroll */}
      {emp.rollfiUserId && (
        histLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : periods.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <CreditCard className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No pay periods found</p>
            <p className="text-gray-400 text-sm mt-1">Run payroll first to see paystub details here.</p>
          </div>
        ) : (
          <>
            {/* Period selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-600 shrink-0">Pay Period</label>
              <select
                value={selectedPeriodId}
                onChange={e => {
                  const p = periods.find(x => x.payPeriodId === e.target.value);
                  setSelectedPeriodId(e.target.value);
                  setSelectedPayDate(p?.payDate ?? p?.payEndDate);
                }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#284362]/30 min-w-[240px]">
                {periods.map(p => (
                  <option key={p.payPeriodId} value={p.payPeriodId ?? ""}>{periodLabel(p)}</option>
                ))}
              </select>
            </div>

            {stubLoading && <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>}

            {!stubLoading && !myStub && (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <CreditCard className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">No paystub for this period</p>
                <p className="text-gray-400 text-sm mt-1">This employee wasn&apos;t included in this pay run.</p>
              </div>
            )}

            {!stubLoading && myStub && (
              <>
                {/* Earnings summary card */}
                <div className="bg-white rounded-xl border shadow-sm p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">{myStub.name}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{myStub.position}</p>
                    </div>
                    {selectedPayDate && (
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Pay Date</div>
                        <div className="text-sm font-semibold text-gray-700">{fmtPayDate(selectedPayDate)}</div>
                      </div>
                    )}
                  </div>

                  {/* Earnings row */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-0.5">Base Earnings</div>
                      <div className="text-xl font-bold text-gray-900">{fmtMoney(myStub.baseTotal ?? myStub.grossPay)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-0.5">Gross Earnings</div>
                      <div className="text-xl font-bold text-gray-900">{fmtMoney(myStub.grossPay + addComp)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-0.5">Net Earnings</div>
                      <div className="text-xl font-bold text-emerald-600">{fmtMoney(myStub.netPay)}</div>
                    </div>
                  </div>

                  {/* Hours + pay date row */}
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Regular Hours</span>
                      <br /><span className="font-semibold text-gray-800">{myStub.hoursWorked}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Total Hours</span>
                      <br /><span className="font-semibold text-gray-800">{myStub.hoursWorked}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Pay Date</span>
                      <br /><span className="font-semibold text-gray-800">{fmtPayDate(selectedPayDate)}</span>
                    </div>
                  </div>
                </div>

                {/* Tax tables side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Employee Taxes */}
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                      <span className="font-semibold text-gray-800">Employee Taxes</span>
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                    </div>
                    {myStub.employeeTaxDetails && myStub.employeeTaxDetails.length > 0 ? (
                      <>
                        {myStub.employeeTaxDetails.map((t, i) => (
                          <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                            <span className="text-gray-700">{t.taxName}</span>
                            <span className="font-medium text-gray-900">{fmtMoney(t.taxAmount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                          <span>Total</span><span>{fmtMoney(totalEmpTax)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="px-5 py-8 text-sm text-gray-400 text-center">
                        {myStub.fromRollfi ? "No employee tax details for this period." : "Employee not yet processed in payroll."}
                      </div>
                    )}
                  </div>

                  {/* Employer Taxes */}
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                      <span className="font-semibold text-gray-800">Employer Taxes</span>
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                    </div>
                    {myStub.employerTaxDetails && myStub.employerTaxDetails.length > 0 ? (
                      <>
                        {myStub.employerTaxDetails.map((t, i) => (
                          <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                            <span className="text-gray-700">{t.taxName}</span>
                            <span className="font-medium text-gray-900">{fmtMoney(t.taxAmount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between px-5 py-3 bg-gray-50 border-t font-bold text-sm">
                          <span>Total</span><span>{fmtMoney(totalErTax)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="px-5 py-8 text-sm text-gray-400 text-center">No employer tax details available.</div>
                    )}
                  </div>
                </div>

                {/* Additional Compensations */}
                {myStub.additionalCompensations && myStub.additionalCompensations.length > 0 && (
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 border-b font-semibold text-gray-800">Additional Compensation</div>
                    {myStub.additionalCompensations.map((a, i) => (
                      <div key={i} className="flex justify-between px-5 py-3 border-b last:border-b-0 text-sm">
                        <span className="text-gray-700">
                          {a.payrollLineItemAdditionalCompensationVertexCompensationIdentifier.compensationDescription}
                        </span>
                        <span className="font-medium">{fmtMoney(a.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* YTD summary footer */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 px-5 py-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">YTD Gross Pay</span>
                  <span className="font-bold text-gray-900">{fmtMoney(myStub.ytdGross)}</span>
                </div>
              </>
            )}
          </>
        )
      )}
    </div>
  );
}

// ── Activity Tab ───────────────────────────────────────────────
function ActivityTab({ emp }: { emp: EmployeeDetail }) {
  const [page, setPage] = useState(1);
  const PER_PAGE = 20;

  const { data, isLoading, isFetching } = useQuery<{ entries: ActivityEntry[]; total?: number }>({
    queryKey: ["activity", emp.id, page],
    queryFn: () => fetch(`/api/activity-log?companyId=${emp.companyId}&employeeId=${emp.id}&limit=${PER_PAGE}&offset=${(page - 1) * PER_PAGE}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ entries: ActivityEntry[]; total?: number }>),
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];

  const CAT_COLORS: Record<string, string> = {
    onboarding: "#3B82F6", compliance: "#8B5CF6", document: "#F59E0B",
    profile: "#10B981", payroll: "#0EA5C9", system: "#6B7280",
  };

  if (isLoading) return <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>;

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Activity className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No activity yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-3">
              <div className="w-2 h-2 rounded-full mt-2 shrink-0"
                style={{ background: CAT_COLORS[e.category] ?? "#9CA3AF" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700">{e.description}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[11px] text-gray-400">{relTime(e.createdAt)}</p>
                  <span className="text-[11px] text-gray-300">·</span>
                  <p className="text-[11px] text-gray-400">
                    {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize shrink-0">
                {e.category}
              </span>
            </div>
          ))}
        </div>
      )}
      {(entries.length === PER_PAGE || page > 1) && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 1 || isFetching} onClick={() => setPage(p => p - 1)}
            className="h-8 text-xs">← Prev</Button>
          <span className="text-xs text-gray-400">Page {page}</span>
          <Button variant="outline" size="sm" disabled={entries.length < PER_PAGE || isFetching} onClick={() => setPage(p => p + 1)}
            className="h-8 text-xs">Next →</Button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function EmployeeProfilePage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id");
  const search = useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const searchParams = new URLSearchParams(search);
  const activeTab = searchParams.get("tab") ?? "overview";

  const [statusModal, setStatusModal] = useState<"leave"|"terminate"|"reactivate"|null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  const canEdit   = user?.role === "super_admin" || user?.role === "owner" || user?.role === "manager";
  const canPhoto  = user?.role === "super_admin" || user?.role === "owner";
  const canStatus = user?.role === "super_admin" || user?.role === "owner";

  const { data, isLoading, isError } = useQuery<{ employee: EmployeeDetail }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ employee: EmployeeDetail }>),
    enabled: !!empId, staleTime: 30_000,
  });

  const emp = data?.employee;

  function setTab(tab: string) {
    navigate(`/people/${empId}?tab=${tab}`);
  }

  if (isLoading) return (
    <div className="space-y-4 max-w-5xl">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="flex gap-1">{TABS.map((_,i) => <Skeleton key={i} className="h-9 w-24 rounded-lg" />)}</div>
      <div className="grid grid-cols-2 gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
    </div>
  );

  if (isError || !emp) return (
    <div className="max-w-5xl">
      <button onClick={() => navigate("/people/directory")}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="text-center py-16">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Employee not found</p>
      </div>
    </div>
  );

  const status = STATUS_CFG[emp.status] ?? { label: emp.status, dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-500" };

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Back */}
      <button onClick={() => navigate("/people/directory")}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Employee Directory
      </button>

      {/* Terminated Banner */}
      {emp.status === "terminated" && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <Ban className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 font-medium">This employee has been terminated</p>
        </div>
      )}

      {/* Profile Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-start gap-4 flex-wrap">
          {/* Avatar with photo change */}
          <div className="relative group shrink-0">
            <Avatar firstName={emp.firstName} lastName={emp.lastName} photoUrl={emp.photoUrl} size="lg" />
            {canPhoto && (
              <button
                onClick={() => setPhotoModalOpen(true)}
                className="absolute inset-0 rounded-full bg-black/40 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera className="h-5 w-5 text-white" />
                <span className="text-[10px] text-white font-medium">Change</span>
              </button>
            )}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{emp.firstName} {emp.lastName}</h1>
                <p className="text-sm text-gray-500">{emp.jobTitle ?? emp.position}</p>
                {(emp.employeeDisplayId || emp.department) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[emp.employeeDisplayId, emp.department].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
                </span>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/people/${emp.id}/edit`)}
                    className="gap-1.5 text-xs h-8">
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                )}
                {canStatus && (
                  <div className="relative">
                    <Button variant="outline" size="sm" onClick={() => setMenuOpen(v => !v)}
                      className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                    {menuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 top-9 z-20 bg-white rounded-xl border border-gray-200 shadow-xl py-1 w-44">
                          {(emp.status === "active" || emp.status === "onboarding") && (
                            <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2"
                              onClick={() => { setMenuOpen(false); setStatusModal("leave"); }}>
                              <Pause className="h-3.5 w-3.5 text-amber-500" />Put On Leave
                            </button>
                          )}
                          {(emp.status === "active" || emp.status === "on_leave" || emp.status === "onboarding") && (
                            <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2 text-red-600"
                              onClick={() => { setMenuOpen(false); setStatusModal("terminate"); }}>
                              <Ban className="h-3.5 w-3.5" />Terminate
                            </button>
                          )}
                          {(emp.status === "terminated" || emp.status === "on_leave") && (
                            <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2 text-emerald-600"
                              onClick={() => { setMenuOpen(false); setStatusModal("reactivate"); }}>
                              <RotateCcw className="h-3.5 w-3.5" />Reactivate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Readiness chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {!emp.rollfiUserId ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">⏳ Payroll Not Set Up</span>
              ) : emp.payrollReady && emp.rollfiAccountStatus === "Active" && emp.kycStatus === "passed" ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✓ Payroll Ready</span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">⏳ Payroll In Progress</span>
              )}
              {emp.easyteamId ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✓ EasyTeam</span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">⏳ EasyTeam</span>
              )}
              {emp.complianceScore != null && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                  Compliance: {emp.complianceScore}%
                </span>
              )}
              {(emp.onboardingProgress ?? 0) < 100 && emp.onboardingProgress != null && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
                  Onboarding: {emp.onboardingProgress}%
                </span>
              )}
              {emp.managerName && (
                <span className="text-[11px] text-gray-500">Reports to <span className="font-medium text-gray-700">{emp.managerName}</span></span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === id
                  ? "text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              }`}
              style={activeTab === id ? { background: NAVY } : {}}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="pb-8">
        {activeTab === "overview" && <OverviewTab emp={emp} onTabChange={setTab} />}
        {activeTab === "job" && <JobPayTab emp={emp} navigate={navigate} />}
        {activeTab === "onboarding" && <EmployeeTasksPanel emp={emp} />}
        {activeTab === "compliance" && <EmployeeCompliancePanel emp={emp} />}
        {activeTab === "documents" && (
          <EmployeeDocuments employeeId={emp.id} companyId={emp.companyId}
            onUpload={() => void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] })} />
        )}
        {activeTab === "contacts" && (
          <EmergencyContactForm employeeId={emp.id} companyId={emp.companyId} />
        )}
        {activeTab === "payroll" && <PayrollTab emp={emp} isSuperAdmin={user?.role === "super_admin"} />}
        {activeTab === "activity" && <ActivityTab emp={emp} />}
        {activeTab === "account" && <AccountTab emp={emp} />}
      </div>

      {/* Status modals */}
      {statusModal === "leave" && (
        <OnLeaveModal emp={emp} onClose={() => setStatusModal(null)}
          onSuccess={() => { setStatusModal(null); void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] }); }} />
      )}
      {statusModal === "terminate" && (
        <TerminateModal emp={emp} onClose={() => setStatusModal(null)}
          onSuccess={() => { setStatusModal(null); void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] }); }} />
      )}
      {statusModal === "reactivate" && (
        <ReactivateModal emp={emp} onClose={() => setStatusModal(null)}
          onSuccess={() => { setStatusModal(null); void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] }); }} />
      )}

      {/* Photo modal */}
      {photoModalOpen && (
        <PhotoModal emp={emp} onClose={() => setPhotoModalOpen(false)}
          onSuccess={() => {
            setPhotoModalOpen(false);
            void qc.invalidateQueries({ queryKey: ["employee-detail", emp.id] });
          }} />
      )}
    </div>
  );
}
