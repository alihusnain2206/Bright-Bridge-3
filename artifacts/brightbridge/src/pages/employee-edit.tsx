import React, { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, User, Briefcase, DollarSign, Lock, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY  = "#1B3A6B";

// ── Types ─────────────────────────────────────────────────────

interface EmployeeDetail {
  id: string; companyId: string;
  firstName: string; lastName: string; email: string; phone: string;
  position: string; jobTitle?: string|null; employmentType: string; workerType: string;
  startDate?: string|null; status: string; employeeDisplayId?: string|null;
  department?: string|null; managerId?: string|null; managerName?: string|null;
  payType?: string|null; hourlyWage?: number|null; annualSalary?: number|null; overtimeEligible?: boolean|null; paymentMethod?: string|null;
  ssn?: string|null; dateOfBirth?: string|null;
  homeAddress?: string|null; homeCity?: string|null; homeState?: string|null; homeZip?: string|null;
  w4FilingStatus?: string|null; w4MultipleJobs?: boolean|null; w4Dependents?: number|null; w4ExtraWithholding?: number|null;
  rollfiUserId?: string|null; notes?: string|null;
}

interface RollfiSyncCall { success: boolean; error?: string; status?: number; blockedReason?: string }
interface RollfiSyncResult {
  skipped?: boolean; reason?: string;
  updateUser?: RollfiSyncCall | null;
  updateKycInfo?: RollfiSyncCall | null;
  updateWage?: RollfiSyncCall | null;
}

// ── Options ───────────────────────────────────────────────────

const EMP_TYPES = [
  "Full Time (30+ Hours per week)",
  "Part Time (Under 30 Hours per week)",
  "PRN / Casual",
  "Seasonal",
];
const WORKER_TYPES = ["W2","1099 Contractor","Volunteer","Intern"];
const PAY_TYPES    = ["hourly","salary"];
const PAY_METHODS  = ["Direct Deposit","Check","Cash"];
const W4_STATUSES  = ["Single","Married Filing Jointly","Married Filing Separately","Head of Household","Qualifying Surviving Spouse"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

// ── Helpers ───────────────────────────────────────────────────

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </label>
  );
}

