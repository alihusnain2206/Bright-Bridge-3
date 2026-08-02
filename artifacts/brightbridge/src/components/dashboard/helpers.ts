// Shared utility functions for dashboard widgets

export async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`/api${path}`, { credentials: "include" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
  return r.json() as Promise<T>;
}

export function fmtD(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  try { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return dateStr; }
}

export function timeAgo(iso: string) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
