import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useGenerateEasyTeamToken, useListClients, useListClientEmployees } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Key, Play, Activity, AlertCircle, RefreshCw, Building2 } from "lucide-react";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { ScheduleIllustration } from "@/components/daycare-illustrations";
import { useAuth } from "@/hooks/useAuth";

const CONTAINER_ID = "easyteam-schedule-container";
const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" } as const;
interface EasyTeamEvent { type?: string; _receivedAt?: string; [key: string]: unknown; }

export default function Schedule() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlClientId = params.get("clientId") ?? "";
  const urlEmployeeId = params.get("employeeId") ?? "";

  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  // Owners are locked to their own company; admins/managers get the full picker.
  const [clientId, setClientId] = useState(isOwner ? (user?.companyId ?? urlClientId) : urlClientId);
  const [employeeId, setEmployeeId] = useState(urlEmployeeId);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EasyTeamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isInitialClientChange = useRef(true);
  const autoLaunched = useRef(false);

  const { data: clientsData } = useListClients();
  const { data: employeesData } = useListClientEmployees(clientId);
  const generateToken = useGenerateEasyTeamToken();

  const handleEvent = useCallback((event: EasyTeamEvent) => {
    setEvents((prev) => [{ ...event, _receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  // Taller min-height for full-width mode
  const { launch } = useEasyTeamLauncher(CONTAINER_ID, handleEvent, 900);

  const employees = employeesData?.employees ?? [];
  const selectedClient = clientsData?.clients.find((c) => c.id === clientId);

  // Reset employee selection when client changes (admin mode only)
  useEffect(() => {
    if (isOwner) return;
    if (isInitialClientChange.current) { isInitialClientChange.current = false; return; }
    setEmployeeId(""); setAccessToken(null); setError(null);
  }, [clientId, isOwner]);

  const handleLaunch = useCallback(async (cId = clientId, eId = employeeId, empList = employees) => {
    setError(null);
    if (!cId) return;
    const client = clientsData?.clients.find((c) => c.id === cId);
    const emp = empList.find((e) => e.id === eId) ?? empList[0];
    try {
      const data = await generateToken.mutateAsync({
        data: { employee_id: eId || (empList[0]?.id ?? ""), client_id: cId, role_name: emp?.roleName, access_role: emp?.role },
      });
      if (data.success && data.token) {
        if (client) {
          launch(data.token, {
            page: Pages.WEEKLY_SCHEDULE,
            organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
            locations: [{ id: client.locationId ?? client.id, name: client.locationName, latitude: client.latitude, longitude: client.longitude }],
            employees: empList.map((e) => ({ id: e.id, name: e.name, role: e.roleName ?? e.role, timeTrackingEnabled: true })),
          });
        }
        setAccessToken(data.token);
      } else {
        setError((data as { error?: string }).error ?? "Token generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [clientId, employeeId, employees, clientsData, generateToken, launch]);

  // Auto-launch: owner fires as soon as their employee data is ready;
  // URL deep-link mode (super admin) also auto-launches.
  useEffect(() => {
    if (isOwner && clientId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(clientId, urlEmployeeId, employeesData.employees ?? []);
    } else if (!isOwner && urlClientId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(urlClientId, urlEmployeeId, employeesData.employees ?? []);
    }
  }, [isOwner, clientId, urlClientId, urlEmployeeId, employeesData, handleLaunch]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Schedule</h1>
        <p className="text-muted-foreground mt-1">View the weekly schedule for a daycare center's staff.</p>
      </div>

      {/* ── Compact horizontal configure bar ───────────────────────── */}
      <div className="rounded-xl border p-4" style={PANEL}>
        <div className="flex flex-wrap items-end gap-4">

          <div className="flex items-center gap-2 shrink-0">
            <Key className="h-4 w-4 text-[#E8622A]" />
            <span className="text-white font-semibold text-sm">Configure Session</span>
          </div>

          {isOwner ? (
            /* Owner: company locked to their own, shown as a read-only chip */
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm" style={PANEL_INNER}>
              <Building2 className="h-3.5 w-3.5 text-white/50" />
              <span className="text-white/80 font-medium">{selectedClient?.name ?? user?.companyId}</span>
            </div>
          ) : (
            /* Super admin / manager: full client dropdown */
            <div className="flex-1 min-w-[200px] max-w-xs space-y-1">
              <Label className="text-white/60 text-xs">Daycare Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="border-white/15 text-white h-9" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {(clientsData?.clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Employee selector — optional for all roles */}
          <div className="flex-1 min-w-[200px] max-w-xs space-y-1">
            <Label className="text-white/60 text-xs">Employee <span className="text-white/30">(optional)</span></Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={!clientId}>
              <SelectTrigger className="border-white/15 text-white h-9" style={{ background: "rgba(255,255,255,0.08)" }}>
                <SelectValue placeholder={clientId ? "All employees" : "Select client first"} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name} — {e.roleName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Launch / Relaunch */}
          <Button
            onClick={() => handleLaunch()}
            disabled={generateToken.isPending || !clientId}
            className="bg-[#E8622A] hover:bg-[#d4571f] text-white border-0 h-9 shrink-0"
          >
            {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            {generateToken.isPending ? "Generating…" : accessToken ? "Relaunch" : "Launch Schedule"}
          </Button>

          {/* SDK event counter */}
          {events.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-white/50 ml-auto shrink-0">
              <Activity className="h-3.5 w-3.5 text-[#E8622A]" />
              <span>{events.length} SDK events</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-red-300 border border-red-500/30 bg-red-900/20 w-full mt-1">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Full-width schedule panel ───────────────────────────────── */}
      <div className="rounded-xl border overflow-hidden" style={PANEL}>
        <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
          <Calendar className="h-5 w-5 text-[#E8622A]" />
          <span className="text-white font-semibold text-base">Weekly Schedule</span>
          {selectedClient && <span className="text-sm font-normal text-white/40 ml-1">— {selectedClient.name}</span>}
        </div>
        {!accessToken && (
          <div className="py-24 flex flex-col items-center justify-center gap-4">
            <ScheduleIllustration />
            <div className="text-center text-white/50 max-w-xs px-6">
              <p className="text-sm font-medium text-white/70">
                {isOwner
                  ? "Click Launch Schedule to view your staff schedule."
                  : "Select a client and click Launch to view the schedule."}
              </p>
              <p className="text-xs mt-1 text-white/35">The weekly planner will load in this panel.</p>
            </div>
          </div>
        )}
        <div id={CONTAINER_ID} className="w-full" />
      </div>
    </div>
  );
}
