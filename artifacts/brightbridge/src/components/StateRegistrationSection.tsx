/**
 * StateRegistrationSection — shared component used by:
 *   1. Super-admin client detail page (/clients/:id → Settings tab)
 *   2. Owner Company Settings → State Tax Information page (/settings/state-tax)
 *
 * Props:
 *   companyId         — the company being managed
 *   hasRollfi         — whether the company is enrolled in Rollfi (shows blocker if false)
 *   registrationsUrl  — API URL to GET the registration list
 *                       super-admin:  "/api/rollfi/state-registrations?companyId=<id>"
 *                       owner:        "/api/state-registrations"
 *
 * The add-state form always POSTs to /api/rollfi/onboard/state-registration (the
 * existing Rollfi-integrated endpoint that handles both roles).
 * The retry button always POSTs to /api/rollfi/state-registrations/:id/retry.
 */
import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, Plus, AlertTriangle, CheckCircle2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// ── Constants ────────────────────────────────────────────────────────────────

const NAVY = "#284362";

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StateRegistration {
  id: string; companyId: string; rollfiCompanyId: string;
  stateCode: string; stateName: string; stateEmployerId?: string | null;
  suiAccountNumber?: string | null; suiRate?: number | null;
  fieldValuesJson?: string | null;
  status: string; rollfiResponse?: string | null;
  registeredAt: string; updatedAt: string;
  /** "rollfi" when this row was imported from Rollfi and doesn't exist in the local DB. */
  source?: string | null;
}

const STATE_REG_STATUS: Record<string, { label: string; color: string }> = {
  active:  { label: "Registered", color: "bg-emerald-100 text-emerald-700" },
  pending: { label: "Pending",    color: "bg-yellow-100 text-yellow-700"  },
  failed:  { label: "Failed",     color: "bg-red-100 text-red-700"        },
};

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true when the user has typed the field's own label as its value —
 * e.g. typing "Withholding ID Number" (or "Withholding ID Number*") into the
 * Withholding ID Number field.  Normalises both sides: trims whitespace and
 * strips any trailing asterisk(s) before the case-insensitive comparison.
 */
function isFieldLabelAsValue(fieldName: string, value: string): boolean {
  const norm = (s: string) => s.trim().replace(/\*+$/, "").trim().toLowerCase();
  return norm(value) === norm(fieldName);
}

// ── RetryStateRegButton ───────────────────────────────────────────────────────