function Sel({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full h-9 text-sm border border-gray-200 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5C9] bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ── Sync result card ──────────────────────────────────────────

function SyncBadge({ call, label }: { call?: RollfiSyncCall | null; label: string }) {
  if (!call) return null;
  if (call.blockedReason) {
    const msg = call.blockedReason === "kyc_not_initiated"
      ? "not sent — KYC not started"
      : call.blockedReason === "no_wage_record"
      ? "not sent — no wage record in Rollfi"
      : call.blockedReason;
    return (
      <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span><strong>{label}:</strong> {msg}</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${call.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
      {call.success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
      <span><strong>{label}:</strong> {call.success ? "synced ✓" : (call.error?.slice(0, 80) ?? "failed")}</span>
    </div>
  );
}

function SyncResultCard({ result }: { result: RollfiSyncResult }) {
  if (result.skipped) {
    return (
      <div className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-500">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Rollfi sync skipped — {result.reason === "no_rollfi_account" ? "employee not yet synced to Rollfi" : result.reason === "not_configured" ? "Rollfi credentials not set" : result.reason}
      </div>
    );
  }
  const calls = [result.updateUser, result.updateKycInfo, result.updateWage].filter(Boolean);
  if (calls.length === 0) return null;

  const kycBlocked  = result.updateKycInfo?.blockedReason === "kyc_not_initiated";
  const wageBlocked = result.updateWage?.blockedReason    === "no_wage_record";

  return (
    <div className="space-y-1.5">
      {/* Prominent warning for any blocked sync — DB save succeeded but Rollfi was not reached */}
      {(kycBlocked || wageBlocked) && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Saved locally.{" "}
            {kycBlocked && "This employee\u2019s details could not be sent to the payroll provider \u2014 identity verification hasn\u2019t been started for them yet."}
            {kycBlocked && wageBlocked && " "}
            {wageBlocked && "Wage changes could not be sent to the payroll provider \u2014 no wage record exists in Rollfi for this employee yet."}
          </span>
        </div>
      )}
      <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5"><RefreshCw className="h-3 w-3" /> Rollfi Sync</p>
      <SyncBadge call={result.updateUser} label="Profile" />
      <SyncBadge call={result.updateKycInfo} label="KYC / Address" />
      <SyncBadge call={result.updateWage} label="Wage" />
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────

const TABS = [
  { id: "basic",      label: "Basic Info",    icon: <User className="h-3.5 w-3.5" />       },
  { id: "employment", label: "Employment",    icon: <Briefcase className="h-3.5 w-3.5" />  },
  { id: "pay",        label: "Compensation",  icon: <DollarSign className="h-3.5 w-3.5" /> },
  { id: "personal",   label: "Personal",      icon: <Lock className="h-3.5 w-3.5" />       },
  { id: "w4",         label: "W4",            icon: <FileText className="h-3.5 w-3.5" />   },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ── Main page ─────────────────────────────────────────────────

export default function EmployeeEditPage() {
  const [, navigate] = useLocation();
  const [, params]   = useRoute("/people/:id/edit");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const [activeTab, setActiveTab] = useState<TabId>("basic");
  const [saving, setSaving]       = useState(false);
  const [error,  setError]        = useState<string | null>(null);
  const [saved,  setSaved]        = useState(false);
  const [syncResult, setSyncResult] = useState<RollfiSyncResult | null>(null);

  const { data, isLoading } = useQuery<{ employee: EmployeeDetail }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeDetail }>),
    enabled: !!empId,
  });

  // Form state — initialised once employee loads
  const [form, setForm] = useState<Record<string, unknown> | null>(null);

  // Initialise form from employee data once loaded
  React.useEffect(() => {
    if (data?.employee && !form) {
      const e = data.employee;
      setForm({
        firstName: e.firstName ?? "",
        lastName:  e.lastName  ?? "",
        email:     e.email     ?? "",
        phone:     e.phone     ?? "",
        position:  e.position  ?? "",
        jobTitle:  e.jobTitle  ?? "",
        employmentType: e.employmentType ?? "",
        workerType:     e.workerType     ?? "",
        startDate:      e.startDate      ?? "",
        status:         e.status         ?? "active",
        department:     e.department     ?? "",
        managerName:    e.managerName    ?? "",
        managerId:      e.managerId      ?? "",
        // Compensation (display in dollars — load from the right column based on payType)
        payType:          e.payType          ?? "hourly",
        hourlyWageDisplay: (() => {
          if ((e.payType ?? "hourly") === "salary") {
            return e.annualSalary != null ? String(Math.round(e.annualSalary / 100)) : "";
          }
          return e.hourlyWage != null ? String((e.hourlyWage / 100).toFixed(2)) : "";
        })(),
        overtimeEligible: e.overtimeEligible ?? true,
        paymentMethod:    e.paymentMethod    ?? "Direct Deposit",
        // Personal
        ssn:          e.ssn         ?? "",
        dateOfBirth:  e.dateOfBirth ?? "",
        homeAddress:  e.homeAddress ?? "",
        homeCity:     e.homeCity    ?? "",
        homeState:    e.homeState   ?? "",
        homeZip:      e.homeZip     ?? "",
        // W4
        w4FilingStatus:     e.w4FilingStatus     ?? "",
        w4MultipleJobs:     e.w4MultipleJobs     ?? false,
        w4Dependents:       e.w4Dependents       ?? 0,
        w4ExtraWithholding: e.w4ExtraWithholding ?? 0,
        // Notes
        notes: e.notes ?? "",
      });
    }
  }, [data, form]);

  function set(key: string, value: unknown) { setForm(f => f ? { ...f, [key]: value } : f); }

  async function handleSave() {
    if (!form) return;
    setSaving(true); setError(null); setSaved(false); setSyncResult(null);

    // Convert wage display → cents, routing to the correct column by pay type
    const wageCents = form.hourlyWageDisplay !== ""
      ? Math.round(Number(form.hourlyWageDisplay as string) * 100)
      : null;
    const isSalary      = form.payType === "salary";
    // hourly_wage column is NOT NULL — use 0 as the sentinel for salary employees
    const hourlyWageCents  = isSalary ? 0 : wageCents;
    const annualSalaryCents = isSalary ? wageCents : null;

    const payload: Record<string, unknown> = {
      firstName: form.firstName, lastName: form.lastName,
      email: form.email, phone: form.phone,
      position: form.position, jobTitle: form.jobTitle,
      employmentType: form.employmentType, workerType: form.workerType,
      startDate: form.startDate, status: form.status,
      department: form.department, managerName: form.managerName, managerId: form.managerId,
      payType: form.payType, hourlyWage: hourlyWageCents, annualSalary: annualSalaryCents,
      overtimeEligible: form.overtimeEligible, paymentMethod: form.paymentMethod,
      ssn: form.ssn || null, dateOfBirth: form.dateOfBirth || null,
      homeAddress: form.homeAddress || null, homeCity: form.homeCity || null,
      homeState: form.homeState || null, homeZip: form.homeZip || null,
      w4FilingStatus: form.w4FilingStatus || null,
      w4MultipleJobs: form.w4MultipleJobs, w4Dependents: form.w4Dependents,
      w4ExtraWithholding: form.w4ExtraWithholding,
      notes: form.notes || null,
    };

    try {
      const r = await fetch(`/api/employees/${empId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const result = await r.json() as { employee?: EmployeeDetail; error?: string; rollfiSync?: RollfiSyncResult };
      if (!r.ok) { setError(result.error ?? "Failed to save changes"); return; }

      setSaved(true);
      if (result.rollfiSync) setSyncResult(result.rollfiSync);

      // Invalidate queries so profile page re-fetches
      void qc.invalidateQueries({ queryKey: ["employee-detail", empId] });
      void qc.invalidateQueries({ queryKey: ["people-employees"] });
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !form) {
    return (
      <div className="p-6 space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-10" />)}
        </div>
      </div>
    );
  }

  const emp = data?.employee;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(`/people/${empId}`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="h-4 w-4" /> {emp ? `${emp.firstName} ${emp.lastName}` : "Back"}
        </button>
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5 text-white" style={{ background: NAVY }}>
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-bold text-gray-900">Edit Employee</h1>
        {emp && <p className="text-sm text-gray-500">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>}
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {saved && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 px-4 py-3 rounded-xl">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Changes saved successfully
          </div>
          {syncResult && <SyncResultCard result={syncResult} />}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">

        {/* ── Basic Info ── */}
        {activeTab === "basic" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First Name" required>
                <Input value={form.firstName as string} onChange={e => set("firstName", e.target.value)} className="h-9 text-sm" />
              </Field>
              <Field label="Last Name" required>
                <Input value={form.lastName as string} onChange={e => set("lastName", e.target.value)} className="h-9 text-sm" />
              </Field>
            </div>
            <Field label="Email" required>
              <Input type="email" value={form.email as string} onChange={e => set("email", e.target.value)} className="h-9 text-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <Input value={form.phone as string} onChange={e => set("phone", e.target.value)} className="h-9 text-sm" placeholder="(555) 000-0000" />
              </Field>
              <Field label="Start Date">
                <Input type="date" value={form.startDate as string} onChange={e => set("startDate", e.target.value)} className="h-9 text-sm" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Position" required>
                <Input value={form.position as string} onChange={e => set("position", e.target.value)} className="h-9 text-sm" />
              </Field>
              <Field label="Job Title">
                <Input value={form.jobTitle as string} onChange={e => set("jobTitle", e.target.value)} className="h-9 text-sm" placeholder="e.g. Lead Teacher" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                value={form.notes as string}
                onChange={e => set("notes", e.target.value)}
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0EA5C9] resize-none"
                placeholder="Internal notes about this employee…"
              />
            </Field>
          </>
        )}

        {/* ── Employment ── */}
        {activeTab === "employment" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Employment Type">
                <Sel value={form.employmentType as string} onChange={v => set("employmentType", v)} options={EMP_TYPES} />
              </Field>
              <Field label="Worker Type">
                <Sel value={form.workerType as string} onChange={v => set("workerType", v)} options={WORKER_TYPES} />
              </Field>
            </div>
            <Field label="Status">
              <Sel value={form.status as string} onChange={v => set("status", v)}
                options={["active","onboarding","pending","on_leave","terminated"]} />
            </Field>
            <Field label="Department">
              <Input value={form.department as string} onChange={e => set("department", e.target.value)} className="h-9 text-sm" placeholder="e.g. Teaching Staff" />
            </Field>
            <Field label="Manager / Supervisor">
              <Input value={form.managerName as string} onChange={e => set("managerName", e.target.value)} className="h-9 text-sm" placeholder="Manager name" />
            </Field>
            {emp?.rollfiUserId && (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                ⚠ Rollfi does not allow name changes via API for KYC reasons. Name changes will be saved locally but not synced to Rollfi. Contact Rollfi support for name corrections.
              </div>
            )}
          </>
        )}

        {/* ── Compensation ── */}
        {activeTab === "pay" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Pay Type">
                <Sel value={form.payType as string} onChange={v => set("payType", v)} options={PAY_TYPES} />
              </Field>
              <Field
                label={form.payType === "salary" ? "Annual Salary (USD)" : "Hourly Rate (USD)"}
                hint={form.payType === "salary" ? "Enter as dollars, e.g. 60000" : "Enter as dollars, e.g. 18.50"}
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <Input
                    type="number"
                    step={form.payType === "salary" ? "1" : "0.01"}
                    min="0"
                    value={form.hourlyWageDisplay as string}
                    onChange={e => set("hourlyWageDisplay", e.target.value)}
                    className="h-9 text-sm pl-7"
                    placeholder={form.payType === "salary" ? "60000" : "18.00"}
                  />
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Payment Method">
                <Sel value={form.paymentMethod as string} onChange={v => set("paymentMethod", v)} options={PAY_METHODS} />
              </Field>
              <Field label="Overtime Eligible">
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={form.overtimeEligible as boolean}
                    onCheckedChange={v => set("overtimeEligible", v)}
                  />
                  <span className="text-sm text-gray-600">{form.overtimeEligible ? "Yes" : "No"}</span>
                </div>
              </Field>
            </div>
            {emp?.rollfiUserId && (
              <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                ℹ Wage changes will be synced to Rollfi automatically on save via <code>updateUserWage</code>.
              </div>
            )}
          </>
        )}

        {/* ── Personal ── */}
        {activeTab === "personal" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="SSN" hint="Stored securely — masked after entry">
                <Input
                  type="password"
                  value={form.ssn as string}
                  onChange={e => set("ssn", e.target.value)}
                  className="h-9 text-sm"
                  placeholder="XXX-XX-XXXX"
                  autoComplete="off"
                />
              </Field>
              <Field label="Date of Birth">
                <Input type="date" value={form.dateOfBirth as string} onChange={e => set("dateOfBirth", e.target.value)} className="h-9 text-sm" />
              </Field>
            </div>
            <Field label="Home Address">
              <Input value={form.homeAddress as string} onChange={e => set("homeAddress", e.target.value)} className="h-9 text-sm" placeholder="Street address" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City">
                <Input value={form.homeCity as string} onChange={e => set("homeCity", e.target.value)} className="h-9 text-sm" />
              </Field>
              <Field label="State">
                <Sel value={form.homeState as string} onChange={v => set("homeState", v)} options={US_STATES} placeholder="Select…" />
              </Field>
              <Field label="Zip Code">
                <Input value={form.homeZip as string} onChange={e => set("homeZip", e.target.value)} className="h-9 text-sm" maxLength={10} />
              </Field>
            </div>
            {emp?.rollfiUserId && (
              <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                ℹ Address and phone changes will be synced to Rollfi via <code>updateKycInformation</code>.
              </div>
            )}
          </>
        )}

        {/* ── W4 ── */}
        {activeTab === "w4" && (
          <>
            <Field label="Filing Status">
              <Sel value={form.w4FilingStatus as string} onChange={v => set("w4FilingStatus", v)} options={W4_STATUSES} placeholder="Select…" />
            </Field>
            <Field label="Multiple Jobs / Spouse Works">
              <div className="flex items-center gap-2 h-9">
                <Switch
                  checked={form.w4MultipleJobs as boolean}
                  onCheckedChange={v => set("w4MultipleJobs", v)}
                />
                <span className="text-sm text-gray-600">{form.w4MultipleJobs ? "Yes" : "No"}</span>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Dependents ($)" hint="Total annual amount from W4 Step 3">
                <Input
                  type="number" min="0"
                  value={String(form.w4Dependents)}
                  onChange={e => set("w4Dependents", Number(e.target.value))}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="Extra Withholding ($)" hint="Additional amount per pay period">
                <Input
                  type="number" min="0"
                  value={String(form.w4ExtraWithholding)}
                  onChange={e => set("w4ExtraWithholding", Number(e.target.value))}
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              These values update the local record. To update W4 elections in Rollfi, use the W4 submission flow on the employee&apos;s Rollfi onboarding.
            </div>
          </>
        )}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5 text-white" style={{ background: NAVY }}>
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
