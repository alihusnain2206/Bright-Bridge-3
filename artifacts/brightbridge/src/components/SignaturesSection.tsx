/**
 * SignaturesSection — shown under /settings?tab=signatures
 *
 * Lists pending tax-authorization forms that the owner needs to sign.
 * Each form has a "Get signing link" button that calls the backend.
 * Backend probes Rollfi for a signing URL; on success it opens in a new
 * tab. On sandbox / unavailable it shows a friendly "check your email" message.
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSignature, ExternalLink, CheckCircle, AlertCircle, Mail, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingTask {
  task: string;
  description: string;
}

interface PendingSignaturesResp {
  signatures: PendingTask[];
}

interface SigningLinkResp {
  url: string | null;
  message: string;
  emailSent?: boolean;
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
    if (taskName.includes(key)) return meta;
  }
  return null;
}

// ── Single form card ───────────────────────────────────────────────────────────

type CardState = "idle" | "loading" | "success" | "email" | "error";

function FormCard({ form, companyId }: { form: PendingTask; companyId: string }) {
  const [state, setState] = useState<CardState>("idle");
  const [message, setMessage] = useState<string>("");
  const meta = matchMeta(form.task);

  const handleGetLink = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/rollfi/request-signing-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, formTask: form.task }),
      });
      const data: SigningLinkResp = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
        setState("success");
        setMessage("Signing page opened in a new tab.");
      } else if (data.emailSent) {
        setState("email");
        setMessage(data.message);
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
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FileSignature className="w-4.5 h-4.5 text-amber-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {meta?.title ?? form.task}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {meta?.body ?? form.description}
          </p>
        </div>
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
          Signature required
        </span>
      </div>

      {/* Why box */}
      {meta?.why && (
        <div className="mt-3 ml-12 text-[11px] text-gray-500 leading-relaxed border-l-2 border-amber-100 pl-3">
          <span className="font-medium text-gray-600">Why it's needed: </span>
          {meta.why}
        </div>
      )}

      {/* Action area */}
      <div className="mt-4 ml-12">
        {state === "idle" && (
          <Button
            size="sm"
            className="h-8 px-4 text-xs bg-[#284362] hover:bg-[#1e3250] text-white"
            onClick={handleGetLink}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Get signing link
          </Button>
        )}

        {state === "loading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Fetching your signing link…
          </div>
        )}

        {state === "success" && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" />
            {message}
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
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────────────────────

export function SignaturesSection({ companyId }: { companyId: string }) {
  const { data, isLoading, isError } = useQuery<PendingSignaturesResp>({
    queryKey: ["pending-signatures", companyId],
    queryFn: () =>
      fetch(`/api/rollfi/pending-signatures?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<PendingSignaturesResp>),
    staleTime: 60_000,
  });

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

  const forms = data?.signatures ?? [];

  if (forms.length === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-10 text-center shadow-sm">
        <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-700">All forms signed</p>
        <p className="text-xs text-gray-400 mt-1">No pending signature requests at this time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-1">
        <h2 className="text-sm font-semibold text-gray-900">Pending Signatures</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          These forms authorize your payroll service to file taxes on your behalf. Click "Get signing
          link" for each form to complete the authorization.
        </p>
      </div>

      {forms.map(form => (
        <FormCard key={form.task} form={form} companyId={companyId} />
      ))}
    </div>
  );
}