function RetryStateRegButton({
  regId,
  label = "Retry",
  onSuccess,
}: {
  regId: string;
  label?: string;
  onSuccess: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  const retry = async () => {
    setRetrying(true); setError("");
    try {
      const res = await fetch(`/api/rollfi/state-registrations/${regId}/retry`, {
        method: "POST", credentials: "include",
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Retry failed");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {error && (
        <span className="text-[10px] text-red-600 max-w-[120px] truncate" title={error}>
          {error}
        </span>
      )}
      <button
        onClick={retry} disabled={retrying}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {retrying ? "Retrying…" : label}
      </button>
    </div>
  );
}

// ── StateRegistrationSection ──────────────────────────────────────────────────

export interface StateRegistrationSectionProps {
  /** The company being managed. */
  companyId: string;
  /** Whether this company is enrolled in Rollfi. Shows a blocker if false. */
  hasRollfi: boolean;
  /**
   * API URL to GET the list of registrations.
   *   Super-admin: "/api/rollfi/state-registrations?companyId=<id>"
   *   Owner:       "/api/state-registrations"
   */
  registrationsUrl: string;
}

export function StateRegistrationSection({
  companyId,
  hasRollfi,
  registrationsUrl,
}: StateRegistrationSectionProps) {
  // ── Add-state form state ────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [stateCode, setStateCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [stateFields, setStateFields] = useState<Record<string, { isMandatory: boolean }>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState("");

  // ── Edit-state form state ───────────────────────────────────────────────────
  const [editingRegId, setEditingRegId] = useState<string | null>(null);
  const [editStateCode, setEditStateCode] = useState("");
  const [editStateName, setEditStateName] = useState("");
  const [editFields, setEditFields] = useState<Record<string, { isMandatory: boolean }>>({});
  const [editFieldValues, setEditFieldValues] = useState<Record<string, string>>({});
  const [editFieldsLoading, setEditFieldsLoading] = useState(false);
  const [editFieldsError, setEditFieldsError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ registrations: StateRegistration[] }>({
    queryKey: ["state-registrations", companyId, registrationsUrl],
    queryFn: () =>
      fetch(registrationsUrl, { credentials: "include" })
        .then(r => r.json() as Promise<{ registrations: StateRegistration[] }>),
    enabled: hasRollfi,
  });

  const registrations = data?.registrations ?? [];

  // Fetch dynamic registration fields from Rollfi when a state is selected
  useEffect(() => {
    if (!stateCode) { setStateFields({}); setFieldValues({}); setFieldsError(""); return; }
    setFieldsLoading(true); setFieldsError("");
    fetch(`/api/rollfi/state-fields/${stateCode}`, { credentials: "include" })
      .then(r => r.json())
      .then((d: {
        companyStateRegistrationFieldList?: Record<string, string>;
        fieldDescription?: Record<string, { isMandatory: boolean }>;
        error?: string;
      }) => {
        if (d.error) { setFieldsError(d.error); return; }
        const fieldList = d.companyStateRegistrationFieldList ?? {};
        const desc      = d.fieldDescription ?? {};
        const fields: Record<string, { isMandatory: boolean }> = {};
        const vals:   Record<string, string>                   = {};
        for (const key of Object.keys(fieldList)) {
          fields[key] = { isMandatory: desc[key]?.isMandatory ?? false };
          vals[key]   = "";
        }
        setStateFields(fields);
        setFieldValues(vals);
      })
      .catch(() => setFieldsError("Failed to load registration fields from the payroll provider"))
      .finally(() => setFieldsLoading(false));
  }, [stateCode]);

  const handleSubmit = async () => {
    if (!stateCode || Object.keys(stateFields).length === 0) return;
    const missing = Object.entries(stateFields)
      .filter(([k, v]) => v.isMandatory && !fieldValues[k]?.trim())
      .map(([k]) => k);
    if (missing.length > 0) { setSaveError(`Required: ${missing.join(", ")}`); return; }

    // Reject any field whose value is the field's own label
    const labelFields = Object.entries(fieldValues)
      .filter(([name, val]) => val.trim() && isFieldLabelAsValue(name, val))
      .map(([name]) => name);
    if (labelFields.length > 0) {
      setSaveError(
        `Enter the actual value${labelFields.length > 1 ? "s" : ""} for: ${labelFields.join(", ")}. The field label was typed as the value.`
      );
      return;
    }

    setSaving(true); setSaveError(""); setSaveSuccess(false);
    try {
      const selectedState = US_STATES.find(s => s.code === stateCode);
      const res = await fetch("/api/rollfi/onboard/state-registration", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId, stateCode, stateName: selectedState?.name ?? stateCode, fieldValues,
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Registration failed");
      setSaveSuccess(true);
      setShowForm(false); setStateCode(""); setStateFields({}); setFieldValues({});
      void refetch();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  // ── Edit handlers ───────────────────────────────────────────────────────────

  const startEdit = (reg: StateRegistration) => {
    // Close add form if open
    setShowForm(false); setSaveError(""); setSaveSuccess(false);
    setEditingRegId(reg.id);
    setEditStateCode(reg.stateCode);
    setEditStateName(reg.stateName);
    setEditError(""); setEditSuccess(false);
    setEditFieldsError(""); setEditFieldsLoading(true); setEditFields({});

    // Pre-fill from stored fieldValuesJson
    const stored: Record<string, string> = reg.fieldValuesJson
      ? JSON.parse(reg.fieldValuesJson) as Record<string, string>
      : {};
    setEditFieldValues(stored);

    // Load dynamic field definitions from the provider
    fetch(`/api/rollfi/state-fields/${reg.stateCode}`, { credentials: "include" })
      .then(r => r.json())
      .then((d: {
        companyStateRegistrationFieldList?: Record<string, string>;
        fieldDescription?: Record<string, { isMandatory: boolean }>;
        error?: string;
      }) => {
        if (d.error) { setEditFieldsError(d.error); return; }
        const fieldList = d.companyStateRegistrationFieldList ?? {};
        const desc      = d.fieldDescription ?? {};
        const fields: Record<string, { isMandatory: boolean }> = {};
        for (const key of Object.keys(fieldList)) {
          fields[key] = { isMandatory: desc[key]?.isMandatory ?? false };
        }
        setEditFields(fields);
        // Merge stored values with discovered field keys — preserve existing, default new to ""
        setEditFieldValues(prev => {
          const merged: Record<string, string> = {};
          for (const key of Object.keys(fields)) {
            merged[key] = prev[key] ?? "";
          }
          return merged;
        });
      })
      .catch(() => setEditFieldsError("Failed to load registration fields from the payroll provider"))
      .finally(() => setEditFieldsLoading(false));
  };

  const cancelEdit = () => {
    setEditingRegId(null); setEditStateCode(""); setEditStateName("");
    setEditFields({}); setEditFieldValues({});
    setEditFieldsLoading(false); setEditFieldsError("");
    setEditError(""); setEditSuccess(false);
  };

  const handleEditSubmit = async () => {
    if (!editingRegId || Object.keys(editFields).length === 0) return;

    const missing = Object.entries(editFields)
      .filter(([k, v]) => v.isMandatory && !editFieldValues[k]?.trim())
      .map(([k]) => k);
    if (missing.length > 0) { setEditError(`Required: ${missing.join(", ")}`); return; }

    // Reject any field whose value is the field's own label
    const labelFields = Object.entries(editFieldValues)
      .filter(([name, val]) => val.trim() && isFieldLabelAsValue(name, val))
      .map(([name]) => name);
    if (labelFields.length > 0) {
      setEditError(
        `Enter the actual value${labelFields.length > 1 ? "s" : ""} for: ${labelFields.join(", ")}. The field label was typed as the value.`
      );
      return;
    }

    setEditSaving(true); setEditError(""); setEditSuccess(false);
    try {
      const res = await fetch(`/api/state-registrations/${editingRegId}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: editFieldValues }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Update failed");
      setEditSuccess(true);
      cancelEdit();
      void refetch();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#284362]" />State Tax Registrations
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Required to withhold and file state taxes at year-end
          </p>
        </div>
        {hasRollfi && !showForm && !editingRegId && (
          <Button
            size="sm" variant="outline"
            onClick={() => { setShowForm(true); setSaveError(""); setSaveSuccess(false); }}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />Add State
          </Button>
        )}
      </div>

      {/* Rollfi not set up */}
      {!hasRollfi && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3 border border-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Complete payroll provider onboarding before adding state registrations.
        </div>
      )}

      {hasRollfi && isLoading && <Skeleton className="h-12 rounded-lg" />}

      {/* Empty state */}
      {hasRollfi && !isLoading && registrations.length === 0 && !showForm && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
          <Globe className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">No states registered yet</p>
          <p className="text-xs text-gray-400 mt-1 mb-3">
            Add the states where your company employs people so your payroll provider
            can correctly withhold and file state taxes.
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />Register First State
          </Button>
        </div>
      )}

      {/* Registration list */}
      {registrations.length > 0 && (
        <div className="divide-y border rounded-xl overflow-hidden">
          {registrations.map(reg => {
            const sc = STATE_REG_STATUS[reg.status] ?? STATE_REG_STATUS.pending;
            return (
              <div
                key={reg.id}
                className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50/50"
              >
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {reg.stateName}{" "}
                    <span className="text-gray-400">({reg.stateCode})</span>
                  </div>
                  {reg.fieldValuesJson ? (
                    <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
                      {Object.entries(JSON.parse(reg.fieldValuesJson) as Record<string, string>)
                        .filter(([, v]) => v)
                        .slice(0, 3)
                        .map(([k, v]) => (
                          <span key={k}>
                            {k}: <span className="font-mono text-gray-600">{v}</span>
                          </span>
                        ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-400 mt-0.5 space-x-2">
                      {reg.stateEmployerId && (
                        <span>Employer ID: <span className="font-mono text-gray-600">{reg.stateEmployerId}</span></span>
                      )}
                      {reg.suiAccountNumber && (
                        <span>· SUI: <span className="font-mono text-gray-600">{reg.suiAccountNumber}</span></span>
                      )}
                      {reg.suiRate != null && <span>· Rate: {reg.suiRate}%</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Rollfi-sourced rows can't be retried or edited through BrightBridge */}
                  {reg.source !== "rollfi" && (reg.status === "failed" || reg.status === "active") && (
                    <RetryStateRegButton
                      regId={reg.id}
                      label={reg.status === "failed" ? "Retry" : "Re-submit"}
                      onSuccess={() => void refetch()}
                    />
                  )}
                  {reg.source !== "rollfi" && hasRollfi && editingRegId !== reg.id && (
                    <button
                      onClick={() => startEdit(reg)}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                      title={`Edit ${reg.stateName} registration fields`}
                    >
                      <Pencil className="h-2.5 w-2.5" />Edit
                    </button>
                  )}
                  {reg.source === "rollfi" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                      Synced from Rollfi
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.color}`}>
                    {sc.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add success banner */}
      {saveSuccess && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          State registration submitted successfully.
        </div>
      )}

      {/* Edit success banner */}
      {editSuccess && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {editStateName} registration updated successfully.
        </div>
      )}

      {/* Edit-state form */}
      {editingRegId && (
        <div className="border border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50/40">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5 text-[#284362]" />
              Edit {editStateName} ({editStateCode}) Registration
            </p>
          </div>

          {editError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {editError}
            </div>
          )}

          {editFieldsLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />Loading {editStateCode} registration fields…
            </div>
          )}
          {editFieldsError && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              {editFieldsError}
            </div>
          )}

          {!editFieldsLoading && Object.keys(editFields).length > 0 && (
            <div className="space-y-3">
              {Object.entries(editFields).map(([fieldName, meta]) => (
                <div key={fieldName} className="space-y-1">
                  <Label className="text-xs text-gray-600 font-medium">
                    {fieldName}
                    {meta.isMandatory
                      ? <span className="text-red-500 ml-1">*</span>
                      : <span className="text-gray-400 font-normal ml-1">(optional)</span>}
                  </Label>
                  <Input
                    value={editFieldValues[fieldName] ?? ""}
                    onChange={e =>
                      setEditFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))
                    }
                    placeholder={fieldName}
                    className="h-9 text-sm bg-white"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => { void handleEditSubmit(); }}
              disabled={editFieldsLoading || Object.keys(editFields).length === 0 || editSaving}
              className="text-white border-0 gap-1.5"
              style={{ background: NAVY }}
            >
              {editSaving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                : <><Pencil className="h-3.5 w-3.5" />Save Changes</>}
            </Button>
          </div>
        </div>
      )}

      {/* Add-state form */}
      {showForm && (
        <div className="border rounded-xl p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-semibold text-gray-800">Register a State</p>
          {saveError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {saveError}
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-gray-600 font-medium">
              State <span className="text-red-500">*</span>
            </Label>
            <select
              value={stateCode}
              onChange={e => setStateCode(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#284362]/20"
            >
              <option value="">Select state…</option>
              {US_STATES.filter(s => !registrations.some(r => r.stateCode === s.code)).map(s => (
                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          {stateCode && fieldsLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" />Loading {stateCode} registration fields…
            </div>
          )}
          {fieldsError && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              {fieldsError}
            </div>
          )}

          {!fieldsLoading && Object.keys(stateFields).length > 0 && (
            <div className="space-y-3">
              {Object.entries(stateFields).map(([fieldName, meta]) => (
                <div key={fieldName} className="space-y-1">
                  <Label className="text-xs text-gray-600 font-medium">
                    {fieldName}
                    {meta.isMandatory
                      ? <span className="text-red-500 ml-1">*</span>
                      : <span className="text-gray-400 font-normal ml-1">(optional)</span>}
                  </Label>
                  <Input
                    value={fieldValues[fieldName] ?? ""}
                    onChange={e =>
                      setFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))
                    }
                    placeholder={fieldName}
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              variant="outline" size="sm"
              onClick={() => {
                setShowForm(false); setSaveError(""); setStateCode("");
                setStateFields({}); setFieldValues({});
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => { void handleSubmit(); }}
              disabled={!stateCode || fieldsLoading || Object.keys(stateFields).length === 0 || saving}
              className="text-white border-0 gap-1.5"
              style={{ background: NAVY }}
            >
              {saving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Registering…</>
                : <><Globe className="h-3.5 w-3.5" />Register State</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
