/**
 * Company Settings → Organization Settings → State Tax Information
 *
 * Owner-facing page for managing Rollfi state tax registrations.
 * Super-admins also land here when viewing their own company's settings.
 *
 * Shows:
 *  - Gap warnings: employees working in states with no active registration
 *  - StateRegistrationSection (shared with client-detail super-admin view)
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, Globe, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StateRegistrationSection } from "@/components/StateRegistrationSection";

interface GapEntry {
  state: string;
  employees: { id: string; name: string }[];
}

interface CompanyData {
  id: string;
  rollfiCompanyId?: string | null;
  rollfi?: { rollfiCompanyId?: string | null } | null;
}

// US state code → full name (used for human-readable gap messages)
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function stateName(code: string) { return STATE_NAMES[code] ?? code; }

// ── Gap warning banner ────────────────────────────────────────────────────────

function GapWarnings({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<{ gaps: GapEntry[] }>({
    queryKey: ["state-registration-gaps", companyId],
    queryFn: () =>
      fetch("/api/state-registrations/gaps", { credentials: "include" })
        .then(r => r.json() as Promise<{ gaps: GapEntry[] }>),
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-10 rounded-lg" />;
  const gaps = data?.gaps ?? [];
  if (gaps.length === 0) return null;

  return (
    <div className="space-y-2">
      {gaps.map(gap => (
        <div
          key={gap.state}
          className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800"
        >
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">
              {gap.employees.length === 1
                ? `1 employee works`
                : `${gap.employees.length} employees work`}{" "}
              in {stateName(gap.state)} ({gap.state}),
            </span>{" "}
            which isn&apos;t registered for payroll tax. They cannot have state
            withholding until it is.{" "}
            <span className="text-amber-600 text-xs">
              (Register {gap.state} below to resolve this.)
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsStateTaxPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? "";

  // Fetch company record to check Rollfi enrollment
  const { data: companyResp, isLoading: companyLoading } = useQuery<{ companies: CompanyData[] }>({
    queryKey: ["company-for-settings", companyId],
    queryFn: () =>
      fetch(`/api/companies?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json() as Promise<{ companies: CompanyData[] }>),
    enabled: !!companyId,
    staleTime: 120_000,
  });

  const company = companyResp?.companies?.find(c => c.id === companyId);
  const hasRollfi = !!(company?.rollfiCompanyId ?? company?.rollfi?.rollfiCompanyId);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
            Organization Settings
          </p>
          <h1 className="text-2xl font-bold text-gray-900">State Tax Information</h1>
          <p className="text-sm text-gray-500 mt-1">
            Register the states where your employees work so Rollfi can correctly
            withhold and remit state payroll taxes.
          </p>
        </div>
        <a
          href="https://rollfi.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-[#0EA5C9] hover:underline shrink-0 mt-1"
        >
          Rollfi portal <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Gap warnings */}
      {companyId && !companyLoading && (
        <GapWarnings companyId={companyId} />
      )}

      {/* Registration section */}
      {companyLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <StateRegistrationSection
          companyId={companyId}
          hasRollfi={hasRollfi}
          registrationsUrl="/api/state-registrations"
        />
      )}

      {/* Delete policy note */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500 space-y-1">
        <p className="font-semibold text-gray-700 flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />About removing a state registration
        </p>
        <p>
          Deleting a state registration is not available here because removing a state
          where employees work would immediately break their withholding. A safe delete
          requires verifying that zero active employees have that state as their home
          state. Contact your payroll administrator if you need to remove a state.
        </p>
      </div>
    </div>
  );
}
