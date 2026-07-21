import React, { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  FlaskConical, LayoutDashboard, Clock, CalendarDays, Calendar,
  Webhook, Settings, LogOut, ShieldCheck, Scale, Building2, DollarSign,
  Users, Briefcase, ChevronDown, ChevronRight,
  UserPlus, ClipboardList, FolderOpen, Phone, FileText,
} from "lucide-react";
import { useAuth, dashboardPath } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

interface NavSubItem {
  href: string;
  label: string;
  soon?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavSubItem[];
}

const PEOPLE_SUBNAV: NavSubItem[] = [
  { href: "/people/directory",    label: "Employee Directory" },
  { href: "/people",              label: "Employee Profiles",    soon: true },
  { href: "/people/new-hires",    label: "New Hires" },
  { href: "/people/onboarding",   label: "Onboarding" },
  { href: "/people",              label: "Job & Compensation",   soon: true },
  { href: "/people/documents",    label: "Documents" },
  { href: "/people",              label: "Benefits",             soon: true },
  { href: "/timesheets",          label: "Time & Attendance" },
  { href: "/people",              label: "Training",             soon: true },
  { href: "/people",              label: "Performance",          soon: true },
  { href: "/people",              label: "Assets",               soon: true },
  { href: "/people/contacts",     label: "Emergency Contacts" },
  { href: "/people",              label: "Certifications",       soon: true },
  { href: "/people/compliance",   label: "Compliance" },
  { href: "/people",              label: "Employment History",   soon: true },
  { href: "/people",              label: "Offboarding",         soon: true },
];

function getNavItems(role: string | undefined): NavItem[] {
  switch (role) {
    case "super_admin":
      return [
        { href: "/dashboard/super-admin", label: "Dashboard", icon: LayoutDashboard },
        { href: "/clients",               label: "Clients",    icon: Building2 },
        { href: "/people",               label: "People",     icon: Users, children: PEOPLE_SUBNAV },
        { href: "/timeclock",             label: "Time Clock", icon: Clock },
        { href: "/timesheets",            label: "Timesheets", icon: CalendarDays },
        { href: "/schedule",             label: "Schedule",   icon: Calendar },
        { href: "/roles",                label: "Roles",      icon: Scale },
        { href: "/payroll",              label: "Payroll",    icon: DollarSign },
        { href: "/webhooks",             label: "Webhooks",   icon: Webhook },
        { href: "/config",               label: "Config",     icon: Settings },
      ];
    case "owner":
      return [
        { href: "/dashboard/owner",  label: "Dashboard",  icon: LayoutDashboard },
        { href: "/people",           label: "People",     icon: Users, children: PEOPLE_SUBNAV },
        { href: "/timesheets",       label: "Timesheets", icon: CalendarDays },
        { href: "/schedule",         label: "Schedule",   icon: Calendar },
        {
          href: "/manager-payroll",
          label: "Payroll",
          icon: Briefcase,
          children: [
            { href: "/manager-payroll",               label: "Current Payrolls" },
            { href: "/manager-payroll?tab=history",   label: "Payroll History" },
            { href: "/manager-payroll?tab=offcycle",  label: "Off-Cycle Payrolls" },
            { href: "/manager-payroll/submit",        label: "Submit Payroll" },
          ],
        },
        { href: "/webhooks", label: "Webhooks", icon: Webhook },
        { href: "/config",   label: "Config",   icon: Settings },
        { href: "/roles",    label: "Roles",    icon: Scale },
      ];
    case "manager":
      return [
        { href: dashboardPath("manager"), label: "Dashboard",       icon: LayoutDashboard },
        { href: "/timesheets",            label: "Timesheets",      icon: CalendarDays },
        { href: "/people",                label: "People",          icon: Users, children: PEOPLE_SUBNAV },
        {
          href: "/manager-payroll",
          label: "Payroll",
          icon: Briefcase,
          children: [
            { href: "/manager-payroll",               label: "Current Payrolls" },
            { href: "/manager-payroll?tab=history",   label: "Payroll History" },
            { href: "/manager-payroll?tab=offcycle",  label: "Off-Cycle Payrolls" },
            { href: "/manager-payroll/submit",        label: "Submit Payroll" },
          ],
        },
        { href: "/roles", label: "Role Comparison", icon: Scale },
      ];
    case "employee":
      return [
        { href: dashboardPath("employee"), label: "Dashboard",       icon: LayoutDashboard },
        { href: "/roles",                  label: "Role Comparison", icon: Scale },
      ];
    case "parent":
      return [
        { href: dashboardPath("parent"), label: "Dashboard",       icon: LayoutDashboard },
        { href: "/roles",                label: "Role Comparison", icon: Scale },
      ];
    default:
      return [];
  }
}

