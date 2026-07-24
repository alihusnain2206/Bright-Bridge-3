import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  User, DollarSign, Lock, CreditCard, CheckCircle2, AlertTriangle,
  ChevronLeft, ChevronRight, Loader2, Eye, EyeOff, Camera,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ORANGE = "#E8622A";
const NAVY = "#284362";
const today = () => new Date().toISOString().split("T")[0];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

// States that issue their own withholding certificate — must match the backend set in rollfi-employee-sync.ts
const STATES_WITH_OWN_W4 = new Set([
  "AL","AR","AZ","CA","CO","CT","DC","DE","GA","HI",
  "ID","IL","IN","IA","KS","KY","LA","ME","MD","MA",
  "MI","MN","MS","MO","MT","NE","NJ","NM","NY","NC",
  "OH","OK","OR","RI","SC","VT","VA","WI",
]);
const NO_INCOME_TAX_STATES = new Set(["AK","FL","NV","NH","SD","TN","TX","WA","WY"]);
// ND, PA, UT use the federal W-4 directly

const STEPS = [
  { label: "Basic Info",    icon: User },
  { label: "Pay Details",   icon: DollarSign },
  { label: "Personal Info", icon: Lock },
  { label: "Bank Setup",    icon: CreditCard },
];

const POSITION_SUGGESTIONS = ["Teacher","Assistant Teacher","Daycare Director","Cook","Administrative Assistant","Security","Janitor","Other"];

interface FormData {
  // Step 1
  firstName: string; lastName: string; email: string; phone: string;
  position: string; employmentType: string; workerType: string; startDate: string;
  department: string; managerId: string; managerName: string;
  // Step 2
  payType: string; wageAmount: number; overtimeEligible: boolean;
  paymentMethod: string; taxExempt: boolean;
  // Step 3
  ssn: string; dateOfBirth: string;
  homeAddress: string; homeCity: string; homeState: string; homeZip: string;
  w4FilingStatus: string; w4MultipleJobs: boolean; w4Dependents: number; w4ExtraWithholding: number;
  stateW4Fields: Record<string, string>;
  // Step 4
  bankSetupMethod: "invite" | "manual";
  bankName: string; routingNumber: string; accountNumber: string; accountType: string;
}

interface Company { id: string; name: string; }

interface StateW4Field {
  fieldName: string;
  fieldDescription: string;
  options?: string[];
  dataType?: string;
}
interface StateW4Response { stateCode: string; stateW4FieldsList: Record<string, string>; fields: StateW4Field[]; }

