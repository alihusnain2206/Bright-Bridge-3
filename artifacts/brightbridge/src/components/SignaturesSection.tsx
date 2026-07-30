/**
 * SignaturesSection — shown under /settings?tab=signatures
 *
 * Form 8655: fully in-app e-sign flow — typed name + title + consent checkbox.
 *            On submit: POST /api/rollfi/companies/:id/sign-8655
 * TR-2000 (and any other tasks from Rollfi): existing "Get signing link" flow.
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature, ExternalLink, CheckCircle, AlertCircle,
  Mail, Loader2, Shield, PenLine, Upload, Clock, Download,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAVY = "#1B3A6B";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingTask {
  task: string;
  description: string;
}

interface SignedFormRecord {
  signerName:   string;
  signerTitle:  string;
  signedAt:     string;
  uploadStatus: string; // "pending" | "uploaded" | "failed"
  uploadError?: string | null;
}

interface PendingSignaturesResp {
  signatures:  PendingTask[];
  signedForms: Record<string, SignedFormRecord>; // formType → record
}

interface SigningLinkResp {
  url: string | null;
  message: string;
  emailSent?: boolean;
}

interface Sign8655Resp {
  id:           string;
  signerName:   string;
  signerTitle:  string;
  signedAt:     string;
  uploadStatus: string;
}

// ── Static form metadata ───────────────────────────────────────────────────────

const FORM_META: Record<string, { title: string; body: string; why: string }> = {
  "TR-2000": {
    title: "Form TR-2000 — New Jersey Tax Authorization",
    body:  "Authorizes your payroll service to file and pay New Jersey state taxes on your behalf.",
    why:   "Required for any company with employees working in New Jersey.",
  },
  "8655": {
    title: "Form 8655 — IRS Reporting Agent Authorization",
    body:  "Authorizes your payroll service to file payroll tax returns and make deposits with the IRS.",
    why:   "Required by the IRS before your payroll service can file 941s and make federal tax payments.",
  },
};

function matchMeta(taskName: string) {
  for (const [key, meta] of Object.entries(FORM_META)) {
    if (taskName.includes(key)) return { key, meta };
  }
  return null;
}

function formatSignedDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch { return iso; }
}

// ── Form 8655 in-app e-sign card ──────────────────────────────────────────────

function Form8655Card({
  companyId,
  signed,
  onSigned,
  onUploadRetried,
}: {
  companyId:       string;
  signed:          SignedFormRecord | null;
  onSigned:        (record: SignedFormRecord) => void;
  onUploadRetried: () => void;
}) {
  const [signerName,  setSignerName]  = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [ackChecked,  setAckChecked]  = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const mutation = useMutation<Sign8655Resp, Error, { signerName: string; signerTitle: string }>({
    mutationFn: async (body) => {
      const res = await fetch(`/api/rollfi/companies/${companyId}/sign-8655`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<Sign8655Resp>;
    },
    onSuccess: (data) => {
      onSigned({ signerName: data.signerName, signerTitle: data.signerTitle, signedAt: data.signedAt, uploadStatus: data.uploadStatus });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const retryMutation = useMutation<{ queued: boolean; message: string }, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/rollfi/companies/${companyId}/retry-8655-upload`, {
        method:      "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ queued: boolean; message: string }>;
    },
    onSuccess: () => {
      onUploadRetried();
    },
  });

  const meta = FORM_META["8655"]!;

  if (signed) {
    const isPending = signed.uploadStatus === "pending";
    const isFailed  = signed.uploadStatus === "failed";
    const isUploaded = signed.uploadStatus === "uploaded";

    // Border / icon colour changes based on upload state
    const cardBorderClass = isFailed
      ? "border-red-100"
      : isPending ? "border-amber-100" : "border-emerald-100";
    const iconBgClass = isFailed
      ? "bg-red-50"
      : isPending ? "bg-amber-50" : "bg-emerald-50";
    const iconColorClass = isFailed
      ? "text-red-500"
      : isPending ? "text-amber-500" : "text-emerald-500";
    const IconEl = isFailed ? AlertCircle : isPending ? Clock : CheckCircle;

    return (
      <div className={cn("rounded-xl border bg-white p-5 shadow-sm", cardBorderClass)}>
        <div className="flex items-start gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", iconBgClass)}>
            <IconEl className={cn("w-4.5 h-4.5", iconColorClass)} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">{meta.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{meta.body}</p>
          </div>
          {/* Status badge */}
          {isUploaded && (
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
              Signed
            </span>
          )}
          {isPending && (
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />Pending upload
            </span>
          )}
          {isFailed && (
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertCircle className="w-2.5 h-2.5" />Upload failed
            </span>
          )}
        </div>

        <div className="mt-3 ml-12 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-xs text-gray-600 space-y-0.5">
          <p><span className="text-gray-400 font-medium">Signed by: </span>{signed.signerName}</p>
          <p><span className="text-gray-400 font-medium">Title: </span>{signed.signerTitle}</p>
          <p><span className="text-gray-400 font-medium">Date: </span>{formatSignedDate(signed.signedAt)}</p>
        </div>

        {/* Pending upload info banner */}
        {isPending && (
          <div className="mt-3 ml-12 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-700 flex items-start gap-1.5">
            <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
            <span>The signed form is waiting to be submitted to the IRS filing service. No action is needed — it will be sent automatically.</span>
          </div>
        )}

        {/* Failed upload: error detail + retry button */}
        {isFailed && (
          <div className="mt-3 ml-12 space-y-2">
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[11px] text-red-700 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
              <span>
                The form could not be submitted to the IRS filing service.
                {signed.uploadError ? ` Reason: ${signed.uploadError}` : ""}
              </span>
            </div>
            {retryMutation.isSuccess ? (
              <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />Upload retry queued successfully.
              </p>
            ) : (
              <Button
                size="sm"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate()}
                className="h-8 px-3 text-xs text-white gap-1.5 bg-red-600 hover:bg-red-700"
              >
                {retryMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                Retry upload
              </Button>
            )}
            {retryMutation.isError && (
              <p className="text-[11px] text-red-600">{retryMutation.error.message}</p>
            )}
          </div>
        )}

        <div className="mt-3 ml-12 flex items-center gap-4">
          <a
            href={`/api/rollfi/companies/${companyId}/form-8655.pdf`}
            download
            className="inline-flex items-center gap-1 text-[11px] text-[#1B3A6B] hover:text-[#0f2447] font-medium underline underline-offset-2"
          >
            <Download className="w-3 h-3" />
            Download PDF
          </a>
          <button
            className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2"
            onClick={() => setShowForm(true)}
          >
            Re-sign with updated information
          </button>
        </div>
        {showForm && (
          <Form8655SignForm
            signerName={signerName}     setSignerName={setSignerName}
            signerTitle={signerTitle}   setSignerTitle={setSignerTitle}
            ackChecked={ackChecked}     setAckChecked={setAckChecked}
            error={error}
            submitting={mutation.isPending}
            onSubmit={() => { setError(null); mutation.mutate({ signerName, signerTitle }); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    );
  }

  // Unsigned state
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FileSignature className="w-4.5 h-4.5 text-amber-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{meta.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{meta.body}</p>
        </div>
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
          Signature required
        </span>
      </div>

      {/* Why box */}
      <div className="mt-3 ml-12 text-[11px] text-gray-500 leading-relaxed border-l-2 border-amber-100 pl-3">
        <span className="font-medium text-gray-600">Why it's needed: </span>{meta.why}
      </div>

      {/* Sign form or trigger button */}
      <div className="mt-4 ml-12">
        {!showForm ? (
          <Button
            size="sm"
            className="h-8 px-4 text-xs text-white gap-1.5"
            style={{ background: NAVY }}
            onClick={() => setShowForm(true)}
          >
            <PenLine className="w-3.5 h-3.5" />
            Sign this form
          </Button>
        ) : (
          <Form8655SignForm
            signerName={signerName}     setSignerName={setSignerName}
            signerTitle={signerTitle}   setSignerTitle={setSignerTitle}
            ackChecked={ackChecked}     setAckChecked={setAckChecked}
            error={error}
            submitting={mutation.isPending}
            onSubmit={() => { setError(null); mutation.mutate({ signerName, signerTitle }); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Shared e-sign form ─────────────────────────────────────────────────────────

function Form8655SignForm({
  signerName, setSignerName,
  signerTitle, setSignerTitle,
  ackChecked, setAckChecked,
  error, submitting,
  onSubmit, onCancel,
}: {
  signerName:    string; setSignerName:    (v: string) => void;
  signerTitle:   string; setSignerTitle:   (v: string) => void;
  ackChecked:    boolean; setAckChecked:   (v: boolean) => void;
  error:         string | null;
  submitting:    boolean;
  onSubmit:      () => void;
  onCancel:      () => void;
}) {
  return (
    <div className="space-y-3.5 border border-gray-200 rounded-xl p-4 bg-gray-50">
      <div className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-[#1B3A6B] shrink-0 mt-0.5" />
        <p className="text-xs text-gray-600 leading-relaxed">
          By signing, you authorize your payroll service to file Form 941, Form 940, and make
          federal tax deposits with the IRS on your behalf. This authorization is effective
          immediately and applies to the current tax year.
        </p>
      </div>

      {/* Signer name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-500">Full name (signer)</label>
        <input
          type="text"
          value={signerName}
          onChange={e => setSignerName(e.target.value)}
          placeholder="Your full legal name"
          className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
        />
      </div>

      {/* Signer title */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-500">Title / role</label>
        <input
          type="text"
          value={signerTitle}
          onChange={e => setSignerTitle(e.target.value)}
          placeholder="e.g. Owner, President, Director"
          className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
        />
      </div>

      {/* Consent checkbox */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={ackChecked}
          onChange={e => setAckChecked(e.target.checked)}
          className="mt-0.5 rounded border-gray-300 accent-[#1B3A6B]"
        />
        <span className="text-xs text-gray-700 leading-relaxed">
          I acknowledge that I am authorized to sign on behalf of this company, and I agree to the
          Reporting Agent Authorization described above.
        </span>
      </label>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!ackChecked || !signerName.trim() || !signerTitle.trim() || submitting}
          onClick={onSubmit}
          className="h-8 px-4 text-xs text-white gap-1.5"
          style={{ background: NAVY }}
        >
          {submitting
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CheckCircle className="w-3.5 h-3.5" />}
          Submit authorization
        </Button>
        <button
          className="text-xs text-gray-400 hover:text-gray-600"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── External-link card (TR-2000 + others) ─────────────────────────────────────

type CardState = "idle" | "loading" | "success" | "email" | "error";

function ExternalLinkCard({ form, companyId }: { form: PendingTask; companyId: string }) {
  const [state,   setState]   = useState<CardState>("idle");
  const [message, setMessage] = useState<string>("");
  const match = matchMeta(form.task);
  const meta  = match?.meta;

  const handleGetLink = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/rollfi/request-signing-link", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ companyId, formTask: form.task }),
      });
      const data: SigningLinkResp = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
        setState("success");
        setMessage("Signing page opened in a new tab.");
      } else {
        setState("email");
        setMessage(data.message || "We'll send the signing link to your registered email address.");
      }
    } catch {
      setState("error");
      setMessage("Something went wrong. Please try again or contact support.");
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FileSignature className="w-4.5 h-4.5 text-amber-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{meta?.title ?? form.task}</p>
          <p className="text-xs text-gray-500 mt-0.5">{meta?.body ?? form.description}</p>
        </div>
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
          Signature required
        </span>
      </div>

      {meta?.why && (
        <div className="mt-3 ml-12 text-[11px] text-gray-500 leading-relaxed border-l-2 border-amber-100 pl-3">
          <span className="font-medium text-gray-600">Why it's needed: </span>{meta.why}
        </div>
      )}

      <div className="mt-4 ml-12">
        {state === "idle" && (
          <Button size="sm" className="h-8 px-4 text-xs bg-[#284362] hover:bg-[#1e3250] text-white" onClick={handleGetLink}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Get signing link
          </Button>
        )}
        {state === "loading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />Fetching your signing link…
          </div>
        )}
        {state === "success" && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" />{message}
          </div>
        )}
        {state === "email" && (
          <div className={cn("rounded-lg p-3 text-xs leading-relaxed", "bg-blue-50 border border-blue-100")}>
            <div className="flex items-start gap-2">
              <Mail className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-blue-800">Check your email</p>
                <p className="text-blue-600 mt-0.5">{message}</p>
              </div>
            </div>
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 text-xs text-red-600">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────────────────────

export function SignaturesSection({ companyId }: { companyId: string }) {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<PendingSignaturesResp>({
    queryKey: ["pending-signatures", companyId],
    queryFn:  () =>
      fetch(`/api/rollfi/pending-signatures?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<PendingSignaturesResp>),
    staleTime: 60_000,
    // Poll every 10 s while Form 8655 is pending upload; stop once it resolves.
    refetchInterval: (query) => {
      const status = query.state.data?.signedForms?.["8655"]?.uploadStatus;
      return status === "pending" ? 10_000 : false;
    },
  });

  const handleSigned = (record: SignedFormRecord) => {
    // Optimistically update the cache so the card flips to signed state immediately.
    // uploadStatus starts as "pending" — the badge will reflect that until the server
    // confirms an upload.
    qc.setQueryData<PendingSignaturesResp>(["pending-signatures", companyId], old => {
      if (!old) return old;
      return { ...old, signedForms: { ...old.signedForms, "8655": record } };
    });
    // Also invalidate dashboard so the progress step and attention items update
    void qc.invalidateQueries({ queryKey: ["company-dashboard"] });
  };

  const handleUploadRetried = () => {
    // Refetch so the badge reflects the new "pending" state from the server
    void qc.invalidateQueries({ queryKey: ["pending-signatures", companyId] });
    void qc.invalidateQueries({ queryKey: ["company-dashboard"] });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm text-red-700">
        Could not load pending signatures. Please refresh the page.
      </div>
    );
  }

  const rollfiTasks  = data?.signatures  ?? [];
  const signedForms  = data?.signedForms ?? {};

  // Determine whether to show the 8655 card:
  // Show it if Rollfi lists it OR if it's already locally signed (so user can always see/re-sign).
  const has8655InRollfi = rollfiTasks.some(t => t.task.includes("8655"));
  const signed8655      = signedForms["8655"] ?? null;
  const show8655        = has8655InRollfi || signed8655 !== null;

  // All other Rollfi tasks that are NOT Form 8655 → use external-link card
  const otherTasks = rollfiTasks.filter(t => !t.task.includes("8655"));

  const totalCards = (show8655 ? 1 : 0) + otherTasks.length;

  if (totalCards === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-10 text-center shadow-sm">
        <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-700">All forms signed</p>
        <p className="text-xs text-gray-400 mt-1">No pending signature requests at this time.</p>
      </div>
    );
  }

  const allSigned = (show8655 ? !!signed8655 : true) && otherTasks.length === 0;

  return (
    <div className="space-y-4">
      <div className="mb-1">
        <h2 className="text-sm font-semibold text-gray-900">Authorization Forms</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {allSigned
            ? "All required tax authorization forms have been signed."
            : "These forms authorize your payroll service to file taxes on your behalf."}
        </p>
      </div>

      {show8655 && (
        <Form8655Card
          companyId={companyId}
          signed={signed8655}
          onSigned={handleSigned}
          onUploadRetried={handleUploadRetried}
        />
      )}

      {otherTasks.map(form => (
        <ExternalLinkCard key={form.task} form={form} companyId={companyId} />
      ))}
    </div>
  );
}
