/**
 * Organization Settings hub — horizontal tab bar pattern.
 *
 * Tabs:
 *   company-info   → Company Information (coming soon placeholder)
 *   state-tax      → State Tax Information (live)
 *
 * URL: /settings?tab=state-tax  (defaults to state-tax)
 */
import React from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, Globe, FileSignature } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StateRegistrationSection } from "@/components/StateRegistrationSection";
import { CompanyInfoSection } from "@/components/CompanyInfoSection";
import { SignaturesSection } from "@/components/SignaturesSection";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GapEntry {
  state: string;
  employees: { id: string; name: string }[];
  /** null = no row at all; 'failed' | 'pending' = row exists but is not active */
  registrationStatus: string | null;
}

interface CompanyData {
  id: string;
  rollfiCompanyId?: string | null;
  rollfi?: { rollfiCompanyId?: string | null } | null;
}

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

// ── Tabs config ───────────────────────────────────────────────────────────────

type TabId = "company-info" | "state-tax" | "signatures";

const TABS: { id: TabId; label: string; soon?: boolean }[] = [
  { id: "company-info", label: "Company Information" },
  { id: "state-tax",    label: "State Tax Information" },
  { id: "signatures",   label: "Signatures" },
];


// ── State Tax tab ─────────────────────────────────────────────────────────────

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
    <div className="space-y-2 mb-5">
      {gaps.map(gap => {
        const sn = stateName(gap.state);
        const count = gap.employees.length;
        const empDesc = count === 1
          ? `1 employee works`
          : `${count} employees work`;

        if (gap.registrationStatus === "failed") {
          return (
            <div key={gap.state}
              className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800"
            >
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">{sn} ({gap.state}) registration failed.</span>{" "}
                {empDesc} in {sn} without state withholding.{" "}
                <span className="text-red-600 text-xs">Use the Retry button below to re-submit it.</span>
              </div>
            </div>
          );
        }

        if (gap.registrationStatus === "pending") {
          return (
            <div key={gap.state}
              className="flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-800"
            >
              <AlertTriangle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">{sn} ({gap.state}) registration is pending.</span>{" "}
                {empDesc} in {sn} — withholding will activate once the registration is confirmed.
              </div>
            </div>
          );
        }

        // registrationStatus === null → no row at all
        return (
          <div key={gap.state}
            className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800"
          >
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">{sn} ({gap.state}) isn&apos;t registered for payroll tax.</span>{" "}
              {empDesc} there without state withholding.{" "}
              <span className="text-amber-600 text-xs">Add it below to resolve this.</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StateTaxTab({ companyId, hasRollfi }: { companyId: string; hasRollfi: boolean }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-gray-500 max-w-xl">
          Register the states where your employees work so your payroll provider can correctly
          withhold and remit state payroll taxes.
        </p>
      </div>

      <GapWarnings companyId={companyId} />

      <StateRegistrationSection
        companyId={companyId}
        hasRollfi={hasRollfi}
        registrationsUrl="/api/state-registrations"
      />

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

// ── Hub page ──────────────────────────────────────────────────────────────────

export default function SettingsHubPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? "";
  const search = useSearch();
  const [, navigate] = useLocation();

  const activeTab = (new URLSearchParams(search).get("tab") as TabId | null) ?? "state-tax";

  // Fetch company to determine Rollfi enrollment
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

  const setTab = (id: TabId) => navigate(`/settings?tab=${id}`, { replace: true });

  return (
    <div className="max-w-3xl">
      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your company configuration and compliance settings.</p>
      </div>

      {/* Horizontal tab bar */}
      <div className="flex gap-0 border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => !tab.soon && setTab(tab.id)}
            disabled={tab.soon}
            className={[
              "relative px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab.soon
                ? "text-gray-300 cursor-not-allowed border-transparent"
                : activeTab === tab.id
                  ? "text-[#284362] border-[#284362]"
                  : "text-gray-500 hover:text-gray-800 border-transparent hover:border-gray-300",
            ].join(" ")}
          >
            {tab.label}
            {tab.soon && (
              <span className="ml-2 text-[9px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase tracking-widest">
                Soon
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {companyLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <>
          {activeTab === "company-info" && <CompanyInfoSection companyId={companyId} />}
          {activeTab === "state-tax"    && (
            <StateTaxTab companyId={companyId} hasRollfi={hasRollfi} />
          )}
          {activeTab === "signatures"   && <SignaturesSection companyId={companyId} />}
        </>
      )}
    </div>
  );
}
