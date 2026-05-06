import React from "react";
import { Link, useRoute } from "wouter";
import { AlertTriangle, Activity, Clock, CalendarDays, Calendar, Settings, Webhook, Menu, Building2 } from "lucide-react";
import { Button } from "./ui/button";
import { useGetEasyTeamStatus } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: status } = useGetEasyTeamStatus();

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex flex-col">
      {/* Sandbox Banner */}
      <div className="bg-accent text-accent-foreground px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 shadow-sm z-50 relative">
        <AlertTriangle className="h-4 w-4" />
        SANDBOX MODE — This is a testing environment. No real data or payments.
      </div>

      {/* Header / Navbar */}
      <header className="bg-primary text-primary-foreground shadow-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/brightbridge-logo.png"
              alt="Brightbridge Assist"
              className="h-9 w-auto brightness-0 invert"
            />
            <div className="h-6 w-px bg-white/20 mx-1" />
            <span className="text-sm font-medium text-white/70 hidden sm:block">
              EasyTeam Integration Test
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
            <NavLink href="/" icon={<Activity className="w-4 h-4" />}>Dashboard</NavLink>
            <NavLink href="/clients" icon={<Building2 className="w-4 h-4" />}>Clients</NavLink>
            <NavLink href="/timeclock" icon={<Clock className="w-4 h-4" />}>Time Clock</NavLink>
            <NavLink href="/timesheets" icon={<CalendarDays className="w-4 h-4" />}>Timesheets</NavLink>
            <NavLink href="/schedule" icon={<Calendar className="w-4 h-4" />}>Schedule</NavLink>
            <NavLink href="/webhooks" icon={<Webhook className="w-4 h-4" />}>Webhooks</NavLink>
            <NavLink href="/config" icon={<Settings className="w-4 h-4" />}>Config</NavLink>
          </nav>

          <div className="md:hidden">
            <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/20">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* API Key Missing Banner */}
      {status && !status.apiKeyPresent && (
        <div className="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium flex items-center justify-center gap-2">
          API Key is missing. Please configure your EasyTeam API key in the Config tab.
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children, icon }: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const [isActive] = useRoute(href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 transition-colors px-1 pb-1 -mb-[1px] border-b-2 ${
        isActive
          ? "text-accent border-accent"
          : "text-white/75 border-transparent hover:text-white"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
