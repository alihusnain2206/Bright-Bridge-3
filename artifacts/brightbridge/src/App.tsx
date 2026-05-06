import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout";
import Home from "@/pages/home";
import Clients from "@/pages/clients";
import TimeClock from "@/pages/timeclock";
import Timesheets from "@/pages/timesheets";
import Schedule from "@/pages/schedule";
import Webhooks from "@/pages/webhooks";
import Config from "@/pages/config";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/clients" component={Clients} />
        <Route path="/timeclock" component={TimeClock} />
        <Route path="/timesheets" component={Timesheets} />
        <Route path="/schedule" component={Schedule} />
        <Route path="/webhooks" component={Webhooks} />
        <Route path="/config" component={Config} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
