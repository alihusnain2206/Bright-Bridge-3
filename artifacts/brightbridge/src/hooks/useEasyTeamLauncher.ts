import { useEffect, useRef, useCallback } from "react";
import { EasyTeamEmbedLauncher, Pages } from "@easyteam/launcher";
import { brightbridgeTheme } from "@/lib/easyteamTheme";

export const SANDBOX_BASE_URL = "https://www.easyteam.io/embed/iframe";
export const SANDBOX_API_URL = "https://www.easyteam.io/embed";

export { Pages };

export interface LauncherEmployee {
  id: string;
  name: string;
  role?: string;
  timeTrackingEnabled?: boolean;
  wage?: number;
  wageType?: "hourly" | "weekly" | "monthly";
  /** Phase 3: employee's assigned location. When set, this employee appears ONLY in that
   *  location's dict. When absent (legacy / manager-self entries), employee appears in all. */
  locationId?: string;
}

export interface LauncherLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Optional timezone string (IANA format). Passed to EasyTeam for display purposes. */
  timezone?: string;
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
  fromDate?: string; // YYYY-MM-DD — passed as searchParams to run()
  toDate?: string;   // YYYY-MM-DD
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

    // Phase 3: build per-location employee maps.
    // Employees with a locationId are scoped to their assigned location only.
    // Employees without locationId (e.g. manager-self entries, legacy data) appear in all
    // locations — this preserves backward compatibility and ensures the JWT's employeeId
    // is always present in the EasyTeam employees list regardless of location.
    const resolvedLocations = config.locations.map((loc) => ({
      ...loc,
      employees: Object.fromEntries(
        config.employees
          .filter((e) => !e.locationId || e.locationId === loc.id)
          .map((e) => [e.id, {}])
      ),
    }));

    const launcher = new EasyTeamEmbedLauncher(token, {
      employees: config.employees,
      locations: resolvedLocations as never,
      organization: config.organization,
      baseURL: SANDBOX_BASE_URL,
      apiBaseURL: SANDBOX_API_URL,
      onEvent: ((event: LauncherEvent) => onEventRef.current?.(event)) as never,
      theme: brightbridgeTheme as never,
      verbose: true,
    });

    // Pass date range as searchParams so EasyTeam's iframe opens on the correct period
    const dateParams = config.fromDate && config.toDate
      ? { searchParams: new URLSearchParams({ start: config.fromDate, end: config.toDate }) }
      : undefined;
    launcher.run(containerId, config.page, dateParams);
    launcherRef.current = launcher;

    // The SDK sets its own iframe height. Override it immediately and after
    // load so the SDK's resize logic doesn't produce internal scrollbars.
    applyMinHeight(launcher, iframeMinHeight);
    const t1 = setTimeout(() => applyMinHeight(launcher, iframeMinHeight), 300);
    const t2 = setTimeout(() => applyMinHeight(launcher, iframeMinHeight), 1500);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [containerId, iframeMinHeight, applyMinHeight]);

  const navigateToDate = useCallback((fromDate: string, toDate: string) => {
    if (!launcherRef.current) return;
    launcherRef.current.navigate(Pages.TIMESHEET, {
      searchParams: new URLSearchParams({ start: fromDate, end: toDate }),
    });
  }, []);

  return { launch, navigateToDate };
}
