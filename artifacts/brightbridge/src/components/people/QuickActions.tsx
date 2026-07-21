import React, { useState } from "react";
import { Link } from "wouter";
import {
  UserPlus, PlayCircle, FolderOpen, BarChart2, GitFork,
  CalendarDays, ClipboardList, Megaphone, Workflow,
  CheckCheck,
} from "lucide-react";

const NAVY = "#1B3A6B";

interface Action {
  icon: React.ReactNode;
  label: string;
  href?: string;
  soon?: boolean;
  adminOnly?: boolean;
}

function ActionButton({ action }: { action: Action }) {
  const [hoverMsg, setHoverMsg] = useState(false);

  if (action.soon) {
    return (
      <div className="relative">
        <button
          onMouseEnter={() => setHoverMsg(true)}
          onMouseLeave={() => setHoverMsg(false)}
          className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 transition-colors opacity-40 cursor-not-allowed min-w-[72px]"
        >
          <div className="p-1.5 rounded-lg" style={{ background: `${NAVY}10` }}>
            {action.icon}
          </div>
          <span className="text-[10px] font-medium text-gray-500 text-center leading-tight">{action.label}</span>
        </button>
        {hoverMsg && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-gray-800 text-white text-[10px] rounded-md whitespace-nowrap z-10">
            Coming Soon
          </div>
        )}
      </div>
    );
  }

  return (
    <Link href={action.href ?? "#"}>
      <button className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-gray-100 bg-white hover:bg-[#0EA5C9]/5 hover:border-[#0EA5C9]/30 transition-colors min-w-[72px]">
        <div className="p-1.5 rounded-lg" style={{ background: `${NAVY}10` }}>
          {action.icon}
        </div>
        <span className="text-[10px] font-medium text-gray-600 text-center leading-tight">{action.label}</span>
      </button>
    </Link>
  );
}

const ICON_CLS = "h-4 w-4 text-[#1B3A6B]";

const ADMIN_ACTIONS: Action[] = [
  { icon: <UserPlus className={ICON_CLS} />,    label: "Add Employee",       href: "/people/new" },
  { icon: <PlayCircle className={ICON_CLS} />,  label: "Start Onboarding",   href: "/people/onboarding" },
  { icon: <FolderOpen className={ICON_CLS} />,  label: "Upload Document",    href: "/people/documents" },
  { icon: <BarChart2 className={ICON_CLS} />,   label: "Run Report",         soon: true },
  { icon: <GitFork className={ICON_CLS} />,     label: "Org Chart",          soon: true },
  { icon: <CalendarDays className={ICON_CLS} />,label: "Time Off Calendar",  href: "/timesheets" },
  { icon: <ClipboardList className={ICON_CLS} />,label: "Open Task Center",  href: "/people/onboarding" },
  { icon: <Megaphone className={ICON_CLS} />,   label: "Send Announcement",  soon: true },
  { icon: <Workflow className={ICON_CLS} />,     label: "Create Workflow",    soon: true },
];

const MANAGER_ACTIONS: Action[] = [
  { icon: <CheckCheck className={ICON_CLS} />,  label: "Approve PTO",        href: "/timesheets" },
  { icon: <UserPlus className={ICON_CLS} />,    label: "Team Directory",     href: "/people" },
  { icon: <ClipboardList className={ICON_CLS} />,label: "Open Task Center",  href: "/people/onboarding" },
  { icon: <CalendarDays className={ICON_CLS} />,label: "Time Off Calendar",  href: "/timesheets" },
];

export default function QuickActions({ role }: { role?: string }) {
  const actions = (role === "super_admin" || role === "owner" || role === "admin") ? ADMIN_ACTIONS : MANAGER_ACTIONS;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</p>
      <div className="flex flex-wrap gap-2">
        {actions.map(a => <ActionButton key={a.label} action={a} />)}
      </div>
    </div>
  );
}