const ROLE_COLOR: Record<string, string> = {
  super_admin: "#dc2626",
  owner:       "#7c3aed",
  manager:     "#d97706",
  employee:    "#16a34a",
  parent:      "#2563eb",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  const navItems = getNavItems(user?.role);

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const isGroupExpanded = (item: NavItem) => {
    if (!item.children) return false;
    const onChildPath = location.startsWith(item.href);
    return onChildPath || manualExpanded.has(item.href);
  };

  const toggleGroup = (href: string) => {
    setManualExpanded(prev => {
      const next = new Set(prev);
      if (next.has(href)) { next.delete(href); } else { next.add(href); }
      return next;
    });
  };

  const isSubItemActive = (childHref: string, label: string) => {
    const [childPath, childQuery] = childHref.split("?");
    if (location !== childPath) return false;
    if (childQuery) {
      const childTab = new URLSearchParams(childQuery).get("tab") ?? "current";
      const currentTab = new URLSearchParams(search).get("tab") ?? "current";
      return childTab === currentTab;
    }
    return true;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Sandbox banner */}
      <div
        className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide shrink-0"
        style={{ background: "linear-gradient(90deg, #284362 0%, #325278 100%)", color: "#fff" }}
      >
        <FlaskConical className="h-3.5 w-3.5 opacity-70" />
        <span className="opacity-80">SANDBOX</span>
        <span className="opacity-40 mx-1">·</span>
        <span className="opacity-70 font-normal">Testing environment — no real data or payments</span>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ── */}
        <aside
          className="w-56 flex flex-col shrink-0 overflow-y-auto"
          style={{ background: "#1b3250" }}
        >
          {/* Logo */}
          <div className="px-5 py-4 border-b border-white/10 shrink-0 bg-white">
            <Link href={user ? dashboardPath(user.role) : "/"}>
              <img
                src="/brightbridge-logo.png"
                alt="BrightBridge"
                className="h-8 object-contain cursor-pointer"
              />
            </Link>
          </div>

          {/* Nav items */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {navItems.map((item) => {
              const { href, label, icon: Icon, children } = item;

              if (!children) {
                return (
                  <Link key={href + label} href={href}>
                    <button
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left ${
                        isActive(href)
                          ? "bg-[#E8622A] text-white shadow-sm"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </button>
                  </Link>
                );
              }

              const expanded = isGroupExpanded(item);
              const parentActive = isActive(href);

              return (
                <div key={href + label}>
                  <Link href={href}>
                    <button
                      onClick={() => { if (parentActive) toggleGroup(href); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left ${
                        parentActive
                          ? "bg-[#E8622A]/20 text-white"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {expanded
                        ? <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                        : <ChevronRight className="h-3.5 w-3.5 opacity-40" />}
                    </button>
                  </Link>

                  {expanded && (
                    <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-white/10 pl-3">
                      {children.map(child => (
                        child.soon ? (
                          <div key={child.label}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white/25 cursor-not-allowed select-none">
                            <span className="flex-1 truncate">{child.label}</span>
                            <span className="text-[9px] font-semibold bg-white/10 text-white/30 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">Soon</span>
                          </div>
                        ) : (
                          <Link key={child.href + child.label} href={child.href}>
                            <button
                              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                                isSubItemActive(child.href, child.label)
                                  ? "bg-[#E8622A] text-white shadow-sm"
                                  : "text-white/50 hover:text-white hover:bg-white/10"
                              }`}
                            >
                              {child.label}
                            </button>
                          </Link>
                        )
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* EasyTeam live indicator */}
          <div className="px-4 pb-3 shrink-0">
            <div className="flex items-center gap-1.5 text-xs border border-[#E8622A]/30 rounded-full px-3 py-1.5 text-[#E8622A] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E8622A] animate-pulse" />
              EasyTeam Live
            </div>
          </div>

          {/* User + Logout */}
          <div className="px-4 pt-3 pb-5 border-t border-white/10 shrink-0">
            {user && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${ROLE_COLOR[user.role] ?? "#E8622A"}30` }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" style={{ color: ROLE_COLOR[user.role] ?? "#E8622A" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-white text-xs font-semibold truncate">{user.name.split(" ")[0]}</div>
                    <div className="text-white/40 text-[10px] uppercase tracking-wider truncate">
                      {user.role.replace(/_/g, " ")}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="w-full justify-start h-7 text-xs text-white/50 hover:text-white hover:bg-white/10 gap-2 px-2"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Logout
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}
        >
          <div className="px-6 py-6">
            {children}
          </div>
          <footer className="text-center py-4 text-xs text-muted-foreground border-t border-gray-100/80">
            BrightBridge Assist · EasyTeam Embedded SDK Integration Test
          </footer>
        </main>

      </div>
    </div>
  );
}
