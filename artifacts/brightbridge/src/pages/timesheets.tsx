import React, { useState } from "react";
import { useGetTimesheets } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Code, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export default function Timesheets() {
  const [showRaw, setShowRaw] = useState(false);
  const { data: timesheetsData, isLoading, refetch, isFetching } = useGetTimesheets({ query: { enabled: false } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Timesheets Test</h1>
        <p className="text-muted-foreground mt-1">Embed the EasyTeam Timesheets component and view API responses.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Code className="h-5 w-5 text-accent" />
                Raw Data Fetch
              </CardTitle>
              <CardDescription>Fetch timesheets directly from the API.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={() => refetch()} 
                disabled={isFetching}
                className="w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
                Fetch Timesheets
              </Button>
              
              {(isLoading || isFetching) && !timesheetsData ? (
                <div className="space-y-2 mt-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : timesheetsData ? (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Response</span>
                    <Badge variant={timesheetsData.success ? "default" : "destructive"} className="text-xs">
                      {timesheetsData.success ? "✅ Success" : "❌ Failed"}
                    </Badge>
                  </div>
                  <ScrollArea className="h-[300px] w-full rounded-md border border-border bg-muted p-4">
                    <pre className="text-xs font-mono">
                      {JSON.stringify(timesheetsData, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8 bg-muted/50 rounded-md border border-dashed border-border mt-4">
                  Click fetch to retrieve data
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-full min-h-[600px] flex flex-col">
            <CardHeader className="py-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-accent" />
                Component Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative border-t border-border">
              {/* In a real scenario, we'd pass a token to this iframe just like timeclock */}
              <div className="absolute inset-0 bg-muted/10 flex items-center justify-center p-4">
                <div className="bg-white border border-border shadow-sm rounded-lg w-full h-full overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-border bg-muted/30 text-xs font-mono text-muted-foreground text-center">
                    iframe: src="https://app.easyteam.com/timesheets"
                  </div>
                  <iframe 
                    src="https://app.easyteam.com/timesheets"
                    className="flex-1 w-full border-0"
                    title="EasyTeam Timesheets"
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

function Badge({ variant, className, children }: any) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variant === 'destructive' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'} ${className}`}>
      {children}
    </span>
  );
}