function StateW4FormSection({ stateCode, fields, values, onChange }: {
  stateCode: string; fields: StateW4Field[]; values: Record<string, string>;
  onChange: (updated: Record<string, string>) => void;
}) {
  const optionFields = fields.filter((f) => f.options && f.options.length > 0);
  const numericFields = fields.filter((f) => !f.options);
  const isMultiStatus = optionFields.length > 1;
  const selectedStatusField = optionFields.find((f) => values[f.fieldName]) ?? optionFields[0];

  const handleChange = (fieldName: string, value: string) => onChange({ ...values, [fieldName]: value });

  const handleStatusTypeChange = (newFieldName: string) => {
    const updated = { ...values };
    optionFields.forEach((f) => { updated[f.fieldName] = ""; });
    const newField = optionFields.find((f) => f.fieldName === newFieldName);
    updated[newFieldName] = newField?.options?.[0] ?? "";
    onChange(updated);
  };

  return (
    <div className="border-t pt-4 space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{stateCode} State W-4 Withholding</p>
      {isMultiStatus ? (
        <>
          <div className="space-y-1.5">
            <Label>Filing Status</Label>
            <Select value={selectedStatusField?.fieldName ?? ""} onValueChange={handleStatusTypeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{optionFields.map((f) => <SelectItem key={f.fieldName} value={f.fieldName}>{f.fieldName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selectedStatusField && (
            <div className="space-y-1.5">
              <Label>Withholding Code</Label>
              <Select value={values[selectedStatusField.fieldName] ?? ""} onValueChange={(v) => handleChange(selectedStatusField.fieldName, v)}>
                <SelectTrigger><SelectValue placeholder="Select code…" /></SelectTrigger>
                <SelectContent>{selectedStatusField.options!.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </>
      ) : (
        optionFields.map((field) => (
          <div key={field.fieldName} className="space-y-1.5">
            <Label>{field.fieldName}</Label>
            <Select value={values[field.fieldName] ?? ""} onValueChange={(v) => handleChange(field.fieldName, v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{field.options!.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))
      )}
      {numericFields.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {numericFields.map((field) => (
            <div key={field.fieldName} className="space-y-1.5">
              <Label>{field.fieldName}</Label>
              <Input type="number" step={field.dataType === "Double" ? "0.01" : "1"} min="0"
                value={values[field.fieldName] ?? "0"}
                onChange={(e) => handleChange(field.fieldName, e.target.value)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PayPreview({ wage, payFrequency }: { wage: number; payFrequency?: string }) {
  const hoursPerPeriod = payFrequency === "Weekly" ? 40 : 80;
  const gross = wage * hoursPerPeriod;
  const taxRate = 0.2465;
  const taxes = gross * taxRate;
  const net = gross - taxes;
  return (
    <div className="bg-[#284362]/5 border border-[#284362]/20 rounded-xl px-4 py-3 space-y-1.5">
      <p className="text-xs font-bold text-[#284362] uppercase tracking-wide flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" />Pay Preview (estimated)</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-gray-500">Hourly rate</div><div className="font-medium">${wage.toFixed(2)}</div>
        <div className="text-gray-500">Hours ({payFrequency === "Weekly" ? "40h" : "80h bi-weekly"})</div><div className="font-medium">{hoursPerPeriod}h</div>
        <div className="text-gray-500">Gross pay</div><div className="font-medium">${gross.toFixed(2)}</div>
        <div className="text-gray-500">Est. taxes (~24.65%)</div><div className="text-red-600">-${taxes.toFixed(2)}</div>
        <div className="text-gray-700 font-semibold">Est. net pay</div><div className="font-bold text-emerald-700">${net.toFixed(2)}</div>
      </div>
    </div>
  );
}

interface ProgressStep { label: string; done: boolean; active: boolean; }

function SetupProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className={`flex items-center gap-3 text-sm ${s.done ? "text-emerald-400" : s.active ? "text-white" : "text-white/40"}`}>
          {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : s.active ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <div className="h-4 w-4 rounded-full border border-white/20 shrink-0" />}
          {s.label}
        </div>
      ))}
    </div>
  );
}

export default function ClientEmployeesNew() {
  const params = useParams<{ companyId: string }>();
  const companyId = params.companyId;
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [showSsn, setShowSsn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [created, setCreated] = useState<{ id: string; firstName: string; lastName: string; easyteamSynced?: boolean; rollfiSynced?: boolean; loginPassword?: string } | null>(null);

  const { data: companyData } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    queryFn: () => fetch(`/api/companies/${companyId}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!companyId,
  });
  const company = companyData;
  const queryClient = useQueryClient();
  const rollfiEnv = useRollfiEnv();
  const isProduction = rollfiEnv === "production";

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const pickPhoto = (f: File) => {
    if (!["image/jpeg","image/jpg","image/png","image/webp"].includes(f.type)) return;
    if (f.size > 5 * 1024 * 1024) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
      canvas.toBlob(blob => {
        if (blob) { setPhotoFile(new File([blob], f.name, { type: f.type })); setPhotoPreview(canvas.toDataURL(f.type)); }
      }, f.type, 0.9);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const [form, setForm] = useState<FormData>({
    firstName: "", lastName: "", email: "", phone: "",
    position: "", employmentType: "Full Time (30+ Hours per week)", workerType: "W2", startDate: today(),
    department: "", managerId: "", managerName: "",
    payType: "hourly", wageAmount: 18, overtimeEligible: true, paymentMethod: "Direct Deposit", taxExempt: false,
    ssn: "", dateOfBirth: "", homeAddress: "", homeCity: "", homeState: "NJ", homeZip: "",
    w4FilingStatus: "Single", w4MultipleJobs: false, w4Dependents: 0, w4ExtraWithholding: 0,
    stateW4Fields: {},
    bankSetupMethod: "invite", bankName: "", routingNumber: "", accountNumber: "", accountType: "checking",
  });
  const set = (key: keyof FormData, value: string | number | boolean) => setForm((f) => ({ ...f, [key]: value }));

  // Fetch state-specific W-4 fields when employee's home state changes
  const { data: stateW4Data, isLoading: stateW4Loading } = useQuery<StateW4Response>({
    queryKey: ["/api/rollfi/state-w4-fields", form.homeState],
    queryFn: () => fetch(`/api/rollfi/state-w4-fields/${form.homeState}`, { credentials: "include" }).then((r) => r.json()),
    enabled: STATES_WITH_OWN_W4.has(form.homeState),
    staleTime: 10 * 60 * 1000,
  });

  // Auto-initialise stateW4Fields with sensible defaults whenever the loaded fields change
  useEffect(() => {
    if (!stateW4Data?.fields) { setForm((f) => ({ ...f, stateW4Fields: {} })); return; }
    const optionFields = stateW4Data.fields.filter((f) => f.options && f.options.length > 0);
    const isMultiStatus = optionFields.length > 1;
    const defaults: Record<string, string> = {};
    stateW4Data.fields.forEach((field) => {
      if (field.options) {
        // Multi-status states (CT): first filing-status gets its first code, others start empty
        defaults[field.fieldName] = (isMultiStatus && field.fieldName !== optionFields[0]?.fieldName) ? "" : (field.options[0] ?? "");
      } else {
        defaults[field.fieldName] = "0";
      }
    });
    setForm((f) => ({ ...f, stateW4Fields: defaults }));
  }, [stateW4Data]);

  // Department + manager data for Step 1
  const { data: deptData } = useQuery<{ departments: Array<{ id: string; name: string }> }>({
    queryKey: ["dept-wizard", companyId],
    queryFn: () => fetch(`/api/departments?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ departments: Array<{ id: string; name: string }> }>),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const departments = deptData?.departments ?? [];

  const { data: empListData } = useQuery<{ employees: Array<{ id: string; firstName: string; lastName: string; position: string; status: string }> }>({
    queryKey: ["emp-wizard", companyId],
    queryFn: () => fetch(`/api/employees?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ employees: Array<{ id: string; firstName: string; lastName: string; position: string; status: string }> }>),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const activeManagers = (empListData?.employees ?? []).filter(e => e.status === "active");

  const [showCreateDept, setShowCreateDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);

  const handleCreateDept = async () => {
    if (!newDeptName.trim() || creatingDept) return;
    setCreatingDept(true);
    try {
      const r = await fetch("/api/departments", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, name: newDeptName.trim() }),
      });
      const d = await r.json() as { department?: { id: string; name: string } };
      if (r.ok && d.department) {
        set("department", d.department.name);
        setShowCreateDept(false); setNewDeptName("");
        await queryClient.invalidateQueries({ queryKey: ["dept-wizard", companyId] });
      }
    } finally { setCreatingDept(false); }
  };

  const runWithProgress = async () => {
    const labels = [
      "Creating BrightBridge profile…",
      "Registering with Rollfi…",
      "Running identity verification…",
      "Setting up wage information…",
      "Configuring tax withholding…",
      "Setting up direct deposit…",
      "Syncing with EasyTeam…",
    ];
    setProgressSteps(labels.map((label, i) => ({ label, done: false, active: i === 0 })));
    const advance = (idx: number) => { setProgressSteps((prev) => prev.map((s, i) => ({ ...s, done: i < idx, active: i === idx }))); return new Promise((r) => setTimeout(r, 500)); };
    await advance(1);
    const res = await fetch("/api/employees", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, ...form }),
    });
    for (let i = 2; i <= 6; i++) await advance(i);
    const data = await res.json() as typeof created & { error?: string };
    setProgressSteps((prev) => prev.map((s) => ({ ...s, done: true, active: false })));
    if (!res.ok) throw new Error(data?.error ?? "Failed to create employee");
    return data;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await runWithProgress();
      // Best-effort photo upload after employee is created
      if (photoFile && data?.id) {
        const fd = new FormData();
        fd.append("photo", photoFile);
        fetch(`/api/employees/${data.id}/photo`, { method: "POST", credentials: "include", body: fd })
          .catch(() => {});
      }
      setCreated(data);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "An error occurred");
      setSubmitting(false);
    }
  };

  // ── Success screen ───────────────────────────────────────────
  if (created) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="px-8 py-8 text-center border-b">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-gray-900">{created.firstName} {created.lastName} has been added!</h2>
            <p className="text-sm text-gray-500 mt-1">Here's what was set up</p>
          </div>
          <div className="px-8 py-5 space-y-2.5">
            {[
              { done: true, label: "BrightBridge profile created" },
              { done: !!created.rollfiSynced, label: created.rollfiSynced ? "Rollfi payroll account created" : "Rollfi: pending (company may need onboarding first)" },
              { done: true, label: "Identity verification submitted" },
              { done: true, label: `Wage set: $${form.wageAmount.toFixed(2)}/hr` },
              { done: true, label: "W4 tax withholding configured" },
              { done: created.easyteamSynced, label: created.easyteamSynced ? "EasyTeam time clock ready — can clock in immediately!" : "EasyTeam: will sync on first Time Clock use" },
            ].map(({ done, label }) => (
              <div key={label} className={`flex items-center gap-2.5 text-sm ${done ? "text-emerald-700" : "text-amber-600"}`}>
                {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {label}
              </div>
            ))}
          </div>
          <div className="px-8 py-4 bg-amber-50 border-t border-amber-100 space-y-1.5 text-sm text-amber-700">
            <p className="font-semibold">Pending:</p>
            <p>→ KYC verification (1-3 business days)</p>
            {form.bankSetupMethod === "invite" && <p>→ Bank account: Invite sent to {form.email}</p>}
            {created.loginPassword && <p>→ Login created: {form.email} / {created.loginPassword}</p>}
          </div>
          <div className="px-8 py-4 flex gap-3">
            <Button onClick={() => { setCreated(null); setStep(1); setForm((f) => ({ ...f, firstName: "", lastName: "", email: "", phone: "" })); }} variant="outline" className="flex-1">Add Another</Button>
            <Button onClick={() => navigate(`/clients/${companyId}`)} className="flex-1 text-white border-0" style={{ background: ORANGE }}>View All Employees →</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading overlay ──────────────────────────────────────────
  if (submitting) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border px-8 py-10">
          <div className="text-center mb-6">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-[#284362] mb-3" />
            <h2 className="text-lg font-bold text-gray-900">Setting up {form.firstName}…</h2>
            <p className="text-sm text-gray-500">This may take 30-60 seconds</p>
          </div>
          <div className="bg-[#284362] rounded-xl px-5 py-4">
            <SetupProgress steps={progressSteps} />
          </div>
          {submitError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />{submitError}
              <Button size="sm" variant="outline" onClick={() => { setSubmitting(false); setSubmitError(""); }} className="ml-auto">Retry</Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link href={`/clients/${companyId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-2">
          <ChevronLeft className="h-4 w-4" />Back to {company?.name ?? "Client"}
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Add Employee</h1>
        {company && <p className="text-sm text-gray-500 mt-0.5">For: <strong>{company.name}</strong> · Step {step} of 4 — {STEPS[step - 1].label}</p>}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const n = i + 1; const done = n < step; const active = n === step;
          return (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${active ? "text-white" : done ? "text-emerald-700 bg-emerald-100" : "text-gray-400 bg-gray-100"}`}
                style={active ? { background: ORANGE } : {}}>
                {done ? <CheckCircle2 className="h-3 w-3" /> : <span>{n}</span>}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${done ? "bg-emerald-300" : "bg-gray-200"}`} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Basic Information</h2>

            {/* Optional Photo */}
            <div className="flex items-center gap-4 pb-2">
              <div className="relative group cursor-pointer shrink-0" onClick={() => photoInputRef.current?.click()}>
                {photoPreview ? (
                  <img src={photoPreview} className="w-16 h-16 rounded-full object-cover" alt="preview" />
                ) : (
                  <Avatar firstName={form.firstName || "?"} lastName={form.lastName || ""} size="lg" />
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>
              <div>
                <button type="button" onClick={() => photoInputRef.current?.click()}
                  className="text-sm text-[#0EA5C9] hover:underline font-medium">
                  {photoPreview ? "Change photo" : "Add profile photo"}
                </button>
                <p className="text-xs text-gray-400 mt-0.5">Optional · JPG, PNG, or WebP · max 5 MB</p>
                {photoPreview && (
                  <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                    className="text-xs text-red-400 hover:text-red-600 mt-0.5">Remove</button>
                )}
              </div>
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickPhoto(f); }} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>First Name *</Label><Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Jane" /></div>
              <div className="space-y-1.5"><Label>Last Name *</Label><Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Smith" /></div>
              <div className="space-y-1.5">
                <Label>Work Email * <span className="text-[10px] text-gray-400 font-normal">A welcome email will be sent</span></Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@daycare.com" type="email" />
              </div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9731234567" /></div>
              <div className="col-span-2 space-y-1.5">
                <Label>Job Title / Position *</Label>
                <div className="flex gap-2 flex-wrap mb-1">
                  {POSITION_SUGGESTIONS.map((p) => (
                    <button key={p} type="button" onClick={() => set("position", p)} className={`px-2 py-0.5 rounded text-xs border transition-colors ${form.position === p ? "border-[#284362] bg-[#284362]/5 text-[#284362] font-medium" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>{p}</button>
                  ))}
                </div>
                <Input value={form.position} onChange={(e) => set("position", e.target.value)} placeholder="Or type a custom position" />
              </div>
              <div className="space-y-1.5">
                <Label>Employment Type</Label>
                <Select value={form.employmentType} onValueChange={(v) => set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Full Time (30+ Hours per week)","Part Time (20-29 Hours per week)","Part Time (0-19 Hours per week)","Seasonal (0-6 months per year)","Variable (Hours vary every week)"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Start Date *</Label>
                <Input value={form.startDate} onChange={(e) => set("startDate", e.target.value)} type="date" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Worker Type *</Label>
              <div className="flex gap-4">
                {[{ value: "W2", label: "W2 Employee (default)" }, { value: "1099-NEC", label: "1099 Contractor" }].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="wt" value={value} checked={form.workerType === value} onChange={() => set("workerType", value)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <Label>Department *</Label>
              <Select
                value={form.department || ""}
                onValueChange={v => {
                  if (v === "__create__") setShowCreateDept(true);
                  else { set("department", v); setShowCreateDept(false); }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select department…" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                  <SelectItem value="__create__">+ Create new department</SelectItem>
                </SelectContent>
              </Select>
              {showCreateDept && (
                <div className="flex gap-2 mt-1">
                  <Input
                    value={newDeptName}
                    onChange={e => setNewDeptName(e.target.value)}
                    placeholder="New department name…"
                    className="flex-1"
                    onKeyDown={e => { if (e.key === "Enter") void handleCreateDept(); }}
                  />
                  <Button size="sm" disabled={creatingDept || !newDeptName.trim()} onClick={() => void handleCreateDept()}
                    className="text-white text-xs shrink-0" style={{ background: ORANGE }}>
                    {creatingDept ? "Creating…" : "Create"}
                  </Button>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setShowCreateDept(false); setNewDeptName(""); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Manager */}
            <div className="space-y-1.5">
              <Label>Manager / Supervisor <span className="text-[10px] text-gray-400 font-normal">Optional</span></Label>
              <Select
                value={form.managerId || "__none__"}
                onValueChange={v => {
                  if (v === "__none__") { set("managerId", ""); set("managerName", ""); }
                  else {
                    const emp = activeManagers.find(e => e.id === v);
                    if (emp) { set("managerId", emp.id); set("managerName", `${emp.firstName} ${emp.lastName}`); }
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select manager (optional)…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {activeManagers.length === 0
                    ? <SelectItem value="__no_mgr__" disabled>No active employees yet</SelectItem>
                    : activeManagers.map(e => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.firstName} {e.lastName}{e.position ? ` · ${e.position}` : ""}
                        </SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">Who does this person report to? Used for approvals and org chart.</p>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Pay Details</h2>
            <div className="space-y-2">
              <Label>Pay Type *</Label>
              {[
                { value: "hourly", label: "Hourly" },
                { value: "salary_weekly", label: "Salary (per week)" },
                { value: "salary_monthly", label: "Salary (per month)" },
                { value: "salary_yearly", label: "Salary (per year)" },
                { value: "commission", label: "Commission" },
              ].map(({ value, label }) => (
                <label key={value} className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-sm ${form.payType === value ? "border-[#284362] bg-[#284362]/5 font-medium" : "border-gray-200"}`}>
                  <input type="radio" name="pt" value={value} checked={form.payType === value} onChange={() => set("payType", value)} />
                  {label}
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{form.payType === "hourly" ? "Hourly Rate" : form.payType === "salary_weekly" ? "Weekly Salary" : form.payType === "salary_monthly" ? "Monthly Salary" : "Annual Salary"} ($ USD) *</Label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">$</span>
                <Input value={form.wageAmount} onChange={(e) => set("wageAmount", parseFloat(e.target.value) || 0)} type="number" step="0.01" min="0" placeholder="18.00" className="max-w-[140px]" />
                {form.payType === "hourly" && <span className="text-gray-400 text-sm">/hr</span>}
              </div>
            </div>
            {form.payType === "hourly" && <PayPreview wage={form.wageAmount} />}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Overtime Eligible</Label>
                <div className="flex gap-4 pt-1">
                  {[{ v: true, l: "Yes (default)" }, { v: false, l: "No" }].map(({ v, l }) => (
                    <label key={l} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="ot" checked={form.overtimeEligible === v} onChange={() => set("overtimeEligible", v)} />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <div className="flex gap-4 pt-1">
                  {["Direct Deposit","Check"].map((m) => (
                    <label key={m} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="pm" value={m} checked={form.paymentMethod === m} onChange={() => set("paymentMethod", m)} />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Personal Information (KYC)</h2>
            <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 rounded-xl border border-blue-200 text-sm text-blue-800">
              <Lock className="h-4 w-4 shrink-0 mt-0.5" />Required for Rollfi identity verification (KYC) and accurate tax withholding. All sensitive data is encrypted.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>SSN *</Label>
                <div className="relative">
                  <Input value={form.ssn} onChange={(e) => set("ssn", e.target.value)} placeholder="XXX-XX-XXXX" type={showSsn ? "text" : "password"} className="pr-9" />
                  <button type="button" onClick={() => setShowSsn(!showSsn)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    {showSsn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Date of Birth *</Label><Input value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} type="date" /></div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Personal Address</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5"><Label>Street Address *</Label><Input value={form.homeAddress} onChange={(e) => set("homeAddress", e.target.value)} placeholder="123 Oak Street" /></div>
                <div className="space-y-1.5"><Label>City *</Label><Input value={form.homeCity} onChange={(e) => set("homeCity", e.target.value)} placeholder="Newark" /></div>
                <div className="space-y-1.5">
                  <Label>State *</Label>
                  <Select value={form.homeState} onValueChange={(v) => set("homeState", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="max-h-60 overflow-y-auto">{US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                  {NO_INCOME_TAX_STATES.has(form.homeState)
                    ? <p className="text-xs text-gray-400 mt-1">No state income tax — federal W-4 only</p>
                    : !STATES_WITH_OWN_W4.has(form.homeState)
                    ? <p className="text-xs text-gray-400 mt-1">{form.homeState} uses federal W-4 — no separate state form</p>
                    : null
                  }
                </div>
                <div className="space-y-1.5"><Label>Zip Code *</Label><Input value={form.homeZip} onChange={(e) => set("homeZip", e.target.value)} placeholder="07101" maxLength={5} /></div>
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Federal W-4 Withholding</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>Filing Status</Label>
                  <div className="flex gap-4">
                    {["Single","Married","Head of Household"].map((s) => (
                      <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer"><input type="radio" name="w4fs" value={s} checked={form.w4FilingStatus === s} onChange={() => set("w4FilingStatus", s)} />{s}</label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5"><Label>Dependents Amount ($)</Label><Input value={form.w4Dependents} onChange={(e) => set("w4Dependents", Number(e.target.value))} type="number" min="0" step="0.01" placeholder="0.00" /></div>
                <div className="space-y-1.5"><Label>Extra Withholding ($)</Label><Input value={form.w4ExtraWithholding} onChange={(e) => set("w4ExtraWithholding", Number(e.target.value))} type="number" min="0" step="0.01" placeholder="0.00" /></div>
              </div>
            </div>

            {/* Dynamic state W-4 section — only for states that issue their own certificate */}
            {STATES_WITH_OWN_W4.has(form.homeState) && (
              stateW4Loading ? (
                <div className="border-t pt-4 flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading {form.homeState} state W-4 fields…
                </div>
              ) : stateW4Data?.fields?.length ? (
                <StateW4FormSection
                  stateCode={form.homeState}
                  fields={stateW4Data.fields}
                  values={form.stateW4Fields}
                  onChange={(updated) => setForm((f) => ({ ...f, stateW4Fields: updated }))}
                />
              ) : null
            )}

          </div>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <div className="px-8 py-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900">Bank Account Setup</h2>
            <div className="space-y-3">
              {[
                { value: "invite" as const, label: "Send invite to employee (Recommended — More Secure)", desc: `We will send ${form.email || "[employee email]"} a secure link to enter their own bank details directly.` },
                { value: "manual" as const, label: "Enter bank details now", desc: "Enter the employee's bank account information manually." },
              ].map(({ value, label, desc }) => (
                <label key={value} className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${form.bankSetupMethod === value ? "border-[#284362] bg-[#284362]/5" : "border-gray-200"}`}>
                  <input type="radio" name="bank" value={value} checked={form.bankSetupMethod === value} onChange={() => set("bankSetupMethod", value)} className="mt-0.5" />
                  <div>
                    <div className="font-medium text-sm">{label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {form.bankSetupMethod === "manual" && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex justify-end">
                  {!isProduction && (
                    <Button type="button" size="sm" variant="outline" className="text-xs gap-1" onClick={() => setForm((f) => ({ ...f, bankName: "Chase Bank", routingNumber: "122238242", accountNumber: "9889890989", accountType: "checking" }))}>
                      Use Test Bank Details (Sandbox)
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Bank Name *</Label><Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="Chase Bank" /></div>
                  <div className="space-y-1.5"><Label>Routing Number * (9 digits)</Label><Input value={form.routingNumber} onChange={(e) => set("routingNumber", e.target.value)} placeholder="122238242" maxLength={9} /></div>
                  <div className="space-y-1.5"><Label>Account Number *</Label><Input value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="9889890989" /></div>
                  <div className="space-y-1.5">
                    <Label>Account Type</Label>
                    <div className="flex gap-4 pt-1">
                      {["checking","savings"].map((t) => <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer capitalize"><input type="radio" name="at" value={t} checked={form.accountType === t} onChange={() => set("accountType", t)} />{t}</label>)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Review summary */}
            <div className="bg-gray-50 rounded-xl border px-4 py-4 space-y-2 text-sm">
              <p className="font-bold text-gray-800 mb-3">Review and Confirm</p>
              {[
                { label: "Employee", value: `${form.firstName} ${form.lastName}` },
                { label: "Position", value: form.position },
                { label: "Start Date", value: form.startDate },
                { label: "Pay", value: `$${form.wageAmount.toFixed(2)}/hr (${form.workerType}, ${form.employmentType.split(" ")[0]} ${form.employmentType.split(" ")[1]})` },
                { label: "Payment", value: form.paymentMethod },
                { label: "Bank", value: form.bankSetupMethod === "invite" ? "Invite to be sent" : form.bankName ? `${form.bankName} ****${form.accountNumber.slice(-4)}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-gray-500 shrink-0">{label}</span>
                  <span className="font-medium text-right">{value || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="px-8 py-4 border-t bg-gray-50/40 flex items-center justify-between">
          <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : navigate(`/clients/${companyId}`)} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" />{step > 1 ? "Back" : "Cancel"}
          </Button>
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} className="gap-1.5 text-white border-0" style={{ background: ORANGE }}
              disabled={(step === 1 && (!form.firstName || !form.lastName || !form.email || !form.position)) || (step === 2 && form.wageAmount <= 0)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} className="gap-1.5 text-white border-0 min-w-[140px]" style={{ background: ORANGE }}>
              Add Employee <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
