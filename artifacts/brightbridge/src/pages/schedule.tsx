import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useGenerateEasyTeamToken, useListClients, useListClientEmployees } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Key, Play, Activity, AlertCircle, RefreshCw } from "lucide-react";
import { useEasyTeamLauncher, Pages } from "@/hooks/useEasyTeamLauncher";

const CONTAINER_ID = "easyteam-schedule-container";
interface EasyTeamEvent { type?: string; _receivedAt?: string; [key: string]: unknown; }

export default function Schedule() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlClientId = params.get("clientId") ?? "";
  const urlEmployeeId = params.get("employeeId") ?? "";

  const [clientId, setClientId] = useState(urlClientId);
  const [employeeId, setEmployeeId] = useState(urlEmployeeId);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EasyTeamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState<string | null>(null);
  const [launcherEmployees, setLauncherEmployees] = useState<Array<{ id: string; name: string; role: string; timeTrackingEnabled: boolean }>>([]);
  const [launcherOrg, setLauncherOrg] = useState<{ id: string; name: string } | undefined>();
  const [launcherLocations, setLauncherLocations] = useState<Array<{ id: string; name: string; latitude: number; longitude: number }>>([]);

  const isInitialClientChange = useRef(true);
  const autoLaunched = useRef(false);

  const { data: clientsData } = useListClients();
  const { data: employeesData } = useListClientEmployees(clientId);
  const generateToken = useGenerateEasyTeamToken();

  useEffect(() => {
    if (isInitialClientChange.current) {
      isInitialClientChange.current = false;
      return;
    }
    setEmployeeId("");
    setAccessToken(null);
    setError(null);
  }, [clientId]);

  useEffect(() => {
    if (urlClientId && employeesData && !autoLaunched.current) {
      autoLaunched.current = true;
      handleLaunch(urlClientId, urlEmployeeId, employeesData.employees ?? []);
    }
  }, [urlClientId, urlEmployeeId, employeesData]);

  const handleEvent = useCallback((event: EasyTeamEvent) => {
    setEvents((prev) => [{ ...event, _receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  const employees = employeesData?.employees ?? [];
  const selectedClient = clientsData?.clients.find((c) => c.id === clientId);
  const selectedEmployee = employees.find((e) => e.id === employeeId);

  useEasyTeamLauncher(CONTAINER_ID, accessToken, Pages.WEEKLY_SCHEDULE, handleEvent, launcherEmployees, launcherOrg, launcherLocations);

  const handleLaunch = (
    cId = clientId,
    eId = employeeId,
    empList = employees,
  ) => {
    setError(null);
    setExchangeWarning(null);
    setAccessToken(null);

    const client = clientsData?.clients.find((c) => c.id === cId);
    const emp = empList.find((e) => e.id === eId);

    if (client) {
      setLauncherOrg({ id: client.id, name: client.name });
      setLauncherLocations([{ id: client.id, name: client.locationName, latitude: client.latitude, longitude: client.longitude }]);
      setLauncherEmployees(empList.map((e) => ({ id: e.id, name: e.name, role: e.role, timeTrackingEnabled: true })));
    }

    generateToken.mutate(
      { data: { employee_id: eId || (empList[0]?.id ?? ""), client_id: cId, role_name: emp?.roleName, access_role: emp?.role } },
      {
        onSuccess: (data) => {
          if (data.success && data.token) {
            setAccessToken(data.token);
            if ((data as { exchangeWarning?: string }).exchangeWarning) setExchangeWarning((data as { exchangeWarning?: string }).exchangeWarning ?? null);
          } else {
            setError((data as { error?: string }).error ?? "Token generation failed");
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : "Request failed"),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Schedule</h1>
        <p className="text-muted-foreground mt-1">View the weekly schedule for a daycare center's staff.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="h-5 w-5 text-accent" />
                Configure Session
              </CardTitle>
              <CardDescription>Select a client and employee to load their schedule.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Daycare Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Select a client…" /></SelectTrigger>
                  <SelectContent>
                    {(clientsData?.clients ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId} disabled={!clientId}>
                  <SelectTrigger><SelectValue placeholder={clientId ? "Select an employee…" : "Select client first"} /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name} — {e.roleName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedClient && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border text-xs space-y-1">
                  <div className="font-medium">{selectedEmployee?.name ?? "No employee selected"}</div>
                  <div className="text-muted-foreground">{selectedEmployee?.roleName ?? ""} · {selectedClient.name}</div>
                  <div className="text-muted-foreground">{selectedClient.locationName} · {selectedClient.timezone.replace("America/", "")}</div>
                </div>
              )}

              <Button onClick={() => handleLaunch()} disabled={generateToken.isPending || !clientId} className="w-full">
                {accessToken ? <RefreshCw className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {generateToken.isPending ? "Generating token…" : accessToken ? "Relaunch" : "Launch Schedule"}
              </Button>

              {error && <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
              {exchangeWarning && <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{exchangeWarning}</span></div>}
              {accessToken && !error && <div className="space-y-1"><div className="text-xs text-muted-foreground font-medium">Access Token</div><div className="p-2 bg-muted rounded text-xs font-mono break-all line-clamp-3 border border-border">{accessToken.slice(0, 80)}…</div></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                SDK Events
                {events.length > 0 && <span className="ml-auto text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">{events.length}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="px-4 pb-4 text-xs text-muted-foreground text-center py-6">Schedule events will appear here.</div>
              ) : (
                <ScrollArea className="h-48">
                  <div className="px-4 pb-4 space-y-2">
                    {events.map((ev, i) => (
                      <div key={i} className="text-xs bg-muted rounded p-2 font-mono border border-border">
                        <div className="font-semibold text-primary truncate">{ev.type ?? "event"}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">{ev._receivedAt}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col" style={{ minHeight: 620 }}>
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-accent" />
                Weekly Schedule
                {selectedClient && <span className="text-sm font-normal text-muted-foreground ml-1">— {selectedClient.name}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative border-t border-border overflow-hidden rounded-b-lg">
              {!accessToken && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30 z-10">
                  <div className="text-center text-muted-foreground max-w-xs p-6">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">Select a client and click Launch to view the schedule.</p>
                  </div>
                </div>
              )}
              <div id={CONTAINER_ID} className="absolute inset-0 w-full h-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
