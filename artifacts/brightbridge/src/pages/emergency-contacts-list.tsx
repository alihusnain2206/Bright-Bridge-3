import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone, Plus, ChevronRight, AlertTriangle, Loader2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmergencyContactForm from "@/components/EmergencyContactForm";
import { useAuth } from "@/hooks/useAuth";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  position?: string;
  companyId: string;
  status?: string;
}

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phoneNumber: string;
  contactType: string;
}

function getInitials(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function ContactSummary({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery<{ contacts: EmergencyContact[] }>({
    queryKey: ["emergency-contacts", employeeId],
    queryFn: () =>
      fetch(`/api/emergency-contacts?employeeId=${employeeId}`, { credentials: "include" }).then(r => r.json() as Promise<{ contacts: EmergencyContact[] }>),
    staleTime: 60_000,
  });

  if (isLoading) return <span className="text-gray-400 text-sm">Loading…</span>;
  const contacts = data?.contacts ?? [];
  if (contacts.length === 0)
    return <span className="text-gray-400 text-sm italic">No contacts added</span>;
  const primary = contacts.find(c => c.contactType === "primary") ?? contacts[0]!;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-800 text-sm font-medium">{primary.name}</span>
      <span className="text-gray-500 text-xs">{primary.relationship} · {primary.phoneNumber}</span>
      {contacts.length > 1 && (
        <span className="text-gray-400 text-xs">+{contacts.length - 1} more</span>
      )}
    </div>
  );
}

export default function EmergencyContactsListPage() {
  const { user } = useAuth();
  const companyId = user?.companyId ?? "";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);

  const { data, isLoading, isError } = useQuery<{ employees: Employee[] }>({
    queryKey: ["people-employees", companyId],
    queryFn: () =>
      fetch(`/api/employees?companyId=${encodeURIComponent(companyId)}`, { credentials: "include" }).then(r => {
        if (!r.ok) throw new Error("Failed");
        return r.json() as Promise<{ employees: Employee[] }>;
      }),
    staleTime: 5 * 60_000,
    enabled: !!companyId,
  });

  const employees = (data?.employees ?? []).filter(e => e.status !== "terminated");

  const filtered = employees.filter(e => {
    const name = `${e.firstName} ${e.lastName}`.toLowerCase();
    return name.includes(search.toLowerCase()) ||
      (e.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (e.position ?? "").toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Emergency Contacts</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            View and manage emergency contact information for all team members.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or title…"
            className="pl-9"
          />
        </div>
        {search && (
          <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600 text-sm">
            Clear
          </button>
        )}
        <span className="text-gray-400 text-sm ml-auto">{filtered.length} employee{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading employees…</span>
          </div>
        ) : isError ? (
          <div className="py-16 flex flex-col items-center gap-3 text-red-500">
            <AlertTriangle className="h-6 w-6" />
            <span className="text-sm">Failed to load employees.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <Users className="h-8 w-8 opacity-30" />
            <span className="text-sm">{search ? "No employees match your search." : "No employees found."}</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Title</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Emergency Contact</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(emp => {
                const fullName = `${emp.firstName} ${emp.lastName}`;
                const initials = getInitials(emp.firstName, emp.lastName);
                const color = avatarColor(fullName);
                return (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {initials}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{fullName}</div>
                          <div className="text-gray-400 text-xs">{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600 hidden sm:table-cell">
                      {emp.position ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <ContactSummary employeeId={emp.id} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(emp)}
                        className="gap-1.5 text-xs"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        Manage
                        <ChevronRight className="h-3 w-3 text-gray-400" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <h2 className="font-semibold text-gray-900">Emergency Contacts</h2>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selected.firstName} {selected.lastName}
                  {selected.position && <> · {selected.position}</>}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <EmergencyContactForm
                employeeId={selected.id}
                companyId={selected.companyId}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
