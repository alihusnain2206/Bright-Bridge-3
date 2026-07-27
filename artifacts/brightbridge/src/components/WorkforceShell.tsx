import React from "react";
import { Link } from "wouter";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface WFClientItem { id: string; name?: string }

export interface WorkforceShellProps {
  activeTab: "overview" | "employees" | "departments";
  companyId: string;
  setCompanyId: (id: string) => void;
  isSuperAdmin: boolean;
  clients: WFClientItem[];
  fromDate: string;
  setFromDate: (d: string) => void;
  toDate: string;
  setToDate: (d: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function fmtWFDateLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to   + "T12:00:00");
  return `${f.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function SoonPill({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-gray-400 cursor-default select-none">
      {label}
      <span className="px-1.5 py-0.5 rounded-full border border-gray-200 text-gray-400" style={{ fontSize: "10px" }}>
        Soon
      </span>
    </span>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href}>
      <span
        className={`cursor-pointer pb-1 font-medium text-sm ${
          active ? "text-[#0EA5C9] border-b-2 border-[#0EA5C9]" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}

export function WorkforceShell({
  activeTab, companyId, setCompanyId, isSuperAdmin, clients,
  fromDate, setFromDate, toDate, setToDate, loading, onRefresh,
}: WorkforceShellProps) {
  return (
    <div className="border-b border-gray-100 bg-white px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workforce Management &amp; Attendance</h1>
          <p className="text-sm text-gray-400 mt-0.5">{fmtWFDateLabel(fromDate, toDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin && clients.length > 0 && (
            <Select value={companyId} onValueChange={v => setCompanyId(v)}>
              <SelectTrigger className="h-8 w-44 text-xs border-gray-200 bg-white text-gray-700">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {clients.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name ?? c.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input
            type="date" value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="h-8 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
          />
          <span className="text-gray-400 text-xs">–</span>
          <input
            type="date" value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="h-8 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
          />
          <Button
            size="sm" variant="ghost"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 text-xs text-gray-500 border border-gray-200 hover:bg-gray-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Sub-nav */}
      <div className="flex items-center gap-5 mt-4 text-sm">
        <NavLink href="/workforce"             label="Overview"       active={activeTab === "overview"} />
        <SoonPill label="My Team" />
        <NavLink href="/workforce/employees"   label="All Employees"  active={activeTab === "employees"} />
        <SoonPill label="Locations" />
        <NavLink href="/workforce/departments" label="Departments"    active={activeTab === "departments"} />
      </div>
    </div>
  );
}
