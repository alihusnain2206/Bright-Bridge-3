import React from "react";
import { Link, useRoute } from "wouter";
import { AlertTriangle, Activity, Clock, CalendarDays, Calendar, Settings, Webhook, Menu } from "lucide-react";
import { Button } from "./ui/button";
import { useGetEasyTeamStatus } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: status } = useGetEasyTeamStatus({ query: { enabled: true } });

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      {/* Sandbox Banner */}
      <div className="bg-amber-400 text-amber-950 px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 shadow-sm z-50 relative">
        <AlertTriangle className="h-4 w-4" />
        ⚠️ SANDBOX MODE — This is a testing environment. No real data or payments.
      </div>

      {/* Header / Navbar */}
      <header className="bg-primary text-primary-foreground shadow-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-accent" />
            <span className="font-bold text-lg tracking-tight">BrightBridge</span>
            <span className="opacity-50 mx-2">|</span>
            <span className="font-medium text-sm bg-primary-foreground/10 px-2 py-1 rounded">
              EasyTeam Integration Test
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            <NavLink href="/" icon={<Activity className="w-4 h-4" />}>Dashboard</NavLink>
            <NavLink href="/timeclock" icon={<Clock className="w-4 h-4" />}>Time Clock</NavLink>
            <NavLink href="/timesheets" icon={<CalendarDays className="w-4 h-4" />}>Timesheets</NavLink>
            <NavLink href="/schedule" icon={<Calendar className="w-4 h-4" />}>Schedule</NavLink>
            <NavLink href="/webhooks" icon={<Webhook className="w-4 h-4" />}>Webhooks</NavLink>
            <NavLink href="/config" icon={<Settings className="w-4 h-4" />}>Config</NavLink>
          </div>

          <div className="md:hidden">
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/20">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* API Key Missing Banner */}
      {status && !status.apiKeyPresent && (
        <div className="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 shadow-sm">
          API Key is missing. Please configure your EasyTeam API key in the configuration tab.
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children, icon }: { href: string, children: React.ReactNode, icon?: React.ReactNode }) {
  const [isActive] = useRoute(href);
  return (
    <Link href={href} className={`flex items-center gap-2 transition-colors hover:text-accent ${isActive ? "text-accent border-b-2 border-accent pb-1 -mb-[6px]" : "text-primary-foreground/80 pb-1 -mb-[6px] border-b-2 border-transparent"}`}>
      {icon}
      {children}
    </Link>
  );
}
