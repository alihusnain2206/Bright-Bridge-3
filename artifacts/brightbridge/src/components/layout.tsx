import React from "react";
import { Link, useLocation } from "wouter";
import { FlaskConical, LayoutDashboard, Users, Clock, CalendarDays, Calendar, Webhook, Settings, LogOut, ShieldCheck, Scale, Building2 } from "lucide-react";
import { useAuth, dashboardPath } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function getNavItems(role: string | undefined): NavItem[] {
  switch (role) {
    case "super_admin":
      return [
        { href: "/dashboard/super-admin", label: "Dashboard", icon: LayoutDashboard },
        { href: "/clients", label: "Clients", icon: Building2 },
        { href: "/timeclock", label: "Time Clock", icon: Clock },
        { href: "/timesheets", label: "Timesheets", icon: CalendarDays },
        { href: "/schedule", label: "Schedule", icon: Calendar },
        { href: "/roles", label: "Roles", icon: Scale },
        { href: "/webhooks", label: "Webhooks", icon: Webhook },
        { href: "/config", label: "Config", icon: Settings },
      ];
    case "manager":
      return [
        { href: dashboardPath("manager"), label: "Dashboard", icon: LayoutDashboard },
        { href: "/roles", label: "Role Comparison", icon: Scale },
      ];
    case "employee":
      return [
        { href: dashboardPath("employee"), label: "Dashboard", icon: LayoutDashboard },
        { href: "/roles", label: "Role Comparison", icon: Scale },
      ];
    case "parent":
      return [
        { href: dashboardPath("parent"), label: "Dashboard", icon: LayoutDashboard },
        { href: "/roles", label: "Role Comparison", icon: Scale },
      ];
    default:
      return [];
  }
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const navItems = getNavItems(user?.role);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>

      {/* Slim sandbox notice */}
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide"
        style={{ background: "linear-gradient(90deg, #284362 0%, #325278 100%)", color: "#fff" }}>
        <FlaskConical className="h-3.5 w-3.5 opacity-70" />
        <span className="opacity-80">SANDBOX</span>
        <span className="opacity-40 mx-1">·</span>
        <span className="opacity-70 font-normal">Testing environment — no real data or payments</span>
      </div>

      {/* Navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100"
        style={{ boxShadow: "0 1px 3px rgba(40,67,98,0.07), 0 4px 12px rgba(40,67,98,0.04)" }}>
        <div className="px-6 h-14 flex items-center gap-6">
          {/* Logo */}
          <Link href={user ? dashboardPath(user.role) : "/"}>
            <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-8 object-contain cursor-pointer" />
          </Link>

          <div className="w-px h-6 bg-gray-100" />

          {/* Nav links */}
          <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive(href)
                    ? "bg-[#E8622A] text-white"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            {/* EasyTeam status */}
            <div className="hidden md:flex items-center gap-1.5 text-xs border border-[#E8622A]/30 rounded-full px-3 py-1 text-[#E8622A] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E8622A] animate-pulse" />
              EasyTeam Live
            </div>

            {/* User info + logout */}
            {user && (
              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="font-medium text-gray-700">{user.name.split(" ")[0]}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-500">
                    {user.role.replace("_", " ")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="h-7 px-2 text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 gap-1"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Logout</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
        {children}
      </main>

      <footer className="text-center py-4 text-xs text-muted-foreground border-t border-gray-100 bg-white/50">
        BrightBridge Assist · EasyTeam Embedded SDK Integration Test
      </footer>
    </div>
  );
}
