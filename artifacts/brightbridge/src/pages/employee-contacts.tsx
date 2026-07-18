import React, { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Phone, Plus, Pencil, Trash2, AlertCircle, X, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1B3A6B";

interface Contact {
  id: string; employeeId: string; companyId: string;
  contactType: string; name: string; relationship: string; phoneNumber: string;
  alternatePhone?: string|null; email?: string|null; address?: string|null;
  physicianName?: string|null; physicianPhone?: string|null;
  insuranceProvider?: string|null; insurancePolicyNumber?: string|null;
  createdAt: string;
}
interface EmployeeSummary { id: string; firstName: string; lastName: string; employeeDisplayId?: string|null; companyId: string; }

const RELATIONSHIPS = ["Spouse","Parent","Sibling","Child","Friend","Other"];
const CONTACT_TYPES = ["primary","secondary","physician"];

function ContactForm({
  initial, onSave, onCancel, isSaving,
}: {
  initial?: Partial<Contact>;
  onSave: (data: Partial<Contact>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<Contact>>({
    contactType: "primary",
    name: "",
    relationship: "",
    phoneNumber: "",
    alternatePhone: "",
    email: "",
    address: "",
    physicianName: "",
    physicianPhone: "",
    insuranceProvider: "",
    insurancePolicyNumber: "",
    ...initial,
  });

  function set(key: keyof Contact, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-gray-800">{initial?.id ? "Edit Contact" : "New Contact"}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Name <span className="text-red-400">*</span></label>
          <Input value={form.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="Full name" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Relationship <span className="text-red-400">*</span></label>
          <select
            value={form.relationship ?? ""}
            onChange={e => set("relationship", e.target.value)}
            className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select…</option>
            {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Phone <span className="text-red-400">*</span></label>
          <Input value={form.phoneNumber ?? ""} onChange={e => set("phoneNumber", e.target.value)} placeholder="(555) 000-0000" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Alternate Phone</label>
          <Input value={form.alternatePhone ?? ""} onChange={e => set("alternatePhone", e.target.value)} placeholder="(555) 000-0000" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
          <Input value={form.email ?? ""} onChange={e => set("email", e.target.value)} placeholder="email@example.com" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Contact Type</label>
          <select
            value={form.contactType ?? "primary"}
            onChange={e => set("contactType", e.target.value)}
            className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CONTACT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Address</label>
          <Input value={form.address ?? ""} onChange={e => set("address", e.target.value)} placeholder="123 Main St, City, State" className="h-9 text-sm" />
        </div>
      </div>

      <details className="group">
        <summary className="text-xs font-medium text-gray-400 cursor-pointer select-none hover:text-gray-600">
          Insurance &amp; Physician (optional)
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Physician Name</label>
            <Input value={form.physicianName ?? ""} onChange={e => set("physicianName", e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Physician Phone</label>
            <Input value={form.physicianPhone ?? ""} onChange={e => set("physicianPhone", e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Insurance Provider</label>
            <Input value={form.insuranceProvider ?? ""} onChange={e => set("insuranceProvider", e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Policy Number</label>
            <Input value={form.insurancePolicyNumber ?? ""} onChange={e => set("insurancePolicyNumber", e.target.value)} className="h-9 text-sm" />
          </div>
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>Cancel</Button>
        <Button
          size="sm"
          disabled={isSaving || !form.name || !form.relationship || !form.phoneNumber}
          onClick={() => onSave(form)}
          className="gap-1.5 text-white"
          style={{ background: NAVY }}
        >
          <Save className="h-3.5 w-3.5" /> {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export default function EmployeeContactsPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/people/:id/contacts");
  const qc = useQueryClient();
  const empId = params?.id ?? "";

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null);

  const { data: empData } = useQuery<{ employee: EmployeeSummary }>({
    queryKey: ["employee-detail", empId],
    queryFn: () => fetch(`/api/employees/${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ employee: EmployeeSummary }>),
    enabled: !!empId,
  });

  const { data, isLoading, isError } = useQuery<{ contacts: Contact[] }>({
    queryKey: ["emergency-contacts", empId],
    queryFn: () => fetch(`/api/emergency-contacts?employeeId=${empId}`, { credentials: "include" }).then(r => r.json() as Promise<{ contacts: Contact[] }>),
    enabled: !!empId,
    staleTime: 0,
  });

  const addMutation = useMutation({
    mutationFn: (body: Partial<Contact>) => fetch("/api/emergency-contacts", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, employeeId: empId, companyId: emp?.companyId }),
    }).then(r => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["emergency-contacts", empId] }); setShowAdd(false); },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ...body }: Partial<Contact> & { id: string }) => fetch(`/api/emergency-contacts/${id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["emergency-contacts", empId] }); setEditingId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/emergency-contacts/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.json()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["emergency-contacts", empId] }); setDeleteConfirm(null); },
  });

  const emp = empData?.employee;
  const contacts = data?.contacts ?? [];

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
          onClick={() => { setShowAdd(true); setEditingId(null); }}
          className="gap-1.5 text-white text-xs"
          style={{ background: NAVY }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Contact
        </Button>
      </div>

      <div className="flex items-start gap-3">
        <Phone className="h-6 w-6 mt-1 shrink-0" style={{ color: NAVY }} />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Emergency Contacts</h1>
          {emp && <p className="text-sm text-gray-500">{emp.firstName} {emp.lastName} · {emp.employeeDisplayId}</p>}
        </div>
      </div>

      {showAdd && (
        <ContactForm
          onSave={body => addMutation.mutate(body)}
          onCancel={() => setShowAdd(false)}
          isSaving={addMutation.isPending}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : isError ? (
        <div className="text-center py-10">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">Failed to load contacts</p>
        </div>
      ) : contacts.length === 0 && !showAdd ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Phone className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No emergency contacts yet</p>
          <p className="text-gray-400 text-sm mt-1">Add a contact for this employee</p>
          <Button size="sm" onClick={() => setShowAdd(true)} className="mt-4 gap-1.5 text-white" style={{ background: NAVY }}>
            <Plus className="h-3.5 w-3.5" /> Add Contact
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map(contact => (
            editingId === contact.id ? (
              <ContactForm
                key={contact.id}
                initial={contact}
                onSave={body => editMutation.mutate({ ...(body as Partial<Contact>), id: contact.id })}
                onCancel={() => setEditingId(null)}
                isSaving={editMutation.isPending}
              />
            ) : (
              <div key={contact.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{contact.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                        {contact.relationship}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium capitalize">
                        {contact.contactType}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        {contact.phoneNumber}
                        {contact.alternatePhone && <span className="text-gray-400">· {contact.alternatePhone}</span>}
                      </div>
                      {contact.email && (
                        <div className="text-sm text-gray-500">{contact.email}</div>
                      )}
                      {contact.address && (
                        <div className="text-sm text-gray-500">{contact.address}</div>
                      )}
                      {contact.insuranceProvider && (
                        <div className="text-xs text-gray-400 mt-1">Insurance: {contact.insuranceProvider} {contact.insurancePolicyNumber && `· ${contact.insurancePolicyNumber}`}</div>
                      )}
                      {contact.physicianName && (
                        <div className="text-xs text-gray-400">Physician: {contact.physicianName} {contact.physicianPhone && `· ${contact.physicianPhone}`}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingId(contact.id); setShowAdd(false); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(contact.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {deleteConfirm === contact.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-600">Remove this contact?</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} className="h-7 text-xs">Cancel</Button>
                      <Button
                        size="sm"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(contact.id)}
                        className="h-7 text-xs bg-red-500 hover:bg-red-600 text-white border-0"
                      >
                        {deleteMutation.isPending ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
