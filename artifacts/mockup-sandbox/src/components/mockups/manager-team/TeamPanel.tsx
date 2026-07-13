import React, { useState } from "react";

const NAVY = "#1a2f4a";
const PANEL = "#284362";
const ORANGE = "#E8622A";

const employees = [
  { id: "1", name: "John Smith",   position: "Lead Educator",      status: "active",     etSync: true,  rollfi: "active",     kyc: "approved", bank: true,  hours: 38.5 },
  { id: "2", name: "Mary Johnson", position: "Assistant Teacher",  status: "active",     etSync: true,  rollfi: "active",     kyc: "approved", bank: true,  hours: 32.0 },
  { id: "3", name: "Chris Dale",   position: "Teaching Assistant", status: "onboarding", etSync: false, rollfi: "onboarding", kyc: "pending",  bank: false, hours: 0    },
  { id: "4", name: "Priya Nair",   position: "Child Care Worker",  status: "active",     etSync: true,  rollfi: "active",     kyc: "approved", bank: true,  hours: 40.0 },
  { id: "5", name: "Lena Brooks",  position: "Lead Educator",      status: "on_leave",   etSync: false, rollfi: null,         kyc: "approved", bank: true,  hours: 0    },
];

const STATUS: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  active:     { label: "Active",      dot: "bg-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
  onboarding: { label: "Onboarding",  dot: "bg-yellow-400",  bg: "bg-yellow-500/15 border-yellow-500/30",  text: "text-yellow-400"  },
  on_leave:   { label: "On Leave",    dot: "bg-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",    text: "text-amber-400"   },
  terminated: { label: "Terminated",  dot: "bg-red-400",     bg: "bg-red-500/15 border-red-500/30",        text: "text-red-400"     },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.onboarding!;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SyncDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? "bg-emerald-400" : "bg-white/20"}`} />
      <span className={`text-xs ${ok ? "text-white/60" : "text-white/25"}`}>{label}</span>
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const steps = ["Basic Info", "Pay Details", "Personal Info", "Bank Setup"];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden shadow-2xl border border-white/10" style={{ background: NAVY }}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.05)" }}>
          <div>
            <p className="text-white font-bold">Add Team Member</p>
            <p className="text-white/40 text-xs">Sunshine Daycare Centre</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 text-xl leading-none">×</button>
        </div>
        {/* Step progress */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-1 mb-5">
            {steps.map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i + 1 === step ? "text-white" : i + 1 < step ? "bg-emerald-500 text-white" : "bg-white/10 text-white/30"}`}
                    style={i + 1 === step ? { background: ORANGE } : undefined}>
                    {i + 1 < step ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs hidden sm:inline ${i + 1 === step ? "text-white font-semibold" : "text-white/30"}`}>{s}</span>
                </div>
                {i < steps.length - 1 && <div className={`flex-1 h-px ${i + 1 < step ? "bg-emerald-500/50" : "bg-white/10"}`} />}
              </React.Fragment>
            ))}
          </div>
          {/* Step 1 form */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">First Name</label>
                <input className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30" defaultValue="Alex" />
              </div>
              <div>
                <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">Last Name</label>
                <input className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30" defaultValue="Rivera" />
              </div>
            </div>
            <div>
              <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">Email</label>
              <input className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30" defaultValue="alex.rivera@sunshine.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">Position</label>
                <input className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30" defaultValue="Child Care Worker" />
              </div>
              <div>
                <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">Start Date</label>
                <input type="date" className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30" defaultValue="2026-08-01" />
              </div>
            </div>
            <div>
              <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide block mb-1">Employment Type</label>
              <select className="w-full rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none">
                <option>W2 Employee</option>
                <option>1099 Contractor</option>
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white/80 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={() => setStep(s => Math.min(s + 1, 4))} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm transition-opacity hover:opacity-90" style={{ background: ORANGE }}>
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamPanel() {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch]  = useState("");
  const [filter, setFilter]  = useState("all");

  const filtered = employees.filter((e) => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.position.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || e.status === filter;
    return matchSearch && matchFilter;
  });

  const counts = {
    total:      employees.length,
    active:     employees.filter(e => e.status === "active").length,
    onboarding: employees.filter(e => e.status === "onboarding").length,
    on_leave:   employees.filter(e => e.status === "on_leave").length,
  };

  return (
    <div className="min-h-screen text-white" style={{ background: NAVY, fontFamily: "system-ui, sans-serif" }}>
      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}

      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div>
          <h1 className="text-white font-bold text-lg">My Team</h1>
          <p className="text-white/40 text-xs">Sunshine Daycare Centre · Susan Manager</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: ORANGE }}
        >
          + Add Team Member
        </button>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Staff",  value: counts.total,      color: "text-white" },
            { label: "Active",       value: counts.active,     color: "text-emerald-400" },
            { label: "Onboarding",   value: counts.onboarding, color: "text-yellow-400" },
            { label: "On Leave",     value: counts.on_leave,   color: "text-amber-400" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-white/10 px-4 py-3" style={{ background: "rgba(255,255,255,0.04)" }}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-white/40 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Search + filter */}
        <div className="flex gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or position…"
            className="flex-1 rounded-lg px-3 py-2 text-sm text-white border border-white/10 bg-white/5 focus:outline-none focus:border-white/30"
          />
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white border border-white/10 focus:outline-none"
            style={{ background: PANEL }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="on_leave">On Leave</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                {["Employee", "Status", "Integrations", "Hours (week)", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 font-semibold text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: PANEL }}>
                        {emp.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <p className="text-white font-medium">{emp.name}</p>
                        <p className="text-white/40 text-xs">{emp.position}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={emp.status} />
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    <SyncDot ok={emp.etSync} label="EasyTeam" />
                    <SyncDot ok={emp.rollfi === "active"} label={`Rollfi ${emp.kyc !== "approved" ? "(KYC pending)" : !emp.bank ? "(no bank)" : ""}`} />
                  </td>
                  <td className="px-4 py-3">
                    {emp.hours > 0
                      ? <span className="text-emerald-400 font-semibold">{emp.hours}h</span>
                      : <span className="text-white/20 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button className="px-2.5 py-1 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/25 text-xs transition-colors">View</button>
                      <button className="px-2.5 py-1 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/25 text-xs transition-colors">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Onboarding nudge */}
        {counts.onboarding > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-yellow-500/25 bg-yellow-500/8 text-xs">
            <span className="text-yellow-400 font-bold text-sm mt-0.5">⚠</span>
            <div>
              <p className="text-yellow-300 font-semibold">1 team member is still completing onboarding</p>
              <p className="text-yellow-400/60 mt-0.5">Chris Dale hasn't finished payroll setup. Remind them to complete their bank info so they can be included in payroll.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
