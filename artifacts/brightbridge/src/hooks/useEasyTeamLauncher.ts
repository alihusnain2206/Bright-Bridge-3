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
  iframeMinHeight = 600,
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

  const applyMinHeight = useCallback((launcher: EasyTeamEmbedLauncher, px: number) => {
    if (launcher.iframe) {
      launcher.iframe.style.minHeight = `${px}px`;
      launcher.iframe.style.height = `${px}px`;
    }
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

    // The SDK sets its own iframe height. Override it immediately and after
    // load so the SDK's resize logic doesn't produce internal scrollbars.
    applyMinHeight(launcher, iframeMinHeight);
    const t1 = setTimeout(() => applyMinHeight(launcher, iframeMinHeight), 300);
    const t2 = setTimeout(() => applyMinHeight(launcher, iframeMinHeight), 1500);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [containerId, iframeMinHeight, applyMinHeight]);

  return { launch };
}
