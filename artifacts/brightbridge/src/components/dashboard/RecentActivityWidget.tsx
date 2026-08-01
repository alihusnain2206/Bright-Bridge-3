import React from "react";
import { useQuery } from "@tanstack/react-query";
import { WidgetCard } from "./WidgetCard";
import { apiFetch, timeAgo } from "./helpers";
import type { ActivityFeedEvent, CompanyState } from "./types";

const TYPE_DOT: Record<string, string> = {
  "payroll.initiated":  "bg-blue-400",
  "payroll.submitted":  "bg-blue-400",
  "payroll.calculated": "bg-emerald-400",
  "payroll.processed":  "bg-emerald-400",
  "payroll.completed":  "bg-emerald-400",
  "payroll.approved":   "bg-emerald-400",
  "payroll.failed":     "bg-red-400",
  "employee.added":     "bg-violet-400",
  "hours.synced":       "bg-amber-400",
};

const SOURCE_BADGE: Record<"app" | "rollfi", { label: string; cls: string }> = {
  app:    { label: "App",    cls: "bg-violet-500/20 text-violet-300" },
  rollfi: { label: "Rollfi", cls: "bg-blue-500/20 text-blue-300" },
};

export function RecentActivityWidget({
  selectedCompanyId,
}: {
  selectedCompanyId: string;
  companies: CompanyState[];
}) {
  const { data, isLoading } = useQuery<{ events: ActivityFeedEvent[] }>({
    queryKey: ["activity-feed", selectedCompanyId],
    queryFn: () => apiFetch(`/activity?companyId=${encodeURIComponent(selectedCompanyId)}`),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const events = data?.events ?? [];

  return (
    <WidgetCard
      title="Recent Activity"
      subtitle="App actions + Rollfi events"
      footer={
        <div className="flex items-center gap-3">
          {(["app", "rollfi"] as const).map((src) => (
            <span key={src} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SOURCE_BADGE[src].cls}`}>
              {SOURCE_BADGE[src].label}
            </span>
          ))}
          <span className="text-white/25 text-[10px] ml-auto">Auto-refreshes every 30s</span>
        </div>
      }
    >
      {isLoading ? (
        <p className="text-white/30 text-xs py-4 text-center">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-white/40 text-sm text-center py-4">
          No recent activity. Events will appear as you process payroll, sync hours, or add staff.
        </p>
      ) : (
        <div className="space-y-0">
          {events.map((ev, i) => {
            const dot = TYPE_DOT[ev.type] ?? (ev.source === "app" ? "bg-violet-400" : "bg-blue-400");
            const badge = SOURCE_BADGE[ev.source];
            return (
              <div key={ev.id} className="flex items-start gap-3 py-2.5">
                <div className="relative flex-shrink-0 flex flex-col items-center">
                  <div className={`w-2 h-2 rounded-full mt-0.5 ${dot}`} />
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-white/10 mt-1" style={{ minHeight: 16 }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-white/85 text-xs font-medium leading-snug">{ev.description}</p>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  {ev.actorName && (
                    <p className="text-white/35 text-[10px] mt-0.5">by {ev.actorName}</p>
                  )}
                </div>
                <span className="text-white/25 text-[10px] shrink-0 mt-0.5">{timeAgo(ev.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}
