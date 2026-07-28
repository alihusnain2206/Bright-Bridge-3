import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
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
import OwnerDashboard from "@/pages/dashboard-owner";
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
import PeopleDirectoryPage from "@/pages/people-directory";
import PeopleNewPage from "@/pages/people-new";
import PeopleNewHiresPage from "@/pages/people-new-hires";
import PeopleOnboardingPage from "@/pages/people-onboarding";
import PeopleComplianceHubPage from "@/pages/people-compliance-hub";
import PeopleDocumentsHubPage from "@/pages/people-documents-hub";
import EmployeeProfilePage from "@/pages/employee-profile";
import EmployeeEditPage from "@/pages/employee-edit";
import EmployeeCompliancePage from "@/pages/employee-compliance";
import EmployeeTasksPage from "@/pages/employee-tasks";
import EmployeeContactsPage from "@/pages/employee-contacts";
import EmployeeDocumentsPage from "@/pages/employee-documents";
import EmergencyContactsListPage from "@/pages/emergency-contacts-list";
import WorkforcePage from "@/pages/workforce";
import WorkforceEmployeesPage from "@/pages/workforce-employees";
import WorkforceDepartmentsPage from "@/pages/workforce-departments";
import SettingsHubPage from "@/pages/settings-hub";
import AccountSettingsPage from "@/pages/account-settings";

const queryClient = new QueryClient();

// Redirect old sub-page routes to the new tab-based profile URL
function TabRedirect({ tab }: { tab: string }) {
  const [, params] = useRoute("/people/:id/:sub");
  const [, navigate] = useLocation();
  useEffect(() => {
    if (params?.id) navigate(`/people/${params.id}?tab=${tab}`, { replace: true });
  }, [params?.id, navigate, tab]);
  return null;
}

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
            <Route path="/dashboard/owner">
              <ProtectedRoute component={OwnerDashboard} roles={["owner"]} />
            </Route>
            <Route path="/dashboard/manager">
              <ProtectedRoute component={ManagerDashboard} roles={["manager"]} />
            </Route>
            {/* /my-team kept as backward-compat alias */}
            <Route path="/my-team">
              <ProtectedRoute component={PeoplePage} roles={["owner", "manager"]} />
            </Route>
            {/* People hub pages — must be before /people/:id to avoid param collision */}
            <Route path="/people/onboarding">
              <ProtectedRoute component={PeopleOnboardingPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/compliance">
              <ProtectedRoute component={PeopleComplianceHubPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/documents">
              <ProtectedRoute component={PeopleDocumentsHubPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/new-hires">
              <ProtectedRoute component={PeopleNewHiresPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/directory">
              <ProtectedRoute component={PeopleDirectoryPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/new">
              <ProtectedRoute component={PeopleNewPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/contacts">
              <ProtectedRoute component={EmergencyContactsListPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            {/* People pages — order matters: most-specific routes first */}
            <Route path="/people/:id/edit">
              <ProtectedRoute component={EmployeeEditPage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people/:id/compliance"><TabRedirect tab="compliance" /></Route>
            <Route path="/people/:id/tasks"><TabRedirect tab="onboarding" /></Route>
            <Route path="/people/:id/contacts"><TabRedirect tab="contacts" /></Route>
            <Route path="/people/:id/documents"><TabRedirect tab="documents" /></Route>
            <Route path="/people/:id">
              <ProtectedRoute component={EmployeeProfilePage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/people">
              <ProtectedRoute component={PeoplePage} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/manager-payroll/employees">
              <ProtectedRoute component={ManagerPayrollEmployees} roles={["owner", "manager"]} />
            </Route>
            <Route path="/manager-payroll/submit">
              <ProtectedRoute component={ManagerPayrollSubmit} roles={["owner", "manager"]} />
            </Route>
            <Route path="/manager-payroll">
              <ProtectedRoute component={ManagerPayroll} roles={["owner", "manager"]} />
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
              <ProtectedRoute component={ClientEmployeesNew} roles={["super_admin", "owner", "manager"]} />
            </Route>
            <Route path="/clients/:companyId">
              <ProtectedRoute component={ClientDetail} roles={["super_admin"]} />
            </Route>
            <Route path="/clients">
              <ProtectedRoute component={Clients} roles={["super_admin"]} />
            </Route>

            <Route path="/workforce/employees">
              <ProtectedRoute component={WorkforceEmployeesPage} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/workforce/departments">
              <ProtectedRoute component={WorkforceDepartmentsPage} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/workforce">
              <ProtectedRoute component={WorkforcePage} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/timeclock">
              <ProtectedRoute component={TimeClock} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/timesheets">
              <ProtectedRoute component={Timesheets} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/schedule">
              <ProtectedRoute component={Schedule} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/webhooks">
              <ProtectedRoute component={Webhooks} roles={["super_admin", "owner"]} />
            </Route>
            <Route path="/config">
              <ProtectedRoute component={Config} roles={["super_admin", "owner"]} />
            </Route>
            {/* Company Settings */}
            <Route path="/account-settings">
              <ProtectedRoute component={AccountSettingsPage} roles={["owner", "super_admin"]} />
            </Route>
            <Route path="/settings">
              <ProtectedRoute component={SettingsHubPage} roles={["owner", "super_admin"]} />
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
