import React, { useState, useCallback } from "react";
import { useGenerateEasyTeamToken } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Key, Play, Activity, AlertCircle } from "lucide-react";
import { useEasyTeamLauncher, Pages, TEST_EMPLOYEES } from "@/hooks/useEasyTeamLauncher";

const CONTAINER_ID = "easyteam-timeclock-container";

interface EasyTeamEvent {
  type: string;
  [key: string]: unknown;
}

export default function TimeClock() {
  const [empId, setEmpId] = useState("EMP-TEST-001");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EasyTeamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exchangeWarning, setExchangeWarning] = useState<string | null>(null);

  const generateToken = useGenerateEasyTeamToken();

  const handleEvent = useCallback((event: EasyTeamEvent) => {
    setEvents((prev) => [{ ...event, _receivedAt: new Date().toISOString() }, ...prev].slice(0, 20));
  }, []);

  useEasyTeamLauncher(CONTAINER_ID, accessToken, Pages.TIME_CLOCK, handleEvent);

  const handleLaunch = () => {
    if (!empId) return;
    setError(null);
    setExchangeWarning(null);
    setAccessToken(null);

    const employee = TEST_EMPLOYEES.find((e) => e.id === empId);

    generateToken.mutate(
      {
        data: {
          employee_id: empId,
          company_id: "SANDBOX-LOC-001",
          location_id: "SANDBOX-LOC-001",
          organization_id: "SANDBOX-ORG-001",
          role_name: employee?.role ?? "manager",
          access_role: "manager",
        },
      },
      {
        onSuccess: (data) => {
          if (data.success && data.token) {
            setAccessToken(data.token);
            if ((data as { exchangeWarning?: string }).exchangeWarning) {
              setExchangeWarning((data as { exchangeWarning?: string }).exchangeWarning ?? null);
            }
          } else {
            setError((data as { error?: string }).error ?? "Token generation failed");
          }
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Request failed");
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Time Clock</h1>
        <p className="text-muted-foreground mt-1">
          Launch the EasyTeam Time Clock via the embedded iframe SDK.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="h-5 w-5 text-accent" />
                Configure Session
              </CardTitle>
              <CardDescription>Select an employee and launch the component.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={empId} onValueChange={setEmpId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEST_EMPLOYEES.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name} ({emp.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={empId} onChange={(e) => setEmpId(e.target.value)} className="font-mono text-sm" />
              </div>

              <Button
                onClick={handleLaunch}
                disabled={generateToken.isPending || !empId}
                className="w-full"
              >
                <Play className="h-4 w-4 mr-2" />
                {generateToken.isPending ? "Generating token…" : accessToken ? "Relaunch" : "Launch Time Clock"}
              </Button>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {exchangeWarning && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{exchangeWarning}</span>
                </div>
              )}

              {accessToken && !error && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">Access Token</div>
                  <div className="p-2 bg-muted rounded text-xs font-mono break-all line-clamp-3 border border-border">
                    {accessToken.slice(0, 80)}…
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                SDK Events
                {events.length > 0 && (
                  <span className="ml-auto text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                    {events.length}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="px-4 pb-4 text-xs text-muted-foreground text-center py-6">
                  Events from the iframe will appear here.
                </div>
              ) : (
                <ScrollArea className="h-48">
                  <div className="px-4 pb-4 space-y-2">
                    {events.map((ev, i) => (
                      <div key={i} className="text-xs bg-muted rounded p-2 font-mono border border-border">
                        <div className="font-semibold text-primary truncate">{ev.type ?? "event"}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">
                          {ev._receivedAt as string}
                        </div>
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
                <Clock className="h-5 w-5 text-accent" />
                Time Clock Component
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative border-t border-border overflow-hidden rounded-b-lg">
              {!accessToken ? (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                  <div className="text-center text-muted-foreground max-w-xs p-6">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">Select an employee and click Launch to load the EasyTeam Time Clock.</p>
                    <p className="text-xs mt-2 opacity-70">
                      The SDK will generate a signed JWT, exchange it for an access token, and mount the iframe here.
                    </p>
                  </div>
                </div>
              ) : null}
              <div id={CONTAINER_ID} className="absolute inset-0 w-full h-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
