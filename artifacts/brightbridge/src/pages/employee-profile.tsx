import React from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Pencil, ShieldCheck, Phone, FolderOpen,
  ClipboardList, Building2, Mail, MapPin, Calendar,
  Briefcase, User, DollarSign, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";

const NAVY  = "#1B3A6B";
const ACCENT = "#0EA5C9";

const AVATAR_COLORS = ["#3B82F6","#8B5CF6","#EC4899","#EF4444","#F59E0B","#10B981","#14B8A6","#E8622A"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function initials(f: string, l: string) { return `${f[0]??""} ${l[0]??""} `.trim().toUpperCase().slice(0,2); }
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function tenure(iso?: string | null) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 1) return "Today"; if (d < 30) return `${d}d`;
  const m = Math.floor(d/30); if (m < 12) return `${m}mo`;
  const y = Math.floor(m/12), r = m%12; return r ? `${y}y ${r}mo` : `${y}y`;
}

const STATUS_CFG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  active:     { label: "Active",      dot: "bg-emerald-500", bg: "bg-emerald-50",  text: "text-emerald-700" },
  on_leave:   { label: "On Leave",    dot: "bg-amber-500",   bg: "bg-amber-50",    text: "text-amber-700"   },
  onboarding: { label: "Onboarding",  dot: "bg-blue-500",    bg: "bg-blue-50",     text: "text-blue-700"    },
  pending:    { label: "Pending",     dot: "bg-gray-400",    bg: "bg-gray-100",    text: "text-gray-500"    },
  terminated: { label: "Terminated",  dot: "bg-red-400",     bg: "bg-red-50",      text: "text-red-600"     },
};

