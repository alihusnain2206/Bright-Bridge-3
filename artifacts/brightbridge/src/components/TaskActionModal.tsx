import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, ChevronLeft, ChevronRight, CheckCircle2, Clock, XCircle, AlertTriangle,
  Loader2, SkipForward, BookOpen, UserCheck, Clipboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import EmergencyContactForm from "./EmergencyContactForm";
import EmployeeDocuments from "./EmployeeDocuments";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface Task {
  id: string; employeeId: string; companyId: string;
  taskName: string; description?: string | null; category: string; stage: string;
  assignedToRole: string; status: string; isRequired: boolean;
  dueDate?: string | null; completedAt?: string | null;
}

interface Employee {
  id: string; companyId: string; firstName: string; lastName: string;
}

interface Props {
  employee: Employee;
  onClose: () => void;
  onRefresh?: () => void;
}

const STAGE_ORDER = ["preboarding", "documents", "training", "equipment", "manager_tasks", "compliance", "ready_to_start"];
const STAGE_LABELS: Record<string, string> = {
  preboarding:    "Pre-boarding",
  documents:      "Documents",
  training:       "Training",
  equipment:      "Equipment & IT",
  manager_tasks:  "Manager Tasks",
  compliance:     "Compliance",
  ready_to_start: "Ready to Start",
};

type ActionType = "emergency_contact" | "upload" | "acknowledge" | "verify" | "simple";

function getAction(task: Task): { type: ActionType; preselectedDocType?: string } {
  const n = task.taskName.toLowerCase();
  if (n.includes("emergency contact")) return { type: "emergency_contact" };
  if (n.includes("upload") || n.includes("records") || n.includes("identification") ||
      n.includes("certification") || n.includes("immunization") ||
      n.includes("physical") || n.includes("tb test")) {
    let docType = "";
    if (n.includes("identification"))           docType = "identification";
    else if (n.includes("immunization"))        docType = "immunization";
    else if (n.includes("tb test") || n.includes("tb ")) docType = "tb_test";
    else if (n.includes("physical"))            docType = "physical_exam";
    else if (n.includes("certif"))              docType = "certification";
    else if (n.includes("background"))          docType = "background_check";
    else if (n.includes("i-9") || n.includes("i9")) docType = "i9";
    return { type: "upload", preselectedDocType: docType };
  }
  if (n.includes("acknowledgment") || n.includes("acknowledge") || n.includes("e-sign") ||
      n.includes("handbook") || n.includes("policy") || n.includes("code of conduct") ||
      n.includes("nda") || n.includes("confidentiality")) return { type: "acknowledge" };
  if (["hr", "manager", "it", "admin"].includes(task.assignedToRole)) return { type: "verify" };
  return { type: "simple" };
}

function fmtDue(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "completed" || task.status === "skipped") return false;
  return new Date(task.dueDate) < new Date();
}

