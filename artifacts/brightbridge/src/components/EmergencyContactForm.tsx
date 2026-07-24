import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, ChevronDown, ChevronUp, Loader2, AlertTriangle, CheckCircle2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NAVY = "#2C4562";

interface EmergencyContact {
  id: string; employeeId: string; companyId: string;
  contactType: string; name: string; relationship: string;
  phoneNumber: string; alternatePhone?: string | null; email?: string | null; address?: string | null;
  physicianName?: string | null; physicianPhone?: string | null;
  insuranceProvider?: string | null; insurancePolicyNumber?: string | null;
  createdAt: string;
}

interface ContactForm {
  contactType: string; name: string; relationship: string;
  phoneNumber: string; alternatePhone: string; email: string; address: string;
  physicianName: string; physicianPhone: string; insuranceProvider: string; insurancePolicyNumber: string;
}

const EMPTY: ContactForm = {
  contactType: "primary", name: "", relationship: "",
  phoneNumber: "", alternatePhone: "", email: "", address: "",
  physicianName: "", physicianPhone: "", insuranceProvider: "", insurancePolicyNumber: "",
};

interface Props {
  employeeId: string;
  companyId: string;
  onFirstSave?: () => void;
}

export default function EmergencyContactForm({ employeeId, companyId, onFirstSave }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactForm>(EMPTY);
  const [showMedical, setShowMedical] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<{ contacts: EmergencyContact[] }>({
    queryKey: ["emergency-contacts", employeeId],
    queryFn: () => fetch(`/api/emergency-contacts?employeeId=${employeeId}`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json() as Promise<{ contacts: EmergencyContact[] }>;
    }),
    staleTime: 60_000,
  });

  const contacts = data?.contacts ?? [];
  const set = (k: keyof ContactForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const startAdd = () => { setForm(EMPTY); setEditingId(null); setAdding(true); setError(""); setShowMedical(false); };
  const startEdit = (c: EmergencyContact) => {
    setForm({
      contactType: c.contactType, name: c.name, relationship: c.relationship,
      phoneNumber: c.phoneNumber, alternatePhone: c.alternatePhone ?? "",
      email: c.email ?? "", address: c.address ?? "",
      physicianName: c.physicianName ?? "", physicianPhone: c.physicianPhone ?? "",
      insuranceProvider: c.insuranceProvider ?? "", insurancePolicyNumber: c.insurancePolicyNumber ?? "",
    });
    setEditingId(c.id); setAdding(true); setError("");
    setShowMedical(!!(c.physicianName || c.insuranceProvider));
  };
  const cancel = () => { setAdding(false); setEditingId(null); setForm(EMPTY); setError(""); };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Full name is required"); return; }
    if (!form.relationship) { setError("Relationship is required"); return; }
    if (!form.phoneNumber.trim()) { setError("Phone number is required"); return; }
    setSaving(true); setError("");
    try {
      const isFirst = contacts.length === 0 && !editingId;
      const payload = { ...form, employeeId, companyId };
      const url = editingId ? `/api/emergency-contacts/${editingId}` : "/api/emergency-contacts";
      const method = editingId ? "PUT" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Save failed"); }
      await qc.invalidateQueries({ queryKey: ["emergency-contacts", employeeId] });
      if (isFirst && onFirstSave) onFirstSave();
      cancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteId(id);
    try {
      await fetch(`/api/emergency-contacts/${id}`, { method: "DELETE", credentials: "include" });
      await qc.invalidateQueries({ queryKey: ["emergency-contacts", employeeId] });
    } finally {
      setDeleteId(null);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (isError) return <div className="flex items-center gap-2 py-4 text-red-600 text-sm"><AlertTriangle className="h-4 w-4" />Failed to load contacts</div>;

  return (
    <div className="space-y-4">
      {contacts.length === 0 && !adding && (
        <div className="text-center py-6 text-gray-400 text-sm">No emergency contacts on file</div>
      )}

      {contacts.map(c => (
        <div key={c.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
              <div className="text-xs text-gray-500">{c.relationship} · <span className="capitalize">{c.contactType}</span></div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => startEdit(c)} className="p-1.5 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleDelete(c.id)} disabled={deleteId === c.id} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50 transition-colors">
                {deleteId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-700">
            <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />{c.phoneNumber}
          </div>
          {c.email && <div className="text-xs text-gray-500">{c.email}</div>}
          {c.address && <div className="text-xs text-gray-500">{c.address}</div>}
          {(c.physicianName || c.insuranceProvider) && (
            <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 space-y-0.5">
              {c.physicianName && <div>Physician: {c.physicianName}{c.physicianPhone ? ` · ${c.physicianPhone}` : ""}</div>}
              {c.insuranceProvider && <div>Insurance: {c.insuranceProvider}{c.insurancePolicyNumber ? ` · ${c.insurancePolicyNumber}` : ""}</div>}
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-[#2C4562]/20 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">{editingId ? "Edit Contact" : "New Emergency Contact"}</p>
            <button onClick={cancel} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Contact Type</Label>
              <Select value={form.contactType} onValueChange={v => set("contactType", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="secondary">Secondary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Relationship *</Label>
              <Select value={form.relationship} onValueChange={v => set("relationship", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {["Spouse","Parent","Sibling","Child","Friend","Other"].map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Full Name *</Label>
              <Input className="h-8 text-sm" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone *</Label>
              <Input className="h-8 text-sm" value={form.phoneNumber} onChange={e => set("phoneNumber", e.target.value)} placeholder="555-1234" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alternate Phone</Label>
              <Input className="h-8 text-sm" value={form.alternatePhone} onChange={e => set("alternatePhone", e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input className="h-8 text-sm" value={form.email} onChange={e => set("email", e.target.value)} type="email" placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address</Label>
              <Input className="h-8 text-sm" value={form.address} onChange={e => set("address", e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <button
            onClick={() => setShowMedical(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showMedical ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Medical Information (optional)
          </button>

          {showMedical && (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-100">
              <div className="space-y-1">
                <Label className="text-xs">Physician Name</Label>
                <Input className="h-8 text-sm" value={form.physicianName} onChange={e => set("physicianName", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Physician Phone</Label>
                <Input className="h-8 text-sm" value={form.physicianPhone} onChange={e => set("physicianPhone", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Insurance Provider</Label>
                <Input className="h-8 text-sm" value={form.insuranceProvider} onChange={e => set("insuranceProvider", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Policy Number</Label>
                <Input className="h-8 text-sm" value={form.insurancePolicyNumber} onChange={e => set("insurancePolicyNumber", e.target.value)} />
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="outline" onClick={cancel}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="text-white gap-1.5" style={{ background: NAVY }}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {editingId ? "Save Changes" : "Add Contact"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={startAdd}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-[#2C4562]/30 hover:text-[#2C4562] transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Emergency Contact
        </button>
      )}
    </div>
  );
}
