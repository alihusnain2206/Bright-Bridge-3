import React from "react";
import { Link } from "wouter";
import { useGetEasyTeamStatus, useGetWebhookLogs, useHealthCheck } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Clock, CalendarDays, Calendar, Webhook, Settings, CheckCircle2, XCircle, Activity, ArrowRight, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSceneIllustration } from "@/components/daycare-illustrations";

const DARK = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const DARK_INNER = { background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)" } as const;
const DARK_DIV = { borderColor: "rgba(255,255,255,0.1)" } as const;

const components = [
  {
    href: "/timeclock",
    icon: Clock,
    label: "Time Clock",
    tagline: "Employee punch-in/out",
    description: "Launch the EasyTeam Time Clock iframe for any staff member. Test live clock-in and clock-out events in the sandbox.",
    color: "#E8622A",
  },
  {
    href: "/timesheets",
    icon: CalendarDays,
    label: "Timesheets",
    tagline: "Hours & attendance",
    description: "View all-staff or per-employee timesheets. Switch between the full roster and individual employee views.",
    color: "#E8622A",
  },
  {
    href: "/schedule",
    icon: Calendar,
    label: "Schedule",
    tagline: "Weekly planning",
    description: "Browse and manage the weekly schedule for a daycare center's staff. Integrate the scheduler into your app flow.",
    color: "#E8622A",
  },
];

