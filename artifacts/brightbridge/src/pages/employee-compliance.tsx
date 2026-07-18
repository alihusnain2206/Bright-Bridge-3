import React from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, XCircle, Ban, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";

interface ComplianceItem {
  id: string; employeeId: string; type: string; name: string;
  status: string; isRequired: boolean; completedAt?: string|null; notes?: string|null;
  dueDate?: string|null;
}
interface EmployeeSummary { id: string; firstName: string; lastName: string; employeeDisplayId?: string|null; companyId: string; }

const STATUS_STYLES: Record<string, string> = {
  completed:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  pending:     "bg-gray-50 text-gray-500 border-gray-200",
  overdue:     "bg-red-50 text-red-600 border-red-200",
  waived:      "bg-purple-50 text-purple-700 border-purple-200",
};
const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed:   <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />,
  in_progress: <Clock className="h-4 w-4 text-blue-500 shrink-0" />,
  pending:     <Clock className="h-4 w-4 text-gray-400 shrink-0" />,
  overdue:     <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
  waived:      <Ban className="h-4 w-4 text-purple-500 shrink-0" />,
};

function fmtDate(iso?: string|null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function EmployeeCompliancePage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id/compliance");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const { data: empData } = useQuery<{ employee: EmployeeSummary }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeSummary }>),
    enabled: !!empId,
  });

  const { data, isLoading, isError } = useQuery<{ items: ComplianceItem[]; score: number }>({
    queryKey: ["compliance", empId],
    queryFn: () => fetch(`/api/compliance?employeeId=${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ items: ComplianceItem[]; score: number }>),
    enabled: !!empId,
    staleTime: 0,
  });

  const completeMutation = useMutation({
    mutationFn: (itemId: string) => fetch(`/api/compliance/${itemId}/complete`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "" }),
    }).then(r => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["compliance", empId] });
      void qc.invalidateQueries({ queryKey: ["employee-detail", empId] });
    },
  });

  const emp = empData?.employee;
  const items = data?.items ?? [];
  const score = data?.score ?? 0;

  const groups = items.reduce<Record<string, ComplianceItem[]>>((acc, item) => {
    const g = item.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    (acc[g] ??= []).push(item);
    return acc;
  }, {});

  const completed = items.filter(i => i.status === "completed").length;
  const required  = items.filter(i => i.isRequired);
  const completedRequired = required.filter(i => i.status === "completed").length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(`/people/${empId}`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="h-4 w-4" /> {emp ? `${emp.firstName} ${emp.lastName}` : "Back"}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <ShieldCheck className="h-6 w-6 mt-1 shrink-0" style={{ color: NAVY }} />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Compliance</h1>
          {emp && <p className="text-sm text-gray-500">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>}
        </div>
      </div>

      {/* Score cards */}
      {!isLoading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{score}%</div>
            <div className="text-xs text-gray-500 mt-0.5">Overall Score</div>
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444" }} />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{completedRequired}/{required.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Required Items</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{completed}/{items.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Total Items</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : isError ? (
        <div className="text-center py-10">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">Failed to load compliance data</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <ShieldCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No compliance items found</p>
          <p className="text-gray-400 text-sm mt-1">Compliance items are created during employee onboarding</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([group, groupItems]) => (
            <div key={group} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group}</span>
                <span className="text-xs text-gray-400">
                  {groupItems.filter(i => i.status === "completed").length}/{groupItems.length} complete
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {groupItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    {STATUS_ICONS[item.status] ?? <Clock className="h-4 w-4 text-gray-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-800 font-medium">{item.name}</span>
                        {item.isRequired && (
                          <span className="text-[10px] font-medium text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">Required</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[item.status] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
                          {item.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      {item.completedAt && (
                        <div className="text-xs text-gray-400 mt-0.5">Completed {fmtDate(item.completedAt)}</div>
                      )}
                    </div>
                    {item.status !== "completed" && item.status !== "waived" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={completeMutation.isPending}
                        onClick={() => completeMutation.mutate(item.id)}
                        className="text-xs shrink-0 h-7"
                      >
                        Mark Done
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
