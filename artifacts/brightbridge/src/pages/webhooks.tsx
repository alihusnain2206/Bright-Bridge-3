import React, { useState } from "react";
import { useGetWebhookLogs, useGetExportLogs } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Webhook, Activity, Copy, Check, Download, FileText, Clock, AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

function CopyableUrl({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-border">
        <code className="text-xs flex-1 truncate">{url}</code>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") return <Badge className="bg-emerald-500 text-white">Ready</Badge>;
  if (status === "fetching") return <Badge variant="secondary" className="bg-amber-100 text-amber-700">Fetching…</Badge>;
  if (status === "error") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function Webhooks() {
  const [expandedExport, setExpandedExport] = useState<string | null>(null);

  const { data: eventsData, isLoading: eventsLoading } = useGetWebhookLogs();
  const { data: exportsData, isLoading: exportsLoading } = useGetExportLogs();

  const origin = window.location.origin;
  const eventsUrl = `${origin}/api/easyteam/webhook`;
  const exportUrl = `${origin}/api/easyteam/webhook/export`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Webhooks</h1>
        <p className="text-muted-foreground mt-1">Live stream of events and export requests received from EasyTeam.</p>
      </div>

      {/* URLs to share with EasyTeam */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-primary/10 p-2 rounded-full">
              <Webhook className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-primary">Webhook URLs — share these with EasyTeam</div>
              <div className="text-xs text-muted-foreground">One for clock events, one for timesheet exports.</div>
            </div>
          </div>
          <CopyableUrl url={eventsUrl} label="Events (clock-in / clock-out / breaks)" />
          <CopyableUrl url={exportUrl} label="Timesheet Exports (Convoy delivery)" />
        </CardContent>
      </Card>

      {/* Export Requests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5 text-accent" />
            Timesheet Export Requests
            <span className="text-xs font-normal text-muted-foreground ml-2">(Last 20)</span>
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {exportsLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : !exportsData?.exports || exportsData.exports.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <FileText className="h-8 w-8 opacity-30" />
              <p className="text-sm">No export requests received yet.</p>
              <p className="text-xs">When a manager clicks Export in the Timesheets widget, it will appear here.</p>
            </div>
          ) : (
            <div className="divide-y">
              {exportsData.exports.map((exp) => (
                <div key={exp.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <StatusBadge status={exp.status} />
                      <span className="text-sm font-medium">Requested by <code className="text-xs bg-muted px-1 rounded">{exp.requestedBy}</code></span>
                      {exp.startDate && exp.endDate && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(exp.startDate).toLocaleDateString()} – {new Date(exp.endDate).toLocaleDateString()}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{exp.shiftCount} shift{exp.shiftCount !== 1 ? "s" : ""}</span>
                      {exp.signatureValid ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-600"><ShieldCheck className="h-3 w-3" />Verified</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-600"><ShieldAlert className="h-3 w-3" />Unverified</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">{new Date(exp.receivedAt).toLocaleString()}</span>
                      {exp.status === "ready" && exp.shifts && exp.shifts.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setExpandedExport(expandedExport === exp.id ? null : exp.id)}
                        >
                          {expandedExport === exp.id ? "Hide" : "View"} Shifts
                        </Button>
                      )}
                    </div>
                  </div>

                  {exp.error && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {exp.error}
                    </div>
                  )}

                  {expandedExport === exp.id && exp.shifts && (
                    <div className="mt-2 rounded border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="text-xs">Employee ID</TableHead>
                            <TableHead className="text-xs">Start</TableHead>
                            <TableHead className="text-xs">End</TableHead>
                            <TableHead className="text-xs text-right">Paid Hours</TableHead>
                            <TableHead className="text-xs text-right">Unpaid Breaks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {exp.shifts.map((shift) => (
                            <TableRow key={shift.id} className="text-xs">
                              <TableCell className="font-mono">{shift.employeeId}</TableCell>
                              <TableCell className="font-mono text-muted-foreground">
                                {new Date(shift.start).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-muted-foreground">
                                {new Date(shift.end).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {shift.total_paid_hours_formatted ?? shift.total_paid_hours_decimal ?? "—"}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {shift.total_unpaid_hours_formatted ?? shift.total_unpaid_hours_decimal ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* General Event Stream */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            Event Stream
            <span className="text-xs font-normal text-muted-foreground ml-2">(Last 50 events)</span>
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 bg-muted rounded w-32 animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-24 animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-28 animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-16 animate-pulse" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-muted rounded w-8 ml-auto animate-pulse" /></TableCell>
                  </TableRow>
                ))
              ) : !eventsData?.events || eventsData.events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No webhook events recorded yet. Perform an action in the Time Clock to trigger one.
                  </TableCell>
                </TableRow>
              ) : (
                eventsData.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{event.event}</TableCell>
                    <TableCell className="font-mono text-xs">{event.employee_id || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={event.status === "processed" ? "default" : "secondary"}
                        className={event.status === "processed" ? "bg-emerald-500 text-white" : ""}
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-8 text-xs">View JSON</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
