import React from "react";
import { useQuery } from "@tanstack/react-query";
import { WidgetCard } from "./WidgetCard";
import { apiFetch, timeAgo } from "./helpers";
import type { ActivityFeedEvent, CompanyState } from "./types";
import {
  DollarSign, UserPlus, Clock, CheckCircle2, XCircle,
  Loader2, FileText, Building2, Activity,
} from "lucide-react";

// ── Icon + colour per event type ────────────────────────────────────────────
type IconConfig = { icon: React.ElementType; bg: string; fg: string };

const TYPE_ICON: Record<string, IconConfig> = {
  "payroll.initiated":   { icon: DollarSign,    bg: "bg-blue-500/20",    fg: "text-blue-300" },
  "payroll.inProcess":   { icon: Loader2,        bg: "bg-blue-500/20",    fg: "text-blue-300" },
  "payroll.calculated":  { icon: DollarSign,    bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  "payroll.submitted":   { icon: DollarSign,    bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  "payroll.processed":   { icon: CheckCircle2,  bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  "payroll.completed":   { icon: CheckCircle2,  bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  "payroll.approved":    { icon: CheckCircle2,  bg: "bg-emerald-500/20", fg: "text-emerald-300" },
  "payroll.failed":      { icon: XCircle,       bg: "bg-red-500/20",     fg: "text-red-300" },
  "payroll.cancelled":   { icon: XCircle,       bg: "bg-red-500/20",     fg: "text-red-300" },
  "employee.added":      { icon: UserPlus,      bg: "bg-violet-500/20",  fg: "text-violet-300" },
  "employee.updated":    { icon: UserPlus,      bg: "bg-violet-500/20",  fg: "text-violet-300" },
  "hours.synced":        { icon: Clock,         bg: "bg-amber-500/20",   fg: "text-amber-300" },
  "document.uploaded":   { icon: FileText,      bg: "bg-sky-500/20",     fg: "text-sky-300" },
  "company.updated":     { icon: Building2,     bg: "bg-gray-500/20",    fg: "text-gray-300" },
};

const DEFAULT_APP_ICON:    IconConfig = { icon: Activity,   bg: "bg-violet-500/20", fg: "text-violet-300" };
const DEFAULT_ROLLFI_ICON: IconConfig = { icon: DollarSign, bg: "bg-blue-500/20",   fg: "text-blue-300" };

function getIconConfig(ev: ActivityFeedEvent): IconConfig {
  return TYPE_ICON[ev.type] ?? (ev.source === "app" ? DEFAULT_APP_ICON : DEFAULT_ROLLFI_ICON);
}

// ── Source pill ──────────────────────────────────────────────────────────────
const SOURCE_PILL: Record<"app" | "rollfi", { label: string; cls: string }> = {
  app:    { label: "App",    cls: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30" },
  rollfi: { label: "Rollfi", cls: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30" },
};

export function RecentActivityWidget({
  selectedCompanyId,
}: {
  selectedCompanyId: string;
  companies: CompanyState[];
}) {
  const { data, isLoading } = useQuery<{ events: ActivityFeedEvent[] }>({
    queryKey: ["activity-feed", selectedCompanyId],
    queryFn: () => apiFetch(`/activity?companyId=${encodeURIComponent(selectedCompanyId)}&limit=8`),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const events = data?.events ?? [];

  return (
    <WidgetCard
      title="Recent Activity"
      subtitle="Payroll events and team actions"
      footer={
        <span className="text-white/25 text-[10px]">Auto-refreshes every 30s</span>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-white/30 text-xs py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
        </div>
      ) : events.length === 0 ? (
        <p className="text-white/40 text-sm text-center py-6">
          No recent activity. Events will appear as you process payroll, sync hours, or add staff.
        </p>
      ) : (
        <div className="space-y-1">
          {events.map((ev, i) => {
            const { icon: Icon, bg, fg } = getIconConfig(ev);
            const pill = SOURCE_PILL[ev.source];
            return (
              <div
                key={ev.id}
                className="flex items-start gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-white/[0.04] transition-colors"
              >
                {/* Icon badge */}
                <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5 ${bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${fg}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white/90 text-xs font-medium leading-snug">{ev.description}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${pill.cls}`}>
                      {pill.label}
                    </span>
                  </div>
                  {ev.actorName && (
                    <p className="text-white/35 text-[10px] mt-0.5">
                      by <span className="text-white/50">{ev.actorName}</span>
                      {ev.actorRole && <span className="text-white/25"> · {ev.actorRole}</span>}
                    </p>
                  )}
                </div>

                {/* Timestamp */}
                <span className="text-white/30 text-[10px] shrink-0 mt-1">{timeAgo(ev.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}
