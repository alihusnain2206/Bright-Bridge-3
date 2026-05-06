import React from "react";
import { Link } from "wouter";
import { useGetEasyTeamStatus, useGetWebhookLogs, useHealthCheck } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, Webhook, Settings, CalendarDays, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardHeroIllustration, SDKStatusMini, ActivityMini, QuickLinksMini } from "@/components/daycare-illustrations";

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

      {/* Hero banner */}
      <div className="rounded-2xl border overflow-hidden relative" style={{ ...PANEL, minHeight: 200 }}>
        {/* Left: text content */}
        <div className="absolute inset-0 flex flex-col justify-center px-8 py-6 z-10 max-w-[55%]">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {healthLoading ? (
              <Skeleton className="h-6 w-24 opacity-20" />
            ) : (
              <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs px-2.5">
                API {health?.status === "ok" ? "Online" : "Offline"}
              </Badge>
            )}
            {statusLoading ? (
              <Skeleton className="h-6 w-28 opacity-20" />
            ) : (
              <Badge className={`text-white text-xs px-2.5 ${status?.connected ? "bg-emerald-500 hover:bg-emerald-600" : "bg-destructive"}`}>
                EasyTeam {status?.connected ? "Connected" : "Disconnected"}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white leading-tight tracking-tight">
            Integration Dashboard
          </h1>
          <p className="text-white/50 mt-2 text-sm leading-relaxed">
            Overview of your EasyTeam Embedded SDK sandbox.<br />
            Manage daycare clients, staff, and test live iframe components.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Link href="/clients">
              <Button className="bg-[#E8622A] hover:bg-[#d4571f] text-white border-0 text-sm h-9">
                Manage Clients
              </Button>
            </Link>
            <Link href="/timeclock">
              <Button variant="outline" className="text-white/80 hover:text-white border-white/20 hover:border-white/40 hover:bg-white/10 bg-transparent text-sm h-9">
                Launch Time Clock
              </Button>
            </Link>
          </div>
        </div>

        {/* Right: illustration */}
        <div className="absolute right-0 top-0 bottom-0 w-[50%] flex items-end justify-end overflow-hidden">
          <DashboardHeroIllustration />
        </div>

        {/* Subtle gradient overlay so text stays readable */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(90deg, #284362 38%, transparent 70%)" }} />
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* SDK Status */}
        <div className="rounded-xl border flex flex-col" style={PANEL}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">SDK Status</span>
            </div>
            <SDKStatusMini />
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
          <div className="px-5 py-4 border-b flex items-center justify-between" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">Recent Activity</span>
            </div>
            <ActivityMini />
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
          <div className="px-5 py-4 border-b flex items-center justify-between" style={PANEL_DIVIDER}>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">Quick Links</span>
            </div>
            <QuickLinksMini />
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
    </div>
  );
}
