import React from "react";
import { useGetEasyTeamStatus, useTestConnection } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Shield, Server, Plug, CheckCircle2, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Config() {
  const { data: status, isLoading: statusLoading } = useGetEasyTeamStatus({ query: { enabled: true } });
  const testConnection = useTestConnection();

  const handleTestConnection = () => {
    testConnection.mutate(undefined);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">API Configuration</h1>
        <p className="text-muted-foreground mt-1">Manage connection settings and test authentication with EasyTeam.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-accent" />
              Authentication Status
            </CardTitle>
            <CardDescription>Current status of your EasyTeam API key.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full rounded" />
                <Skeleton className="h-10 w-full rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${status?.apiKeyPresent ? 'bg-emerald-100 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
                      {status?.apiKeyPresent ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="font-medium text-sm">API Key</div>
                      <div className="text-xs text-muted-foreground">
                        {status?.apiKeyPresent ? "Configured and present" : "Missing from environment"}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm">
                    {status?.apiKeyPresent ? "✅" : "❌"}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Server className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">Environment</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {status?.environment || "Unknown"} Mode
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded capitalize">
                    {status?.environment}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Plug className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">SDK Version</div>
                      <div className="text-xs text-muted-foreground">
                        Currently installed version
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded">
                    v{status?.sdkVersion || "Unknown"}
                  </div>
                </div>
              </>
            )}

            {!status?.apiKeyPresent && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Action Required</AlertTitle>
                <AlertDescription>
                  To use the integration, set the <code className="text-xs bg-black/10 px-1 py-0.5 rounded">EASYTEAM_API_KEY</code> environment variable in your Replit secrets and restart the server.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5 text-accent" />
              Connection Tests
            </CardTitle>
            <CardDescription>Run diagnostics to verify backend connectivity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <Button 
                onClick={handleTestConnection} 
                disabled={testConnection.isPending || !status?.apiKeyPresent}
                className="w-full"
              >
                {testConnection.isPending ? "Running Diagnostics..." : "Run Full Connection Test"}
              </Button>

              {testConnection.data && (
                <div className="space-y-3 mt-6 border border-border rounded-lg p-4 bg-muted/20">
                  <h3 className="font-medium text-sm border-b border-border pb-2 mb-3">Diagnostic Results</h3>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">API Connectivity</span>
                    <span>{testConnection.data.apiConnection ? "✅" : "❌"}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Authentication Valid</span>
                    <span>{testConnection.data.authentication ? "✅" : "❌"}</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Webhook Endpoint Reachable</span>
                    <span>{testConnection.data.webhook ? "✅" : "❌"}</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
