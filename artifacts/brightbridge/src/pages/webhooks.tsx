import React, { useState } from "react";
import { useGetWebhookLogs } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Webhook, Activity, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Webhooks() {
  const [copied, setCopied] = useState(false);
  
  // Auto-refresh every 10 seconds
  const { data, isLoading } = useGetWebhookLogs({ 
    query: { 
      enabled: true,
      refetchInterval: 10000 
    } 
  });

  const webhookUrl = `${window.location.origin}/api/easyteam/webhook`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Webhook Event Log</h1>
        <p className="text-muted-foreground mt-1">Live stream of webhook events received from EasyTeam. Auto-refreshes every 10 seconds.</p>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-full">
              <Webhook className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium text-primary">Webhook URL Configuration</div>
              <div className="text-xs text-muted-foreground">Set this URL in your EasyTeam dashboard to receive events.</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-border flex-1 max-w-lg">
            <code className="text-xs flex-1 truncate">{webhookUrl}</code>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copyToClipboard}>
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            Event Stream <span className="text-xs font-normal text-muted-foreground ml-2">(Last 50 events)</span>
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
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 bg-muted rounded w-32 animate-pulse"></div></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-24 animate-pulse"></div></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-28 animate-pulse"></div></TableCell>
                    <TableCell><div className="h-4 bg-muted rounded w-16 animate-pulse"></div></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-muted rounded w-8 ml-auto animate-pulse"></div></TableCell>
                  </TableRow>
                ))
              ) : !data?.events || data.events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No webhook events recorded yet. Perform an action in the Time Clock to trigger one.
                  </TableCell>
                </TableRow>
              ) : (
                data.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {event.event}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {event.employee_id || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={event.status === 'processed' ? "default" : "secondary"} className={event.status === 'processed' ? 'bg-emerald-500 text-white' : ''}>
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