export default function TaskActionModal({ employee, onClose, onRefresh }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Task | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [ackChecked, setAckChecked] = useState(false);
  const [ackSigner, setAckSigner] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<{
    tasks: Task[]; byStage: Record<string, Task[]>;
    completionPercentage: number; total: number; completed: number;
  }>({
    queryKey: ["tasks-modal", employee.id],
    queryFn: () => fetch(`/api/onboarding-tasks?employeeId=${employee.id}`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to load tasks");
      return r.json() as Promise<{ tasks: Task[]; byStage: Record<string, Task[]>; completionPercentage: number; total: number; completed: number }>;
    }),
    staleTime: 30_000,
  });

  const tasks = data?.tasks ?? [];
  const required = tasks.filter(t => t.isRequired);
  const doneRequired = required.filter(t => t.status === "completed" || t.status === "skipped");
  const progress = required.length > 0 ? Math.round((doneRequired.length / required.length) * 100) : 0;

  const handleComplete = async (task: Task, notes?: string, completedBy?: string) => {
    setCompleting(true); setCompleteError("");
    try {
      const r = await fetch(`/api/onboarding-tasks/${task.id}/complete`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, completedBy }),
      });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Failed to complete"); }
      await refetch();
      await qc.invalidateQueries({ queryKey: ["people-employees"] });
      await qc.invalidateQueries({ queryKey: ["compliance", employee.id] });
      if (onRefresh) onRefresh();
      backToList();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : "Failed to complete task");
    } finally {
      setCompleting(false);
    }
  };

  const handleSkip = async (task: Task) => {
    await fetch(`/api/onboarding-tasks/${task.id}/skip`, { method: "POST", credentials: "include" });
    await refetch();
    if (onRefresh) onRefresh();
  };

  const backToList = () => { setSelected(null); setCompleteError(""); setAckChecked(false); setAckSigner(""); setVerifyNotes(""); };

  const action = selected ? getAction(selected) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            {selected && (
              <button onClick={backToList} className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">
                {selected ? selected.taskName : "Onboarding Tasks"}
              </h2>
              <p className="text-xs text-gray-400">{employee.firstName} {employee.lastName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar — task list view only */}
        {!selected && (
          <div className="px-6 py-3 border-b shrink-0 bg-gray-50/50">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>{doneRequired.length} of {required.length} required tasks completed</span>
              <span className={`font-semibold ${progress >= 100 ? "text-emerald-600" : progress >= 50 ? "text-amber-600" : "text-gray-600"}`}>{progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: progress >= 100 ? "#10b981" : ACCENT }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            /* ─── Task list ─── */
            isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
              </div>
            ) : isError ? (
              <div className="flex items-center gap-2 p-6 text-red-600 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Failed to load tasks.
                <button onClick={() => refetch()} className="underline ml-1">Retry</button>
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No tasks found</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {STAGE_ORDER
                  .filter(stage => (data?.byStage[stage] ?? []).length > 0)
                  .map(stage => (
                    <div key={stage}>
                      <div className="px-6 py-2 bg-gray-50/70 sticky top-0">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          {STAGE_LABELS[stage] ?? stage}
                        </span>
                      </div>
                      {(data?.byStage[stage] ?? []).map(task => {
                        const done = task.status === "completed" || task.status === "skipped";
                        const overdue = isOverdue(task);
                        return (
                          <button
                            key={task.id}
                            onClick={() => { if (!done) { setSelected(task); setCompleteError(""); } }}
                            disabled={done}
                            className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors ${
                              done ? "opacity-50 cursor-default" : "hover:bg-blue-50/50 cursor-pointer"
                            }`}
                          >
                            {task.status === "completed"
                              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              : task.status === "skipped"
                              ? <XCircle className="h-4 w-4 text-gray-300 shrink-0" />
                              : <Clock className="h-4 w-4 text-gray-300 shrink-0" />}

                            <div className="flex-1 min-w-0">
                              <div className={`text-sm truncate ${done ? "line-through text-gray-400" : "font-medium text-gray-900"}`}>
                                {task.taskName}
                                {!task.isRequired && (
                                  <span className="ml-1.5 text-[10px] text-gray-400 font-normal not-line-through">optional</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-400 uppercase">{task.assignedToRole}</span>
                                {task.dueDate && (
                                  <span className={`text-[10px] ${overdue ? "text-red-500 font-semibold" : "text-gray-400"}`}>
                                    {overdue ? "Overdue · " : "Due "}{fmtDue(task.dueDate)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {!done && !task.isRequired && (
                              <button
                                onClick={e => { e.stopPropagation(); void handleSkip(task); }}
                                className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 shrink-0"
                              >
                                <SkipForward className="h-3 w-3" />Skip
                              </button>
                            )}
                            {!done && (
                              <ChevronRight className="h-4 w-4 text-gray-200 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )
          ) : (
            /* ─── Action view ─── */
            <div className="p-6 space-y-4">

              {action?.type === "emergency_contact" && (
                <>
                  <p className="text-sm text-gray-500">Add this employee's emergency contact information. This task completes automatically on first save.</p>
                  <EmergencyContactForm
                    employeeId={employee.id}
                    companyId={employee.companyId}
                    onFirstSave={async () => {
                      await refetch();
                      await qc.invalidateQueries({ queryKey: ["people-employees"] });
                      if (onRefresh) onRefresh();
                      backToList();
                    }}
                  />
                </>
              )}

              {action?.type === "upload" && (
                <>
                  <p className="text-sm text-gray-500">Upload the required document. The task completes automatically on successful upload.</p>
                  <EmployeeDocuments
                    employeeId={employee.id}
                    companyId={employee.companyId}
                    preselectedType={action.preselectedDocType}
                    onUpload={async () => {
                      await refetch();
                      await qc.invalidateQueries({ queryKey: ["people-employees"] });
                      if (onRefresh) onRefresh();
                      backToList();
                    }}
                  />
                </>
              )}

              {action?.type === "acknowledge" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <BookOpen className="h-5 w-5 text-[#1B3A6B] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && <p className="text-xs text-gray-500 mt-1">{selected.description}</p>}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackChecked}
                      onChange={e => setAckChecked(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 accent-[#1B3A6B]"
                    />
                    <span className="text-sm text-gray-700">I acknowledge I have read and agree to the above</span>
                  </label>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Signed by</label>
                    <input
                      type="text"
                      value={ackSigner}
                      onChange={e => setAckSigner(e.target.value)}
                      placeholder="Full name…"
                      className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
                    />
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={!ackChecked || !ackSigner.trim() || completing}
                    onClick={() => void handleComplete(selected, undefined, ackSigner)}
                    className="text-white gap-1.5"
                    style={{ background: NAVY }}
                  >
                    {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Confirm Acknowledgment
                  </Button>
                </div>
              )}

              {action?.type === "verify" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <UserCheck className="h-5 w-5 text-[#1B3A6B] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && <p className="text-xs text-gray-500 mt-1">{selected.description}</p>}
                        <p className="text-[10px] text-gray-400 mt-1.5 uppercase tracking-wide">Assigned to: {selected.assignedToRole}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
                    <textarea
                      value={verifyNotes}
                      onChange={e => setVerifyNotes(e.target.value)}
                      placeholder="Add notes…"
                      rows={3}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30 resize-none"
                    />
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={completing}
                    onClick={() => void handleComplete(selected, verifyNotes || undefined)}
                    className="text-white gap-1.5"
                    style={{ background: NAVY }}
                  >
                    {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Mark as Completed
                  </Button>
                </div>
              )}

              {action?.type === "simple" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <Clipboard className="h-5 w-5 text-[#1B3A6B] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && <p className="text-xs text-gray-500 mt-1">{selected.description}</p>}
                        {!selected.isRequired && (
                          <span className="mt-1.5 inline-block text-[10px] text-gray-400">This task is optional</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      disabled={completing}
                      onClick={() => void handleComplete(selected)}
                      className="text-white gap-1.5"
                      style={{ background: NAVY }}
                    >
                      {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Mark as Completed
                    </Button>
                    {!selected.isRequired && (
                      <button
                        onClick={() => void handleSkip(selected)}
                        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
                      >
                        <SkipForward className="h-3.5 w-3.5" />Skip
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
