import { useEffect, useRef, useCallback } from "react";
import { EasyTeamEmbedLauncher, Pages } from "@easyteam/launcher";

export const SANDBOX_BASE_URL = "https://www.easyteam.io/sandbox/embed/iframe";
export const SANDBOX_API_URL = "https://www.easyteam.io/sandbox/embed";

export { Pages };

export interface LauncherEmployee {
  id: string;
  name: string;
  role?: string;
  timeTrackingEnabled?: boolean;
  wage?: number;
  wageType?: "hourly" | "weekly" | "monthly";
}

export interface LauncherLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface LauncherOrg {
  id: string;
  name: string;
}

export interface LauncherConfig {
  page: Pages;
  employees: LauncherEmployee[];
  organization: LauncherOrg;
  locations: LauncherLocation[];
}

interface LauncherEvent {
  type?: string;
  [key: string]: unknown;
}

export function useEasyTeamLauncher(
  containerId: string,
  onEvent?: (event: LauncherEvent) => void,
) {
  const launcherRef = useRef<EasyTeamEmbedLauncher | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    return () => {
      if (launcherRef.current) {
        launcherRef.current.clean();
        launcherRef.current = null;
      }
    };
  }, []);

  const launch = useCallback((token: string, config: LauncherConfig) => {
    if (launcherRef.current) {
      launcherRef.current.clean();
      launcherRef.current = null;
    }

    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const resolvedLocations = config.locations.map((loc) => ({
      ...loc,
      employees: Object.fromEntries(config.employees.map((e) => [e.id, {}])),
    }));

    const launcher = new EasyTeamEmbedLauncher(token, {
      employees: config.employees,
      locations: resolvedLocations as never,
      organization: config.organization,
      baseURL: SANDBOX_BASE_URL,
      apiBaseURL: SANDBOX_API_URL,
      onEvent: ((event: LauncherEvent) => onEventRef.current?.(event)) as never,
      verbose: true,
    });

    launcher.run(containerId, config.page);
    launcherRef.current = launcher;
  }, [containerId]);

  return { launch };
}
