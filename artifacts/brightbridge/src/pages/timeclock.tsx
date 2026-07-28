import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useGenerateEasyTeamToken, useListClients, useListClientEmployees } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Key, Play, Activity, AlertCircle, RefreshCw } from "lucide-react";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { ClockIllustration } from "@/components/daycare-illustrations";

const CONTAINER_ID = "easyteam-timeclock-container";
const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" } as const;
interface EasyTeamEvent { type?: string; _receivedAt?: string; [key: string]: unknown; }

export default function TimeClock() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlClientId = params.get("clientId") ?? "";
  const urlEmployeeId = params.get("employeeId") ?? "";

  const [clientId, setClientId] = useState(urlClientId);
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

  const { launch } = useEasyTeamLauncher(CONTAINER_ID, handleEvent, 520);

  const employees = employeesData?.employees ?? [];
  const selectedClient = clientsData?.clients.find((c) => c.id === clientId);
  const selectedEmployee = employees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (isInitialClientChange.current) { isInitialClientChange.current = false; return; }
    setEmployeeId(""); setAccessToken(null); setError(null);
  }, [clientId]);

  const handleLaunch = useCallback(async (cId = clientId, eId = employeeId, empList = employees) => {
    if (!cId) return;
    setError(null);
    const client = clientsData?.clients.find((c) => c.id === cId);
    const emp = empList.find((e) => e.id === eId) ?? empList[0];
    try {
      const data = await generateToken.mutateAsync({
        data: { employee_id: eId || (empList[0]?.id ?? ""), client_id: cId, role_name: emp?.roleName, access_role: emp?.role },
      });
      if (data.success && data.token) {
        if (!client) {
          setError("Client not found — please select a valid daycare from the dropdown.");
          return;
        }
        launch(data.token, {
          page: Pages.TIME_CLOCK,
          organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
          locations: [{ id: client.locationId ?? client.id, name: client.locationName, latitude: client.latitude, longitude: client.longitude }],
          employees: empList.map((e) => ({ id: e.id, name: e.name, role: e.roleName ?? e.role, timeTrackingEnabled: true })),
        });
        setAccessToken(data.token);
      } else {
        setError((data as { error?: string }).error ?? "Token generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [clientId, employeeId, employees, clientsData, generateToken, launch]);

  useEffect(() => {
    if (urlClientId && urlEmployeeId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(urlClientId, urlEmployeeId, employeesData.employees ?? []);
    }
  }, [urlClientId, urlEmployeeId, employeesData, handleLaunch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Time Clock</h1>
        <p className="text-muted-foreground mt-1">Launch the EasyTeam Time Clock for a specific employee.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">

          {/* Configure Session — dark panel */}
          <div className="rounded-xl border p-5 space-y-4" style={PANEL}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Key className="h-4 w-4 text-[#E8622A]" />
                <span className="text-white font-semibold text-base">Configure Session</span>
              </div>
              <p className="text-white/50 text-xs">Select a client and employee to launch their time clock.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Daycare Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="border-white/15 text-white bg-white/8 focus:ring-[#E8622A]" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {(clientsData?.clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId} disabled={!clientId}>
                <SelectTrigger className="border-white/15 text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <SelectValue placeholder={clientId ? "Select an employee…" : "Select a client first"} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} — {e.roleName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedClient && selectedEmployee && (
              <div className="p-3 rounded-lg text-xs space-y-0.5 border" style={PANEL_INNER}>
                <div className="font-semibold text-white">{selectedEmployee.name}</div>
                <div className="text-white/50">{selectedEmployee.roleName} · {selectedClient.name}</div>
                <div className="text-white/35 font-mono text-[10px]">{selectedEmployee.id}</div>
              </div>
            )}

            <Button
              onClick={() => handleLaunch()}
              disabled={generateToken.isPending || !clientId || !employeeId}
              className="w-full bg-[#E8622A] hover:bg-[#d4571f] text-white border-0"
            >
              {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {generateToken.isPending ? "Generating token…" : accessToken ? "Relaunch" : "Launch Time Clock"}
            </Button>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md text-xs text-red-300 border border-red-500/30 bg-red-900/20">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
            {accessToken && !error && (
              <div className="space-y-1">
                <div className="text-xs text-white/50 font-medium">Access Token</div>
                <div className="p-2 rounded text-xs font-mono break-all line-clamp-3 border text-white/60" style={PANEL_INNER}>{accessToken.slice(0, 80)}…</div>
              </div>
            )}
          </div>

          {/* SDK Events — dark panel */}
          <div className="rounded-xl border" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <Activity className="h-4 w-4 text-[#E8622A]" />
              <span className="text-white font-semibold text-sm">SDK Events</span>
              {events.length > 0 && (
                <span className="ml-auto text-xs bg-[#E8622A] text-white px-2 py-0.5 rounded-full font-bold">{events.length}</span>
              )}
            </div>
            <div className="p-0">
              {events.length === 0 ? (
                <div className="px-5 py-6 text-xs text-white/35 text-center">Events from the iframe will appear here.</div>
              ) : (
                <ScrollArea className="h-48">
                  <div className="px-4 py-3 space-y-2">
                    {events.map((ev, i) => (
                      <div key={i} className="text-xs rounded p-2 font-mono border border-white/10" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div className="font-semibold text-[#E8622A] truncate">{ev.type ?? "event"}</div>
                        <div className="text-white/40 text-[10px] mt-0.5">{ev._receivedAt}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </div>

        {/* Main iframe panel — dark */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border overflow-hidden" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <Clock className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">Time Clock Component</span>
              {selectedEmployee && (
                <span className="text-sm font-normal text-white/40 ml-1">— {selectedEmployee.name}</span>
              )}
            </div>
            {!accessToken && (
              <div className="py-24 flex flex-col items-center justify-center gap-4">
                <ClockIllustration />
                <div className="text-center text-white/50 max-w-xs px-6">
                  <p className="text-sm font-medium text-white/70">Select a client and employee, then click Launch.</p>
                  <p className="text-xs mt-1 text-white/35">The SDK signs a JWT for that employee and mounts the EasyTeam iframe here.</p>
                </div>
              </div>
            )}
            <div id={CONTAINER_ID} className="w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
