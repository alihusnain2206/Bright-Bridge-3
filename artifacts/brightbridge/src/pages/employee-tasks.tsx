import React from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Clock, SkipForward, ClipboardList, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";

interface OnboardingTask {
  id: string; employeeId: string; taskName: string; stage: string;
  status: string; isRequired: boolean; dueDate?: string|null;
  completedAt?: string|null; completedBy?: string|null; notes?: string|null;
}
interface EmployeeSummary { id: string; firstName: string; lastName: string; employeeDisplayId?: string|null; }

function fmtDate(iso?: string|null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STAGE_LABELS: Record<string, string> = {
  pre_hire: "Pre-Hire",
  day_one: "Day One",
  week_one: "Week One",
  month_one: "Month One",
  ongoing: "Ongoing",
};

export default function EmployeeTasksPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id/tasks");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const { data: empData } = useQuery<{ employee: EmployeeSummary }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeSummary }>),
    enabled: !!empId,
  });

  const { data, isLoading, isError } = useQuery<{ tasks: OnboardingTask[]; completionPercentage: number; total: number; completed: number }>({
    queryKey: ["onboarding-tasks", empId],
    queryFn: () => fetch(`/api/onboarding-tasks?employeeId=${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ tasks: OnboardingTask[]; completionPercentage: number; total: number; completed: number }>),
    enabled: !!empId,
    staleTime: 0,
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: string) => fetch(`/api/onboarding-tasks/${taskId}/complete`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "" }),
    }).then(r => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["onboarding-tasks", empId] });
      void qc.invalidateQueries({ queryKey: ["employee-detail", empId] });
    },
  });

  const skipMutation = useMutation({
    mutationFn: (taskId: string) => fetch(`/api/onboarding-tasks/${taskId}/skip`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "" }),
    }).then(r => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["onboarding-tasks", empId] });
    },
  });

  const emp = empData?.employee;
  const tasks = data?.tasks ?? [];
  const pct = data?.completionPercentage ?? 0;
  const total = data?.total ?? 0;
  const completed = data?.completed ?? 0;

  const groups = tasks.reduce<Record<string, OnboardingTask[]>>((acc, t) => {
    (acc[t.stage] ??= []).push(t);
    return acc;
  }, {});

  const stageOrder = ["pre_hire", "day_one", "week_one", "month_one", "ongoing"];
  const sortedStages = stageOrder.filter(s => groups[s]);

  const isPending = completeMutation.isPending || skipMutation.isPending;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(`/people/${empId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {emp ? `${emp.firstName} ${emp.lastName}` : "Back"}
        </button>
      </div>

      <div className="flex items-start gap-3">
        <ClipboardList className="h-6 w-6 mt-1 shrink-0" style={{ color: NAVY }} />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Onboarding Tasks</h1>
          {emp && <p className="text-sm text-gray-500">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>}
        </div>
      </div>

      {!isLoading && tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{pct}%</div>
            <div className="text-xs text-gray-500 mt-0.5">Complete</div>
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : NAVY }}
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{completed}/{total}</div>
            <div className="text-xs text-gray-500 mt-0.5">Tasks Done</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">
              {tasks.filter(t => t.isRequired && t.status !== "completed" && t.status !== "skipped").length}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Required Pending</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : isError ? (
        <div className="text-center py-10">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">Failed to load tasks</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <ClipboardList className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No onboarding tasks yet</p>
          <p className="text-gray-400 text-sm mt-1">Tasks are created when an employee starts onboarding</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedStages.map(stage => {
            const stageTasks = groups[stage]!;
            const stageDone = stageTasks.filter(t => t.status === "completed" || t.status === "skipped").length;
            return (
              <div key={stage} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {STAGE_LABELS[stage] ?? stage}
                  </span>
                  <span className="text-xs text-gray-400">{stageDone}/{stageTasks.length} done</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {stageTasks.map(task => {
                    const isDone = task.status === "completed" || task.status === "skipped";
                    return (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                        {task.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : task.status === "skipped" ? (
                          <SkipForward className="h-4 w-4 text-gray-400 shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-gray-300 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${isDone ? "text-gray-400 line-through" : "text-gray-800"}`}>
                              {task.taskName}
                            </span>
                            {task.isRequired && !isDone && (
                              <span className="text-[10px] font-medium text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">Required</span>
                            )}
                          </div>
                          {task.completedAt && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {task.status === "skipped" ? "Skipped" : "Completed"} {fmtDate(task.completedAt)}
                            </div>
                          )}
                          {task.dueDate && !isDone && (
                            <div className="text-xs text-gray-400 mt-0.5">Due {fmtDate(task.dueDate)}</div>
                          )}
                        </div>
                        {!isDone && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm"
                              disabled={isPending}
                              onClick={() => completeMutation.mutate(task.id)}
                              className="text-xs h-7 text-white"
                              style={{ background: NAVY }}
                            >
                              Complete
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={() => skipMutation.mutate(task.id)}
                              className="text-xs h-7 text-gray-400"
                            >
                              Skip
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
