import React from "react";
import { useLocation } from "wouter";
import { useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";
import { CheckCircle2, XCircle } from "lucide-react";

const YES = <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />;
const NO = <XCircle className="h-4 w-4 text-red-400 mx-auto" />;
const COMPANY = <span className="text-xs text-amber-600 font-medium">Company only</span>;
const ADMIN = <span className="text-xs text-emerald-600 font-medium">Admin</span>;
const MGR = <span className="text-xs text-emerald-600 font-medium">Manager</span>;
const EMP = <span className="text-xs text-emerald-600 font-medium">Employee</span>;
const NONE = <span className="text-xs text-red-400 font-medium">None</span>;

const FEATURES = [
  { label: "EasyTeam Access",        super_admin: YES, owner: YES,     manager: YES,     employee: YES, parent: NO  },
  { label: "Clock In / Out",         super_admin: YES, owner: YES,     manager: YES,     employee: YES, parent: NO  },
  { label: "View All Timesheets",    super_admin: YES, owner: COMPANY, manager: COMPANY, employee: NO,  parent: NO  },
  { label: "Edit Timesheets",        super_admin: YES, owner: YES,     manager: YES,     employee: NO,  parent: NO  },
  { label: "Manage Schedules",       super_admin: YES, owner: YES,     manager: YES,     employee: NO,  parent: NO  },
  { label: "Approve Time Off",       super_admin: YES, owner: YES,     manager: YES,     employee: NO,  parent: NO  },
  { label: "View Reports",           super_admin: YES, owner: YES,     manager: YES,     employee: NO,  parent: NO  },
  { label: "People Hub (full)",      super_admin: YES, owner: YES,     manager: NO,      employee: NO,  parent: NO  },
  { label: "Payroll",                super_admin: YES, owner: YES,     manager: NO,      employee: NO,  parent: NO  },
  { label: "Compliance & Docs",      super_admin: YES, owner: YES,     manager: NO,      employee: NO,  parent: NO  },
  { label: "Webhooks & Config",      super_admin: YES, owner: YES,     manager: NO,      employee: NO,  parent: NO  },
  { label: "All Companies",          super_admin: YES, owner: NO,      manager: NO,      employee: NO,  parent: NO  },
  { label: "Parent Check-In",        super_admin: NO,  owner: NO,      manager: NO,      employee: NO,  parent: YES },
  { label: "JWT Level",              super_admin: ADMIN, owner: MGR,   manager: MGR,     employee: EMP, parent: NONE },
];

const COLUMNS = [
  { key: "super_admin", label: "Super Admin", color: "#dc2626" },
  { key: "owner",       label: "Owner",       color: "#7c3aed" },
  { key: "manager",     label: "Manager",     color: "#d97706" },
  { key: "employee",    label: "Employee",    color: "#16a34a" },
  { key: "parent",      label: "Parent",      color: "#2563eb" },
] as const;

const QUICK_LOGINS = [
  { label: "Super Admin — Joanne", email: "joanne@brightbridgeassist.com", password: "Admin123!",   color: "#dc2626", role: "super_admin" as UserRole },
  { label: "Owner — Sunshine",     email: "manager@sunshine.com",          password: "Manager123!", color: "#7c3aed", role: "owner"       as UserRole },
  { label: "Owner — Rainbow",      email: "manager@rainbow.com",           password: "Manager123!", color: "#7c3aed", role: "owner"       as UserRole },
  { label: "Employee — John",      email: "john@sunshine.com",             password: "Staff123!",   color: "#16a34a", role: "employee"    as UserRole },
  { label: "Employee — Tom",       email: "tom@rainbow.com",               password: "Staff123!",   color: "#16a34a", role: "employee"    as UserRole },
  { label: "Employee — Ali",       email: "ali@rainbow.com",               password: "Staff123!",   color: "#16a34a", role: "employee"    as UserRole },
  { label: "Employee — Lisa",      email: "lisa.chen@rainbow.com",         password: "Staff123!",   color: "#16a34a", role: "employee"    as UserRole },
  { label: "Parent — Sarah",       email: "sarah@parent.com",              password: "Parent123!",  color: "#2563eb", role: "parent"      as UserRole },
];

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;

export default function Roles() {
  const { login } = useAuth();
  const [, navigate] = useLocation();

  const quickLogin = async (q: typeof QUICK_LOGINS[0]) => {
    const result = await login(q.email, q.password);
    if (result.success && result.user) navigate(dashboardPath(result.user.role as UserRole));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">User Role Comparison</h1>
        <p className="text-muted-foreground mt-1">See how different roles access BrightBridge and EasyTeam features.</p>
      </div>

      {/* Comparison table */}
      <div className="rounded-2xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#284362" }}>
                <th className="text-left px-5 py-4 text-white/60 text-sm font-medium w-48">Feature</th>
                {COLUMNS.map(({ label, color }) => (
                  <th key={label} className="px-4 py-4 text-center">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, i) => (
                <tr key={f.label} className={i % 2 === 0 ? "bg-white" : "bg-muted/30"}>
                  <td className="px-5 py-3 text-sm font-medium text-gray-800">{f.label}</td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-4 py-3 text-center">{f[col.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick login */}
      <div className="rounded-2xl border overflow-hidden" style={PANEL}>
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold text-base">Quick Login — Test Any Role</h2>
          <p className="text-white/50 text-sm mt-0.5">Click a button to instantly log in and see that role's dashboard.</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {QUICK_LOGINS.map((q) => (
            <button
              key={q.email}
              onClick={() => quickLogin(q)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 text-left transition-all hover:border-white/30 hover:bg-white/10"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: q.color }} />
              <div className="min-w-0">
                <div className="text-white text-sm font-medium truncate">{q.label}</div>
                <div className="text-white/40 text-xs font-mono truncate">{q.email}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
