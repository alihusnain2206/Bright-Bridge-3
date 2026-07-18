import React, { useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, FolderOpen, Upload, Trash2, Download, AlertCircle,
  FileText, Image, File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";

interface Doc {
  id: string; employeeId: string; companyId: string;
  documentName: string; documentType: string; customTypeName?: string|null;
  fileName: string; fileUrl: string; fileSize: number; mimeType: string;
  status: string; uploadedAt: string; uploadedBy: string;
  verifiedAt?: string|null; expiryDate?: string|null;
  requiresSignature: boolean; signedAt?: string|null;
  notes?: string|null;
}
interface EmployeeSummary { id: string; firstName: string; lastName: string; employeeDisplayId?: string|null; companyId: string; }

const DOC_TYPES = [
  { value: "i9", label: "I-9" },
  { value: "w4", label: "W-4" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "license", label: "License" },
  { value: "certification", label: "Certification" },
  { value: "background_check", label: "Background Check" },
  { value: "tb_test", label: "TB Test" },
  { value: "cpr_certification", label: "CPR Certification" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
];

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso?: string|null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <Image className="h-5 w-5 text-blue-400" />;
  if (mime === "application/pdf") return <FileText className="h-5 w-5 text-red-400" />;
  return <File className="h-5 w-5 text-gray-400" />;
}

export default function EmployeeDocumentsPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id/documents");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState<{ docType: string; docName: string; expiry: string }>({ docType: "other", docName: "", expiry: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File|null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null);
  const [uploadError, setUploadError] = useState<string|null>(null);

  const { data: empData } = useQuery<{ employee: EmployeeSummary }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeSummary }>),
    enabled: !!empId,
  });

  const { data, isLoading, isError } = useQuery<{ documents: Doc[] }>({
    queryKey: ["documents", empId],
    queryFn: () => fetch(`/api/documents?employeeId=${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ documents: Doc[] }>),
    enabled: !!empId,
    staleTime: 0,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("employeeId", empId);
      fd.append("companyId", emp?.companyId ?? "");
      fd.append("documentName", uploadForm.docName || file.name);
      fd.append("documentType", uploadForm.docType);
      if (uploadForm.expiry) fd.append("expiryDate", uploadForm.expiry);
      const r = await fetch("/api/documents/upload", { method: "POST", credentials: "include", body: fd });
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? "Upload failed"); }
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents", empId] });
      setShowUpload(false);
      setSelectedFile(null);
      setUploadForm({ docType: "other", docName: "", expiry: "" });
      setUploadError(null);
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/documents/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["documents", empId] }); setDeleteConfirm(null); },
  });

  const emp = empData?.employee;
  const docs = data?.documents ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(`/people/${empId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {emp ? `${emp.firstName} ${emp.lastName}` : "Back"}
        </button>
        <Button
          size="sm"
          onClick={() => setShowUpload(true)}
          className="gap-1.5 text-white text-xs"
          style={{ background: NAVY }}
        >
          <Upload className="h-3.5 w-3.5" /> Upload Document
        </Button>
      </div>

      <div className="flex items-start gap-3">
        <FolderOpen className="h-6 w-6 mt-1 shrink-0" style={{ color: NAVY }} />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Documents</h1>
          {emp && <p className="text-sm text-gray-500">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>}
        </div>
      </div>

      {showUpload && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-800">Upload Document</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Document Type</label>
              <select
                value={uploadForm.docType}
                onChange={e => setUploadForm(f => ({ ...f, docType: e.target.value }))}
                className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Document Name</label>
              <input
                type="text"
                value={uploadForm.docName}
                onChange={e => setUploadForm(f => ({ ...f, docName: e.target.value }))}
                placeholder="Leave blank to use file name"
                className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Expiry Date (optional)</label>
              <input
                type="date"
                value={uploadForm.expiry}
                onChange={e => setUploadForm(f => ({ ...f, expiry: e.target.value }))}
                className="w-full h-9 rounded-md border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">File <span className="text-red-400">*</span></label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-9 rounded-md border border-dashed border-gray-300 px-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors text-left truncate"
              >
                {selectedFile ? selectedFile.name : "Choose file…"}
              </button>
            </div>
          </div>
          {uploadError && (
            <p className="text-sm text-red-500">{uploadError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setShowUpload(false); setSelectedFile(null); setUploadError(null); }} disabled={uploadMutation.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={uploadMutation.isPending || !selectedFile}
              onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
              className="gap-1.5 text-white"
              style={{ background: NAVY }}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : isError ? (
        <div className="text-center py-10">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">Failed to load documents</p>
        </div>
      ) : docs.length === 0 && !showUpload ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <FolderOpen className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No documents uploaded yet</p>
          <p className="text-gray-400 text-sm mt-1">Upload licenses, certifications, or other documents</p>
          <Button size="sm" onClick={() => setShowUpload(true)} className="mt-4 gap-1.5 text-white" style={{ background: NAVY }}>
            <Upload className="h-3.5 w-3.5" /> Upload Document
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">All Documents</span>
            <span className="text-xs text-gray-400">{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {docs.map(doc => (
              <div key={doc.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    <FileIcon mime={doc.mimeType} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 truncate">{doc.documentName}</span>
                      <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full capitalize">
                        {DOC_TYPES.find(t => t.value === doc.documentType)?.label ?? doc.documentType}
                      </span>
                      {doc.status === "verified" && (
                        <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">Verified</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
                      <span>{fmt(doc.fileSize)}</span>
                      <span>·</span>
                      <span>Uploaded {fmtDate(doc.uploadedAt)}</span>
                      {doc.expiryDate && (
                        <>
                          <span>·</span>
                          <span className={new Date(doc.expiryDate) < new Date() ? "text-red-500" : ""}>
                            Expires {fmtDate(doc.expiryDate)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => setDeleteConfirm(doc.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {deleteConfirm === doc.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-600">Delete "{doc.documentName}"?</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} className="h-7 text-xs">Cancel</Button>
                      <Button
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(doc.id)}
                        className="h-7 text-xs bg-red-500 hover:bg-red-600 text-white border-0"
                      >
                        {deleteMutation.isPending ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
