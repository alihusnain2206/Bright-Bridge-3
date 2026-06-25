import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Users, Plus, CheckCircle2, Clock, AlertTriangle,
  XCircle, Search, ChevronRight, MapPin, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const ORANGE = "#E8622A";
const NAVY = "#284362";

interface Company {
  id: string; name: string; doingBusinessAs?: string; phone: string;
  industry: string; package: string; status: string;
  address1: string; city: string; state: string; zipcode: string;
  kybStatus: string; bankAccountAdded: boolean; payScheduleAdded: boolean;
  payFrequency?: string; rollfiCompanyId?: string;
  createdAt: string; employeeCount?: number;
}

const STATUS_CFG: Record<string, { label: string; dot: string; text: string }> = {
  active:      { label: "Active",      dot: "bg-emerald-500", text: "text-emerald-700" },
  setting_up:  { label: "Setting Up",  dot: "bg-yellow-500",  text: "text-yellow-700" },
  pending:     { label: "Pending",     dot: "bg-orange-500",  text: "text-orange-700" },
  suspended:   { label: "Suspended",   dot: "bg-red-500",     text: "text-red-700" },
};

const INDUSTRY_LABEL: Record<string, string> = {
  daycare: "Daycare Centre", retail: "Retail", medical: "Medical",
  construction: "Construction", other: "Other",
};

const PKG_LABEL: Record<string, string> = {
  full_daycare: "Full Daycare", payroll_only: "Payroll Only", payroll_hr_workforce: "Payroll + HR",
};

function CompanyCard({ company }: { company: Company }) {
  const cfg = STATUS_CFG[company.status] ?? STATUS_CFG.pending;
  const hasRollfi = !!company.rollfiCompanyId;

  const onboardingItems = [
    { done: true,                       label: "BrightBridge account" },
    { done: hasRollfi,                  label: "Rollfi registered" },
    { done: company.kybStatus === "verified", label: "KYB verified" },
    { done: company.bankAccountAdded,   label: "Bank account" },
    { done: company.payScheduleAdded,   label: "Pay schedule" },
  ];
  const doneCount = onboardingItems.filter((i) => i.done).length;

  return (
    <div className="bg-white rounded-2xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="px-5 py-4 border-b bg-gray-50/50 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ORANGE}15` }}>
            <Building2 className="h-5 w-5" style={{ color: ORANGE }} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 truncate">{company.name}</h3>
            {company.doingBusinessAs && company.doingBusinessAs !== company.name && (
              <p className="text-xs text-gray-400">dba {company.doingBusinessAs}</p>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 ${cfg.text} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{company.city}, {company.state}</span>
          <span className="flex items-center gap-1"><Package className="h-3 w-3" />{PKG_LABEL[company.package] ?? company.package}</span>
          <span className="px-1.5 py-0.5 rounded bg-[#284362]/8 text-[#284362] text-[10px] font-medium">{INDUSTRY_LABEL[company.industry] ?? company.industry}</span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-gray-600">
            <Users className="h-3.5 w-3.5 text-gray-400" />
            <span className="font-semibold">{company.employeeCount ?? 0}</span>
            <span className="text-gray-400">employees</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600">
            <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />
            <span className="font-semibold">{doneCount}/5</span>
            <span className="text-gray-400">setup done</span>
          </div>
          {company.payFrequency && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Clock className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-gray-400">{company.payFrequency}</span>
            </div>
          )}
        </div>

        {/* Onboarding mini checklist */}
        <div className="flex gap-1.5 flex-wrap">
          {onboardingItems.map((item) => (
            <span key={item.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${item.done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
              {item.done ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="px-5 py-3 border-t bg-gray-50/40 flex items-center gap-2">
        <Link href={`/clients/${company.id}`} className="flex-1">
          <Button size="sm" className="w-full gap-1.5 text-white border-0" style={{ background: NAVY }}>
            View Details <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <Link href={`/clients/${company.id}/employees/new`}>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />Add Employee
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery<{ companies: Company[] }>({
    queryKey: ["/api/companies"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then((r) => r.json()),
  });

  const companies = (data?.companies ?? []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.city.toLowerCase().includes(search.toLowerCase())
  );

  const active = companies.filter((c) => c.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading ? "Loading…" : `${companies.length} daycare centers · ${active} active`}
          </p>
        </div>
        <Link href="/clients/new">
          <Button className="gap-2 text-white border-0" style={{ background: ORANGE }}>
            <Plus className="h-4 w-4" />Add New Client
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or city…" className="pl-9" />
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Clients", value: companies.length, color: NAVY },
          { label: "Active", value: companies.filter((c) => c.status === "active").length, color: "#16a34a" },
          { label: "Setting Up", value: companies.filter((c) => c.status !== "active" && c.status !== "suspended").length, color: "#d97706" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border px-4 py-3 text-center shadow-sm">
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Company cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />Failed to load clients. Please refresh.
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl">
          <Building2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-700">{search ? "No matching clients" : "No clients yet"}</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">{search ? "Try a different search" : "Add your first daycare center to get started."}</p>
          {!search && (
            <Link href="/clients/new">
              <Button className="gap-2 text-white border-0" style={{ background: ORANGE }}><Plus className="h-4 w-4" />Add First Client</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {companies.map((c) => <CompanyCard key={c.id} company={c} />)}
        </div>
      )}
    </div>
  );
}