export default function Home() {
  const { data: status, isLoading: statusLoading } = useGetEasyTeamStatus();
  const { data: health, isLoading: healthLoading } = useHealthCheck();
  const { data: webhooks, isLoading: webhooksLoading } = useGetWebhookLogs();

  const apiOk = health?.status === "ok";
  const sdkOk = status?.connected;
  const lastWebhook = webhooks?.events?.[0];
  const webhookCount = webhooks?.events?.length ?? 0;

  return (
    <div className="space-y-8">

      {/* ── Hero status card ────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden border" style={DARK}>
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div style={{
            position: "absolute", right: -60, top: -60,
            width: 320, height: 320, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(232,98,42,0.12) 0%, transparent 70%)",
          }} />
          <div style={{
            position: "absolute", left: -40, bottom: -60,
            width: 260, height: 260, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)",
          }} />
          {/* Grid dots */}
          {Array.from({ length: 6 }).map((_, col) =>
            Array.from({ length: 3 }).map((_, row) => (
              <div key={`${col}-${row}`} style={{
                position: "absolute",
                right: 80 + col * 38, top: 24 + row * 38,
                width: 3, height: 3, borderRadius: "50%",
                background: "rgba(255,255,255,0.07)",
              }} />
            ))
          )}
        </div>

        <div className="relative px-8 py-7 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-[#E8622A]" />
              <span className="text-[#E8622A] text-xs font-semibold tracking-widest uppercase">EasyTeam Embedded SDK</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Integration Dashboard</h1>
            <p className="text-white/50 text-sm max-w-md">
              Sandbox testing environment for the BrightBridge EasyTeam integration. Configure clients, sign JWTs, and test all three embedded components.
            </p>
          </div>

          {/* Status pills */}
          <div className="flex flex-col gap-3 shrink-0">
            {/* API status */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border" style={DARK_INNER}>
              {healthLoading ? (
                <Skeleton className="h-4 w-32 opacity-20" />
              ) : (
                <>
                  {apiOk
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  <span className="text-white/80 text-sm">API Server</span>
                  <span className={`ml-auto text-xs font-semibold ${apiOk ? "text-emerald-400" : "text-red-400"}`}>
                    {apiOk ? "Online" : "Offline"}
                  </span>
                </>
              )}
            </div>
            {/* SDK status */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border" style={DARK_INNER}>
              {statusLoading ? (
                <Skeleton className="h-4 w-32 opacity-20" />
              ) : (
                <>
                  {sdkOk
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    : <XCircle className="h-4 w-4 text-amber-400 shrink-0" />}
                  <span className="text-white/80 text-sm">EasyTeam SDK</span>
                  <span className={`ml-auto text-xs font-semibold ${sdkOk ? "text-emerald-400" : "text-amber-400"}`}>
                    {sdkOk ? "Connected" : "Partial"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Slim metric bar */}
        <div className="relative px-8 py-3 border-t flex items-center gap-8 flex-wrap" style={DARK_DIV}>
          {[
            { label: "Environment", value: statusLoading ? "…" : (status?.environment ?? "—"), mono: true },
            { label: "SDK Version", value: statusLoading ? "…" : (status?.sdkVersion ?? "—"), mono: true },
            { label: "API Key", value: statusLoading ? "…" : (status?.apiKeyPresent ? "Present ✅" : "Missing ❌"), mono: false },
            { label: "Webhooks Logged", value: webhooksLoading ? "…" : String(webhookCount), mono: true },
          ].map(({ label, value, mono }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-white/35 text-xs">{label}</span>
              <span className={`text-white/80 text-xs font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── EasyTeam components ──────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-primary">EasyTeam Components</h2>
            <p className="text-muted-foreground text-sm">Select a component to configure and launch its embedded iframe.</p>
          </div>
          <Link href="/clients">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              Manage Clients <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {components.map(({ href, icon: Icon, label, tagline, description }) => (
            <Link key={href} href={href} className="group block">
              <div className="h-full rounded-2xl border bg-card p-6 flex flex-col gap-4 transition-all duration-200
                hover:shadow-lg hover:border-[#E8622A]/30 hover:-translate-y-0.5"
                style={{ borderColor: "hsl(var(--border))" }}>
                {/* Icon badge */}
                <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors"
                  style={{ background: "rgba(232,98,42,0.1)" }}>
                  <Icon className="h-6 w-6 text-[#E8622A]" />
                </div>

                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-base text-gray-900">{label}</span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border text-muted-foreground"
                      style={{ borderColor: "hsl(var(--border))" }}>
                      {tagline}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                </div>

                <div className="flex items-center gap-2 text-[#E8622A] text-sm font-medium group-hover:gap-3 transition-all">
                  Launch component
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Bottom row: Recent activity + SDK details ─────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Recent webhooks */}
        <div className="rounded-2xl border overflow-hidden" style={DARK}>
          <div className="px-6 py-4 border-b flex items-center gap-3" style={DARK_DIV}>
            <Webhook className="h-4 w-4 text-[#E8622A]" />
            <span className="text-white font-semibold">Recent Webhook Activity</span>
            {webhookCount > 0 && (
              <span className="ml-auto text-[11px] bg-[#E8622A] text-white px-2 py-0.5 rounded-full font-bold">
                {webhookCount}
              </span>
            )}
          </div>
          <div className="px-6 py-5">
            {webhooksLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full opacity-20" />
                <Skeleton className="h-4 w-2/3 opacity-20" />
              </div>
            ) : lastWebhook ? (
              <div className="space-y-3">
                <div>
                  <div className="text-white/40 text-xs mb-1">Most recent event</div>
                  <div className="text-white font-medium truncate">{lastWebhook.event}</div>
                  <div className="text-white/35 text-xs mt-1">{new Date(lastWebhook.timestamp).toLocaleString()}</div>
                </div>
                {lastWebhook.employee_id && (
                  <div className="text-xs font-mono px-3 py-2 rounded-lg text-white/50 border" style={DARK_INNER}>
                    Employee: {lastWebhook.employee_id}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 text-white/25 text-sm gap-2">
                <Webhook className="h-8 w-8 opacity-40" />
                No webhook events yet
              </div>
            )}
          </div>
          <div className="px-6 pb-5">
            <Link href="/webhooks">
              <Button variant="outline" size="sm" className="w-full gap-2 text-white/70 border-white/20 hover:border-white/40 hover:bg-white/10 bg-transparent text-xs">
                View All Logs <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* SDK configuration details */}
        <div className="rounded-2xl border overflow-hidden" style={DARK}>
          <div className="px-6 py-4 border-b flex items-center gap-3" style={DARK_DIV}>
            <Activity className="h-4 w-4 text-[#E8622A]" />
            <span className="text-white font-semibold">SDK Configuration</span>
          </div>
          <div className="px-6 py-5 space-y-3">
            {statusLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full opacity-20" />
                <Skeleton className="h-4 w-3/4 opacity-20" />
                <Skeleton className="h-4 w-1/2 opacity-20" />
              </div>
            ) : (
              [
                { label: "Environment", value: status?.environment ?? "Unknown", tag: true },
                { label: "API Key", value: status?.apiKeyPresent ? "RSA private key present" : "Missing — add EASYTEAM_API_KEY", ok: status?.apiKeyPresent },
                { label: "SDK Version", value: status?.sdkVersion ?? "Unknown" },
                { label: "Base URL", value: "easyteam.io/sandbox/embed/iframe", mono: true },
              ].map(({ label, value, tag, ok, mono }) => (
                <div key={label} className="flex items-start justify-between gap-3 py-2 border-b last:border-0" style={DARK_DIV}>
                  <span className="text-white/40 text-xs shrink-0 pt-0.5">{label}</span>
                  {tag ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border capitalize text-white/70 border-white/20">
                      {value}
                    </span>
                  ) : (
                    <span className={`text-xs text-right break-all ${mono ? "font-mono text-white/50" : ok === false ? "text-amber-400" : "text-white/80"}`}>
                      {value}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="px-6 pb-5">
            <Link href="/config">
              <Button variant="outline" size="sm" className="w-full gap-2 text-white/70 border-white/20 hover:border-white/40 hover:bg-white/10 bg-transparent text-xs">
                Full Configuration <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Decorative scene ─────────────────────────────────── */}
      <div className="pointer-events-none select-none pb-2" style={{ opacity: 0.75 }}>
        <DashboardSceneIllustration />
      </div>
    </div>
  );
}
