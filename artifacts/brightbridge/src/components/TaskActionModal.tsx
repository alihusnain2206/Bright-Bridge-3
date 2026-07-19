import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, ChevronLeft, ChevronRight, CheckCircle2, Clock, XCircle, AlertTriangle,
  Loader2, SkipForward, BookOpen, UserCheck, Clipboard, FileText, Download,
  RotateCcw, MessageSquare, Send,
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
  dueDate?: string | null; completedAt?: string | null; completedBy?: string | null;
  completionMethod?: string | null; completionNote?: string | null;
  acknowledgedBy?: string | null; acknowledgedAt?: string | null;
  reopenedCount?: number | null; linkedDocumentIds?: string | null;
}

interface TaskNote {
  id: string; taskId: string; text: string;
  authorId: string; authorName: string; createdAt: string;
}

interface LinkedDoc {
  id: string; documentName: string; documentType: string;
  fileUrl: string; expiryDate?: string | null; uploadedAt: string; status: string;
}

interface TaskDetail { task: Task; notes: TaskNote[]; linkedDocuments: LinkedDoc[]; }

interface FullEmployee {
  id: string; firstName: string; lastName: string; email: string;
  position: string; jobTitle?: string | null; department?: string | null;
  managerName?: string | null; employeeDisplayId?: string | null;
  ssn?: string | null; dateOfBirth?: string | null;
  homeAddress?: string | null; homeCity?: string | null;
  homeState?: string | null; homeZip?: string | null;
  w4FilingStatus?: string | null; w4Dependents?: number | null;
  w4ExtraWithholding?: number | null;
  bankAccountAdded: boolean; payType: string; hourlyWage: number;
  easyteamSynced: boolean;
}

interface Employee { id: string; companyId: string; firstName: string; lastName: string; }

interface Props {
  employee: Employee;
  initialTask?: Task | null;
  onClose: () => void;
  onRefresh?: () => void;
}

// ── Constants ──────────────────────────────────────────────────
const STAGE_ORDER = [
  "preboarding","documents","training","equipment",
  "manager_tasks","compliance","daycare_compliance","ready_to_start",
];
const STAGE_LABELS: Record<string, string> = {
  preboarding: "Pre-boarding", documents: "Documents", training: "Training",
  equipment: "Equipment & IT", manager_tasks: "Manager Tasks",
  compliance: "Compliance", daycare_compliance: "Daycare Compliance",
  ready_to_start: "Ready to Start",
};

type ActionType =
  | "emergency_contact" | "upload_expiry" | "upload"
  | "acknowledge" | "esign_all" | "number_entry" | "verify" | "simple";

