import React from "react";
import { Link } from "wouter";
import { useGetEasyTeamStatus, useGetWebhookLogs, useHealthCheck } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, Webhook, Settings, CalendarDays, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSceneIllustration } from "@/components/daycare-illustrations";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)" } as const;
const PANEL_DIVIDER = { borderColor: "rgba(255,255,255,0.1)" } as const;

export default function Home() {
  const { data: status, isLoading: statusLoading } = useGetEasyTeamStatus();
  const { data: health, isLoading: healthLoading } = useHealthCheck();
  const { data: webhooks, isLoading: webhooksLoading } = useGetWebhookLogs();

  const lastWebhook = webhooks?.events?.[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Integration Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your EasyTeam Embedded SDK sandbox.</p>
        </div>
        <div className="flex items-center gap-2">
          {healthLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">
              API {health?.status === "ok" ? "Online" : "Offline"}
            </Badge>
          )}
          {statusLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <Badge className={status?.connected ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-destructive text-white"}>
              EasyTeam {status?.connected ? "Connected" : "Disconnected"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* SDK Status */}
        <div className="rounded-xl border flex flex-col" style={PANEL}>
          <div className="px-5 py-4 border-b" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">SDK Status</span>
            </div>
          </div>
          <div className="px-5 py-4 flex-1">
            {statusLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full opacity-20" />
                <Skeleton className="h-4 w-3/4 opacity-20" />
              </div>
            ) : (
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-white/50">Environment</dt>
                  <dd className="font-medium text-white capitalize">{status?.environment || "Unknown"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/50">API Key</dt>
                  <dd className="font-medium text-white">{status?.apiKeyPresent ? "✅ Present" : "❌ Missing"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/50">SDK Version</dt>
                  <dd className="font-medium text-white">{status?.sdkVersion || "Unknown"}</dd>
                </div>
              </dl>
            )}
          </div>
          <div className="px-5 pb-5 pt-2 border-t" style={PANEL_DIVIDER}>
            <Link href="/config">
              <Button variant="outline" className="w-full text-xs h-8 text-white/80 hover:text-white border-white/20 hover:border-white/40 hover:bg-white/10 bg-transparent">
                View Configuration
              </Button>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border flex flex-col" style={PANEL}>
          <div className="px-5 py-4 border-b" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">Recent Activity</span>
            </div>
          </div>
          <div className="px-5 py-4 flex-1">
            {webhooksLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full opacity-20" />
                <Skeleton className="h-4 w-3/4 opacity-20" />
              </div>
            ) : lastWebhook ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-white/40">Last Event Received</div>
                  <div className="font-medium mt-1 truncate text-white" title={lastWebhook.event}>{lastWebhook.event}</div>
                  <div className="text-xs mt-1 text-white/40">{new Date(lastWebhook.timestamp).toLocaleString()}</div>
                </div>
                <div className="text-xs p-2 rounded-md font-mono truncate text-white/60 border" style={PANEL_INNER}>
                  {lastWebhook.employee_id ? `Employee: ${lastWebhook.employee_id}` : "No Employee ID"}
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-white/35 text-sm flex flex-col items-center">
                <Webhook className="h-8 w-8 mb-2 opacity-20" />
                No webhooks received yet
              </div>
            )}
          </div>
          <div className="px-5 pb-5 pt-2 border-t" style={PANEL_DIVIDER}>
            <Link href="/webhooks">
              <Button variant="outline" className="w-full text-xs h-8 text-white/80 hover:text-white border-white/20 hover:border-white/40 hover:bg-white/10 bg-transparent">
                View All Logs
              </Button>
            </Link>
          </div>
        </div>

        {/* Quick Links */}
        <div className="rounded-xl border flex flex-col" style={PANEL}>
          <div className="px-5 py-4 border-b" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">Quick Links</span>
            </div>
          </div>
          <div className="px-5 py-4 flex-1">
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: "/timeclock", icon: Clock, label: "Time Clock" },
                { href: "/timesheets", icon: CalendarDays, label: "Timesheets" },
                { href: "/schedule", icon: Calendar, label: "Schedule" },
                { href: "/config", icon: Settings, label: "Settings" },
              ].map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center p-4 rounded-lg text-center transition-colors border border-white/10 hover:border-[#E8622A]/50 hover:bg-white/10"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <Icon className="h-6 w-6 mb-2 text-[#E8622A]" />
                  <span className="text-xs font-medium text-white/80">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Decorative scene — sits quietly below the cards */}
      <div className="pointer-events-none select-none pt-4 pb-2" style={{ opacity: 0.85 }}>
        <DashboardSceneIllustration />
      </div>
    </div>
  );
}
