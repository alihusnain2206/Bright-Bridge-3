import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

type RollfiEnv = "sandbox" | "production" | "unknown";

interface ConfigEnvResponse {
  rollfiEnv?: "sandbox" | "production";
}

/**
 * FIX 4 — banner stuck on LOADING / unknown after login.
 *
 * Key changes:
 *  • queryKey includes user?.id so React Query treats each auth session
 *    as a fresh key — the query re-fetches automatically after login.
 *  • queryFn throws on non-ok responses so the retry mechanism fires
 *    (previously it swallowed errors and returned {}, causing "unknown").
 *  • retry: 3 / retryDelay: 1 000 ms — up to 3 automatic retries on failure.
 *  • staleTime: 30 000 ms (was 60 000) so a tab-focus after ~30 s re-fetches.
 */
export function useRollfiEnv(): RollfiEnv {
  const { user } = useAuth();

  const { data } = useQuery<ConfigEnvResponse>({
    queryKey: ["config-env", user?.id ?? "anon"],
    queryFn: async (): Promise<ConfigEnvResponse> => {
      const res = await fetch("/api/config/env", { credentials: "include" });
      if (!res.ok) throw new Error(`config-env: ${res.status}`);
      return res.json() as Promise<ConfigEnvResponse>;
    },
    staleTime: 30_000,
    retry: 3,
    retryDelay: 1_000,
  });

  if (!data) return "unknown";
  if (data.rollfiEnv === "production") return "production";
  if (data.rollfiEnv === "sandbox") return "sandbox";
  return "unknown";
}
