import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";
import {
  Building2, MapPin, User, FileText, Calendar, CheckCircle2,
  AlertTriangle, ChevronRight, ChevronLeft, Loader2, Eye, EyeOff, RefreshCw,
  Globe, Plus, Trash2, Landmark, KeyRound, UserPlus, Copy, X, ExternalLink, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ORANGE = "#E8622A";
const NAVY = "#284362";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const US_STATES_FULL = [
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
const today = () => new Date().toISOString().split("T")[0];
const daysOut = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
const payDateOffsetDays: Record<string, number> = { Weekly: 7, BiWeekly: 14, SemiMonthly: 15, Monthly: 30 };
function randomTestEin() { return `${String(Math.floor(10 + Math.random()*89))}-${String(Math.floor(1000000 + Math.random()*9000000))}`; }

// ── N2: Pay-date helpers ──────────────────────────────────────────────────────
/** Last Mon–Fri on or before the given ISO date (e.g. period-end Saturday → Friday). */
function prevBankingDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
/** True when the given ISO date falls on a Mon–Fri banking day. */
function isBankingDay(dateStr: string): boolean {
  const day = new Date(dateStr + "T12:00:00").getDay();
  return day >= 1 && day <= 5;
}
/** Default pay date: last banking day at or before n days from today. */
const bankingPayDate = (n: number) => prevBankingDay(daysOut(n));

interface FormData {
  // Step 1
  companyName: string; doingBusinessAs: string; businessWebsite: string; phone: string;
  industry: string; package: string;
  // Step 2
  address1: string; address2: string; city: string; state: string; zipcode: string; locationName: string;
  // Step 3
  ownerFirstName: string; ownerLastName: string; ownerEmail: string; ownerPhone: string;
  ownerDob: string; ownerSsn: string; ownerAddress1: string; ownerCity: string; ownerState: string; ownerZip: string;
  ownershipPercentage: number; isPayrollAdmin: boolean;
  // Step 4
  entityType: string; ein: string; incorporationState: string; dateOfIncorporation: string; irsFilingForm: string; payrollRunThisYear: string;
  // Step 5
  payFrequency: string; payBeginDate: string; payDate: string; workerType: string;
  // Step 6 — funding bank account (production only; sandbox uses test values automatically)
  fundingBankName: string; fundingRoutingNumber: string; fundingAccountNumber: string; fundingAccountType: string; fundingAccountName: string;
  bankSetupMethod: "Manual" | "Plaid";
}

interface StateTaxEntry {
  stateCode: string;
  stateName: string;
  fieldValues: Record<string, string>;
}

const STEPS = [
  { label: "Business Info",      icon: Building2 },
  { label: "Location",           icon: MapPin },
  { label: "Owner Details",      icon: User },
  { label: "Verification",       icon: FileText },
  { label: "Pay Schedule",       icon: Calendar },
  { label: "Bank Account",       icon: Landmark },
  { label: "State Taxes",        icon: Globe },
];

interface ProgressStep {
  label: string;
  done: boolean;
  active: boolean;
}

function SetupProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="space-y-2 py-2">
      {steps.map((s, i) => (
        <div key={i} className={`flex items-center gap-3 text-sm ${s.done ? "text-emerald-400" : s.active ? "text-white" : "text-white/40"}`}>
          {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : s.active ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <div className="h-4 w-4 rounded-full border border-white/20 shrink-0" />}
          {s.label}
        </div>
      ))}
    </div>
  );
}

