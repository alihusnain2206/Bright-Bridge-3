/**
 * CompanyInfoSection — Company Information tab for the Organization Settings hub.
 *
 * Sections:
 *   1. Company Name          → read-only (no endpoint exists)
 *   2. Basic Info            → doingBusinessAs + businessWebsite via updateCompany
 *   3. Address & Contact     → address1/2, city, state, zip, phone via updateCompanyLocation
 *   4. Tax & Legal (KYB)     → EIN, entity type, date of incorporation via updateKybInformation
 *                              LOCKED when KYB has been submitted (kybStatus ≠ "not_started")
 *
 * Rules:
 *  - Saves write to our DB AND the payroll provider.
 *  - If the provider call fails, we do NOT report success.
 *  - Provider name is never shown to owners.
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Globe, MapPin, Phone, Lock, Edit2, Check, X,
  AlertTriangle, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ─────────────────────────────────────────────────────

interface CompanyInfo {
  id: string;
  name: string;
  doingBusinessAs: string | null;
  businessWebsite: string | null;
  phone: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zipcode: string;
  ein: string | null;
  kybStatus: string;
  // From Rollfi
  rollfiCompanyId: string | null;
  rollfiLocationId: string | null;
  rollfiKybInformationId: string | null;
  rollfiEntityType: string | null;
  rollfiDateOfIncorporation: string | null;
  rollfiEin: string | null;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const ENTITY_TYPES = ["LLC","C Corp","S Corp","Sole Proprietor","Partnership","Nonprofit"];

// ── Sub-components ────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-7 h-7 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <Label className="text-xs text-gray-500 mb-1 block">{label}</Label>
      <p className="text-sm text-gray-700 py-2 px-3 bg-gray-50 rounded-lg border border-gray-200">
        {value || <span className="text-gray-400 italic">Not set</span>}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface Props { companyId: string }

export function CompanyInfoSection({ companyId }: Props) {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ company: CompanyInfo }>({
    queryKey: ["company-info", companyId],
    queryFn: () =>
      fetch(`/api/company-info?companyId=${companyId}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div>;
  if (error || !data?.company) return (
    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">
      Failed to load company information.
    </div>
  );

  const co = data.company;
  const kybLocked = co.kybStatus !== "not_started";
  const hasRollfi = !!co.rollfiCompanyId;

  return (
    <div className="space-y-4">
      {/* ── 1. Company Name (read-only) ─────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <SectionHeader icon={<Building2 className="h-4 w-4 text-[#1B3A6B]" />} title="Company Name" />
        <ReadOnlyField label="Legal name" value={co.name} />
        <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
          <Lock className="h-3 w-3 flex-shrink-0" />
          Company name cannot be changed after registration. Contact support if it needs correcting.
        </p>
      </div>

      {/* ── 2. Basic Info ───────────────────────────────── */}
      {hasRollfi
        ? <BasicInfoForm companyId={companyId} co={co} onSaved={() => qc.invalidateQueries({ queryKey: ["company-info", companyId] })} />
        : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <SectionHeader icon={<Globe className="h-4 w-4 text-[#1B3A6B]" />} title="Basic Info" />
            <p className="text-xs text-gray-500">Payroll setup required before this section becomes editable.</p>
          </div>
        )
      }

      {/* ── 3. Address & Contact ────────────────────────── */}
      {hasRollfi
        ? <LocationForm companyId={companyId} co={co} onSaved={() => qc.invalidateQueries({ queryKey: ["company-info", companyId] })} />
        : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <SectionHeader icon={<MapPin className="h-4 w-4 text-[#1B3A6B]" />} title="Address & Contact" />
            <p className="text-xs text-gray-500">Payroll setup required before this section becomes editable.</p>
          </div>
        )
      }

      {/* ── 4. Tax & Legal ──────────────────────────────── */}
      <KybSection companyId={companyId} co={co} kybLocked={kybLocked} hasRollfi={hasRollfi}
        onSaved={() => qc.invalidateQueries({ queryKey: ["company-info", companyId] })} />
    </div>
  );
}

// ── Basic Info form ───────────────────────────────────────────

