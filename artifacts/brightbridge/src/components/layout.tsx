import React, { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  FlaskConical, LayoutDashboard, Clock, CalendarDays, Calendar,
  Webhook, Settings, SlidersHorizontal, LogOut, ShieldCheck, Scale, Building2, DollarSign,
  Users, Briefcase, ChevronDown, ChevronRight,
  UserPlus, ClipboardList, FolderOpen, Phone, FileText,
  BarChart2, AlertTriangle, UserCog, Menu, X,
} from "lucide-react";
import { useAuth, dashboardPath } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationBell } from "@/components/NotificationBell";

interface NavSubItem {
  href: string;
  label: string;
  soon?: boolean;
  /** Renders as a non-clickable section label/divider in the sub-nav. */
  heading?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavSubItem[];
}

const PEOPLE_SUBNAV: NavSubItem[] = [
  { href: "/people/directory",    label: "Employee Directory" },
  { href: "/people/new-hires",    label: "New Hires" },
  { href: "/people/onboarding",   label: "Onboarding" },
  { href: "/people/documents",    label: "Documents" },
  { href: "/timesheets",          label: "Time & Attendance" },
  { href: "/people/contacts",     label: "Emergency Contacts" },
  { href: "/people/compliance",   label: "Compliance" },
];

function getNavItems(role: string | undefined): NavItem[] {
  switch (role) {
    case "super_admin":
      return [
        { href: "/dashboard/super-admin", label: "Dashboard", icon: LayoutDashboard },
        { href: "/clients",               label: "Clients",    icon: Building2 },
        { href: "/people",                label: "People",     icon: Users, children: PEOPLE_SUBNAV },
        { href: "/workforce",             label: "Workforce",  icon: BarChart2 },
        { href: "/timeclock",             label: "Time Clock", icon: Clock },
        { href: "/timesheets",            label: "Timesheets", icon: CalendarDays },
        { href: "/schedule",              label: "Schedule",   icon: Calendar },
        { href: "/payroll",               label: "Payroll",    icon: DollarSign },
        {
          href: "/company-settings",
          label: "Company Settings",
          icon: Settings,
          children: [
            { href: "/account-settings", label: "Account Settings" },
            { href: "/users-access",     label: "Users & Access" },
            { href: "/settings",         label: "Organization Settings" },
          ],
        },
        { href: "/config",    label: "Config",    icon: SlidersHorizontal },
        { href: "/roles",     label: "Roles",     icon: Scale },
        { href: "/webhooks",  label: "Webhooks",  icon: Webhook },
      ];
    case "owner":
      return [
        { href: "/dashboard/owner",  label: "Dashboard",  icon: LayoutDashboard },
        { href: "/people",           label: "People",     icon: Users, children: PEOPLE_SUBNAV },
        { href: "/workforce",        label: "Workforce",  icon: BarChart2 },
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
        {
          href: "/company-settings",
          label: "Company Settings",
          icon: Settings,
          children: [
            { href: "/account-settings", label: "Account Settings" },
            { href: "/users-access",     label: "Users & Access" },
            { href: "/settings",         label: "Organization Settings" },
          ],
        },
        { href: "/config",    label: "Config",    icon: SlidersHorizontal },
        { href: "/roles",     label: "Roles",     icon: Scale },
        { href: "/webhooks",  label: "Webhooks",  icon: Webhook },
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
        { href: dashboardPath("employee"), label: "Dashboard",        icon: LayoutDashboard },
        { href: "/account-settings",       label: "Account Settings", icon: UserCog },
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

interface CompanyInfo { id: string; name: string; ein?: string; }

function getGreeting(name: string): { text: string; emoji: string; sub: string } {
  const h = new Date().getHours();
  const first = name.split(" ")[0] ?? name;
  if (h < 12) return { text: `Good morning, ${first}!`, emoji: "☀️", sub: "Here's what's happening with your workforce today." };
  if (h < 17) return { text: `Good afternoon, ${first}!`, emoji: "👋", sub: "Here's what's happening with your workforce today." };
  return { text: `Good evening, ${first}!`, emoji: "🌙", sub: "Here's what's happening with your workforce today." };
}

function EnvironmentBanner() {
  const rollfiEnv = useRollfiEnv();

  useEffect(() => {
    if (rollfiEnv === "production") {
      if (!document.title.startsWith("[LIVE] ")) {
        document.title = `[LIVE] ${document.title}`;
      }
    } else {
      if (document.title.startsWith("[LIVE] ")) {
        document.title = document.title.slice(7);
      }
    }
  }, [rollfiEnv]);

  if (rollfiEnv === "production") {
    return (
      <div
        className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold tracking-wide shrink-0"
        style={{ background: "#DC2626", color: "#fff" }}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>PRODUCTION · LIVE PAYROLL</span>
        <span className="mx-1 opacity-60">—</span>
        <span className="font-normal opacity-90">real employees and real money</span>
      </div>
    );
  }

  if (rollfiEnv === "unknown") {
    return (
      <div
        className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide shrink-0"
        style={{ background: "#6B7280", color: "#fff" }}
      >
        <span className="opacity-80">Environment unknown</span>
        <span className="opacity-40 mx-1">—</span>
        <span className="opacity-70 font-normal">verify configuration before taking action</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide shrink-0"
      style={{ background: "linear-gradient(90deg, #284362 0%, #325278 100%)", color: "#fff" }}
    >
      <FlaskConical className="h-3.5 w-3.5 opacity-70" />
      <span className="opacity-80">SANDBOX</span>
      <span className="opacity-40 mx-1">·</span>
      <span className="opacity-70 font-normal">Testing environment — no real data or payments</span>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  const navItems = getNavItems(user?.role);
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/companies?companyId=${user.companyId}`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { companies: CompanyInfo[] }) => {
        const c = d.companies.find(co => co.id === user.companyId);
        if (c) setCompany(c);
      })
      .catch(() => {});
  }, [user?.companyId]);

  const greeting = user ? getGreeting(user.name) : null;
  const companyName = company?.name ?? (user?.role === "super_admin" ? "BrightBridge Assist" : "");
  const companyEin = company?.ein;
  const userInitials = user
    ? user.name.split(" ").filter(Boolean).map(p => p[0]).join("").toUpperCase().slice(0, 2)
    : "?";

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
    // Auto-expand if the current path is the parent href or any child's path
    const onChildPath = location.startsWith(item.href) ||
      item.children.some(c => location.startsWith(c.href.split("?")[0]));
    return onChildPath || manualExpanded.has(item.href);
  };

  const toggleGroup = (href: string) => {
    setManualExpanded(prev => {
      const next = new Set(prev);
      if (next.has(href)) { next.delete(href); } else { next.add(href); }
      return next;
    });
  };

  const isSubItemActive = (childHref: string, _label: string) => {
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

      <EnvironmentBanner />

      {/* ── Top Header ── */}
      <header className="flex items-center gap-3 px-4 sm:px-5 h-14 sm:h-16 bg-white border-b border-gray-100 shrink-0 z-10">
        {/* Mobile hamburger */}
        <button
          className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
          onClick={() => setMobileOpen(v => !v)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Logo */}
        <Link href={user ? dashboardPath(user.role) : "/"}>
          <img
            src="/brightbridge-logo.png"
            alt="BrightBridge"
            className="h-9 sm:h-11 object-contain cursor-pointer"
          />
        </Link>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-100 mx-1 hidden lg:block" />

        {/* Greeting */}
        {greeting && (
          <div className="hidden lg:block">
            <div className="font-bold text-gray-900 text-sm leading-tight">
              {greeting.text} {greeting.emoji}
            </div>
            <div className="text-xs text-gray-400 leading-tight">{greeting.sub}</div>
          </div>
        )}

        {/* Flex spacer */}
        <div className="flex-1" />

        {/* Search bar */}
        <GlobalSearch />

        {/* Bell */}
        <NotificationBell />

        {/* Company + EIN + Avatar */}
        {companyName && (
          <div className="hidden md:flex items-center gap-2.5 pl-3 border-l border-gray-100">
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-900 leading-tight whitespace-nowrap">{companyName}</div>
              {companyEin ? (
                <div className="text-[11px] text-gray-400 leading-tight">EIN: {companyEin}</div>
              ) : (
                <div className="text-[11px] text-gray-400 leading-tight capitalize">
                  {(user?.role ?? "").replace(/_/g, " ")}
                </div>
              )}
            </div>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 select-none"
              style={{ background: ROLE_COLOR[user?.role ?? ""] ?? "#E8622A" }}
            >
              {userInitials}
            </div>
          </div>
        )}
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ── Mobile Nav Drawer ── */}
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            {/* Drawer */}
            <aside className="fixed inset-y-0 left-0 w-64 flex flex-col z-50 md:hidden bg-white border-r border-gray-100 shadow-xl overflow-y-auto">
              {/* Drawer header */}
              <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 shrink-0">
                <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-9 object-contain" />
                <button
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {/* Nav items — same as sidebar */}
              <nav className="flex-1 px-3 py-4 space-y-0.5">
                {navItems.map((item) => {
                  const { href, label, icon: Icon, children } = item;
                  if (!children) {
                    return (
                      <Link key={href + label} href={href}>
                        <button
                          onClick={() => setMobileOpen(false)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                            isActive(href)
                              ? "bg-[#2C4562] text-white shadow-sm"
                              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
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
                          onClick={() => { if (parentActive) toggleGroup(href); setMobileOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                            parentActive
                              ? "bg-[#2C4562]/10 text-[#2C4562]"
                              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{label}</span>
                          {expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
                        </button>
                      </Link>
                      {expanded && (
                        <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-gray-200 pl-3">
                          {children.map(child =>
                            child.heading ? (
                              <div key={child.label} className="mt-2 mb-0.5 px-2.5 text-[9px] font-bold text-gray-400 uppercase tracking-widest select-none">
                                {child.label}
                              </div>
                            ) : child.soon ? (
                              <div key={child.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-300 cursor-not-allowed select-none">
                                <span className="flex-1 truncate">{child.label}</span>
                                <span className="text-[9px] font-semibold bg-gray-100 text-gray-400 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">Soon</span>
                              </div>
                            ) : (
                              <Link key={child.href + child.label} href={child.href}>
                                <button
                                  onClick={() => setMobileOpen(false)}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                                    isSubItemActive(child.href, child.label)
                                      ? "bg-[#2C4562] text-white shadow-sm"
                                      : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                                  }`}
                                >
                                  {child.label}
                                </button>
                              </Link>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
              {/* User + Logout */}
              {user && (
                <div className="px-4 pt-3 pb-5 border-t border-gray-100 shrink-0 space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${ROLE_COLOR[user.role] ?? "#E8622A"}15` }}>
                      <ShieldCheck className="h-3.5 w-3.5" style={{ color: ROLE_COLOR[user.role] ?? "#E8622A" }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-gray-800 text-xs font-semibold truncate">{user.name}</div>
                      <div className="text-gray-400 text-[10px] uppercase tracking-wider">{user.role.replace(/_/g, " ")}</div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleLogout}
                    className="w-full justify-start h-7 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 gap-2 px-2">
                    <LogOut className="h-3.5 w-3.5" /> Logout
                  </Button>
                </div>
              )}
            </aside>
          </>
        )}

        {/* ── Sidebar (desktop) ── */}
        <aside className="hidden md:flex w-64 flex-col shrink-0 overflow-y-auto bg-white border-r border-gray-100">

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
                          ? "bg-[#2C4562] text-white shadow-sm"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
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
                          ? "bg-[#2C4562]/10 text-[#2C4562]"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {expanded
                        ? <ChevronDown className={`h-3.5 w-3.5 ${parentActive ? "text-[#E8622A]/60" : "text-gray-400"}`} />
                        : <ChevronRight className={`h-3.5 w-3.5 ${parentActive ? "text-[#E8622A]/50" : "text-gray-300"}`} />}
                    </button>
                  </Link>

                  {expanded && (
                    <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-gray-200 pl-3">
                      {children.map(child => (
                        child.heading ? (
                          <div key={child.label}
                            className="mt-2 mb-0.5 px-2.5 text-[9px] font-bold text-gray-400 uppercase tracking-widest select-none">
                            {child.label}
                          </div>
                        ) : child.soon ? (
                          <div key={child.label}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-300 cursor-not-allowed select-none">
                            <span className="flex-1 truncate">{child.label}</span>
                            <span className="text-[9px] font-semibold bg-gray-100 text-gray-400 px-1 py-0.5 rounded uppercase tracking-wide shrink-0">Soon</span>
                          </div>
                        ) : (
                          <Link key={child.href + child.label} href={child.href}>
                            <button
                              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                                isSubItemActive(child.href, child.label)
                                  ? "bg-[#2C4562] text-white shadow-sm"
                                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
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

          {/* User + Logout */}
          <div className="px-4 pt-3 pb-5 border-t border-gray-100 shrink-0">
            {user && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${ROLE_COLOR[user.role] ?? "#E8622A"}15` }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" style={{ color: ROLE_COLOR[user.role] ?? "#E8622A" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-gray-800 text-xs font-semibold truncate">{user.name.split(" ")[0]}</div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wider truncate">
                      {user.role.replace(/_/g, " ")}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="w-full justify-start h-7 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 gap-2 px-2"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Logout
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto bg-white min-w-0">
          <div className="px-3 py-4 sm:px-6 sm:py-6 max-w-screen-2xl mx-auto">
            {children}
          </div>
        </main>

      </div>
    </div>
  );
}
