/**
 * Bank Account Setup — standalone page accessible from Company Settings
 * Route: /bank-account-setup  (owner + super_admin)
 *
 * Presents Plaid (recommended) or Manual bank linking for the owner's company.
 * Sandbox: shows info card only — Plaid is production-only.
 * Production: full Plaid + Manual flows with status polling.
 */
import React, { useState, useEffect, useRef } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";
import {
  Landmark, ChevronLeft, CheckCircle2, AlertTriangle, Loader2,
  ExternalLink, Mail, RefreshCw, ArrowRight, DollarSign, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ORANGE = "#E8622A";
const NAVY = "#284362";
const PLAID_GREEN = "#009974";
const HOURS_72_MS = 72 * 60 * 60 * 1000;
const MAX_POLL_COUNT = 60; // 5 min at 5 s intervals

type PlaidStep = "idle" | "loading" | "waiting" | "emailSent" | "success" | "timeout" | "error";

interface BankStatus {
  verified: boolean;
  status: string | null;
  last4: string | null;
  bankName: string | null;
  accountType: string | null;
}

interface CompanyDetail {
  bankLinkMethod?: string | null;
  bankLinkGeneratedAt?: string | null;
}

export default function BankAccountSetupPage() {
  const { user } = useAuth();
  const rollfiEnv = useRollfiEnv();
  const isProduction = rollfiEnv === "production";
  const queryClient = useQueryClient();

  // FIX 1 — accept companyId from the route (/clients/:companyId/bank-account),
  // from a ?companyId= query param, or fall back to the logged-in user's company.
  const routeParams = useParams<{ companyId?: string }>();
  const queryParams = new URLSearchParams(window.location.search);
  const companyId = routeParams?.companyId ?? queryParams.get("companyId") ?? user?.companyId ?? "";
  const fromClientRoute = !!routeParams?.companyId;

  // ── Method choice ──────────────────────────────────────────────────────
  const [method, setMethod] = useState<"Plaid" | "Manual" | null>(null);

  // ── Plaid state ────────────────────────────────────────────────────────
  const [plaidStep, setPlaidStep] = useState<PlaidStep>("idle");
  const [plaidError, setPlaidError] = useState("");
  const [emailOverride, setEmailOverride] = useState("");
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Micro-deposit verification state ──────────────────────────────────
  const [mdAmt1, setMdAmt1] = useState("");
  const [mdAmt2, setMdAmt2] = useState("");
  const [mdErr1, setMdErr1] = useState("");
  const [mdErr2, setMdErr2] = useState("");
  const [mdState, setMdState] = useState<"idle" | "submitting" | "success" | "error" | "exhausted">("idle");
  const [mdError, setMdError] = useState("");

  // ── Manual state ───────────────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({
    bankName: "", routingNumber: "", accountNumber: "", accountType: "checking", accountName: "",
  });
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualSuccess, setManualSuccess] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────
  const { data: bankStatus, refetch: refetchBankStatus } = useQuery<BankStatus>({
    queryKey: ["bank-status", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/rollfi/onboard/bank-status?companyId=${companyId}`, { credentials: "include" });
      return r.json() as Promise<BankStatus>;
    },
    enabled: !!companyId,
  });

  const { data: companyData } = useQuery<CompanyDetail>({
    queryKey: ["company-detail", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/companies/${companyId}`, { credentials: "include" });
      return r.json() as Promise<CompanyDetail>;
    },
    enabled: !!companyId,
  });

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────
  const linkExpired = companyData?.bankLinkGeneratedAt
    ? Date.now() - new Date(companyData.bankLinkGeneratedAt).getTime() > HOURS_72_MS
    : false;

  const hadPlaidLink = companyData?.bankLinkMethod === "Plaid" && !!companyData?.bankLinkGeneratedAt;

  const startPolling = () => {
    pollCountRef.current = 0;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      pollCountRef.current++;
      void fetch(`/api/rollfi/onboard/bank-status?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<BankStatus>)
        .then(data => {
          void queryClient.setQueryData(["bank-status", companyId], data);
          if (data.verified) {
            clearInterval(pollTimerRef.current!);
            setPlaidStep("success");
          } else if (pollCountRef.current >= MAX_POLL_COUNT) {
            clearInterval(pollTimerRef.current!);
            setPlaidStep("timeout");
          }
        })
        .catch(() => { /* non-fatal — keep polling */ });
    }, 5000);
  };

  // ── Micro-deposit helpers ──────────────────────────────────────────────
  const validateMdAmount = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "Required";
    const val = parseFloat(trimmed);
    if (isNaN(val) || !isFinite(val)) return "Enter a number (e.g. 0.12)";
    if (val <= 0) return "Must be greater than $0.00";
    if (val >= 1.00) return "Must be less than $1.00";
    if (!/^\d*\.\d{1,2}$/.test(trimmed)) return "Up to two decimal places only (e.g. 0.12)";
    return "";
  };

  const handleVerifyDeposits = async () => {
    const e1 = validateMdAmount(mdAmt1);
    const e2 = validateMdAmount(mdAmt2);
    setMdErr1(e1);
    setMdErr2(e2);
    if (e1 || e2) return;
    setMdState("submitting");
    setMdError("");
    try {
      const r = await fetch("/api/rollfi/onboard/verify-bank", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Amounts are sent as numbers; the server validates range and logs them separately.
        body: JSON.stringify({ companyId, debitAmount1: parseFloat(mdAmt1), debitAmount2: parseFloat(mdAmt2) }),
      });
      const data = await r.json() as { success?: boolean; currentStatus?: string; error?: string; verifyResponse?: Record<string, unknown> };
      if (!r.ok) {
        const msg = data.error ?? "Verification failed";
        const isExhausted = /exhaust|limit|no.more.attempt|too.many/i.test(msg);
        setMdState(isExhausted ? "exhausted" : "error");
        setMdError(msg);
        return;
      }
      if (data.success) {
        setMdState("success");
        void queryClient.invalidateQueries({ queryKey: ["bank-status", companyId] });
        void refetchBankStatus();
      } else {
        // 200 but success:false — Rollfi rejected the amounts or they're still pending
        const body = data.verifyResponse ?? {};
        const raw = JSON.stringify(body);
        const isExhausted = /exhaust|limit|no.more.attempt|too.many/i.test(raw);
        const msg = data.error ?? (body.message as string | undefined) ?? raw;
        setMdState(isExhausted ? "exhausted" : "error");
        setMdError(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      const isExhausted = /exhaust|limit|no.more.attempt|too.many/i.test(msg);
      setMdState(isExhausted ? "exhausted" : "error");
      setMdError(msg);
    }
  };

  const handlePlaidConnect = async (subOption: "generateURL" | "sendInviteByEmail") => {
    setPlaidStep("loading");
    setPlaidError("");
    try {
      const body: Record<string, string> = { companyId, linkType: "Plaid", plaidOptions: subOption };
      if (subOption === "sendInviteByEmail" && emailOverride.trim()) body.email = emailOverride.trim();
      const r = await fetch("/api/rollfi/onboard/bank-account", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { plaidLinkURL?: string; sentTo?: string | null; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to initiate Plaid link");
      void queryClient.invalidateQueries({ queryKey: ["company-detail", companyId] });
      if (subOption === "generateURL") {
        // Backend returns 502 when URL is missing, but guard here too so the
        // UI never silently stays in "loading" if an unexpected 200 arrives.
        if (!data.plaidLinkURL) {
          throw new Error("Rollfi returned success but no Plaid link URL was included in the response. Try 'Send invite by email' instead.");
        }
        window.open(data.plaidLinkURL, "_blank", "noopener,noreferrer");
        setPlaidStep("waiting");
        startPolling();
      } else if (subOption === "sendInviteByEmail") {
        setEmailSentTo((data.sentTo ?? emailOverride.trim()) || null);
        setPlaidStep("emailSent");
        startPolling();
      }
    } catch (e) {
      setPlaidError(e instanceof Error ? e.message : "Failed to initiate Plaid");
      setPlaidStep("error");
    }
  };

  const handleManualSubmit = async () => {
    setManualSubmitting(true);
    setManualError("");
    try {
      const r = await fetch("/api/rollfi/onboard/bank-account", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, linkType: "Manual", ...manualForm }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to link bank account");
      setManualSuccess(true);
      void queryClient.invalidateQueries({ queryKey: ["bank-status", companyId] });
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setManualSubmitting(false);
    }
  };

  const resetPlaid = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setPlaidStep("idle");
    setPlaidError("");
  };

  if (!companyId) {
    return <div className="p-8 text-center text-gray-500">Company not found — make sure you are logged in.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href={fromClientRoute ? `/clients/${companyId}` : "/company-settings"}>
          <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronLeft className="h-5 w-5" />
          </button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bank Account</h1>
          <p className="text-sm text-gray-500">Link the account Rollfi uses to fund payroll and collect taxes</p>
        </div>
      </div>

      {/* ── Current status card ─────────────────────────────────────────── */}
      {bankStatus && (
        <div className={`rounded-xl border px-5 py-4 flex items-start gap-3 ${bankStatus.verified ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
          {bankStatus.verified
            ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            : <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />}
          <div>
            {bankStatus.verified ? (
              <>
                {/* FIX 2/3: green card unchanged except support-text replaces false "replace" promise */}
                <p className="text-sm font-semibold text-emerald-800">Bank account connected</p>
                <p className="text-sm text-emerald-700 mt-0.5">
                  {[bankStatus.bankName, bankStatus.last4 ? `···· ${bankStatus.last4}` : null, bankStatus.accountType].filter(Boolean).join(" · ")}
                  {bankStatus.status ? <span className="ml-1 capitalize">— {bankStatus.status}</span> : null}
                </p>
                {/* FIX 3: removed false "replace below" promise; no deactivate flow exists */}
                <p className="text-xs text-gray-500 mt-1">Need to change this account? Changing your payroll funding account isn't available in the app yet — please contact support so it can be updated safely.</p>
              </>
            ) : (
              <>
                {/* FIX 2: honest amber card for accounts that exist but aren't yet verified */}
                <p className="text-sm font-semibold text-amber-800">Bank account pending verification</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  {[bankStatus.bankName, bankStatus.last4 ? `···· ${bankStatus.last4}` : null, bankStatus.accountType].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm text-amber-700 mt-1">We've sent two small test deposits to this account. Enter the amounts below to finish setup. Payroll cannot be funded until this is complete.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Micro-deposit verification card ─────────────────────────────── */}
      {/* Show only when: status is pending AND bank was linked manually (not Plaid) */}
      {bankStatus && !bankStatus.verified &&
        (bankStatus.status?.toLowerCase() === "microdeposit pending" || bankStatus.status?.toLowerCase() === "pending") &&
        companyData?.bankLinkMethod !== "Plaid" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div className="px-5 py-4 border-b border-blue-200 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-blue-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-blue-900">Verify your bank account</p>
              <p className="text-xs text-blue-700 mt-0.5">Rollfi sent two small deposits to confirm you own this account</p>
            </div>
          </div>

          <div className="px-5 py-5 space-y-4">
            {mdState !== "success" && mdState !== "exhausted" && (
              <p className="text-sm text-blue-800">
                Check your bank statement for two deposits under $1.00 (usually $0.01–$0.99). They arrive within{" "}
                <strong>1–3 business days</strong>. Enter the exact amounts below — the order doesn't matter.
              </p>
            )}

            {/* Success */}
            {mdState === "success" && (
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">Bank account verified!</p>
                  {bankStatus.bankName && (
                    <p className="text-sm text-emerald-700 mt-0.5">
                      {bankStatus.bankName}{bankStatus.last4 ? ` ···· ${bankStatus.last4}` : ""}
                      {bankStatus.accountType ? ` · ${bankStatus.accountType}` : ""} is now active.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Exhausted — no retry */}
            {mdState === "exhausted" && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1.5">
                <p className="text-sm font-semibold text-red-800">Verification attempts exhausted</p>
                <p className="text-sm text-red-700">{mdError}</p>
                <p className="text-xs text-red-600 mt-1">Contact Rollfi support to reset the micro-deposit verification for this account, or link a new bank account.</p>
              </div>
            )}

            {/* Error — wrong amounts, retry allowed */}
            {mdState === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm font-semibold text-red-800">Amounts didn't match</p>
                <p className="text-sm text-red-700">{mdError}</p>
                <Button size="sm" variant="outline" onClick={() => { setMdState("idle"); setMdError(""); setMdAmt1(""); setMdAmt2(""); setMdErr1(""); setMdErr2(""); }}>
                  Try again
                </Button>
              </div>
            )}

            {/* Amount form — idle or submitting */}
            {(mdState === "idle" || mdState === "submitting") && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-blue-900">First deposit amount ($)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 0.12"
                      value={mdAmt1}
                      onChange={(e) => { setMdAmt1(e.target.value); if (mdErr1) setMdErr1(validateMdAmount(e.target.value)); }}
                      onBlur={() => setMdErr1(validateMdAmount(mdAmt1))}
                      className={`${mdErr1 ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                      disabled={mdState === "submitting"}
                    />
                    {mdErr1 && <p className="text-xs text-red-600">{mdErr1}</p>}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-blue-900">Second deposit amount ($)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 0.37"
                      value={mdAmt2}
                      onChange={(e) => { setMdAmt2(e.target.value); if (mdErr2) setMdErr2(validateMdAmount(e.target.value)); }}
                      onBlur={() => setMdErr2(validateMdAmount(mdAmt2))}
                      className={`${mdErr2 ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                      disabled={mdState === "submitting"}
                    />
                    {mdErr2 && <p className="text-xs text-red-600">{mdErr2}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => { void handleVerifyDeposits(); }}
                    disabled={mdState === "submitting"}
                    className="gap-1.5 text-white border-0"
                    style={{ background: NAVY }}
                  >
                    {mdState === "submitting"
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Verifying…</>
                      : <><ShieldCheck className="h-4 w-4" />Verify deposits</>}
                  </Button>
                  <button
                    className="text-xs text-blue-600 hover:underline underline-offset-2"
                    onClick={() => void refetchBankStatus()}
                  >
                    Deposits not arrived yet? Check status
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sandbox note ─────────────────────────────────────────────────── */}
      {!isProduction && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <Landmark className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Sandbox mode — test bank auto-configured</p>
            <p className="text-sm text-blue-700 mt-1">Plaid bank linking is production-only. In sandbox, BrightBridge automatically submits a test bank account (BrightBridge Test Bank, routing 221982389) when the company is first onboarded.</p>
          </div>
        </div>
      )}

      {/* ── Production: method choice ──────────────────────────────────── */}
      {/* FIX 4: hide method choice whenever an account already exists (status present).
          When bankStatus is absent or has null status (no account on file) this renders
          exactly as before — first-time linking is completely unaffected. */}
      {isProduction && !method && !bankStatus?.status && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">Choose how to link your bank account:</p>

          {/* Plaid */}
          <button
            onClick={() => setMethod("Plaid")}
            className="w-full text-left border-2 border-gray-200 rounded-xl p-5 hover:border-[#284362] hover:bg-[#284362]/5 transition-all group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: PLAID_GREEN }}>
                  <Landmark className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">Connect instantly with Plaid</p>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide">Recommended</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">Log in to your bank securely. Verified in seconds — no waiting for test deposits.</p>
                  {hadPlaidLink && !linkExpired && (
                    <p className="text-xs text-amber-600 mt-1">A Plaid link was generated previously — you can regenerate it here.</p>
                  )}
                  {hadPlaidLink && linkExpired && (
                    <p className="text-xs text-red-600 mt-1">Your previous Plaid link has expired — generate a new one.</p>
                  )}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-[#284362] shrink-0 mt-1 transition-colors" />
            </div>
          </button>

          {/* Manual */}
          <button
            onClick={() => setMethod("Manual")}
            className="w-full text-left border-2 border-gray-200 rounded-xl p-5 hover:border-[#284362] hover:bg-[#284362]/5 transition-all group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: NAVY }}>
                  <Landmark className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Enter bank details manually</p>
                  <p className="text-sm text-gray-500 mt-0.5">Routing number, account number, and holder name. Requires two small test deposits to verify (1–3 business days).</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-[#284362] shrink-0 mt-1 transition-colors" />
            </div>
          </button>
        </div>
      )}

      {/* ── Plaid flow ────────────────────────────────────────────────────── */}
      {/* FIX 4: also hide when an account already exists */}
      {isProduction && method === "Plaid" && !bankStatus?.status && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => { setMethod(null); resetPlaid(); }} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-bold text-gray-900">Connect with Plaid</p>
          </div>

          {plaidStep === "idle" && (
            <div className="space-y-4">
              {hadPlaidLink && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${linkExpired ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                  {linkExpired
                    ? "⚠ Your previous Plaid link has expired. Generate a new one below."
                    : "ℹ A Plaid link was generated previously. You can regenerate it or send a fresh email invite."}
                </div>
              )}

              {/* Connect now */}
              <div className="rounded-xl border border-gray-200 p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" style={{ color: PLAID_GREEN }} />
                  {hadPlaidLink && !linkExpired ? "Re-open Plaid" : "Connect now"}
                </p>
                <p className="text-sm text-gray-500">A secure Plaid window opens in a new tab. Log in to your bank and authorise the connection. Returns here automatically once complete.</p>
                <Button
                  onClick={() => { void handlePlaidConnect("generateURL"); }}
                  className="w-full gap-2 text-white border-0"
                  style={{ background: PLAID_GREEN }}
                >
                  <ExternalLink className="h-4 w-4" />
                  {hadPlaidLink ? "Regenerate Plaid link" : "Open Plaid"}
                </Button>
              </div>

              {/* Email invite */}
              <div className="rounded-xl border border-gray-200 p-5 space-y-3">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#284362]" />Email the link instead
                </p>
                <p className="text-sm text-gray-500">Rollfi emails a one-time Plaid link to the payroll admin. You can override the destination below.</p>
                <Input
                  type="email"
                  placeholder="Override destination email (optional)"
                  value={emailOverride}
                  onChange={(e) => setEmailOverride(e.target.value)}
                  className="text-sm"
                />
                <Button variant="outline" onClick={() => { void handlePlaidConnect("sendInviteByEmail"); }} className="w-full gap-2">
                  <Mail className="h-4 w-4" />Send invite
                </Button>
              </div>

              <button
                className="text-sm text-gray-400 hover:text-gray-600 hover:underline underline-offset-2"
                onClick={() => setMethod("Manual")}
              >
                Switch to manual entry instead
              </button>
            </div>
          )}

          {plaidStep === "loading" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: NAVY }} />
              <p className="text-sm text-gray-600">Setting up Plaid link…</p>
            </div>
          )}

          {plaidStep === "waiting" && (
            <div className="rounded-xl border border-[#284362]/20 bg-[#284362]/5 p-6 space-y-4 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto" style={{ color: NAVY }} />
              <p className="text-sm font-semibold text-gray-800">Complete the connection in the Plaid window, then return here.</p>
              <p className="text-xs text-gray-500">Checking every 5 seconds — this page updates automatically once verified.</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => { void handlePlaidConnect("generateURL"); }}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Reopen Plaid
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setMethod("Manual"); resetPlaid(); }}>
                  Switch to manual
                </Button>
              </div>
            </div>
          )}

          {plaidStep === "emailSent" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 space-y-3 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-semibold text-emerald-800">
                Invitation sent{emailSentTo ? ` to ${emailSentTo}` : " to the payroll admin"} — the link expires in about 72 hours.
              </p>
              <p className="text-xs text-emerald-600">This page checks every 5 seconds and updates automatically once the connection is complete.</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => { void handlePlaidConnect("sendInviteByEmail"); }}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Resend
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setMethod("Manual"); resetPlaid(); }}>
                  Switch to manual
                </Button>
              </div>
            </div>
          )}

          {plaidStep === "timeout" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-amber-800">Connection not yet confirmed — Plaid may still be in progress.</p>
              <p className="text-xs text-amber-600">If you completed the Plaid flow, click "Check again" to re-poll.</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => {
                  pollCountRef.current = 0;
                  setPlaidStep("waiting");
                  startPolling();
                  void refetchBankStatus();
                }}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Check again
                </Button>
                <Button variant="outline" size="sm" onClick={() => { resetPlaid(); }}>
                  Try again
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setMethod("Manual"); resetPlaid(); }}>
                  Switch to manual
                </Button>
              </div>
            </div>
          )}

          {plaidStep === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-3">
              <p className="text-sm font-semibold text-red-800">Could not start Plaid link</p>
              <p className="text-xs font-mono text-red-700">{plaidError}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPlaidStep("idle")}>Try again</Button>
                <Button variant="outline" size="sm" onClick={() => { setMethod("Manual"); resetPlaid(); }}>Switch to manual</Button>
              </div>
            </div>
          )}

          {plaidStep === "success" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 space-y-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <p className="text-base font-bold text-emerald-800">Bank account connected via Plaid!</p>
              {bankStatus && (
                <p className="text-sm text-emerald-700">
                  {[bankStatus.bankName, bankStatus.last4 ? `···· ${bankStatus.last4}` : null, bankStatus.accountType].filter(Boolean).join(" · ")}
                  {bankStatus.status ? <span className="ml-1 capitalize">— {bankStatus.status}</span> : null}
                </p>
              )}
              <Link href="/company-settings">
                <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: NAVY }}>
                  Back to Settings
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Manual flow ───────────────────────────────────────────────────── */}
      {/* FIX 4: also hide when an account already exists */}
      {isProduction && method === "Manual" && !bankStatus?.status && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => { setMethod(null); setManualError(""); setManualSuccess(false); }} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-bold text-gray-900">Manual bank entry</p>
          </div>

          {manualSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 space-y-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <p className="text-base font-bold text-emerald-800">Bank details submitted</p>
              <p className="text-sm text-emerald-700">Rollfi will send two small test deposits to verify the account. This typically takes 1–3 business days. Once received, enter the amounts under <strong>Settings → Verify Bank Deposits</strong> to activate payroll.</p>
              <Link href="/company-settings">
                <Button size="sm" className="gap-1.5 text-white border-0" style={{ background: NAVY }}>
                  Back to Settings
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                <p className="font-semibold text-amber-800">Micro-deposit verification required</p>
                <p className="text-amber-700 mt-0.5">After submitting, Rollfi sends two small test deposits ($0.01–$0.99) to your account. You'll enter the exact amounts here to activate payroll — this takes 1–3 business days.</p>
              </div>

              {manualError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{manualError}
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Bank Name *</Label>
                  <Input value={manualForm.bankName} onChange={(e) => setManualForm(f => ({ ...f, bankName: e.target.value }))} placeholder="e.g. Chase Bank" />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Holder Name *</Label>
                  <Input value={manualForm.accountName} onChange={(e) => setManualForm(f => ({ ...f, accountName: e.target.value }))} placeholder="e.g. ABC Daycare LLC" />
                </div>
                <div className="space-y-1.5">
                  <Label>Routing Number * (9 digits)</Label>
                  <Input value={manualForm.routingNumber} onChange={(e) => setManualForm(f => ({ ...f, routingNumber: e.target.value.replace(/\D/g, "").slice(0, 9) }))} placeholder="021000021" maxLength={9} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Number * (4–17 digits)</Label>
                  <Input value={manualForm.accountNumber} onChange={(e) => setManualForm(f => ({ ...f, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 17) }))} placeholder="Your business checking account number" />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Type *</Label>
                  <div className="flex gap-3">
                    {(["checking", "savings"] as const).map((t) => (
                      <label key={t} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer text-sm ${manualForm.accountType === t ? "border-[#284362] bg-[#284362]/5 font-medium" : "border-gray-200"}`}>
                        <input type="radio" name="bankAcctType" value={t} checked={manualForm.accountType === t} onChange={() => setManualForm(f => ({ ...f, accountType: t }))} className="sr-only" />
                        <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${manualForm.accountType === t ? "border-[#284362]" : "border-gray-300"}`}>
                          {manualForm.accountType === t && <span className="h-2 w-2 rounded-full bg-[#284362]" />}
                        </span>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => setMethod(null)}>Back</Button>
                <Button
                  onClick={() => { void handleManualSubmit(); }}
                  disabled={manualSubmitting}
                  className="gap-1.5 text-white border-0"
                  style={{ background: ORANGE }}
                >
                  {manualSubmitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</>
                    : <><Landmark className="h-4 w-4" />Submit Bank Details</>}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
