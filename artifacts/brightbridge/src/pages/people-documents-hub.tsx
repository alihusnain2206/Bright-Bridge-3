import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen, ChevronLeft, Building2, Search,
  FileText, Download, Eye, AlertTriangle, CheckCircle2,
  File, ImageIcon, FileBadge, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Employee {
  id: string; firstName: string; lastName: string;
  department?: string | null; status: string; companyId: string;
}
interface Company { id: string; name: string; }
interface EmployeeDocument {
  id: string; employeeId: string; documentName: string; documentType: string;
  customTypeName?: string | null; fileName: string; fileUrl: string; fileSize?: number | null;
  mimeType?: string | null; status: string; uploadedAt: string; uploadedBy: string;
  verifiedAt?: string | null; expiryDate?: string | null; notes?: string | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  identification: "Identification",
  employment:     "Employment",
  tax:            "Tax Documents",
  payroll:        "Payroll",
  compliance:     "Compliance",
  training:       "Training",
  medical:        "Medical",
  background:     "Background Check",
  other:          "Other",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  identification: "#3B82F6",
  employment:     "#8B5CF6",
  tax:            "#F59E0B",
  payroll:        "#10B981",
  compliance:     "#E8622A",
  training:       "#0EA5C9",
  medical:        "#EC4899",
  background:     "#6366F1",
  other:          "#9CA3AF",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mimeType?: string | null) {
  if (!mimeType) return <File className="h-4 w-4" />;
  if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileBadge className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function initials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}
const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

// ── Per-employee document row ──────────────────────────────────
function EmployeeDocRow({ emp }: { emp: Employee }) {
  const { data, isLoading } = useQuery<{ documents: EmployeeDocument[] }>({
    queryKey: ["emp-docs", emp.id],
    queryFn: () => fetch(`/api/documents?employeeId=${emp.id}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ documents: EmployeeDocument[] }>),
    staleTime: 60_000,
  });

  const docs = data?.documents ?? [];
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const expiring = docs.filter(d => d.expiryDate && new Date(d.expiryDate) <= in30 && new Date(d.expiryDate) >= now);
  const expired = docs.filter(d => d.expiryDate && new Date(d.expiryDate) < now);
  const color = avatarColor(`${emp.firstName} ${emp.lastName}`);

  if (isLoading) return <Skeleton className="h-14 w-full rounded-xl" />;
  if (docs.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold"
          style={{ background: color }}>
          {initials(emp.firstName, emp.lastName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{emp.firstName} {emp.lastName}</p>
          <p className="text-xs text-gray-400">{emp.department ?? "Unassigned"} · {docs.length} document{docs.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {expiring.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium">
              {expiring.length} expiring
            </span>
          )}
          {expired.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
              {expired.length} expired
            </span>
          )}
          <Link href={`/people/${emp.id}/documents`}>
            <Button size="sm" variant="outline" className="h-7 text-xs">Manage</Button>
          </Link>
        </div>
      </div>
      <div className="divide-y divide-gray-50">
        {docs.slice(0, 4).map(doc => {
          const isExpired = doc.expiryDate && new Date(doc.expiryDate) < now;
          const isExpiring = !isExpired && doc.expiryDate && new Date(doc.expiryDate) <= in30;
          return (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="shrink-0" style={{ color: DOC_TYPE_COLORS[doc.documentType] ?? "#9CA3AF" }}>
                {fileIcon(doc.mimeType)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{doc.documentName}</p>
                <p className="text-[10px] text-gray-400">{DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}</p>
              </div>
              {isExpired && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium shrink-0">
                  Expired {fmtDate(doc.expiryDate)}
                </span>
              )}
              {isExpiring && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium shrink-0">
                  Expires {fmtDate(doc.expiryDate)}
                </span>
              )}
              {!isExpired && !isExpiring && doc.status === "uploaded" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 font-medium shrink-0">
                  {fmtDate(doc.uploadedAt)}
                </span>
              )}
              {doc.fileUrl && (
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors shrink-0">
                  <Eye className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          );
        })}
        {docs.length > 4 && (
          <div className="px-4 py-2">
            <Link href={`/people/${emp.id}/documents`}>
              <span className="text-xs text-[#0EA5C9] hover:underline cursor-pointer">
                +{docs.length - 4} more documents →
              </span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function PeopleDocumentsHubPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [search, setSearch] = useState("");

  const isAdmin = user?.role === "super_admin";
  const companyId = isAdmin ? selectedCompanyId : (user?.companyId ?? "");

  const { data: companiesData } = useQuery<{ companies: Company[] }>({
    queryKey: ["companies-list"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then(r => r.json() as Promise<{ companies: Company[] }>),
    enabled: isAdmin,
  });
  const companies = companiesData?.companies ?? [];

  const { data: empData, isLoading: empLoading } = useQuery<{ employees: Employee[] }>({
    queryKey: ["people-employees", companyId],
    queryFn: () => fetch(`/api/employees?companyId=${companyId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ employees: Employee[] }>),
    enabled: !!companyId, staleTime: 60_000,
  });

  const all = (empData?.employees ?? []).filter(e => e.status !== "terminated");
  const filtered = search
    ? all.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()))
    : all;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/people")} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <div className="p-2 rounded-lg" style={{ background: `${NAVY}15` }}>
          <FolderOpen className="h-5 w-5" style={{ color: NAVY }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>Documents</h1>
          <p className="text-sm text-muted-foreground">Employee files, certificates, and records</p>
        </div>
      </div>

      {/* Company picker — admin only */}
      {isAdmin && (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-white shadow-sm">
          <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-600 font-medium shrink-0">Company:</span>
          <select
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="flex-1 max-w-xs h-8 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
          >
            <option value="">— Select a company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId && isAdmin && (
        <div className="rounded-xl border bg-white shadow-sm p-12 text-center">
          <Building2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Select a company to view documents</p>
        </div>
      )}

      {companyId && (
        <>
          {/* Notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-[#0EA5C9]/20 bg-[#0EA5C9]/5">
            <Lock className="h-4 w-4 text-[#0EA5C9] shrink-0 mt-0.5" />
            <p className="text-xs text-gray-600">
              Documents are securely stored. Access is role-scoped — only authorized personnel can view sensitive employee files.
            </p>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search employees…" className="pl-8 h-8 text-sm" />
          </div>

          {/* Employee document rows */}
          {empLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <FolderOpen className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No employees found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(emp => <EmployeeDocRow key={emp.id} emp={emp} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
