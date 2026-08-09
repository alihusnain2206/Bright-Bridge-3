/**
 * Bank Account Setup — standalone page accessible from Company Settings
 * Route: /bank-account-setup  (owner + super_admin)
 *
 * Presents Plaid (recommended) or Manual bank linking for the owner's company.
 * Sandbox: shows info card only — Plaid is production-only.
 * Production: full Plaid + Manual flows with status polling.
 */
import React, { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";
import {
  Landmark, ChevronLeft, CheckCircle2, AlertTriangle, Loader2,
  ExternalLink, Mail, RefreshCw, ArrowRight,
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

  // For super_admin acting on another company, accept ?companyId= query param
  const params = new URLSearchParams(window.location.search);
  const companyId = params.get("companyId") ?? user?.companyId ?? "";

  // ── Method choice ──────────────────────────────────────────────────────
  const [method, setMethod] = useState<"Plaid" | "Manual" | null>(null);

  // ── Plaid state ────────────────────────────────────────────────────────
  const [plaidStep, setPlaidStep] = useState<PlaidStep>("idle");
  const [plaidError, setPlaidError] = useState("");
  const [emailOverride, setEmailOverride] = useState("");
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (subOption === "generateURL" && data.plaidLinkURL) {
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
        <Link href="/company-settings">
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
                <p className="text-sm font-semibold text-emerald-800">Bank account connected</p>
                <p className="text-sm text-emerald-700 mt-0.5">
                  {[bankStatus.bankName, bankStatus.last4 ? `···· ${bankStatus.last4}` : null, bankStatus.accountType].filter(Boolean).join(" · ")}
                  {bankStatus.status ? <span className="ml-1 capitalize">— {bankStatus.status}</span> : null}
                </p>
                <p className="text-xs text-emerald-600 mt-1">You can replace this account below. Changes take effect for the next payroll run.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-amber-800">No verified bank account</p>
                <p className="text-sm text-amber-700 mt-0.5">Payroll cannot run until a bank account is linked and verified.</p>
              </>
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
      {isProduction && !method && (
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
      {isProduction && method === "Plaid" && (
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
      {isProduction && method === "Manual" && (
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