interface EmployeeDetail {
  id: string; companyId: string;
  firstName: string; lastName: string; email: string; phone: string;
  position: string; jobTitle?: string|null; employmentType: string; workerType: string;
  startDate?: string|null; status: string; employeeDisplayId?: string|null;
  department?: string|null; managerId?: string|null; managerName?: string|null;
  payType?: string|null; hourlyWage?: number|null; overtimeEligible?: boolean|null; paymentMethod?: string|null;
  ssn?: string|null; dateOfBirth?: string|null;
  homeAddress?: string|null; homeCity?: string|null; homeState?: string|null; homeZip?: string|null;
  w4FilingStatus?: string|null; w4MultipleJobs?: boolean|null; w4Dependents?: number|null; w4ExtraWithholding?: number|null;
  complianceScore?: number|null; onboardingProgress?: number|null;
  rollfiUserId?: string|null; easyteamId?: string|null; kycStatus?: string|null;
  bankAccountAdded?: boolean|null; w4Submitted?: boolean|null; payrollReady?: boolean|null;
  photoUrl?: string|null; notes?: string|null; createdAt: string; updatedAt?: string|null;
}

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      {icon && <span className="mt-0.5 text-gray-400 shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400 mb-0.5">{label}</div>
        <div className="text-sm text-gray-800 font-medium">{value || <span className="text-gray-300 font-normal">—</span>}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default function EmployeeProfilePage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id");
  const { user } = useAuth();
  const empId = params?.id ?? "";

  const { data, isLoading, isError } = useQuery<{ employee: EmployeeDetail }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeDetail }>),
    enabled: !!empId,
  });

  const emp = data?.employee;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-40" /><Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (isError || !emp) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => navigate("/people")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to People
        </button>
        <div className="text-center py-16">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Employee not found</p>
        </div>
      </div>
    );
  }

  const color  = avatarColor(`${emp.firstName} ${emp.lastName}`);
  const status = STATUS_CFG[emp.status] ?? { label: emp.status, dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-500" };
  const wageDisplay = emp.hourlyWage != null ? `$${(emp.hourlyWage / 100).toFixed(2)}/hr` : null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/people")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to People
        </button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/people/${emp.id}/compliance`)} className="gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" /> Compliance
          </Button>
          {(user?.role === "super_admin" || user?.role === "manager") && (
            <Button size="sm" onClick={() => navigate(`/people/${emp.id}/edit`)} className="gap-1.5 text-xs text-white" style={{ background: NAVY }}>
              <Pencil className="h-3.5 w-3.5" /> Edit Profile
            </Button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-start gap-4">
        {emp.photoUrl ? (
          <img src={emp.photoUrl} alt="" className="w-20 h-20 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-20 h-20 rounded-full flex items-center justify-center shrink-0 text-white text-2xl font-bold" style={{ background: color }}>
            {initials(emp.firstName, emp.lastName)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{emp.firstName} {emp.lastName}</h1>
              <p className="text-sm text-gray-500">{emp.jobTitle ?? emp.position}</p>
              {emp.employeeDisplayId && <p className="text-xs text-gray-400 mt-0.5">{emp.employeeDisplayId}</p>}
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
            {emp.department && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{emp.department}</span>}
            {emp.managerName && <span className="flex items-center gap-1"><User className="h-3 w-3" />Reports to {emp.managerName}</span>}
            {emp.startDate && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Started {fmtDate(emp.startDate)} · {tenure(emp.startDate)}</span>}
          </div>
        </div>
      </div>

      {/* Progress bars */}
      {(emp.complianceScore != null || emp.onboardingProgress != null) && (
        <div className="grid grid-cols-2 gap-3">
          {emp.onboardingProgress != null && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Onboarding</span>
                <span className="text-sm font-bold text-gray-800">{emp.onboardingProgress}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${emp.onboardingProgress}%` }} />
              </div>
            </div>
          )}
          {emp.complianceScore != null && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Compliance</span>
                <span className="text-sm font-bold text-gray-800">{emp.complianceScore}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${emp.complianceScore}%`, background: emp.complianceScore >= 80 ? "#10b981" : emp.complianceScore >= 50 ? "#f59e0b" : "#ef4444" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Contact">
          <InfoRow label="Email" value={emp.email} icon={<Mail className="h-3.5 w-3.5" />} />
          <InfoRow label="Phone" value={emp.phone} icon={<Phone className="h-3.5 w-3.5" />} />
          {emp.homeAddress && <InfoRow label="Address" icon={<MapPin className="h-3.5 w-3.5" />}
            value={[emp.homeAddress, emp.homeCity, emp.homeState, emp.homeZip].filter(Boolean).join(", ")} />}
        </Section>

        <Section title="Employment">
          <InfoRow label="Position" value={emp.position} icon={<Briefcase className="h-3.5 w-3.5" />} />
          <InfoRow label="Employment Type" value={emp.employmentType} />
          <InfoRow label="Worker Type" value={emp.workerType} />
          <InfoRow label="Start Date" value={fmtDate(emp.startDate)} icon={<Calendar className="h-3.5 w-3.5" />} />
        </Section>

        <Section title="Compensation">
          <InfoRow label="Pay Rate" value={wageDisplay} icon={<DollarSign className="h-3.5 w-3.5" />} />
          <InfoRow label="Pay Type" value={emp.payType} />
          <InfoRow label="Payment Method" value={emp.paymentMethod} />
          <InfoRow label="Overtime Eligible" value={emp.overtimeEligible === true ? "Yes" : emp.overtimeEligible === false ? "No" : null} />
        </Section>

        <Section title="System Status">
          <InfoRow label="Rollfi" value={emp.rollfiUserId ? <span className="text-emerald-600">Synced ✓</span> : <span className="text-gray-400">Not synced</span>} />
          <InfoRow label="EasyTeam" value={emp.easyteamId ? <span className="text-emerald-600">Synced ✓</span> : <span className="text-gray-400">Not synced</span>} />
          <InfoRow label="KYC Status" value={emp.kycStatus ?? "—"} />
          <InfoRow label="Bank Account" value={emp.bankAccountAdded ? "Added ✓" : "Not added"} />
          <InfoRow label="W4 Submitted" value={emp.w4Submitted ? "Yes ✓" : "No"} />
        </Section>
      </div>

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: <ClipboardList className="h-4 w-4" />, label: "Onboarding Tasks", path: "tasks" },
          { icon: <Phone className="h-4 w-4" />, label: "Emergency Contacts", path: "contacts" },
          { icon: <FolderOpen className="h-4 w-4" />, label: "Documents", path: "documents" },
          { icon: <ShieldCheck className="h-4 w-4" />, label: "Compliance", path: "compliance" },
        ].map(({ icon, label, path }) => (
          <button
            key={path}
            onClick={() => navigate(`/people/${emp.id}/${path}`)}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 bg-white hover:border-[#0EA5C9] hover:bg-blue-50/30 transition-colors text-gray-600 hover:text-[#0EA5C9] text-xs font-medium"
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {emp.notes && (
        <Section title="Notes">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{emp.notes}</p>
        </Section>
      )}
    </div>
  );
}
