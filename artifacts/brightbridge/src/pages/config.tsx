import React from "react";
import { useGetEasyTeamStatus, useTestConnection } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Shield, Server, Plug, CheckCircle2, XCircle, Key, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SANDBOX_BASE_URL, SANDBOX_API_URL } from "@/hooks/useEasyTeamLauncher";

const TEST_ORGANIZATION = { id: "SANDBOX-ORG-001", name: "BrightBridge Sandbox" };
const TEST_LOCATIONS = [
  { id: "SANDBOX-LOC-001", name: "Sandbox Test Location", latitude: 40.7128, longitude: -74.006, employees: { "EMP-TEST-001": {}, "EMP-TEST-002": {}, "EMP-TEST-003": {} } },
];
const TEST_EMPLOYEES = [
  { id: "EMP-TEST-001", name: "John Smith", role: "manager", timeTrackingEnabled: true, wage: 1500, wageType: "hourly" },
  { id: "EMP-TEST-002", name: "Mary Johnson", role: "assistant", timeTrackingEnabled: true, wage: 1200, wageType: "hourly" },
  { id: "EMP-TEST-003", name: "Carlos Rivera", role: "cashier", timeTrackingEnabled: true, wage: 1000, wageType: "hourly" },
];

export default function Config() {
  const { data: status, isLoading: statusLoading } = useGetEasyTeamStatus();
  const testConnection = useTestConnection();

  const handleTestConnection = () => {
    testConnection.mutate(undefined);
  };

  type StatusData = {
    apiKeyPresent?: boolean;
    partnerIdPresent?: boolean;
    environment?: string;
    sdkVersion?: string;
    connected?: boolean;
    baseURL?: string;
  };

  type TestData = {
    apiConnection?: boolean;
    authentication?: boolean;
    tokenExchange?: boolean;
    webhook?: boolean;
    partnerIdPresent?: boolean;
    details?: Record<string, unknown>;
  };

  const s = status as StatusData | undefined;
  const t = testConnection.data as TestData | undefined;

  const checks = [
    {
      label: "Private Key (EASYTEAM_API_KEY)",
      icon: <Key className="h-5 w-5" />,
      ok: s?.apiKeyPresent,
      okText: "RSA private key present",
      failText: "Set EASYTEAM_API_KEY in Replit secrets",
    },
    {
      label: "Partner ID (EASYTEAM_PARTNER_ID)",
      icon: <Shield className="h-5 w-5" />,
      ok: s?.partnerIdPresent,
      okText: "Partner ID configured",
      failText: "Optional — enables full token exchange with EasyTeam",
      warn: true,
    },
    {
      label: "Environment",
      icon: <Server className="h-5 w-5" />,
      ok: true,
      okText: `${s?.environment ?? "sandbox"} mode`,
      failText: "",
    },
    {
      label: "SDK Version",
      icon: <Plug className="h-5 w-5" />,
      ok: true,
      okText: `@easyteam/launcher v${s?.sdkVersion ?? "1.1.19"}`,
      failText: "",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">API Configuration</h1>
        <p className="text-muted-foreground mt-1">EasyTeam SDK integration status, test data, and connection diagnostics.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-accent" />
              Authentication Status
            </CardTitle>
            <CardDescription>Environment variables and SDK configuration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : (
              checks.map((check, i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${
                      check.ok
                        ? "bg-emerald-100 text-emerald-600"
                        : check.warn
                        ? "bg-amber-100 text-amber-600"
                        : "bg-destructive/10 text-destructive"
                    }`}>
                      {check.icon}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{check.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {check.ok ? check.okText : check.failText}
                      </div>
                    </div>
                  </div>
                  <div>
                    {check.ok
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : check.warn
                      ? <span className="text-amber-500 text-lg">⚠</span>
                      : <XCircle className="h-5 w-5 text-destructive" />
                    }
                  </div>
                </div>
              ))
            )}

            {!s?.apiKeyPresent && !statusLoading && (
              <Alert variant="destructive" className="mt-2">
                <AlertTitle>Action Required</AlertTitle>
                <AlertDescription>
                  Set <code className="text-xs bg-black/10 px-1 py-0.5 rounded">EASYTEAM_API_KEY</code> (RSA private key) in Replit secrets and restart the API server.
                </AlertDescription>
              </Alert>
            )}

            {s?.apiKeyPresent && !s?.partnerIdPresent && !statusLoading && (
              <Alert className="mt-2 bg-amber-50 border-amber-200">
                <AlertTitle className="text-amber-800">Partner ID Missing</AlertTitle>
                <AlertDescription className="text-amber-700">
                  Without <code className="text-xs bg-amber-100 px-1 py-0.5 rounded">EASYTEAM_PARTNER_ID</code>, the backend will use the raw signed JWT instead of an exchanged access token. The iframe may still load in sandbox mode.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5 text-accent" />
              Connection Diagnostics
            </CardTitle>
            <CardDescription>Tests JWT signing, token exchange, and webhook endpoint.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleTestConnection}
              disabled={testConnection.isPending || !s?.apiKeyPresent}
              className="w-full"
            >
              {testConnection.isPending ? "Running…" : "Run Full Diagnostic"}
            </Button>

            {t && (
              <div className="space-y-2 border border-border rounded-lg p-4 bg-muted/20">
                <h3 className="font-medium text-sm border-b border-border pb-2 mb-3">Results</h3>
                {[
                  { label: "API Key Present", value: t.apiConnection },
                  { label: "RS256 JWT Signing", value: t.authentication },
                  { label: "Token Exchange (EasyTeam API)", value: t.tokenExchange },
                  { label: "Webhook Endpoint", value: t.webhook },
                  { label: "Partner ID Present", value: t.partnerIdPresent },
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{row.label}</span>
                    <span>{row.value ? "✅" : "❌"}</span>
                  </div>
                ))}
                {t.details && Object.keys(t.details).length > 0 && (
                  <ScrollArea className="h-32 mt-3">
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                      {JSON.stringify(t.details, null, 2)}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5 text-accent" />
              SDK Endpoints
            </CardTitle>
            <CardDescription>EasyTeam iframe URLs used by this integration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Iframe Base URL", value: SANDBOX_BASE_URL },
              { label: "API Base URL", value: SANDBOX_API_URL },
              { label: "Exchange Token", value: `${SANDBOX_API_URL}/api/auth/exchangeToken` },
            ].map((row, i) => (
              <div key={i} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{row.label}</div>
                <div className="p-2 bg-muted rounded border border-border text-xs font-mono break-all">{row.value}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Plug className="h-5 w-5 text-accent" />
              Test Data
            </CardTitle>
            <CardDescription>Sample employees and location passed to the EasyTeam launcher.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    organization: TEST_ORGANIZATION,
                    locations: TEST_LOCATIONS,
                    employees: TEST_EMPLOYEES,
                  },
                  null,
                  2
                )}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
