import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";

import { AppLayout } from "@/components/layout";
import Login from "@/pages/login";
import Home from "@/pages/home";
import Clients from "@/pages/clients";
import ClientsNew from "@/pages/clients-new";
import ClientDetail from "@/pages/client-detail";
import ClientEmployeesNew from "@/pages/client-employees-new";
import TimeClock from "@/pages/timeclock";
import Timesheets from "@/pages/timesheets";
import Schedule from "@/pages/schedule";
import Webhooks from "@/pages/webhooks";
import Config from "@/pages/config";
import Payroll from "@/pages/payroll";
import Roles from "@/pages/roles";
import SuperAdminDashboard from "@/pages/dashboard-super-admin";
import ManagerDashboard from "@/pages/dashboard-manager";
import ManagerTeam from "@/pages/manager-team";
import ManagerPayroll from "@/pages/manager-payroll";
import ManagerPayrollEmployees from "@/pages/manager-payroll-employees";
import ManagerPayrollSubmit from "@/pages/manager-payroll-submit";
import EmployeeDashboard from "@/pages/dashboard-employee";
import ParentDashboard from "@/pages/dashboard-parent";
import NotFound from "@/pages/not-found";
import Paystub from "@/pages/paystub";
import PeoplePage from "@/pages/people";

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>
      <div className="w-8 h-8 border-2 border-[#284362] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles?: UserRole[];
}) {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login"); return; }
    if (roles && !roles.includes(user.role)) {
      navigate(dashboardPath(user.role));
    }
  }, [user, isLoading, navigate, roles]);

  if (isLoading) return <LoadingScreen />;
  if (!user) return null;
  if (roles && !roles.includes(user.role)) return null;
  return <Component />;
}

function RootRedirect() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login"); return; }
    navigate(dashboardPath(user.role));
  }, [user, isLoading, navigate]);

  if (isLoading) return <LoadingScreen />;
  return null;
}

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/login" component={Login} />

      {/* Standalone pages (no AppLayout sidebar) */}
      <Route path="/paystub/:companyId/:employeeId/:payPeriodId" component={Paystub} />

      {/* All pages share AppLayout with sidebar nav */}
      <Route>
        <AppLayout>
          <Switch>
            <Route path="/" component={RootRedirect} />
            <Route path="/dashboard/super-admin">
              <ProtectedRoute component={SuperAdminDashboard} roles={["super_admin"]} />
            </Route>
            <Route path="/dashboard/manager">
              <ProtectedRoute component={ManagerDashboard} roles={["manager"]} />
            </Route>
            {/* /my-team kept as backward-compat alias for managers */}
            <Route path="/my-team">
              <ProtectedRoute component={PeoplePage} roles={["manager"]} />
            </Route>
            <Route path="/people">
              <ProtectedRoute component={PeoplePage} roles={["super_admin", "manager"]} />
            </Route>
            <Route path="/manager-payroll/employees">
              <ProtectedRoute component={ManagerPayrollEmployees} roles={["manager"]} />
            </Route>
            <Route path="/manager-payroll/submit">
              <ProtectedRoute component={ManagerPayrollSubmit} roles={["manager"]} />
            </Route>
            <Route path="/manager-payroll">
              <ProtectedRoute component={ManagerPayroll} roles={["manager"]} />
            </Route>
            <Route path="/dashboard/employee">
              <ProtectedRoute component={EmployeeDashboard} roles={["employee"]} />
            </Route>
            <Route path="/dashboard/parent">
              <ProtectedRoute component={ParentDashboard} roles={["parent"]} />
            </Route>

            {/* Clients — super_admin only — ORDER MATTERS: specific routes before :param routes */}
            <Route path="/clients/new">
              <ProtectedRoute component={ClientsNew} roles={["super_admin"]} />
            </Route>
            <Route path="/clients/:companyId/employees/new">
              <ProtectedRoute component={ClientEmployeesNew} roles={["super_admin", "manager"]} />
            </Route>
            <Route path="/clients/:companyId">
              <ProtectedRoute component={ClientDetail} roles={["super_admin"]} />
            </Route>
            <Route path="/clients">
              <ProtectedRoute component={Clients} roles={["super_admin"]} />
            </Route>

            <Route path="/timeclock">
              <ProtectedRoute component={TimeClock} roles={["super_admin"]} />
            </Route>
            <Route path="/timesheets">
              <ProtectedRoute component={Timesheets} roles={["super_admin"]} />
            </Route>
            <Route path="/schedule">
              <ProtectedRoute component={Schedule} roles={["super_admin"]} />
            </Route>
            <Route path="/webhooks">
              <ProtectedRoute component={Webhooks} roles={["super_admin"]} />
            </Route>
            <Route path="/config">
              <ProtectedRoute component={Config} roles={["super_admin"]} />
            </Route>
            <Route path="/payroll">
              <ProtectedRoute component={Payroll} roles={["super_admin"]} />
            </Route>
            <Route path="/roles" component={Roles} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
