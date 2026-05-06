import React from "react";
import { Link, useRoute } from "wouter";
import {
  AlertTriangle, Activity, Clock, CalendarDays,
  Calendar, Settings, Webhook, Building2, FlaskConical
} from "lucide-react";
import { useGetEasyTeamStatus } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { href: "/",           label: "Dashboard",  icon: Activity     },
  { href: "/clients",    label: "Clients",    icon: Building2    },
  { href: "/timeclock",  label: "Time Clock", icon: Clock        },
  { href: "/timesheets", label: "Timesheets", icon: CalendarDays },
  { href: "/schedule",   label: "Schedule",   icon: Calendar     },
  { href: "/webhooks",   label: "Webhooks",   icon: Webhook      },
  { href: "/config",     label: "Config",     icon: Settings     },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: status } = useGetEasyTeamStatus();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>

      {/* Slim sandbox notice */}
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide"
           style={{ background: "linear-gradient(90deg, #1B2D55 0%, #2a4070 100%)", color: "#fff" }}>
        <FlaskConical className="h-3.5 w-3.5 opacity-70" />
        <span className="opacity-80">SANDBOX</span>
        <span className="opacity-40 mx-1">·</span>
        <span className="opacity-70 font-normal">Testing environment — no real data or payments</span>
      </div>

      {/* White navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-100"
              style={{ boxShadow: "0 1px 3px rgba(27,45,85,0.06), 0 4px 20px rgba(27,45,85,0.08)" }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-8">

          {/* Logo — no filter so it shows brand colors */}
          <Link href="/" className="flex items-center shrink-0">
            <img
              src="/brightbridge-logo.png"
              alt="Brightbridge Assist"
              className="h-8 w-auto"
            />
          </Link>

          {/* Divider */}
          <div className="h-6 w-px bg-slate-200 shrink-0" />

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <NavLink key={href} href={href} icon={<Icon className="w-3.5 h-3.5" />}>
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right side — API status pill */}
          <div className="ml-auto shrink-0">
            {status?.connected ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: "rgba(232,98,42,0.08)", color: "#E8622A", border: "1px solid rgba(232,98,42,0.18)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#E8622A] animate-pulse" />
                EasyTeam Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Disconnected
              </span>
            )}
          </div>
        </div>
      </header>

      {/* API Key Missing banner */}
      {status && !status.apiKeyPresent && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          API Key missing — configure your EasyTeam key in the Config tab.
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white/60 py-3 px-6 text-center text-xs text-slate-400">
        BrightBridge Assist · EasyTeam Embedded SDK Integration Test
      </footer>
    </div>
  );
}

function NavLink({ href, children, icon }: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const [isActive] = useRoute(href);
  return (
    <Link
      href={href}
      className={`
        flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150
        ${isActive
          ? "text-[#E8622A] bg-[#E8622A]/8"
          : "text-slate-500 hover:text-[#1B2D55] hover:bg-slate-50"
        }
      `}
      style={isActive ? { background: "rgba(232,98,42,0.07)" } : {}}
    >
      <span className={isActive ? "text-[#E8622A]" : "text-slate-400"}>{icon}</span>
      {children}
    </Link>
  );
}
