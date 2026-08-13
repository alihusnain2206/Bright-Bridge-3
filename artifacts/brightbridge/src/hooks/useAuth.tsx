import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type UserRole = "super_admin" | "owner" | "manager" | "employee" | "parent" | "technical" | "super_manager";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId: string;
  locationId?: string;
  employeeId: string | null;
  position: string;
  hourlyWage?: number;
  /** Set after a profile-photo upload; null means no photo on file */
  photoUrl?: string | null;
}

export interface AuthCompany {
  id: string;
  name: string;
  type: string;
  locationId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  /** EasyTeam org ID from the DB — set at company creation; null for legacy companies on ORG-BRIGHTBRIDGE. */
  easyteamOrgId?: string | null;
}

export interface AuthLocation {
  id: string;
  name: string;
  organizationId: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  company: AuthCompany | null;
  location: AuthLocation | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; user?: AuthUser }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  company: null,
  location: null,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<AuthCompany | null>(null);
  const [location, setLocation] = useState<AuthLocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { user: AuthUser; company: AuthCompany; location: AuthLocation };
        setUser(data.user);
        setCompany(data.company ?? null);
        setLocation(data.location ?? null);
      } else {
        setUser(null);
        setCompany(null);
        setLocation(null);
      }
    } catch {
      setUser(null);
      setCompany(null);
      setLocation(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { user?: AuthUser; company?: AuthCompany; location?: AuthLocation; error?: string };
      if (!res.ok || !data.user) {
        return { success: false, error: data.error ?? "Login failed" };
      }
      setUser(data.user);
      setCompany(data.company ?? null);
      setLocation(data.location ?? null);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: "Network error — please try again" };
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setCompany(null);
    setLocation(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, company, location, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function dashboardPath(role: UserRole): string {
  if (role === "technical" || role === "super_manager") return "/support-admin";
  return `/dashboard/${role.replace("_", "-")}`;
}

export function roleLabel(role: UserRole | string): string {
  const map: Record<string, string> = {
    super_admin: "Super Admin",
    owner: "Owner",
    manager: "Manager",
    employee: "Employee",
    parent: "Parent",
  };
  return map[role] ?? role;
}
