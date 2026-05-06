import { useEffect, useRef } from "react";
import { EasyTeamEmbedLauncher, Pages } from "@easyteam/launcher";

export const SANDBOX_BASE_URL = "https://www.easyteam.io/sandbox/embed/iframe";
export const SANDBOX_API_URL = "https://www.easyteam.io/sandbox/embed";

export const TEST_EMPLOYEES = [
  { id: "EMP-TEST-001", name: "John Smith", role: "manager", timeTrackingEnabled: true, wage: 1500, wageType: "hourly" as const },
  { id: "EMP-TEST-002", name: "Mary Johnson", role: "assistant", timeTrackingEnabled: true, wage: 1200, wageType: "hourly" as const },
  { id: "EMP-TEST-003", name: "Carlos Rivera", role: "cashier", timeTrackingEnabled: true, wage: 1000, wageType: "hourly" as const },
];

export const TEST_LOCATIONS = [
  {
    id: "SANDBOX-LOC-001",
    name: "Sandbox Test Location",
    latitude: 40.7128,
    longitude: -74.006,
    employees: { "EMP-TEST-001": {}, "EMP-TEST-002": {}, "EMP-TEST-003": {} },
  },
];

export const TEST_ORGANIZATION = { id: "SANDBOX-ORG-001", name: "BrightBridge Sandbox" };

export { Pages };

interface LauncherEmployee {
  id: string;
  name: string;
  role?: string;
  timeTrackingEnabled?: boolean;
  wage?: number;
  wageType?: "hourly" | "weekly" | "monthly";
}

interface LauncherLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface LauncherOrg {
  id: string;
  name: string;
}

interface LauncherEvent {
  type?: string;
  [key: string]: unknown;
}

export function useEasyTeamLauncher(
  containerId: string,
  accessToken: string | null,
  page: Pages = Pages.TIMESHEET,
  onEvent?: (event: LauncherEvent) => void,
  employees?: LauncherEmployee[],
  organization?: LauncherOrg,
  locations?: LauncherLocation[]
) {
  const launcherRef = useRef<EasyTeamEmbedLauncher | null>(null);

  useEffect(() => {
    if (!accessToken || !containerId) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const resolvedEmployees = employees && employees.length > 0 ? employees : TEST_EMPLOYEES;
    const resolvedOrg = organization ?? TEST_ORGANIZATION;
    const resolvedLocations = locations && locations.length > 0
      ? locations.map((loc) => ({
          ...loc,
          employees: Object.fromEntries(resolvedEmployees.map((e) => [e.id, {}])),
        }))
      : TEST_LOCATIONS;

    const launcher = new EasyTeamEmbedLauncher(accessToken, {
      employees: resolvedEmployees,
      locations: resolvedLocations as never,
      organization: resolvedOrg,
      baseURL: SANDBOX_BASE_URL,
      apiBaseURL: SANDBOX_API_URL,
      onEvent: (onEvent ?? (() => undefined)) as never,
      verbose: true,
    });

    launcher.run(containerId, page);
    launcherRef.current = launcher;

    return () => {
      launcher.clean();
      launcherRef.current = null;
    };
  }, [accessToken, containerId, page]);

  return launcherRef;
}
