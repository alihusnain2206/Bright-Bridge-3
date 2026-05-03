import React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Code, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Schedule() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);

  const fetchSchedule = () => {
    setLoading(true);
    // Simulate API fetch since there's no specific hook for schedules
    setTimeout(() => {
      setData({
        success: true,
        schedules: [
          { id: "sch_1", employee_id: "EMP-TEST-001", date: new Date().toISOString().split('T')[0], start_time: "09:00", end_time: "17:00", shift_type: "Regular" },
          { id: "sch_2", employee_id: "EMP-TEST-002", date: new Date().toISOString().split('T')[0], start_time: "10:00", end_time: "18:00", shift_type: "Regular" }
        ]
      });
      setLoading(false);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Schedule Test</h1>
        <p className="text-muted-foreground mt-1">Embed the EasyTeam Schedule component and test data fetching.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Code className="h-5 w-5 text-accent" />
                Raw Data Fetch
              </CardTitle>
              <CardDescription>Fetch current schedule directly from the API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={fetchSchedule} 
                disabled={loading}
                className="w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Fetch Current Schedule
              </Button>
              
              {loading ? (
                <div className="space-y-2 mt-4 animate-pulse">
                  <div className="h-4 bg-muted rounded w-full"></div>
                  <div className="h-4 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-5/6"></div>
                </div>
              ) : data ? (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Response</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500 text-white">
                      ✅ Success
                    </span>
                  </div>
                  <ScrollArea className="h-[300px] w-full rounded-md border border-border bg-muted p-4">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8 bg-muted/50 rounded-md border border-dashed border-border mt-4">
                  Click fetch to retrieve schedule
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-full min-h-[600px] flex flex-col">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-accent" />
                Component Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative border-t border-border">
              <div className="absolute inset-0 bg-muted/10 flex items-center justify-center p-4">
                <div className="bg-white border border-border shadow-sm rounded-lg w-full h-full overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-border bg-muted/30 text-xs font-mono text-muted-foreground text-center">
                    iframe: src="https://app.easyteam.com/schedules"
                  </div>
                  <iframe 
                    src="https://app.easyteam.com/schedules"
                    className="flex-1 w-full border-0"
                    title="EasyTeam Schedule"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
