import React from "react";
import { Link } from "wouter";
import { useGetEasyTeamStatus, useGetWebhookLogs, useHealthCheck } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Activity, Webhook, Settings, CalendarDays, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: status, isLoading: statusLoading } = useGetEasyTeamStatus();
  const { data: health, isLoading: healthLoading } = useHealthCheck();
  const { data: webhooks, isLoading: webhooksLoading } = useGetWebhookLogs();

  const lastWebhook = webhooks?.events?.[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Integration Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your EasyTeam Embedded SDK sandbox.</p>
        </div>
        <div className="flex items-center gap-2">
          {healthLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <Badge variant={health?.status === "ok" ? "default" : "destructive"} className="bg-emerald-500 hover:bg-emerald-600">
              API {health?.status === "ok" ? "Online" : "Offline"}
            </Badge>
          )}
          {statusLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <Badge variant={status?.connected ? "default" : "destructive"} className={status?.connected ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
              EasyTeam {status?.connected ? "Connected" : "Disconnected"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-accent" />
              SDK Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Environment</dt>
                  <dd className="font-medium capitalize">{status?.environment || "Unknown"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">API Key</dt>
                  <dd className="font-medium flex items-center gap-1">
                    {status?.apiKeyPresent ? "✅ Present" : "❌ Missing"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">SDK Version</dt>
                  <dd className="font-medium">{status?.sdkVersion || "Unknown"}</dd>
                </div>
              </dl>
            )}
            <div className="mt-4 pt-4 border-t border-border">
              <Link href="/config">
                <Button variant="outline" className="w-full text-xs h-8">View Configuration</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Webhook className="h-5 w-5 text-accent" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {webhooksLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : lastWebhook ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Last Event Received</div>
                  <div className="font-medium mt-1 truncate" title={lastWebhook.event}>
                    {lastWebhook.event}
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">
                    {new Date(lastWebhook.timestamp).toLocaleString()}
                  </div>
                </div>
                <div className="text-xs bg-muted p-2 rounded-md font-mono truncate">
                  {lastWebhook.employee_id ? `Employee: ${lastWebhook.employee_id}` : "No Employee ID"}
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-muted-foreground text-sm flex flex-col items-center">
                <Webhook className="h-8 w-8 mb-2 opacity-20" />
                No webhooks received yet
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-border">
              <Link href="/webhooks">
                <Button variant="outline" className="w-full text-xs h-8">View All Logs</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5 text-accent" />
              Quick Links
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/timeclock" className="flex flex-col items-center justify-center p-4 bg-muted hover:bg-muted/80 rounded-lg text-center transition-colors border border-border">
                <Clock className="h-6 w-6 mb-2 text-primary" />
                <span className="text-xs font-medium">Time Clock</span>
              </Link>
              <Link href="/timesheets" className="flex flex-col items-center justify-center p-4 bg-muted hover:bg-muted/80 rounded-lg text-center transition-colors border border-border">
                <CalendarDays className="h-6 w-6 mb-2 text-primary" />
                <span className="text-xs font-medium">Timesheets</span>
              </Link>
              <Link href="/schedule" className="flex flex-col items-center justify-center p-4 bg-muted hover:bg-muted/80 rounded-lg text-center transition-colors border border-border">
                <Calendar className="h-6 w-6 mb-2 text-primary" />
                <span className="text-xs font-medium">Schedule</span>
              </Link>
              <Link href="/config" className="flex flex-col items-center justify-center p-4 bg-muted hover:bg-muted/80 rounded-lg text-center transition-colors border border-border">
                <Settings className="h-6 w-6 mb-2 text-primary" />
                <span className="text-xs font-medium">Settings</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
