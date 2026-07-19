import React, { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Clock, XCircle, Ban, AlertCircle, ShieldCheck,
  ExternalLink, RotateCcw, FileText, Download, Loader2, AlertTriangle,
  ChevronRight, ListTodo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import TaskActionModal from "@/components/TaskActionModal";

const NAVY = "#1B3A6B";
const ACCENT = "#0EA5C9";

interface LinkedTask {
  id: string; taskName: string; status: string; isRequired: boolean;
}

interface ComplianceItem {
  id: string; employeeId: string; companyId: string;
  type: string; name: string; status: string; isRequired: boolean;
  completedAt?: string | null; notes?: string | null;
  dueDate?: string | null; linkedDocumentId?: string | null;
  linkedTasks: LinkedTask[];
}

interface FullTask {
  id: string; employeeId: string; companyId: string;
  taskName: string; description?: string | null; category: string; stage: string;
  assignedToRole: string; status: string; isRequired: boolean;
  dueDate?: string | null; completedAt?: string | null; completedBy?: string | null;
  completionMethod?: string | null; completionNote?: string | null;
  acknowledgedBy?: string | null; acknowledgedAt?: string | null;
  reopenedCount?: number | null; linkedDocumentIds?: string | null;
}

interface EmployeeSummary {
  id: string; firstName: string; lastName: string;
  employeeDisplayId?: string | null; companyId: string;
}

const STATUS_STYLES: Record<string, string> = {
  completed:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  pending:     "bg-gray-50 text-gray-500 border-gray-200",
  not_started: "bg-gray-50 text-gray-500 border-gray-200",
  overdue:     "bg-red-50 text-red-600 border-red-200",
  waived:      "bg-purple-50 text-purple-700 border-purple-200",
};
const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed:   <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />,
  in_progress: <Clock className="h-4 w-4 text-blue-500 shrink-0" />,
  pending:     <Clock className="h-4 w-4 text-gray-400 shrink-0" />,
  not_started: <Clock className="h-4 w-4 text-gray-300 shrink-0" />,
  overdue:     <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
  waived:      <Ban className="h-4 w-4 text-purple-500 shrink-0" />,
};

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Evidence Modal (direct completion — no linked tasks) ───────
interface EvidenceModalProps {
  item: ComplianceItem; emp: EmployeeSummary;
  onClose: () => void; onComplete: () => void;
}
function EvidenceModal({ item, emp, onClose, onComplete }: EvidenceModalProps) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const noteOk = note.trim().length >= 5;

  const submit = async () => {
    if (!noteOk) return;
    setSaving(true); setError("");
    try {
      let linkedDocumentId: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("employeeId", item.employeeId);
        fd.append("companyId", item.companyId);
        fd.append("documentType", "compliance_evidence");
        fd.append("documentName", `${item.name} — Evidence`);
        const upResp = await fetch("/api/documents/upload", { method: "POST", credentials: "include", body: fd });
        if (!upResp.ok) throw new Error("File upload failed");
        const upData = await upResp.json() as { document?: { id: string } };
        linkedDocumentId = upData.document?.id;
      }
      const r = await fetch(`/api/compliance/${item.id}/complete`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note.trim(), linkedDocumentId }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed to complete");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-sm">Complete: {item.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{emp.firstName} {emp.lastName}</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500">
              Note <span className="text-red-500">*</span>
              <span className="font-normal text-gray-400 ml-1">(min 5 characters)</span>
            </label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)}
              placeholder='e.g. "Verified from existing staff file"'
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/30 resize-none"
            />
            {note.trim().length > 0 && note.trim().length < 5 && (
              <p className="text-[10px] text-amber-600">{5 - note.trim().length} more character{5 - note.trim().length !== 1 ? "s" : ""} required</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500">Supporting Document <span className="text-gray-400 font-normal">(optional)</span></label>
            <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-300 rounded-lg px-3 py-2.5 hover:border-[#0EA5C9] hover:bg-blue-50/30 transition-colors">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-500 truncate flex-1">
                {file ? file.name : "Upload PDF, JPG, or PNG…"}
              </span>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file && (
              <button onClick={() => setFile(null)} className="text-[10px] text-gray-400 hover:text-red-500">Remove file</button>
            )}
          </div>
          {error && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
            </p>
          )}
        </div>
        <div className="px-6 pb-5 flex gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" disabled={!noteOk || saving}
            onClick={() => void submit()}
            className="text-white gap-1.5" style={{ background: NAVY }}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Mark Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Review Modal (completed item, directly completed) ──────────
interface ReviewModalProps {
  item: ComplianceItem; emp: EmployeeSummary;
  onClose: () => void; onReopen: () => void;
}
function ReviewModal({ item, emp, onClose, onReopen }: ReviewModalProps) {
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState("");

  const doReopen = async () => {
    setReopening(true); setError("");
    try {
      const r = await fetch(`/api/compliance/${item.id}/reopen`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        throw new Error(d.error ?? "Failed to reopen");
      }
      onReopen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reopen");
    } finally {
      setReopening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{item.name}</h3>
            <p className="text-xs text-gray-400">{emp.firstName} {emp.lastName}</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-1.5">
            <p className="text-xs font-semibold text-emerald-800">Completed</p>
            {item.completedAt && (
              <p className="text-xs text-emerald-700">Date: {fmtDateTime(item.completedAt)}</p>
            )}
          </div>

          {item.notes && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Note</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{item.notes}</p>
            </div>
          )}

          {item.linkedDocumentId && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Supporting Document</p>
              <a href={`/api/documents/${item.linkedDocumentId}/download`} download
                className="flex items-center gap-2 text-sm text-[#0EA5C9] hover:underline">
                <Download className="h-4 w-4 shrink-0" />Download attachment
              </a>
            </div>
          )}

          {!item.notes && !item.linkedDocumentId && (
            <p className="text-sm text-gray-400 italic">No evidence recorded.</p>
          )}

          <div className="pt-2 border-t border-gray-100">
            {reopenConfirm ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">Move item back to not started?</p>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReopenConfirm(false)} className="h-8">Cancel</Button>
                  <Button size="sm" disabled={reopening}
                    onClick={() => void doReopen()}
                    className="h-8 text-white gap-1.5" style={{ background: "#d97706" }}>
                    {reopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
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
        <div className="px-6 pb-5 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ── Task Picker (multiple pending linked tasks) ────────────────
interface TaskPickerProps {
  item: ComplianceItem; tasks: LinkedTask[];
  onPick: (task: LinkedTask) => void; onClose: () => void;
}
function TaskPicker({ item, tasks, onPick, onClose }: TaskPickerProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-sm">{item.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">Select which linked task to complete</p>
        </div>
        <div className="p-3 space-y-1">
          {tasks.map(t => (
            <button key={t.id} onClick={() => onPick(t)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-blue-50 text-left transition-colors">
              <ListTodo className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{t.taskName}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{t.status.replace(/_/g, " ")}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
        <div className="px-5 pb-4 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function EmployeeCompliancePage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id/compliance");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  type ModalState =
    | { mode: "task"; task: FullTask }
    | { mode: "picker"; item: ComplianceItem; tasks: LinkedTask[] }
    | { mode: "direct"; item: ComplianceItem }
    | { mode: "review"; item: ComplianceItem }
    | null;

  const [modal, setModal] = useState<ModalState>(null);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const { data: empData } = useQuery<EmployeeSummary>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" })
      .then(r => r.json() as Promise<EmployeeSummary>),
    enabled: !!empId,
  });

  const { data, isLoading, isError, refetch } = useQuery<{ items: ComplianceItem[]; score: number }>({
    queryKey: ["compliance", empId],
    queryFn: () => fetch(`/api/compliance?employeeId=${empId}`, { credentials: "include" })
      .then(r => r.json() as Promise<{ items: ComplianceItem[]; score: number }>),
    enabled: !!empId,
    staleTime: 0,
  });

  const emp = empData as EmployeeSummary | undefined;
  const items = data?.items ?? [];
  const score = data?.score ?? 0;

  const groups = items.reduce<Record<string, ComplianceItem[]>>((acc, item) => {
    const g = item.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    (acc[g] ??= []).push(item);
    return acc;
  }, {});

  const completed      = items.filter(i => i.status === "completed").length;
  const required       = items.filter(i => i.isRequired);
  const completedReq   = required.filter(i => i.status === "completed").length;

  const invalidate = async () => {
    await refetch();
    await qc.invalidateQueries({ queryKey: ["employee-detail", empId] });
    await qc.invalidateQueries({ queryKey: ["people-employees"] });
  };

  const openTask = async (taskId: string) => {
    setLoadingTaskId(taskId);
    try {
      const r = await fetch(`/api/onboarding-tasks/${taskId}`, { credentials: "include" });
      const d = await r.json() as { task: FullTask };
      setModal({ mode: "task", task: d.task });
    } finally {
      setLoadingTaskId(null);
    }
  };

  const handleItemClick = (item: ComplianceItem) => {
    const pending = item.linkedTasks.filter(t => t.status !== "completed" && t.status !== "skipped");
    if (item.status === "completed" || item.status === "waived") {
      // Review mode
      if (item.linkedTasks.some(t => t.status === "completed" || t.status === "skipped")) {
        // Completed via task — open task modal for first completed linked task
        const doneTask = item.linkedTasks.find(t => t.status === "completed");
        if (doneTask) { void openTask(doneTask.id); return; }
      }
      // Directly completed — show evidence review
      setModal({ mode: "review", item });
      return;
    }
    // Pending — route to completion
    if (pending.length === 0 && item.linkedTasks.length > 0) {
      // All tasks done but item still pending (edge case) — direct complete
      setModal({ mode: "direct", item });
      return;
    }
    if (pending.length === 1) {
      void openTask(pending[0]!.id);
      return;
    }
    if (pending.length > 1) {
      setModal({ mode: "picker", item, tasks: pending });
      return;
    }
    // No linked tasks — direct evidence modal
    setModal({ mode: "direct", item });
  };

  const getButtonLabel = (item: ComplianceItem): string => {
    const pending = item.linkedTasks.filter(t => t.status !== "completed" && t.status !== "skipped");
    if (pending.length > 0) return "Complete via Task";
    return "Mark Done";
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(`/people/${empId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {emp ? `${emp.firstName} ${emp.lastName}` : "Back"}
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
              <div className="h-full rounded-full" style={{
                width: `${score}%`,
                background: score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444",
              }} />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{completedReq}/{required.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Required Items</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{completed}/{items.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Total Items</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
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
                {groupItems.map(item => {
                  const isDone = item.status === "completed" || item.status === "waived";
                  const pendingLinked = item.linkedTasks.filter(t => t.status !== "completed" && t.status !== "skipped");
                  const hasLinked = item.linkedTasks.length > 0;
                  const isLoadingThis = pendingLinked.some(t => loadingTaskId === t.id) ||
                    (isDone && item.linkedTasks.some(t => loadingTaskId === t.id));
                  const buttonLabel = getButtonLabel(item);
                  const isTaskRouted = buttonLabel === "Complete via Task";

                  return (
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
                        {!isDone && hasLinked && pendingLinked.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.linkedTasks.map(t => (
                              <span key={t.id}
                                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${t.status === "completed" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                                {t.taskName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Action button */}
                      {isDone ? (
                        <button
                          onClick={() => handleItemClick(item)}
                          disabled={isLoadingThis}
                          className="text-xs text-gray-400 hover:text-[#0EA5C9] flex items-center gap-1 shrink-0 transition-colors">
                          {isLoadingThis
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <ExternalLink className="h-3 w-3" />}
                          View
                        </button>
                      ) : (
                        <Button
                          size="sm"
                          variant={isTaskRouted ? "outline" : "outline"}
                          disabled={isLoadingThis}
                          onClick={() => handleItemClick(item)}
                          className={`text-xs shrink-0 h-7 gap-1 ${isTaskRouted ? "border-[#0EA5C9] text-[#0EA5C9] hover:bg-blue-50" : ""}`}
                        >
                          {isLoadingThis
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : isTaskRouted
                            ? <ListTodo className="h-3 w-3" />
                            : <CheckCircle2 className="h-3 w-3" />}
                          {buttonLabel}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}

      {modal?.mode === "task" && emp && (
        <TaskActionModal
          employee={{ id: emp.id, companyId: emp.companyId, firstName: emp.firstName, lastName: emp.lastName }}
          initialTask={modal.task}
          onClose={() => setModal(null)}
          onRefresh={() => void invalidate()}
        />
      )}

      {modal?.mode === "picker" && (
        <TaskPicker
          item={modal.item}
          tasks={modal.tasks}
          onPick={t => { setModal(null); void openTask(t.id); }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.mode === "direct" && emp && (
        <EvidenceModal
          item={modal.item}
          emp={emp}
          onClose={() => setModal(null)}
          onComplete={() => { setModal(null); void invalidate(); }}
        />
      )}

      {modal?.mode === "review" && emp && (
        <ReviewModal
          item={modal.item}
          emp={emp}
          onClose={() => setModal(null)}
          onReopen={() => { setModal(null); void invalidate(); }}
        />
      )}
    </div>
  );
}