// ── Helpers ────────────────────────────────────────────────────
function maskSSN(ssn?: string | null): string {
  if (!ssn) return "—";
  const d = ssn.replace(/\D/g, "");
  return d.length >= 4 ? `***-**-${d.slice(-4)}` : "***";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function expiryColor(expiry?: string | null): string {
  if (!expiry) return "text-gray-400";
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return "text-red-600 font-semibold";
  if (days <= 30) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function methodLabel(method?: string | null): string {
  switch (method) {
    case "auto": return "Auto";
    case "form": return "Form";
    case "upload": return "Upload";
    case "acknowledge": return "Acknowledged";
    case "verify": return "Verified";
    case "manual": return "Manual";
    default: return "Manual";
  }
}

function methodBgClass(method?: string | null): string {
  switch (method) {
    case "auto": return "bg-blue-100 text-blue-700";
    case "form": return "bg-purple-100 text-purple-700";
    case "upload": return "bg-cyan-100 text-cyan-700";
    case "acknowledge": return "bg-indigo-100 text-indigo-700";
    case "verify": return "bg-amber-100 text-amber-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

function completedByLabel(by?: string | null): string {
  if (!by) return "System";
  if (by === "system" || by.startsWith("system")) return "System (auto)";
  return by;
}

const UPLOAD_EXPIRY_KW = [
  "cpr","first aid","child abuse","health & safety","medication admin",
  "mandated reporter","fingerprint clearance","license verification",
  "driver's license","work authorization",
];
const UPLOAD_KW = [
  "i-9 section 1","identification upload","immunization","physical exam",
  "tb test","staff health","upload required","equipment signature","certification",
];

function docTypeFromName(n: string): string {
  if (n.includes("i-9") || n.includes("i9")) return "i9";
  if (n.includes("identification")) return "identification";
  if (n.includes("immunization")) return "immunization";
  if (n.includes("tb test") || n.includes("tb ")) return "tb_test";
  if (n.includes("physical")) return "physical_exam";
  if (n.includes("background")) return "background_check";
  if (n.includes("cpr") || n.includes("first aid") || n.includes("certification")) return "certification";
  return "";
}

function getAction(task: Task): { type: ActionType; preselectedDocType?: string; requiresExpiry?: boolean } {
  const n = task.taskName.toLowerCase();
  if (n.includes("emergency contact")) return { type: "emergency_contact" };
  if (n.includes("e-sign all")) return { type: "esign_all" };
  if (n.includes("ocfs training hours")) return { type: "number_entry" };

  if (UPLOAD_EXPIRY_KW.some(kw => n.includes(kw)))
    return { type: "upload_expiry", preselectedDocType: docTypeFromName(n), requiresExpiry: true };
  if (UPLOAD_KW.some(kw => n.includes(kw)))
    return { type: "upload", preselectedDocType: docTypeFromName(n) };
  if (n.includes("upload") || n.includes("records") || n.includes("fingerprint")) {
    const reqExpiry = UPLOAD_EXPIRY_KW.some(kw => n.includes(kw));
    return { type: reqExpiry ? "upload_expiry" : "upload", preselectedDocType: docTypeFromName(n), requiresExpiry: reqExpiry };
  }

  if (n.includes("acknowledgment") || n.includes("acknowledge") || n.includes("handbook") ||
      n.includes("code of conduct") || n.includes("nda") || n.includes("confidentiality") ||
      n.includes("e-sign") || n.includes("it acceptable"))
    return { type: "acknowledge" };

  if (["hr", "manager", "it", "admin"].includes(task.assignedToRole))
    return { type: "verify" };

  return { type: "simple" };
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "completed" || task.status === "skipped") return false;
  return new Date(task.dueDate) < new Date();
}

// ── Auto-complete detail display ───────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-gray-400 w-36 shrink-0">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

function AutoWhatWasDone({ task, emp }: { task: Task; emp: FullEmployee | null }) {
  if (!emp) return <p className="text-sm text-gray-400 italic">Loading…</p>;
  const n = task.taskName.toLowerCase();

  if (n.includes("personal information")) return (
    <div className="space-y-2">
      <Row label="SSN" value={maskSSN(emp.ssn)} />
      <Row label="Date of Birth" value={fmtDate(emp.dateOfBirth)} />
      <Row label="Home Address"
        value={[emp.homeAddress, emp.homeCity, emp.homeState, emp.homeZip].filter(Boolean).join(", ") || "—"} />
    </div>
  );
  if (n.includes("employee id") || n.includes("issue employee"))
    return <Row label="Employee ID" value={emp.employeeDisplayId ?? "—"} />;
  if (n.includes("job title") || n.includes("assign job")) return (
    <div className="space-y-2">
      <Row label="Position" value={emp.position ?? "—"} />
      {emp.jobTitle && <Row label="Job Title" value={emp.jobTitle} />}
    </div>
  );
  if (n.includes("pay schedule") || n.includes("assign pay")) return (
    <div className="space-y-2">
      <Row label="Pay Type" value={emp.payType ?? "—"} />
      <Row label="Schedule" value="Set at company level" />
    </div>
  );
  if (n.includes("system login") || n.includes("create system")) return (
    <div className="space-y-2">
      <Row label="Login Email" value={emp.email} />
      <Row label="Status" value="Account created" />
    </div>
  );
  if (n.includes("time & attendance") || n.includes("attendance profile")) return (
    <div className="space-y-2">
      <Row label="EasyTeam" value={emp.easyteamSynced ? "Active in time tracking" : "Pending sync"} />
    </div>
  );
  if (n.includes("department")) return (
    <div className="space-y-2">
      <Row label="Department" value={emp.department ?? "—"} />
      <Row label="Manager" value={emp.managerName ?? "—"} />
    </div>
  );
  if (n.includes("w-4") || n.includes("federal w")) return (
    <div className="space-y-2">
      <Row label="Filing Status" value={emp.w4FilingStatus ?? "—"} />
      {emp.w4Dependents != null && <Row label="Dependents Credit" value={`$${(emp.w4Dependents / 100).toFixed(0)}`} />}
      {emp.w4ExtraWithholding ? <Row label="Extra Withholding" value={`$${(emp.w4ExtraWithholding / 100).toFixed(0)}`} /> : null}
    </div>
  );
  if (n.includes("direct deposit")) return (
    <Row label="Status" value={emp.bankAccountAdded ? "Bank account on file" : "—"} />
  );
  if (n.includes("state tax")) return (
    <div className="space-y-2">
      <Row label="State" value={emp.homeState ?? "—"} />
      <Row label="Status" value="State tax form completed" />
    </div>
  );
  if (n.includes("manager")) return (
    <Row label="Assigned Manager" value={emp.managerName ?? "—"} />
  );
  return <p className="text-sm text-gray-500">Collected during employee creation wizard.</p>;
}

// ── Notes section ──────────────────────────────────────────────
function NoteSection({
  taskId, notes, onNoteAdded,
}: { taskId: string; notes: TaskNote[]; onNoteAdded: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true); setErr("");
    try {
      const r = await fetch(`/api/onboarding-tasks/${taskId}/notes`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setText("");
      onNoteAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />Notes
      </p>
      {notes.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No notes yet.</p>
      ) : (
        <div className="space-y-2">
          {notes.map(n => (
            <div key={n.id} className="text-sm">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-medium text-gray-700 text-xs">{n.authorName}</span>
                <span className="text-gray-400 text-xs">{fmtDateTime(n.createdAt)}</span>
              </div>
              <p className="text-gray-600 bg-gray-50 rounded-lg px-3 py-2 text-sm">{n.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
          placeholder="Add a note…"
          className="flex-1 h-8 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30"
        />
        <Button size="sm" variant="outline" disabled={saving || !text.trim()}
          onClick={() => void submit()} className="h-8 px-2.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function TaskActionModal({ employee, initialTask, onClose, onRefresh }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Task | null>(initialTask ?? null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [ackChecked, setAckChecked] = useState(false);
  const [ackSigner, setAckSigner] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");
  const [ocfsHours, setOcfsHours] = useState("");
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");

  // All tasks for list + progress
  const { data, isLoading, isError, refetch } = useQuery<{
    tasks: Task[];
    byStage: Record<string, Task[]>;
    completionPercentage: number;
    total: number;
    completed: number;
  }>({
    queryKey: ["tasks-modal", employee.id],
    queryFn: () =>
      fetch(`/api/onboarding-tasks?employeeId=${employee.id}`, { credentials: "include" })
        .then(r => {
          if (!r.ok) throw new Error("Failed");
          return r.json() as Promise<{ tasks: Task[]; byStage: Record<string, Task[]>; completionPercentage: number; total: number; completed: number }>;
        }),
    staleTime: 30_000,
  });

  // Task detail (notes + linked docs) when a task is selected
  const { data: taskDetail, refetch: refetchDetail } = useQuery<TaskDetail>({
    queryKey: ["task-detail", selected?.id],
    queryFn: () =>
      fetch(`/api/onboarding-tasks/${selected!.id}`, { credentials: "include" })
        .then(r => r.json() as Promise<TaskDetail>),
    enabled: !!selected,
    staleTime: 0,
  });

  // Full employee for auto-completed task review
  const { data: empDetail } = useQuery<FullEmployee>({
    queryKey: ["emp-full", employee.id],
    queryFn: () =>
      fetch(`/api/employees/${employee.id}`, { credentials: "include" })
        .then(r => r.json() as Promise<FullEmployee>),
    enabled: !!selected && selected.status === "completed" && selected.completionMethod === "auto",
    staleTime: 60_000,
  });

  const tasks = data?.tasks ?? [];
  const required = tasks.filter(t => t.isRequired);
  const doneRequired = required.filter(t => t.status === "completed" || t.status === "skipped");
  const progress = required.length > 0 ? Math.round((doneRequired.length / required.length) * 100) : 0;
  const notes = taskDetail?.notes ?? [];

  const invalidateAll = async () => {
    await refetch();
    await qc.invalidateQueries({ queryKey: ["people-employees"] });
    await qc.invalidateQueries({ queryKey: ["compliance", employee.id] });
    if (onRefresh) onRefresh();
  };

  const handleComplete = async (
    task: Task,
    opts?: {
      completionMethod?: string; completionNote?: string;
      acknowledgedBy?: string; acknowledgedAt?: string;
      linkedDocumentId?: string;
    },
  ) => {
    setCompleting(true); setCompleteError("");
    try {
      const r = await fetch(`/api/onboarding-tasks/${task.id}/complete`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts ?? { completionMethod: "manual" }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        throw new Error(d.error ?? "Failed to complete");
      }
      await invalidateAll();
      backToList();
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : "Failed to complete task");
    } finally {
      setCompleting(false);
    }
  };

  const handleSkip = async (task: Task) => {
    await fetch(`/api/onboarding-tasks/${task.id}/skip`, {
      method: "POST", credentials: "include",
    });
    await invalidateAll();
  };

  const handleReopen = async (task: Task) => {
    setReopening(true); setReopenError("");
    try {
      const r = await fetch(`/api/onboarding-tasks/${task.id}/reopen`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        throw new Error(d.error ?? "Failed to reopen");
      }
      setReopenConfirm(false);
      await invalidateAll();
      // Reload fresh task (now pending)
      const freshResp = await fetch(`/api/onboarding-tasks/${task.id}`, { credentials: "include" });
      const fresh = await freshResp.json() as TaskDetail;
      setSelected(fresh.task);
    } catch (e) {
      setReopenError(e instanceof Error ? e.message : "Failed to reopen task");
    } finally {
      setReopening(false);
    }
  };

  const backToList = () => {
    setSelected(null); setCompleteError(""); setReopenConfirm(false); setReopenError("");
    setAckChecked(false); setAckSigner(""); setVerifyNotes(""); setOcfsHours("");
  };

  const selectTask = (task: Task) => {
    setSelected(task); setCompleteError(""); setReopenConfirm(false); setReopenError("");
    setAckChecked(false); setAckSigner(""); setVerifyNotes(""); setOcfsHours("");
  };

  const action = selected ? getAction(selected) : null;
  const isCompleted = selected && (selected.status === "completed" || selected.status === "skipped");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-2 px-6 py-4 border-b shrink-0">
          {selected && (
            <button onClick={backToList}
              className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors shrink-0">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900 text-sm truncate">
              {selected ? selected.taskName : "Onboarding Tasks"}
            </h2>
            <p className="text-xs text-gray-400">{employee.firstName} {employee.lastName}</p>
          </div>
          {selected && isCompleted && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${methodBgClass(selected.completionMethod)}`}>
              {methodLabel(selected.completionMethod)}
            </span>
          )}
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 ml-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress bar — list view only */}
        {!selected && (
          <div className="px-6 py-3 border-b shrink-0 bg-gray-50/50">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>{doneRequired.length} of {required.length} required tasks completed</span>
              <span className={`font-semibold ${progress >= 100 ? "text-emerald-600" : progress >= 50 ? "text-amber-600" : "text-gray-600"}`}>
                {progress}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: progress >= 100 ? "#10b981" : ACCENT }} />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Task list ── */}
          {!selected && (
            isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
              </div>
            ) : isError ? (
              <div className="flex items-center gap-2 p-6 text-red-600 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Failed to load tasks.
                <button onClick={() => void refetch()} className="underline ml-1">Retry</button>
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No tasks found</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {STAGE_ORDER
                  .filter(stage => (data?.byStage[stage] ?? []).length > 0)
                  .map(stage => (
                    <div key={stage}>
                      <div className="px-6 py-2 bg-gray-50/70 sticky top-0 z-10">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          {STAGE_LABELS[stage] ?? stage}
                        </span>
                      </div>
                      {(data?.byStage[stage] ?? []).map(task => {
                        const done = task.status === "completed" || task.status === "skipped";
                        const overdue = isOverdue(task);
                        return (
                          <button key={task.id} onClick={() => selectTask(task)}
                            className="w-full flex items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-blue-50/40">
                            {task.status === "completed"
                              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              : task.status === "skipped"
                              ? <XCircle className="h-4 w-4 text-gray-300 shrink-0" />
                              : <Clock className="h-4 w-4 text-gray-300 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm truncate ${done ? "text-gray-400" : "font-medium text-gray-900"}`}>
                                {task.taskName}
                                {!task.isRequired && (
                                  <span className="ml-1.5 text-[10px] text-gray-400 font-normal">optional</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-gray-400 uppercase">{task.assignedToRole}</span>
                                {task.dueDate && !done && (
                                  <span className={`text-[10px] ${overdue ? "text-red-500 font-semibold" : "text-gray-400"}`}>
                                    {overdue ? "Overdue · " : "Due "}
                                    {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                                {done && task.completedAt && (
                                  <span className="text-[10px] text-gray-400">
                                    {task.status === "skipped" ? "Skipped" : "Done"}{" "}
                                    {new Date(task.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {!done && !task.isRequired && (
                              <button
                                onClick={e => { e.stopPropagation(); void handleSkip(task); }}
                                className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 shrink-0 mr-1">
                                <SkipForward className="h-3 w-3" />Skip
                              </button>
                            )}
                            <ChevronRight className="h-4 w-4 text-gray-200 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )
          )}

          {/* ── Mode B: Completed / Skipped review ── */}
          {selected && isCompleted && (
            <div className="p-6 space-y-5">

              {/* Completion header */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1">
                <div className="flex items-center gap-2">
                  {selected.status === "skipped"
                    ? <XCircle className="h-5 w-5 text-gray-400 shrink-0" />
                    : <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />}
                  <span className={`font-semibold text-sm ${selected.status === "skipped" ? "text-gray-600" : "text-emerald-800"}`}>
                    {selected.status === "skipped" ? "Skipped" : "Completed"}
                  </span>
                </div>
                <div className="pl-7 text-xs space-y-0.5">
                  {selected.completedAt && (
                    <p className={selected.status === "skipped" ? "text-gray-500" : "text-emerald-700"}>
                      Date: {fmtDateTime(selected.completedAt)}
                    </p>
                  )}
                  <p className={selected.status === "skipped" ? "text-gray-500" : "text-emerald-700"}>
                    By: {completedByLabel(selected.completedBy)}
                  </p>
                  {(selected.reopenedCount ?? 0) > 0 && (
                    <p className="text-amber-700">Reopened {selected.reopenedCount}× previously</p>
                  )}
                </div>
              </div>

              {/* What Was Done */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">What Was Done</p>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                  {selected.completionMethod === "auto" ? (
                    <AutoWhatWasDone task={selected} emp={empDetail ?? null} />
                  ) : selected.completionMethod === "form" ? (
                    <p className="text-sm text-gray-600">
                      Emergency contact information saved to employee record.
                    </p>
                  ) : selected.completionMethod === "upload" ? (
                    taskDetail && taskDetail.linkedDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {taskDetail.linkedDocuments.map(doc => (
                          <div key={doc.id}
                            className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-3 py-2">
                            <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{doc.documentName}</p>
                              <p className="text-[10px] text-gray-400">
                                Uploaded {fmtDate(doc.uploadedAt)}
                                {doc.expiryDate && (
                                  <> · <span className={expiryColor(doc.expiryDate)}>Expires {fmtDate(doc.expiryDate)}</span></>
                                )}
                              </p>
                            </div>
                            <a href={`/api/documents/${doc.id}/download`}
                              className="text-[10px] text-[#0EA5C9] hover:underline flex items-center gap-0.5 shrink-0"
                              download>
                              <Download className="h-3 w-3" />Download
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">No linked documents found.</p>
                    )
                  ) : selected.completionMethod === "acknowledge" ? (
                    <div className="space-y-1 text-sm">
                      {selected.acknowledgedBy && (
                        <p className="text-gray-700">
                          Signed by <span className="font-semibold">{selected.acknowledgedBy}</span>
                        </p>
                      )}
                      {selected.acknowledgedAt && (
                        <p className="text-gray-500 text-xs">on {fmtDateTime(selected.acknowledgedAt)}</p>
                      )}
                    </div>
                  ) : selected.completionMethod === "verify" ? (
                    <div className="text-sm">
                      {selected.completionNote
                        ? <p className="text-gray-700">{selected.completionNote}</p>
                        : <p className="text-gray-400 italic">Verified without notes.</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">
                      {selected.completionNote ?? "Marked as completed."}
                    </p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />

              {/* Reopen */}
              <div className="pt-2 border-t border-gray-100">
                {reopenConfirm ? (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                    <p className="text-sm font-medium text-amber-800">Move task back to pending?</p>
                    <p className="text-xs text-amber-700">
                      Documents and notes will be kept. The task will need to be completed again.
                    </p>
                    {reopenError && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{reopenError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline"
                        onClick={() => { setReopenConfirm(false); setReopenError(""); }}
                        className="h-8">
                        Cancel
                      </Button>
                      <Button size="sm" disabled={reopening}
                        onClick={() => void handleReopen(selected)}
                        className="h-8 text-white gap-1.5" style={{ background: "#d97706" }}>
                        {reopening
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RotateCcw className="h-3.5 w-3.5" />}
                        Confirm Reopen
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setReopenConfirm(true)}
                    className="text-sm text-gray-400 hover:text-amber-600 flex items-center gap-1.5 transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" />Mark as Not Completed
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Mode A: Pending action ── */}
          {selected && !isCompleted && (
            <div className="p-6 space-y-4">

              {action?.type === "emergency_contact" && (
                <>
                  <p className="text-sm text-gray-500">
                    Add this employee&apos;s emergency contact information. Task completes automatically on first save.
                  </p>
                  <EmergencyContactForm
                    employeeId={employee.id}
                    companyId={employee.companyId}
                    onFirstSave={async () => {
                      await fetch(`/api/onboarding-tasks/${selected.id}/complete`, {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ completionMethod: "form" }),
                      });
                      await invalidateAll();
                      backToList();
                    }}
                  />
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </>
              )}

              {(action?.type === "upload" || action?.type === "upload_expiry") && (
                <>
                  {action.requiresExpiry && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                      An expiry date is required for this document type.
                    </p>
                  )}
                  <EmployeeDocuments
                    employeeId={employee.id}
                    companyId={employee.companyId}
                    preselectedType={action.preselectedDocType}
                    requireExpiry={action.requiresExpiry}
                    onUpload={async (docId) => {
                      await fetch(`/api/onboarding-tasks/${selected.id}/complete`, {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ completionMethod: "upload", linkedDocumentId: docId }),
                      });
                      await invalidateAll();
                      backToList();
                    }}
                  />
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </>
              )}

              {action?.type === "acknowledge" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <BookOpen className="h-5 w-5 shrink-0 mt-0.5" style={{ color: NAVY }} />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && (
                          <p className="text-xs text-gray-500 mt-1">{selected.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={ackChecked}
                      onChange={e => setAckChecked(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 accent-[#1B3A6B]" />
                    <span className="text-sm text-gray-700">
                      I acknowledge I have read and agree to the above
                    </span>
                  </label>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Signed by</label>
                    <input type="text" value={ackSigner}
                      onChange={e => setAckSigner(e.target.value)}
                      placeholder="Full name…"
                      className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30" />
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button size="sm"
                    disabled={!ackChecked || !ackSigner.trim() || completing}
                    onClick={() => void handleComplete(selected, {
                      completionMethod: "acknowledge",
                      acknowledgedBy: ackSigner,
                      acknowledgedAt: new Date().toISOString(),
                    })}
                    className="text-white gap-1.5" style={{ background: NAVY }}>
                    {completing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Confirm Acknowledgment
                  </Button>
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </div>
              )}

              {action?.type === "number_entry" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                    {selected.description && (
                      <p className="text-xs text-gray-500 mt-1">{selected.description}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Training hours completed</label>
                    <input type="number" min="0" value={ocfsHours}
                      onChange={e => setOcfsHours(e.target.value)}
                      placeholder="e.g. 30"
                      className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30" />
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button size="sm" disabled={!ocfsHours || completing}
                    onClick={() => void handleComplete(selected, {
                      completionMethod: "manual",
                      completionNote: `OCFS training hours: ${ocfsHours}`,
                    })}
                    className="text-white gap-1.5" style={{ background: NAVY }}>
                    {completing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Mark as Completed
                  </Button>
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </div>
              )}

              {action?.type === "verify" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <UserCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: NAVY }} />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && (
                          <p className="text-xs text-gray-500 mt-1">{selected.description}</p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1.5 uppercase tracking-wide">
                          Assigned to: {selected.assignedToRole}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-500">Verification notes (optional)</label>
                    <textarea value={verifyNotes} onChange={e => setVerifyNotes(e.target.value)}
                      placeholder="Add notes…" rows={3}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30 resize-none" />
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button size="sm" disabled={completing}
                    onClick={() => void handleComplete(selected, {
                      completionMethod: "verify",
                      completionNote: verifyNotes || undefined,
                    })}
                    className="text-white gap-1.5" style={{ background: NAVY }}>
                    {completing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Mark as Completed
                  </Button>
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </div>
              )}

              {action?.type === "esign_all" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    All acknowledgment tasks must be completed before finalizing this e-sign summary.
                  </p>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                    {tasks
                      .filter(t => getAction(t).type === "acknowledge")
                      .map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          {t.status === "completed"
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            : <Clock className="h-4 w-4 text-gray-300 shrink-0" />}
                          <span className={t.status === "completed" ? "text-gray-400" : "text-gray-700"}>
                            {t.taskName}
                          </span>
                        </div>
                      ))}
                  </div>
                  {completeError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{completeError}
                    </p>
                  )}
                  <Button size="sm"
                    disabled={completing || tasks.filter(t => getAction(t).type === "acknowledge").some(t => t.status !== "completed")}
                    onClick={() => void handleComplete(selected, { completionMethod: "manual" })}
                    className="text-white gap-1.5" style={{ background: NAVY }}>
                    {completing
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Mark E-Sign Summary Complete
                  </Button>
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </div>
              )}

              {action?.type === "simple" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div className="flex items-start gap-2.5">
                      <Clipboard className="h-5 w-5 shrink-0 mt-0.5" style={{ color: NAVY }} />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{selected.taskName}</p>
                        {selected.description && (
                          <p className="text-xs text-gray-500 mt-1">{selected.description}</p>
                        )}
                        {!selected.isRequired && (
                          <span className="mt-1.5 inline-block text-[10px] text-gray-400">Optional task</span>
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
                    <Button size="sm" disabled={completing}
                      onClick={() => void handleComplete(selected, { completionMethod: "manual" })}
                      className="text-white gap-1.5" style={{ background: NAVY }}>
                      {completing
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Mark as Completed
                    </Button>
                    {!selected.isRequired && (
                      <button onClick={() => void handleSkip(selected)}
                        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                        <SkipForward className="h-3.5 w-3.5" />Skip
                      </button>
                    )}
                  </div>
                  <NoteSection taskId={selected.id} notes={notes} onNoteAdded={() => void refetchDetail()} />
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
