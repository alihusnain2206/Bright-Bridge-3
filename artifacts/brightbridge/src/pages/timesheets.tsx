import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useGenerateEasyTeamToken, useListClients, useListClientEmployees } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarDays, Key, Play, Activity, AlertCircle, Users, User, RefreshCw, Building2 } from "lucide-react";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";
import { TimesheetIllustration } from "@/components/daycare-illustrations";
import { useAuth } from "@/hooks/useAuth";

const CONTAINER_ID = "easyteam-timesheets-container";
const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;
const PANEL_INNER = { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" } as const;
type ViewMode = "all" | "employee";
interface EasyTeamEvent { type?: string; _receivedAt?: string; [key: string]: unknown; }

export default function Timesheets() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlClientId = params.get("clientId") ?? "";
  const urlEmployeeId = params.get("employeeId") ?? "";

  const { user } = useAuth();
  const isScoped = user?.role === "owner" || user?.role === "manager";

  const [clientId, setClientId] = useState(urlClientId);
  const [employeeId, setEmployeeId] = useState(urlEmployeeId);
  const [viewMode, setViewMode] = useState<ViewMode>(urlEmployeeId ? "employee" : "all");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EasyTeamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isInitialClientChange = useRef(true);
  const autoLaunched = useRef(false);
  const scopedAutoLaunched = useRef(false);

  const { data: clientsData } = useListClients();
  const { data: employeesData } = useListClientEmployees(clientId);
  const generateToken = useGenerateEasyTeamToken();

  // For owner/manager: auto-set their company as the client
  useEffect(() => {
    if (isScoped && user?.companyId && !clientId) {
      setClientId(user.companyId);
    }
  }, [isScoped, user?.companyId, clientId]);

  const handleEvent = useCallback((event: EasyTeamEvent) => {
    setEvents((prev) => [{ ...event, _receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  const { launch } = useEasyTeamLauncher(CONTAINER_ID, handleEvent, 780);

  const employees = employeesData?.employees ?? [];
  const selectedClient = clientsData?.clients.find((c) => c.id === clientId);
  const selectedEmployee = employees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (isInitialClientChange.current) { isInitialClientChange.current = false; return; }
    setEmployeeId(""); setAccessToken(null); setError(null);
  }, [clientId]);

  const handleLaunch = useCallback(async (cId = clientId, eId = employeeId, empList = employees, mode = viewMode) => {
    setError(null);
    if (!cId) return;
    const client = clientsData?.clients.find((c) => c.id === cId);
    const emp = empList.find((e) => e.id === eId) ?? empList[0];
    const page = mode === "employee" ? Pages.EMPLOYEE_TIMESHEET : Pages.TIMESHEET;
    try {
      const data = await generateToken.mutateAsync({
        data: { employee_id: eId || (empList[0]?.id ?? ""), client_id: cId, role_name: emp?.roleName, access_role: emp?.role },
      });
      if (data.success && data.token) {
        if (client) {
          launch(data.token, {
            page,
            organization: { id: "ORG-BRIGHTBRIDGE", name: "BrightBridge Assist" },
            locations: [{ id: client.id, name: client.locationName, latitude: client.latitude, longitude: client.longitude }],
            employees: empList.map((e) => ({ id: e.id, name: e.name, role: e.role, timeTrackingEnabled: true })),
          });
        }
        setAccessToken(data.token);
      } else {
        setError((data as { error?: string }).error ?? "Token generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, [clientId, employeeId, employees, viewMode, clientsData, generateToken, launch]);

  useEffect(() => {
    if (urlClientId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(urlClientId, urlEmployeeId, employeesData.employees ?? []);
    }
  }, [urlClientId, urlEmployeeId, employeesData, handleLaunch]);

  // Owner/manager: auto-launch for their company once employees are loaded
  useEffect(() => {
    if (isScoped && clientId && employeesData && !scopedAutoLaunched.current) {
      scopedAutoLaunched.current = true;
      handleLaunch(clientId, "", employeesData.employees ?? [], "all");
    }
  }, [isScoped, clientId, employeesData, handleLaunch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Timesheets</h1>
        <p className="text-muted-foreground mt-1">View all staff timesheets or drill into an individual employee.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">

          {isScoped ? (
            /* Owner / Manager — company info card (auto-scoped, no client picker) */
            <div className="rounded-xl border p-5 space-y-4" style={PANEL}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-4 w-4 text-[#E8622A]" />
                  <span className="text-white font-semibold text-base">Company Timesheets</span>
                </div>
                <p className="text-white/50 text-xs">Viewing timesheets for your company's staff.</p>
              </div>

              {selectedClient && (
                <div className="p-3 rounded-lg border space-y-1" style={PANEL_INNER}>
                  <div className="text-white font-semibold text-sm">{selectedClient.name}</div>
                  <div className="text-white/50 text-xs">{employees.length} employee{employees.length !== 1 ? "s" : ""}</div>
                </div>
              )}

              <Button
                onClick={() => handleLaunch()}
                disabled={generateToken.isPending || !clientId}
                className="w-full bg-[#E8622A] hover:bg-[#d4571f] text-white border-0"
              >
                {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {generateToken.isPending ? "Loading…" : accessToken ? "Refresh" : "Load Timesheets"}
              </Button>

              {error && <div className="flex items-start gap-2 p-3 rounded-md text-xs text-red-300 border border-red-500/30 bg-red-900/20"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
            </div>
          ) : (
            /* Super Admin — full Configure Session panel */
            <div className="rounded-xl border p-5 space-y-4" style={PANEL}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Key className="h-4 w-4 text-[#E8622A]" />
                  <span className="text-white font-semibold text-base">Configure Session</span>
                </div>
                <p className="text-white/50 text-xs">Select client, view mode and employee context.</p>
              </div>

              {/* View mode toggle */}
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">View Mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["all", "employee"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => { setViewMode(mode); setAccessToken(null); }}
                      className="flex items-center justify-center gap-2 p-2 rounded-lg border text-sm font-medium transition-colors"
                      style={viewMode === mode
                        ? { background: "#E8622A", color: "white", borderColor: "#E8622A" }
                        : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)", borderColor: "rgba(255,255,255,0.12)" }
                      }
                    >
                      {mode === "all" ? <Users className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      {mode === "all" ? "All Staff" : "Employee"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">Daycare Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="border-white/15 text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
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
                <Label className="text-white/70 text-xs">
                  Employee {viewMode === "all" && <span className="text-white/35 text-[10px]">(JWT context)</span>}
                </Label>
                <Select value={employeeId} onValueChange={setEmployeeId} disabled={!clientId}>
                  <SelectTrigger className="border-white/15 text-white" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <SelectValue placeholder={clientId ? "Select an employee…" : "Select client first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name} — {e.roleName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedClient && (
                <div className="p-3 rounded-lg text-xs space-y-0.5 border" style={PANEL_INNER}>
                  <div className="font-semibold text-white">{selectedEmployee?.name ?? "All Employees"}</div>
                  <div className="text-white/50">{selectedEmployee?.roleName ?? "Manager view"} · {selectedClient.name}</div>
                </div>
              )}

              <Button
                onClick={() => handleLaunch()}
                disabled={generateToken.isPending || !clientId}
                className="w-full bg-[#E8622A] hover:bg-[#d4571f] text-white border-0"
              >
                {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {generateToken.isPending ? "Generating token…" : accessToken ? "Relaunch" : "Launch Timesheets"}
              </Button>

              {error && <div className="flex items-start gap-2 p-3 rounded-md text-xs text-red-300 border border-red-500/30 bg-red-900/20"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
              {accessToken && !error && (
                <div className="space-y-1">
                  <div className="text-xs text-white/50 font-medium">Access Token</div>
                  <div className="p-2 rounded text-xs font-mono break-all line-clamp-3 border text-white/60" style={PANEL_INNER}>{accessToken.slice(0, 80)}…</div>
                </div>
              )}
            </div>
          )}

          {/* SDK Events — dark panel */}
          <div className="rounded-xl border" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <Activity className="h-4 w-4 text-[#E8622A]" />
              <span className="text-white font-semibold text-sm">SDK Events</span>
              {events.length > 0 && (
                <span className="ml-auto text-xs bg-[#E8622A] text-white px-2 py-0.5 rounded-full font-bold">{events.length}</span>
              )}
            </div>
            {events.length === 0 ? (
              <div className="px-5 py-6 text-xs text-white/35 text-center">Timesheet events will appear here.</div>
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

        {/* Main iframe panel — dark */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border overflow-hidden" style={PANEL}>
            <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
              <CalendarDays className="h-5 w-5 text-[#E8622A]" />
              <span className="text-white font-semibold text-base">
                {viewMode === "employee" ? "Employee Timesheet" : "All Timesheets"}
              </span>
              {selectedEmployee && viewMode === "employee" && (
                <span className="text-sm font-normal text-white/40 ml-1">— {selectedEmployee.name}</span>
              )}
            </div>
            {!accessToken && (
              <div className="py-24 flex flex-col items-center justify-center gap-4">
                <TimesheetIllustration />
                <div className="text-center text-white/50 max-w-xs px-6">
                  <p className="text-sm font-medium text-white/70">Select a client and click Launch to load timesheets.</p>
                  <p className="text-xs mt-1 text-white/35">Staff hours and attendance will appear in this panel.</p>
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
