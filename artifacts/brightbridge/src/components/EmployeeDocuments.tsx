import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Download, Trash2, Loader2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NAVY = "#1B3A6B";

export const DOC_TYPES = [
  { value: "i9",               label: "I-9" },
  { value: "w4",               label: "W-4" },
  { value: "handbook",         label: "Handbook Acknowledgment" },
  { value: "policy",           label: "Policy Acknowledgment" },
  { value: "offer_letter",     label: "Offer Letter" },
  { value: "nda",              label: "NDA" },
  { value: "license",          label: "License" },
  { value: "certification",    label: "Certification" },
  { value: "background_check", label: "Background Check" },
  { value: "identification",   label: "Identification" },
  { value: "immunization",     label: "Immunization Records" },
  { value: "physical_exam",    label: "Physical Exam" },
  { value: "tb_test",          label: "TB Test" },
  { value: "custom",           label: "Custom" },
];

interface EmployeeDocument {
  id: string; employeeId: string; companyId: string;
  documentName: string; documentType: string; customTypeName?: string | null;
  fileName: string; fileUrl: string; fileSize?: number | null; mimeType?: string | null;
  status: string; uploadedAt: string; expiryDate?: string | null; notes?: string | null;
}

interface Props {
  employeeId: string;
  companyId: string;
  preselectedType?: string;
  onUpload?: () => void;
}

function expiryClass(expiryDate?: string | null): string {
  if (!expiryDate) return "text-gray-300";
  const days = Math.floor((new Date(expiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0)  return "text-red-600 font-semibold";
  if (days <= 30) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function EmployeeDocuments({ employeeId, companyId, preselectedType, onUpload }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState(preselectedType ?? "");
  const [customName, setCustomName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<{ documents: EmployeeDocument[] }>({
    queryKey: ["documents", employeeId],
    queryFn: () => fetch(`/api/documents?employeeId=${employeeId}`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json() as Promise<{ documents: EmployeeDocument[] }>;
    }),
    staleTime: 60_000,
  });

  const documents = (data?.documents ?? []).filter(d => d.status !== "rejected");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
    setUploadError("");
  };

  const resetForm = () => {
    setSelectedFile(null); setDocType(preselectedType ?? "");
    setCustomName(""); setExpiryDate(""); setNotes("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!docType) { setUploadError("Please select a document type"); return; }
    if (!selectedFile) { setUploadError("Please select a file"); return; }
    if (selectedFile.size > 10 * 1024 * 1024) { setUploadError("File must be 10MB or less"); return; }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(selectedFile.type)) {
      setUploadError("Only PDF, JPG, and PNG files are allowed"); return;
    }

    const displayName = docType === "custom"
      ? (customName.trim() || selectedFile.name)
      : (DOC_TYPES.find(t => t.value === docType)?.label ?? docType);

    const fd = new FormData();
    fd.append("file", selectedFile);
    fd.append("employeeId", employeeId);
    fd.append("companyId", companyId);
    fd.append("documentType", docType);
    fd.append("documentName", displayName);
    if (docType === "custom" && customName.trim()) fd.append("customTypeName", customName.trim());
    if (expiryDate) fd.append("expiryDate", expiryDate);
    if (notes.trim()) fd.append("notes", notes.trim());

    setUploading(true); setUploadError(""); setUploadSuccess("");
    try {
      const r = await fetch("/api/documents/upload", { method: "POST", credentials: "include", body: fd });
      const d = await r.json() as { document?: EmployeeDocument; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      await qc.invalidateQueries({ queryKey: ["documents", employeeId] });
      await qc.invalidateQueries({ queryKey: ["compliance", employeeId] });
      await qc.invalidateQueries({ queryKey: ["people-employees"] });
      setUploadSuccess(`"${displayName}" uploaded successfully`);
      resetForm();
      if (onUpload) onUpload();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/documents/${id}`, { method: "DELETE", credentials: "include" });
      await qc.invalidateQueries({ queryKey: ["documents", employeeId] });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Upload form */}
      <div className="rounded-xl border border-[#1B3A6B]/20 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Upload Document</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Document Type *</Label>
            <Select value={docType} onValueChange={v => { setDocType(v); setUploadError(""); }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {docType === "custom" && (
            <div className="space-y-1">
              <Label className="text-xs">Document Name</Label>
              <Input className="h-8 text-sm" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Name your document…" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Expiry Date</Label>
            <Input className="h-8 text-sm" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            <p className="text-[10px] text-gray-400">Set for certifications and licenses that expire</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Input className="h-8 text-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div>
          <Label className="text-xs">File * (PDF, JPG, PNG · max 10MB)</Label>
          <div
            className="mt-1 border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-[#1B3A6B]/30 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {selectedFile ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                <FileText className="h-4 w-4 text-[#1B3A6B]" />
                <span>{selectedFile.name}</span>
                <span className="text-gray-400 text-xs">({fmtSize(selectedFile.size)})</span>
                <button
                  onClick={e => { e.stopPropagation(); setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="ml-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-400 space-y-1">
                <Upload className="h-6 w-6 mx-auto text-gray-300" />
                <p>Click to select a file</p>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileChange} />
        </div>

        {uploadError && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{uploadError}
          </p>
        )}
        {uploadSuccess && (
          <p className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{uploadSuccess}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={uploading || !selectedFile || !docType}
            className="text-white gap-1.5"
            style={{ background: NAVY }}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {/* Document list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : isError ? (
        <div className="text-red-600 text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Failed to load documents</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-4 text-gray-400 text-sm">No documents uploaded yet</div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Document</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Uploaded</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Expiry</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 truncate max-w-[180px]">{doc.documentName}</div>
                    <div className="text-xs text-gray-400">{DOC_TYPES.find(t => t.value === doc.documentType)?.label ?? doc.documentType}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{fmtDate(doc.uploadedAt)}</td>
                  <td className={`px-4 py-3 text-xs ${expiryClass(doc.expiryDate)}`}>
                    {doc.expiryDate ? fmtDate(doc.expiryDate) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      doc.status === "verified"  ? "bg-emerald-100 text-emerald-700" :
                      doc.status === "uploaded"  ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-500"
                    }`}>{doc.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        target="_blank" rel="noreferrer"
                        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50 transition-colors"
                        title="Delete"
                      >
                        {deletingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
