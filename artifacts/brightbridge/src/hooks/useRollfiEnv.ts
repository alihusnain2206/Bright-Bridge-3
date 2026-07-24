import { useQuery } from "@tanstack/react-query";

type RollfiEnv = "sandbox" | "production" | "unknown";

interface ConfigEnvResponse {
  rollfiEnv?: "sandbox" | "production";
}

export function useRollfiEnv(): RollfiEnv {
  const { data } = useQuery<ConfigEnvResponse>({
    queryKey: ["config-env"],
    queryFn: async (): Promise<ConfigEnvResponse> => {
      const res = await fetch("/api/config/env", { credentials: "include" });
      if (!res.ok) return {};
      return res.json() as Promise<ConfigEnvResponse>;
    },
    staleTime: 60_000,
    retry: false,
  });

  if (!data) return "unknown";
  if (data.rollfiEnv === "production") return "production";
  if (data.rollfiEnv === "sandbox") return "sandbox";
  return "unknown";
}
