import React, { useState } from "react";
import { useGenerateEasyTeamToken, useGetEmployees } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Key, Play, Code } from "lucide-react";

export default function TimeClock() {
  const [empId, setEmpId] = useState("EMP-TEST-001");
  const [compId, setCompId] = useState("SUNSHINE-TEST");
  const [token, setToken] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const { data: employeesData } = useGetEmployees({ query: { enabled: true } });
  const generateToken = useGenerateEasyTeamToken();

  const handleGenerateToken = () => {
    if (!empId || !compId) return;
    generateToken.mutate({ data: { employee_id: empId, company_id: compId } }, {
      onSuccess: (data) => {
        if (data.success && data.token) {
          setToken(data.token);
        }
      }
    });
  };

  const handleLoadIframe = () => {
    if (token) {
      setIframeLoaded(true);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Time Clock Test</h1>
        <p className="text-muted-foreground mt-1">Embed the EasyTeam Time Clock component and test API interactions.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="h-5 w-5 text-accent" />
                Generate Auth Token
              </CardTitle>
              <CardDescription>Select a test employee or enter custom IDs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Quick Select Employee</Label>
                <Select onValueChange={(val) => {
                  const emp = employeesData?.employees.find(e => e.id === val);
                  if (emp) {
                    setEmpId(emp.id);
                    setCompId(emp.company_id || "SUNSHINE-TEST");
                  } else if (val === "EMP-TEST-001") {
                    setEmpId("EMP-TEST-001");
                    setCompId("SUNSHINE-TEST");
                  } else if (val === "EMP-TEST-002") {
                    setEmpId("EMP-TEST-002");
                    setCompId("SUNSHINE-TEST");
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an employee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMP-TEST-001">John Smith (Teacher)</SelectItem>
                    <SelectItem value="EMP-TEST-002">Mary Johnson (Assistant)</SelectItem>
                    {employeesData?.employees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={empId} onChange={(e) => setEmpId(e.target.value)} />
              </div>
              
              <div className="space-y-2">
                <Label>Company ID</Label>
                <Input value={compId} onChange={(e) => setCompId(e.target.value)} />
              </div>

              <Button 
                onClick={handleGenerateToken} 
                disabled={generateToken.isPending || !empId || !compId} 
                className="w-full"
              >
                {generateToken.isPending ? "Generating..." : "Generate Token"}
              </Button>

              {token && (
                <div className="mt-4 p-3 bg-muted rounded-md text-xs font-mono overflow-hidden break-all border border-border">
                  {token}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Code className="h-5 w-5 text-accent" />
                Raw API Test
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground mb-4">
                Test clocking in and out directly via API.
              </div>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100">
                  <Clock className="h-4 w-4 mr-2" /> Clock In
                </Button>
                <Button variant="outline" className="w-full justify-start text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100">
                  <Clock className="h-4 w-4 mr-2" /> Clock Out
                </Button>
                <div className="text-xs text-muted-foreground text-center mt-2 italic">
                  // TODO: Wire up when API exists
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-full min-h-[600px] flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="h-5 w-5 text-accent" />
                Component Preview
              </CardTitle>
              <Button 
                size="sm" 
                onClick={handleLoadIframe} 
                disabled={!token}
                variant={token ? "default" : "secondary"}
              >
                Load Component
              </Button>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative border-t border-border">
              {!iframeLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                  <div className="text-center text-muted-foreground max-w-sm p-6">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    {token ? (
                      <p>Token generated. Click "Load Component" to view the EasyTeam Time Clock.</p>
                    ) : (
                      <p>Generate an auth token first to preview the component.</p>
                    )}
                  </div>
                </div>
              ) : (
                <iframe 
                  src={`https://app.easyteam.com/timeclock?token=${token}`}
                  className="absolute inset-0 w-full h-full border-0 bg-white"
                  title="EasyTeam Time Clock"
                  onError={(e) => {
                    console.error("Iframe failed to load", e);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