function BasicInfoForm({ companyId, co, onSaved }: { companyId: string; co: CompanyInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [dba, setDba] = useState(co.doingBusinessAs ?? "");
  const [website, setWebsite] = useState(co.businessWebsite ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/company-info/basic?companyId=${companyId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doingBusinessAs: dba, businessWebsite: website }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? "Save failed");
      return d;
    },
    onSuccess: () => { setSaveError(null); setEditing(false); onSaved(); },
    onError: (e: Error) => setSaveError(e.message),
  });

  function handleCancel() {
    setDba(co.doingBusinessAs ?? "");
    setWebsite(co.businessWebsite ?? "");
    setSaveError(null);
    setEditing(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-4">
        <SectionHeader icon={<Globe className="h-4 w-4 text-[#1B3A6B]" />} title="Basic Info" />
        {!editing && (
          <Button variant="ghost" size="sm" className="text-[#0EA5C9] h-7 px-2 -mt-1" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="dba" className="text-xs text-gray-600 mb-1 block">Doing Business As</Label>
            <Input id="dba" value={dba} onChange={e => setDba(e.target.value)} maxLength={40}
              placeholder="Trading name (if different from legal name)" />
            <p className="text-xs text-gray-400 mt-1">{dba.length}/40 characters</p>
          </div>
          <div>
            <Label htmlFor="website" className="text-xs text-gray-600 mb-1 block">Business Website</Label>
            <Input id="website" value={website} onChange={e => setWebsite(e.target.value)} maxLength={40}
              placeholder="www.yourcompany.com" />
            <p className="text-xs text-gray-400 mt-1">
              Format: www.domain.com (no https://). {website.length}/40 characters.
            </p>
          </div>
          {saveError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {saveError}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#1B3A6B]/90 text-white h-8"
              onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Check className="h-3.5 w-3.5 mr-1" />
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleCancel} disabled={mutation.isPending}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ReadOnlyField label="Doing Business As" value={co.doingBusinessAs} />
          <ReadOnlyField label="Business Website" value={co.businessWebsite} />
        </div>
      )}
    </div>
  );
}

// ── Location form ─────────────────────────────────────────────

function LocationForm({ companyId, co, onSaved }: { companyId: string; co: CompanyInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [address1, setAddress1] = useState(co.address1);
  const [address2, setAddress2] = useState(co.address2 ?? "");
  const [city, setCity] = useState(co.city);
  const [state, setState] = useState(co.state);
  const [zipcode, setZipcode] = useState(co.zipcode);
  const [phone, setPhone] = useState(co.phone);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/company-info/location?companyId=${companyId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address1, address2, city, state, zipcode, phone }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? "Save failed");
      return d;
    },
    onSuccess: () => { setSaveError(null); setEditing(false); onSaved(); },
    onError: (e: Error) => setSaveError(e.message),
  });

  function handleCancel() {
    setAddress1(co.address1);
    setAddress2(co.address2 ?? "");
    setCity(co.city);
    setState(co.state);
    setZipcode(co.zipcode);
    setPhone(co.phone);
    setSaveError(null);
    setEditing(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-4">
        <SectionHeader icon={<MapPin className="h-4 w-4 text-[#1B3A6B]" />} title="Address & Contact" />
        {!editing && (
          <Button variant="ghost" size="sm" className="text-[#0EA5C9] h-7 px-2 -mt-1" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Address Line 1</Label>
            <Input value={address1} onChange={e => setAddress1(e.target.value)} maxLength={40} placeholder="Street address" />
          </div>
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Address Line 2</Label>
            <Input value={address2} onChange={e => setAddress2(e.target.value)} maxLength={40} placeholder="Suite, floor, etc. (optional)" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs text-gray-600 mb-1 block">City</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} maxLength={40} placeholder="City" />
            </div>
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">State</Label>
              <select
                value={state}
                onChange={e => setState(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/50"
              >
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">ZIP Code</Label>
              <Input value={zipcode} onChange={e => setZipcode(e.target.value)} maxLength={10} placeholder="07101" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">
              <Phone className="h-3 w-3 inline mr-1" />Phone (10 digits)
            </Label>
            <Input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="9731234567" maxLength={10} />
          </div>
          {saveError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {saveError}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#1B3A6B]/90 text-white h-8"
              onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Check className="h-3.5 w-3.5 mr-1" />
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleCancel} disabled={mutation.isPending}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadOnlyField label="Address Line 1" value={co.address1} />
            <ReadOnlyField label="Address Line 2" value={co.address2} />
            <ReadOnlyField label="City" value={co.city} />
            <ReadOnlyField label="State" value={co.state} />
            <ReadOnlyField label="ZIP Code" value={co.zipcode} />
            <ReadOnlyField label="Phone" value={co.phone} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── KYB / Tax & Legal ─────────────────────────────────────────

function KybSection({
  companyId, co, kybLocked, hasRollfi, onSaved,
}: {
  companyId: string;
  co: CompanyInfo;
  kybLocked: boolean;
  hasRollfi: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [ein, setEin] = useState(co.rollfiEin ?? co.ein ?? "");
  const [entityType, setEntityType] = useState(co.rollfiEntityType ?? "LLC");
  const [dateOfIncorp, setDateOfIncorp] = useState(co.rollfiDateOfIncorporation ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/company-info/kyb?companyId=${companyId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ein, entityType, dateOfIncorporation: dateOfIncorp }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? "Save failed");
      return d;
    },
    onSuccess: () => { setSaveError(null); setEditing(false); onSaved(); },
    onError: (e: Error) => setSaveError(e.message),
  });

  const lockReason = !hasRollfi
    ? "Payroll setup required before tax information can be updated."
    : kybLocked
      ? "Tax and legal details are locked once business verification is submitted. Contact support if a correction is needed."
      : null;

  function handleCancel() {
    setEin(co.rollfiEin ?? co.ein ?? "");
    setEntityType(co.rollfiEntityType ?? "LLC");
    setDateOfIncorp(co.rollfiDateOfIncorporation ?? "");
    setSaveError(null);
    setEditing(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-4">
        <SectionHeader
          icon={<Lock className="h-4 w-4 text-[#1B3A6B]" />}
          title="Tax & Legal"
        />
        {!editing && !lockReason && (
          <Button variant="ghost" size="sm" className="text-[#0EA5C9] h-7 px-2 -mt-1" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
      </div>

      {lockReason && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {lockReason}
        </div>
      )}

      {editing ? (
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">EIN (Employer Identification Number)</Label>
            <Input value={ein} onChange={e => setEin(e.target.value.replace(/\D/g, "").slice(0, 9))}
              placeholder="9 digits, no dashes" maxLength={9} />
          </div>
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Entity Type</Label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0EA5C9]/50"
            >
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Date of Incorporation</Label>
            <Input type="date" value={dateOfIncorp} onChange={e => setDateOfIncorp(e.target.value)} />
          </div>
          {saveError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {saveError}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#1B3A6B]/90 text-white h-8"
              onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Check className="h-3.5 w-3.5 mr-1" />
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleCancel} disabled={mutation.isPending}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ReadOnlyField label="EIN" value={co.rollfiEin ?? co.ein} />
          <ReadOnlyField label="Entity Type" value={co.rollfiEntityType} />
          <ReadOnlyField label="Date of Incorporation" value={co.rollfiDateOfIncorporation} />
        </div>
      )}
    </div>
  );
}