export default function ClientsNew() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [showSsn, setShowSsn] = useState(false);
  const [ownerSsnAttempted, setOwnerSsnAttempted] = useState(false);
  const [payDateError, setPayDateError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; rollfiCompanyId?: string | null; rollfi?: { error?: string; rollfiCompanyId?: string }; stateRegistrations?: number } | null>(null);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);

  // Manager login creation (shown on success screen)
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginForm, setLoginForm] = useState({ name: "", email: "", password: "" });
  const [loginCreating, setLoginCreating] = useState(false);
  const [loginCreated, setLoginCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [loginError, setLoginError] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showProdConfirm, setShowProdConfirm] = useState(false);
  const rollfiEnv = useRollfiEnv();
  const isProduction = rollfiEnv === "production";

  // FIX 6 — pre-populate the owner login form as soon as the company is created
  // so the panel is never blank on first open.
  useEffect(() => {
    if (created && !loginCreated && !loginForm.name) {
      const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefghjkmnpqrstwxyz0123456789!@#$";
      const pwd = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      setLoginForm({
        name: `${form.ownerFirstName} ${form.ownerLastName}`.trim(),
        email: form.ownerEmail,
        password: pwd,
      });
    }
  }, [created]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyField = (val: string, field: string) => {
    void navigator.clipboard.writeText(val);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreateLogin = async (companyId: string) => {
    if (!loginForm.name || !loginForm.email || !loginForm.password) {
      setLoginError("Name, email, and password are all required");
      return;
    }
    setLoginCreating(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth/create-manager", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginForm.name, email: loginForm.email, companyId, position: "Daycare Manager", password: loginForm.password }),
      });
      const data = await res.json() as { name?: string; email?: string; password?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create login");
      setLoginCreated({ name: data.name ?? loginForm.name, email: data.email ?? loginForm.email, password: data.password ?? loginForm.password });
      setShowLoginForm(false);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Failed to create login");
    } finally {
      setLoginCreating(false);
    }
  };

  // Step 6 — state tax entries
  const [stateTaxEntries, setStateTaxEntries] = useState<StateTaxEntry[]>([]);
  const [stateFormCode, setStateFormCode] = useState("");
  const [stateFormFields, setStateFormFields] = useState<Record<string, { isMandatory: boolean }>>({});
  const [stateFormFieldValues, setStateFormFieldValues] = useState<Record<string, string>>({});
  const [stateFormFieldsLoading, setStateFormFieldsLoading] = useState(false);
  const [stateFormFieldsError, setStateFormFieldsError] = useState("");

  useEffect(() => {
    if (!stateFormCode) { setStateFormFields({}); setStateFormFieldValues({}); setStateFormFieldsError(""); return; }
    setStateFormFieldsLoading(true); setStateFormFieldsError("");
    fetch(`/api/rollfi/state-fields/${stateFormCode}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { companyStateRegistrationFieldList?: Record<string, string>; fieldDescription?: Record<string, { isMandatory: boolean }>; error?: string }) => {
        if (d.error) { setStateFormFieldsError(d.error); return; }
        const fieldList = d.companyStateRegistrationFieldList ?? {};
        const desc = d.fieldDescription ?? {};
        const fields: Record<string, { isMandatory: boolean }> = {};
        const vals: Record<string, string> = {};
        for (const key of Object.keys(fieldList)) {
          fields[key] = { isMandatory: desc[key]?.isMandatory ?? false };
          vals[key] = "";
        }
        setStateFormFields(fields);
        setStateFormFieldValues(vals);
      })
      .catch(() => setStateFormFieldsError("Failed to load state fields"))
      .finally(() => setStateFormFieldsLoading(false));
  }, [stateFormCode]);

  const addStateTaxEntry = () => {
    if (!stateFormCode || Object.keys(stateFormFields).length === 0) return;
    const name = US_STATES_FULL.find((s) => s.code === stateFormCode)?.name ?? stateFormCode;
    setStateTaxEntries((prev) => [...prev, { stateCode: stateFormCode, stateName: name, fieldValues: stateFormFieldValues }]);
    setStateFormCode(""); setStateFormFields({}); setStateFormFieldValues({});
  };
  const removeStateTaxEntry = (idx: number) => setStateTaxEntries((prev) => prev.filter((_, i) => i !== idx));

  const [form, setForm] = useState<FormData>({
    companyName: "", doingBusinessAs: "", businessWebsite: "", phone: "", industry: "daycare", package: "full_daycare",
    address1: "", address2: "", city: "", state: "", zipcode: "", locationName: "",
    ownerFirstName: "", ownerLastName: "", ownerEmail: "", ownerPhone: "",
    ownerDob: "", ownerSsn: "", ownerAddress1: "", ownerCity: "", ownerState: "", ownerZip: "",
    ownershipPercentage: 100, isPayrollAdmin: true,
    entityType: "LLC", ein: "", incorporationState: "", dateOfIncorporation: "", irsFilingForm: "941", payrollRunThisYear: "No",
    payFrequency: "BiWeekly", payBeginDate: today(), payDate: bankingPayDate(14), workerType: "W2",
    fundingBankName: "", fundingRoutingNumber: "", fundingAccountNumber: "", fundingAccountType: "checking", fundingAccountName: "",
    bankSetupMethod: "Manual" as "Manual" | "Plaid",
  });

  const set = (key: keyof FormData, value: string | number | boolean) => setForm((f) => ({ ...f, [key]: value }));

  // ── Plaid bank-link wizard (used on success screen when bankSetupMethod === "Plaid") ──
  const plaidWizardPollCountRef = useRef(0);
  const plaidWizardTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [plaidWizardStep, setPlaidWizardStep] = useState<"idle" | "loading" | "waiting" | "emailSent" | "success" | "timeout" | "error">("idle");
  const [plaidWizardEmailOverride, setPlaidWizardEmailOverride] = useState("");
  const [plaidWizardEmailSentTo, setPlaidWizardEmailSentTo] = useState<string | null>(null);
  const [plaidWizardError, setPlaidWizardError] = useState("");

  const runWithProgress = async () => {
    const labels = [
      "Creating BrightBridge account…",
      "Registering with Rollfi…",
      "Submitting business verification…",
      "Setting up bank account…",
      "Creating pay schedule…",
      "Registering state taxes…",
      "Finalizing setup…",
    ];
    setProgressSteps(labels.map((label, i) => ({ label, done: false, active: i === 0 })));

    const advance = (idx: number) => {
      setProgressSteps((prev) => prev.map((s, i) => ({ ...s, done: i < idx, active: i === idx })));
      return new Promise((r) => setTimeout(r, 500));
    };

    await advance(1);
    const res = await fetch("/api/companies", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, stateTaxRegistrations: stateTaxEntries }),
    });
    await advance(2); await advance(3); await advance(4); await advance(5); await advance(6);
    const data = await res.json() as { id: string; name: string; rollfiCompanyId?: string | null; rollfi?: { error?: string; rollfiCompanyId?: string }; stateRegistrations?: number; error?: string };
    setProgressSteps((prev) => prev.map((s) => ({ ...s, done: true, active: false })));
    if (!res.ok) throw new Error(data.error ?? "Failed to create client");
    return data;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await runWithProgress();
      setCreated(data);
      setShowLoginForm(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "An error occurred";
      // Keep the overlay open so the error is visible — the Retry button handles dismissal
      setSubmitError(msg);
    }
  };

  // Cleanup Plaid wizard polling on unmount
  useEffect(() => {
    return () => { if (plaidWizardTimerRef.current) clearInterval(plaidWizardTimerRef.current); };
  }, []);

  const startPlaidWizardPoll = (companyId: string) => {
    plaidWizardPollCountRef.current = 0;
    if (plaidWizardTimerRef.current) clearInterval(plaidWizardTimerRef.current);
    plaidWizardTimerRef.current = setInterval(() => {
      plaidWizardPollCountRef.current++;
      void fetch(`/api/rollfi/onboard/bank-status?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<{ verified: boolean }>)
        .then(data => {
          if (data.verified) {
            clearInterval(plaidWizardTimerRef.current!);
            setPlaidWizardStep("success");
          } else if (plaidWizardPollCountRef.current >= 60) {
            clearInterval(plaidWizardTimerRef.current!);
            setPlaidWizardStep("timeout");
          }
        })
        .catch(() => { /* non-fatal — keep polling */ });
    }, 5000);
  };

  const handlePlaidWizardConnect = async (companyId: string, subOption: "generateURL" | "sendInviteByEmail") => {
    setPlaidWizardStep("loading");
    setPlaidWizardError("");
    try {
      const body: Record<string, string> = { companyId, linkType: "Plaid", plaidOptions: subOption };
      if (subOption === "sendInviteByEmail" && plaidWizardEmailOverride.trim()) body.email = plaidWizardEmailOverride.trim();
      const r = await fetch("/api/rollfi/onboard/bank-account", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { plaidLinkURL?: string; sentTo?: string | null; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to initiate Plaid link");
      if (subOption === "generateURL") {
        // Backend returns 502 when URL is missing, but guard here too so the
        // UI never silently stays in "loading" if an unexpected 200 arrives.
        if (!data.plaidLinkURL) {
          throw new Error("Rollfi returned success but no Plaid link URL was included in the response. Try 'Send invite by email' instead.");
        }
        window.open(data.plaidLinkURL, "_blank", "noopener,noreferrer");
        setPlaidWizardStep("waiting");
        startPlaidWizardPoll(companyId);
      } else if (subOption === "sendInviteByEmail") {
        setPlaidWizardEmailSentTo((data.sentTo ?? plaidWizardEmailOverride.trim()) || null);
        setPlaidWizardStep("emailSent");
        startPlaidWizardPoll(companyId);
      }
    } catch (e) {
      setPlaidWizardError(e instanceof Error ? e.message : "Failed to initiate Plaid");
      setPlaidWizardStep("error");
    }
  };

  // ── Success screen ───────────────────────────────────────────
  if (created) {
    // hasRollfi is true only when a real Rollfi company ID was assigned.
    // created.rollfi?.error covers createBusiness failures;
    // !rollfiCompanyId covers the credentials-not-configured path where rollfi:{} is returned with no error and no ID.
    const hasRollfi = !!(created.rollfiCompanyId ?? created.rollfi?.rollfiCompanyId);
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="px-8 py-8 text-center border-b">
            <div className={`w-16 h-16 ${hasRollfi ? "bg-emerald-100" : "bg-amber-100"} rounded-full flex items-center justify-center mx-auto mb-4`}>
              {hasRollfi
                ? <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                : <AlertTriangle className="h-8 w-8 text-amber-600" />}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{created.name} has been added!</h2>
            <p className="text-gray-500 mt-1">Here's what was set up automatically</p>
          </div>

          {/* Rollfi registration failure banner */}
          {!hasRollfi && (
            <div className="px-8 pt-6">
              <div className="flex items-start gap-3 bg-orange-50 border border-orange-300 rounded-xl px-4 py-3.5">
                <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-orange-800">Rollfi registration incomplete — payroll is not active</p>
                  <p className="text-sm text-orange-700 mt-0.5">
                    The company was saved, but registration with Rollfi failed:{" "}
                    <span className="font-mono text-xs bg-orange-100 px-1 py-0.5 rounded">{created.rollfi?.error ?? "credentials not configured"}</span>
                  </p>
                  <p className="text-xs text-orange-600 mt-1.5">
                    Go to the client's <strong>Settings tab → Register with Rollfi</strong> to complete payroll setup before adding employees.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="px-8 py-6 space-y-3">
            {[
              { done: true, label: "BrightBridge account created" },
              { done: hasRollfi, label: hasRollfi ? "Rollfi payroll account created" : `Rollfi: ${created.rollfi?.error ?? "pending"}` },
              { done: hasRollfi, label: "Business verification submitted" },
              { done: hasRollfi, label: `Pay schedule configured (${form.payFrequency})` },
              { done: (created.stateRegistrations ?? 0) > 0, label: (created.stateRegistrations ?? 0) > 0 ? `${created.stateRegistrations} state tax registration${(created.stateRegistrations ?? 0) > 1 ? "s" : ""} submitted` : "State tax registrations pending" },
              { done: form.package === "full_daycare", label: "EasyTeam time clock ready" },
            ].map(({ done, label }) => (
              <div key={label} className={`flex items-center gap-3 text-sm ${done ? "text-emerald-700" : "text-amber-600"}`}>
                {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {label}
              </div>
            ))}
          </div>

          {/* ── Plaid bank connection panel (shown when Plaid was selected) ── */}
          {hasRollfi && isProduction && form.bankSetupMethod === "Plaid" && (
            <div className="px-8 py-5 border-t space-y-4">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Landmark className="h-4 w-4" style={{ color: "#009974" }} />Connect Bank Account via Plaid
              </p>

              {plaidWizardStep === "idle" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <ExternalLink className="h-4 w-4" style={{ color: "#009974" }} />Connect now
                    </p>
                    <p className="text-xs text-gray-500">Opens a secure Plaid window in a new tab — log in to your bank and authorise.</p>
                    <Button size="sm" onClick={() => { void handlePlaidWizardConnect(created.id, "generateURL"); }} className="w-full gap-1.5 text-white border-0" style={{ background: "#009974" }}>
                      <ExternalLink className="h-3.5 w-3.5" />Open Plaid
                    </Button>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <Mail className="h-4 w-4 text-[#284362]" />Email the link to the owner
                    </p>
                    <Input type="email" placeholder={`Override destination (default: ${form.ownerEmail})`} value={plaidWizardEmailOverride} onChange={(e) => setPlaidWizardEmailOverride(e.target.value)} className="text-sm h-8" />
                    <Button size="sm" variant="outline" onClick={() => { void handlePlaidWizardConnect(created.id, "sendInviteByEmail"); }} className="w-full gap-1.5">
                      <Mail className="h-3.5 w-3.5" />Send invite
                    </Button>
                  </div>
                </div>
              )}

              {plaidWizardStep === "loading" && (
                <div className="flex items-center gap-2 py-4 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin text-[#284362]" />Setting up Plaid link…
                </div>
              )}

              {plaidWizardStep === "waiting" && (
                <div className="rounded-xl border border-[#284362]/20 bg-[#284362]/5 p-4 space-y-3 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-[#284362] mx-auto" />
                  <p className="text-sm font-semibold text-gray-800">Complete the connection in the Plaid window, then return here.</p>
                  <p className="text-xs text-gray-500">Checking every 5 seconds…</p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" variant="outline" onClick={() => { void handlePlaidWizardConnect(created.id, "generateURL"); }}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />Reopen Plaid
                    </Button>
                  </div>
                </div>
              )}

              {plaidWizardStep === "emailSent" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 text-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto" />
                  <p className="text-sm font-semibold text-emerald-800">
                    Invitation sent{plaidWizardEmailSentTo ? ` to ${plaidWizardEmailSentTo}` : ` to ${form.ownerEmail}`} — link expires in ~72 hours.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => { void handlePlaidWizardConnect(created.id, "sendInviteByEmail"); }}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />Resend
                  </Button>
                </div>
              )}

              {plaidWizardStep === "success" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center space-y-1.5">
                  <CheckCircle2 className="h-7 w-7 text-emerald-500 mx-auto" />
                  <p className="text-sm font-bold text-emerald-800">Bank connected via Plaid!</p>
                  <p className="text-xs text-emerald-600">Verified and ready for payroll.</p>
                </div>
              )}

              {(plaidWizardStep === "timeout" || plaidWizardStep === "error") && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-amber-800">{plaidWizardStep === "timeout" ? "Connection not yet confirmed." : "Could not start Plaid link."}</p>
                  {plaidWizardStep === "error" && <p className="text-xs text-amber-700 font-mono">{plaidWizardError}</p>}
                  <Button size="sm" variant="outline" onClick={() => setPlaidWizardStep("idle")}>Try again</Button>
                </div>
              )}
            </div>
          )}

          <div className="px-8 py-5 border-t bg-amber-50 space-y-3">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Action required to run payroll:</p>
            <div className="space-y-2 text-sm text-amber-700">
              {form.bankSetupMethod === "Plaid" && isProduction
                ? <div className="flex items-start gap-2"><span className="mt-0.5">□</span><span>Connect company bank account via Plaid (use the panel above)</span></div>
                : <div className="flex items-start gap-2"><span className="mt-0.5">□</span><span>Connect company bank account for payroll funding</span></div>}
              <div className="flex items-start gap-2"><span className="mt-0.5">□</span><span>KYB verification under review — takes 1-3 business days</span></div>
              <div className="flex items-start gap-2"><span className="mt-0.5">□</span><span>Add employees so payroll can be processed</span></div>
            </div>
          </div>

          {/* Owner login creation — required next step */}
          <div className="px-8 py-5 border-t space-y-4 bg-[#284362]/5 border-l-4 border-l-[#284362]">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#284362]" />
              <p className="text-sm font-bold text-[#284362]">Next Step: Create Owner Login</p>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#284362] text-white uppercase tracking-wide">Required</span>
            </div>
            <p className="text-xs text-gray-600">The owner needs a login to access the company dashboard, add employees, and manage payroll.</p>

            {loginCreated ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                  <CheckCircle2 className="h-4 w-4" />Owner login created successfully
                </div>
                {[
                  { label: "Name", val: loginCreated.name, field: "name" },
                  { label: "Email", val: loginCreated.email, field: "email" },
                  { label: "Password", val: loginCreated.password, field: "pw" },
                ].map(({ label, val, field }) => (
                  <div key={field} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-800">{field === "pw" ? (showLoginPw ? val : "••••••••") : val}</span>
                      {field === "pw" && (
                        <button onClick={() => setShowLoginPw((p) => !p)} className="text-gray-400 hover:text-gray-600">
                          {showLoginPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <button onClick={() => copyField(val, field)} className="text-gray-400 hover:text-[#284362]">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {copiedField === field && <span className="text-[10px] text-emerald-600">Copied!</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : showLoginForm ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                {loginError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />{loginError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Full Name</Label>
                    <Input value={loginForm.name} onChange={(e) => setLoginForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" placeholder="Jane Smith" autoComplete="off" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Email (login)</Label>
                    <Input value={loginForm.email} onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))} className="h-8 text-sm" type="email" placeholder="jane@daycare.com" autoComplete="off" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs text-gray-500">Temporary Password <span className="font-normal text-gray-400">(auto-generated — copy before sharing)</span></Label>
                    <div className="relative">
                      <Input type={showLoginPw ? "text" : "password"} value={loginForm.password} readOnly className="h-8 text-sm pr-16 font-mono bg-gray-50 cursor-default" autoComplete="off" />
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        <button type="button" onClick={() => setShowLoginPw((p) => !p)} className="p-1 text-gray-400 hover:text-gray-700">
                          {showLoginPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" onClick={() => copyField(loginForm.password, "new-pw")} className="p-1 text-gray-400 hover:text-[#284362]" title="Copy password">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {copiedField === "new-pw" && <span className="text-[10px] text-emerald-600 whitespace-nowrap">Copied!</span>}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setShowLoginForm(false); setLoginError(""); }}>
                    <X className="h-3.5 w-3.5 mr-1" />Cancel
                  </Button>
                  <Button size="sm" onClick={() => { void handleCreateLogin(created.id); }} disabled={loginCreating} className="gap-1.5 text-white border-0" style={{ background: NAVY }}>
                    {loginCreating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</> : <><KeyRound className="h-3.5 w-3.5" />Create Login</>}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                className="gap-1.5 text-white border-0"
                style={{ background: NAVY }}
                onClick={() => {
                  const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefghjkmnpqrstwxyz0123456789!@#$";
                  const pwd = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
                  setLoginForm({
                    name: `${form.ownerFirstName} ${form.ownerLastName}`.trim(),
                    email: form.ownerEmail,
                    password: pwd,
                  });
                  setShowLoginPw(false);
                  setShowLoginForm(true);
                }}
              >
                <UserPlus className="h-3.5 w-3.5" />Create Owner Login
              </Button>
            )}
          </div>

          <div className="px-8 py-4 border-t flex gap-3">
            <Button onClick={() => navigate(`/clients/${created.id}/employees/new`)} className="flex-1 text-white border-0" style={{ background: ORANGE }}>
              Add First Employee →
            </Button>
            <Button onClick={() => navigate(`/clients/${created.id}`)} variant="outline" className="flex-1">
              Go to Client Dashboard →
            </Button>
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
            <h2 className="text-lg font-bold text-gray-900">Setting up {form.companyName}…</h2>
            <p className="text-sm text-gray-500">This may take 30-60 seconds</p>
          </div>
          <div className="bg-[#284362] rounded-xl px-5 py-4">
            <SetupProgress steps={progressSteps} />
          </div>
          {submitError && (
            <div className="mt-4 space-y-2">
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-3 border border-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1">
                  {submitError.toLowerCase().includes("unauthorized") || submitError === "Unauthorized"
                    ? "Your session expired. Please log in again and then retry."
                    : submitError}
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setSubmitting(false); setSubmitError(""); }} className="flex-1">
                  ← Back to form
                </Button>
                {(submitError.toLowerCase().includes("unauthorized") || submitError === "Unauthorized") && (
                  <Button size="sm" className="flex-1 text-white border-0" style={{ background: NAVY }}
                    onClick={() => navigate("/login")}>
                    Log in again
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Wizard form ──────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => step > 1 ? setStep(step - 1) : navigate("/clients")} className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-3">
          <ChevronLeft className="h-4 w-4" />{step > 1 ? "Back" : "Back to Clients"}
        </button>
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Add New Client</h1>
        <p className="text-sm text-gray-500 mt-0.5">Step {step} of {STEPS.length} — {STEPS[step - 1].label}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${active ? "text-white" : done ? "text-emerald-700 bg-emerald-100" : "text-gray-400 bg-gray-100"}`}
                style={active ? { background: ORANGE } : {}}>
                {done ? <CheckCircle2 className="h-3 w-3" /> : <span>{n}</span>}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${done ? "bg-emerald-300" : "bg-gray-200"}`} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Form card */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Business Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Company Name *</Label>
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Sunshine Daycare Centre" />
              </div>
              <div className="space-y-1.5">
                <Label>Doing Business As</Label>
                <Input value={form.doingBusinessAs} onChange={(e) => set("doingBusinessAs", e.target.value)} placeholder="Same as company name" />
              </div>
              <div className="space-y-1.5">
                <Label>Business Website</Label>
                <Input value={form.businessWebsite} onChange={(e) => set("businessWebsite", e.target.value)} placeholder="www.example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number *</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9731234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Industry</Label>
                <Select value={form.industry} onValueChange={(v) => set("industry", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daycare">Daycare Centre</SelectItem>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="medical">Medical</SelectItem>
                    <SelectItem value="construction">Construction</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Service Package *</Label>
              {[
                { value: "full_daycare", label: "Full Daycare", desc: "Includes EasyTeam time tracking, daycare management, and full payroll", recommended: true },
                { value: "payroll_hr_workforce", label: "Payroll + HR + Workforce", desc: "Payroll processing plus HR and workforce management features" },
                { value: "payroll_only", label: "Payroll Only", desc: "Basic payroll processing" },
              ].map(({ value, label, desc, recommended }) => (
                <label key={value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${form.package === value ? "border-[#284362] bg-[#284362]/5" : "border-gray-200 hover:border-gray-300"}`}>
                  <input type="radio" name="package" value={value} checked={form.package === value} onChange={() => set("package", value)} className="mt-0.5" />
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm">{label} {recommended && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">RECOMMENDED</span>}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {form.package === "full_daycare" && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                Includes EasyTeam time tracking, daycare management features, and full payroll processing
              </div>
            )}
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Company Location</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Location Name</Label>
                <Input value={form.locationName} onChange={(e) => set("locationName", e.target.value)} placeholder="Main Street Location" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Address Line 1 *</Label>
                <Input value={form.address1} onChange={(e) => set("address1", e.target.value)} placeholder="123 Main Street" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Address Line 2</Label>
                <Input value={form.address2} onChange={(e) => set("address2", e.target.value)} placeholder="Suite 100 (optional)" />
              </div>
              <div className="space-y-1.5">
                <Label>City *</Label>
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Newark" />
              </div>
              <div className="space-y-1.5">
                <Label>State *</Label>
                <Select value={form.state} onValueChange={(v) => set("state", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">{US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Zip Code *</Label>
                <Input value={form.zipcode} onChange={(e) => set("zipcode", e.target.value)} placeholder="07101" maxLength={5} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Use this address as:</Label>
              {["Work location", "Mailing address", "Filing address"].map((label) => (
                <label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Business Owner Details</h2>
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 rounded-xl border border-amber-200 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div><strong>Beneficial Owner Required</strong> — This must be the actual business owner with 25%+ equity or a C-level executive. Required by law for KYB verification.</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>First Name *</Label>
                <Input value={form.ownerFirstName} onChange={(e) => set("ownerFirstName", e.target.value)} placeholder="Jane" />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name *</Label>
                <Input value={form.ownerLastName} onChange={(e) => set("ownerLastName", e.target.value)} placeholder="Smith" />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} placeholder="jane@daycare.com" type="email" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} placeholder="9731234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Birth *</Label>
                <Input value={form.ownerDob} onChange={(e) => set("ownerDob", e.target.value)} placeholder="MM/DD/YYYY" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label>SSN * <span className="text-[10px] text-gray-400 font-normal">Encrypted — KYB only</span></Label>
                <div className="relative">
                  <Input
                    value={form.ownerSsn}
                    onChange={(e) => { set("ownerSsn", e.target.value); if (ownerSsnAttempted) setOwnerSsnAttempted(false); }}
                    onBlur={() => { if (form.ownerSsn && form.ownerSsn.replace(/\D/g, "").length !== 9) setOwnerSsnAttempted(true); }}
                    placeholder="XXX-XX-XXXX"
                    type={showSsn ? "text" : "password"}
                    autoComplete="off"
                    data-1p-ignore
                    className={`pr-9 ${ownerSsnAttempted && form.ownerSsn.replace(/\D/g, "").length !== 9 ? "border-red-500 focus-visible:ring-red-400" : ""}`}
                  />
                  <button type="button" onClick={() => setShowSsn(!showSsn)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                    {showSsn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {ownerSsnAttempted && form.ownerSsn.replace(/\D/g, "").length !== 9 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />{form.ownerSsn.replace(/\D/g, "").length === 0 ? "SSN is required" : "SSN must be exactly 9 digits"}
                  </p>
                )}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Home Address *</Label>
                <Input value={form.ownerAddress1} onChange={(e) => set("ownerAddress1", e.target.value)} placeholder="123 Oak Street" />
              </div>
              <div className="space-y-1.5">
                <Label>City *</Label>
                <Input value={form.ownerCity} onChange={(e) => set("ownerCity", e.target.value)} placeholder="Newark" />
              </div>
              <div className="space-y-1.5">
                <Label>State *</Label>
                <Select value={form.ownerState} onValueChange={(v) => set("ownerState", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">{US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Zip Code *</Label>
                <Input value={form.ownerZip} onChange={(e) => set("ownerZip", e.target.value)} placeholder="07101" maxLength={5} />
              </div>
              <div className="space-y-1.5">
                <Label>Ownership % (min 25) *</Label>
                <Input value={form.ownershipPercentage} onChange={(e) => set("ownershipPercentage", Number(e.target.value))} type="number" min={25} max={100} />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Business Verification</h2>
            <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 rounded-xl border border-blue-200 text-sm text-blue-800">
              <FileText className="h-4 w-4 shrink-0 mt-0.5" />
              Required for tax compliance. All information must match your IRS records.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Entity Type *</Label>
                <Select value={form.entityType} onValueChange={(v) => set("entityType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["LLC","Corporation","S-Corporation","Sole Proprietor","Partnership","Non-Profit"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>EIN / Tax ID *</Label>
                <div className="flex gap-1.5">
                  <Input value={form.ein} onChange={(e) => set("ein", e.target.value)} placeholder="XX-XXXXXXX" className="flex-1" />
                  {!isProduction && (
                    <Button type="button" size="sm" variant="outline" onClick={() => set("ein", randomTestEin())} className="shrink-0 text-xs gap-1">
                      <RefreshCw className="h-3 w-3" />Test EIN
                    </Button>
                  )}
                </div>
                {!isProduction && <p className="text-[10px] text-gray-400">Sandbox: click Test EIN to auto-fill</p>}
              </div>
              <div className="space-y-1.5">
                <Label>State of Incorporation *</Label>
                <Select value={form.incorporationState} onValueChange={(v) => set("incorporationState", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">{US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date of Incorporation *</Label>
                <Input value={form.dateOfIncorporation} onChange={(e) => set("dateOfIncorporation", e.target.value)} placeholder="MM/DD/YYYY" />
              </div>
              <div className="space-y-1.5">
                <Label>IRS Federal Filing Form</Label>
                <Select value={form.irsFilingForm} onValueChange={(v) => set("irsFilingForm", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="941">941 (most common)</SelectItem>
                    <SelectItem value="944">944</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payroll run this year?</Label>
                <div className="flex gap-3 pt-1">
                  {["Yes","No"].map((v) => (
                    <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="pry" value={v} checked={form.payrollRunThisYear === v} onChange={() => set("payrollRunThisYear", v)} />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 5 ── */}
        {step === 5 && (
          <div className="px-8 py-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Pay Schedule</h2>
            <div className="space-y-2">
              <Label>Pay Frequency *</Label>
              {[
                { value: "Weekly", label: "Weekly" },
                { value: "BiWeekly", label: "BiWeekly (most common)" },
                { value: "SemiMonthly", label: "Semi-Monthly (1st & 15th)" },
                { value: "Monthly", label: "Monthly" },
              ].map(({ value, label }) => (
                <label key={value} className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm ${form.payFrequency === value ? "border-[#284362] bg-[#284362]/5 font-medium" : "border-gray-200"}`}>
                  <input type="radio" name="freq" value={value} checked={form.payFrequency === value} onChange={() => setForm((f) => ({ ...f, payFrequency: value, payBeginDate: today(), payDate: bankingPayDate(payDateOffsetDays[value] ?? 14) }))} />
                  {label} {value === "BiWeekly" && <span className="ml-auto px-1.5 py-0.5 bg-[#284362]/10 text-[#284362] text-[10px] font-bold rounded">DEFAULT</span>}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>First Pay Period Start *</Label>
                <Input value={form.payBeginDate} onChange={(e) => set("payBeginDate", e.target.value)} type="date" />
                <p className="text-[11px] text-gray-400 leading-tight">The first day employees start tracking hours for payroll (usually today or next Monday).</p>
              </div>
              <div className="space-y-1.5">
                <Label>First Pay Date *</Label>
                <Input
                  value={form.payDate}
                  onChange={(e) => { set("payDate", e.target.value); setPayDateError(""); }}
                  type="date"
                  className={payDateError ? "border-red-500 focus-visible:ring-red-400" : ""}
                />
                <p className="text-[11px] text-gray-400 leading-tight">The date employees receive their first paycheck — must be after the pay period ends.</p>
                {payDateError && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{payDateError}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Worker Types</Label>
              <div className="flex gap-4">
                {["W2","1099-NEC","Both"].map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="wtype" value={t} checked={form.workerType === t} onChange={() => set("workerType", t)} />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-[#284362]/5 rounded-xl border border-[#284362]/20 px-4 py-3 space-y-1.5">
              <p className="text-xs font-bold text-[#284362] uppercase tracking-wide flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Pay Schedule Preview</p>
              <p className="text-sm text-gray-700">First pay period starts: <strong>{form.payBeginDate}</strong></p>
              <p className="text-sm text-gray-700">First pay date: <strong>{form.payDate}</strong></p>
              <p className="text-sm text-gray-700">Frequency: <strong>{{ Weekly: "Every week", BiWeekly: "Every 2 weeks", SemiMonthly: "Twice a month", Monthly: "Once a month" }[form.payFrequency] ?? form.payFrequency}</strong></p>
            </div>
          </div>
        )}

        {/* ── Step 6 — Bank Account ── */}
        {step === 6 && (
          <div className="px-8 py-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Bank Account</h2>
              <p className="text-sm text-gray-500 mt-1">
                A bank account is required so Rollfi can fund payroll and collect tax payments on behalf of this company.
              </p>
            </div>

            {!isProduction ? (
              <>
                <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
                  <Landmark className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                  <div>
                    <p className="font-semibold">Sandbox mode — test bank auto-configured</p>
                    <p className="mt-0.5 text-blue-700">In production, you would enter the company's real business checking account details. For sandbox testing, BrightBridge automatically submits a test bank account when the client is created.</p>
                  </div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Landmark className="h-3.5 w-3.5" />Sandbox Test Account (auto-submitted)
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: "Bank Name", value: "BrightBridge Test Bank" },
                      { label: "Routing Number", value: "221982389" },
                      { label: "Account Number", value: "Uses company EIN" },
                      { label: "Account Type", value: "Business Checking" },
                    ].map(({ label, value }) => (
                      <div key={label} className="space-y-0.5">
                        <p className="text-xs text-gray-400">{label}</p>
                        <p className="font-mono font-medium text-gray-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                {/* Method toggle — Plaid (recommended) or Manual */}
                <div className="flex gap-3">
                  {(["Plaid", "Manual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set("bankSetupMethod", m)}
                      className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${form.bankSetupMethod === m ? "border-[#284362] bg-[#284362]/5" : "border-gray-200 hover:border-gray-300"}`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${form.bankSetupMethod === m ? (m === "Plaid" ? "bg-[#009974]" : "bg-[#284362]") : "bg-gray-100"}`}>
                        <Landmark className={`h-4 w-4 ${form.bankSetupMethod === m ? "text-white" : "text-gray-400"}`} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-gray-900 flex items-center gap-1 justify-center">
                          {m === "Plaid" ? "Plaid" : "Manual entry"}
                          {m === "Plaid" && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">Recommended</span>}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{m === "Plaid" ? "Instant — no test deposits" : "Routing & account number"}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {form.bankSetupMethod === "Plaid" ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4 space-y-1.5">
                    <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />Plaid selected
                    </p>
                    <p className="text-sm text-emerald-700">After this company is created, a <strong>Connect Bank</strong> panel will appear where you can open the secure Plaid window or send the owner an invite link by email.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                      <Landmark className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <div>
                        <p className="font-semibold">Enter the company's business bank account</p>
                        <p className="mt-0.5 text-amber-700">This account will be used by Rollfi to fund payroll and collect tax payments on behalf of this company.</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Bank Name *</Label>
                        <Input value={form.fundingBankName} onChange={(e) => set("fundingBankName", e.target.value)} placeholder="e.g. Chase Bank" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Account Holder Name *</Label>
                        <Input value={form.fundingAccountName} onChange={(e) => set("fundingAccountName", e.target.value)} placeholder="e.g. ABC Daycare LLC" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Routing Number * (9 digits)</Label>
                        <Input value={form.fundingRoutingNumber} onChange={(e) => set("fundingRoutingNumber", e.target.value.replace(/\D/g, ""))} placeholder="021000021" maxLength={9} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Account Number * (4–17 digits)</Label>
                        <Input value={form.fundingAccountNumber} onChange={(e) => set("fundingAccountNumber", e.target.value.replace(/\D/g, "").slice(0, 17))} placeholder="Your business checking account number" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Account Type *</Label>
                        <div className="flex gap-3">
                          {(["checking", "savings"] as const).map((t) => (
                            <label key={t} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer text-sm ${form.fundingAccountType === t ? "border-[#284362] bg-[#284362]/5 font-medium" : "border-gray-200"}`}>
                              <input type="radio" name="fundingAccountType" value={t} checked={form.fundingAccountType === t} onChange={() => set("fundingAccountType", t)} className="sr-only" />
                              <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${form.fundingAccountType === t ? "border-[#284362]" : "border-gray-300"}`}>
                                {form.fundingAccountType === t && <span className="h-2 w-2 rounded-full bg-[#284362]" />}
                              </span>
                              {t.charAt(0).toUpperCase() + t.slice(1)}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* N5: micro-deposit warning only in production+Manual — sandbox uses auto-configured test bank */}
            {isProduction && form.bankSetupMethod === "Manual" && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-medium">Micro-deposit verification required</p>
                  <p className="mt-0.5">After creation, Rollfi sends two small test deposits (usually $0.01–$0.99) to verify the account. KYB approval is also required before payroll can run. Both typically take 1–3 business days.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 7 — State Taxes ── */}
        {step === 7 && (
          <div className="px-8 py-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-gray-900">State Tax Registrations</h2>
              <p className="text-sm text-gray-500 mt-1">
                Required by Rollfi to accurately withhold and file state taxes at year-end. Add every state where this company employs workers.
              </p>
            </div>

            {/* Added entries */}
            {stateTaxEntries.length > 0 && (
              <div className="space-y-2">
                {stateTaxEntries.map((entry, idx) => (
                  <div key={idx} className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                    <Globe className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-emerald-900">{entry.stateName} ({entry.stateCode})</p>
                      <div className="text-xs text-emerald-700 mt-0.5 flex flex-wrap gap-x-3">
                        {Object.entries(entry.fieldValues)
                          .filter(([, v]) => v)
                          .slice(0, 3)
                          .map(([k, v]) => <span key={k}>{k}: <span className="font-mono">{v}</span></span>)}
                      </div>
                    </div>
                    <button onClick={() => removeStateTaxEntry(idx)} className="text-emerald-400 hover:text-red-500 transition-colors mt-0.5">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add state form */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Add a State</p>
              <div className="space-y-1.5">
                <Label>State *</Label>
                <Select value={stateFormCode} onValueChange={setStateFormCode}>
                  <SelectTrigger><SelectValue placeholder="Select state…" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {US_STATES_FULL.filter((s) => !stateTaxEntries.some((e) => e.stateCode === s.code)).map((s) => (
                      <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {stateFormCode && stateFormFieldsLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading {stateFormCode} registration fields…
                </div>
              )}
              {stateFormFieldsError && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">{stateFormFieldsError}</div>
              )}

              {!stateFormFieldsLoading && Object.keys(stateFormFields).length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(stateFormFields).map(([fieldName, meta]) => (
                    <div key={fieldName} className="space-y-1.5">
                      <Label>
                        {fieldName}
                        {meta.isMandatory
                          ? <span className="text-red-500 ml-1">*</span>
                          : <span className="text-gray-400 font-normal ml-1">(optional)</span>}
                      </Label>
                      <Input
                        value={stateFormFieldValues[fieldName] ?? ""}
                        onChange={(e) => setStateFormFieldValues((prev) => ({ ...prev, [fieldName]: e.target.value }))}
                        placeholder={fieldName}
                      />
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={addStateTaxEntry}
                disabled={!stateFormCode || stateFormFieldsLoading || Object.keys(stateFormFields).length === 0}
                variant="outline"
                className="gap-1.5 w-full"
              >
                <Plus className="h-4 w-4" /> Add State
              </Button>
            </div>

            {stateTaxEntries.length === 0 && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                At least one state registration is required before creating this client.
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="px-8 py-4 border-t bg-gray-50/40 flex items-center justify-between">
          <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : navigate("/clients")} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" />{step > 1 ? "Back" : "Cancel"}
          </Button>
          {step < STEPS.length ? (
            <Button onClick={() => {
              if (step === 3 && form.ownerSsn.replace(/\D/g, "").length !== 9) {
                setOwnerSsnAttempted(true);
                return;
              }
              if (step === 5) {
                // N2: require a banking day at or after the last banking day of the period
                if (!isBankingDay(form.payDate)) {
                  setPayDateError("Pay date must be a weekday (Mon–Fri)");
                  return;
                }
                const periodEndTs = new Date(form.payBeginDate + "T12:00:00").getTime()
                  + (payDateOffsetDays[form.payFrequency] ?? 14) * 86400000;
                const minPayDate = prevBankingDay(new Date(periodEndTs).toISOString().split("T")[0]);
                if (form.payDate < minPayDate) {
                  setPayDateError(`Pay date must be on or after ${minPayDate} (last banking day of the pay period)`);
                  return;
                }
                setPayDateError("");
              }
              setStep(step + 1);
            }} className="gap-1.5 text-white border-0" style={{ background: ORANGE }}
              disabled={
                (step === 1 && (!form.companyName || !form.phone)) ||
                (step === 2 && (!form.address1 || !form.city || !form.zipcode)) ||
                (step === 3 && (!form.ownerFirstName || !form.ownerLastName || !form.ownerEmail)) ||
                (step === 4 && (!form.entityType))
              }>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={isProduction ? () => setShowProdConfirm(true) : () => { void handleSubmit(); }} className="gap-1.5 text-white border-0 min-w-[140px]" style={{ background: ORANGE }}
              disabled={stateTaxEntries.length === 0}>
              Create Client <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Production-only confirmation before creating a real company */}
      {showProdConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ background: "#FEF2F2" }}>
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <div>
                <p className="font-bold text-red-800">Create Real Company</p>
                <p className="text-xs text-red-600 mt-0.5">PRODUCTION — this creates a live payroll entity</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700">You are about to create a real company record in Rollfi and start KYB verification:</p>
              <div className="bg-gray-50 border rounded-xl px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Legal Name</span>
                  <span className="font-semibold text-gray-900 text-right">{form.companyName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">EIN</span>
                  <span className="font-mono text-gray-900">{form.ein}</span>
                </div>
              </div>
              <p className="text-xs text-red-600 font-medium">This cannot be undone. KYB will begin immediately upon confirmation.</p>
            </div>
            <div className="flex gap-3 px-6 pb-5">
              <Button variant="outline" className="flex-1" autoFocus onClick={() => setShowProdConfirm(false)}>Cancel</Button>
              <Button className="flex-1 text-white border-0" style={{ background: "#DC2626" }}
                onClick={() => { setShowProdConfirm(false); void handleSubmit(); }}>
                Confirm — Create Company
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
