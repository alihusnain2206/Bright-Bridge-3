import React from "react";
import { ArrowRight } from "lucide-react";

export interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub1?: string;
  sub2?: string;
  accent?: string;
  loading?: boolean;
  onAction?: () => void;
  actionLabel?: string;
}

export function KpiCard({ icon, label, value, sub1, sub2, accent = "#284362", loading, onAction, actionLabel }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <div className="p-1.5 rounded-lg" style={{ background: `${accent}15` }}>
          <div style={{ color: accent }}>{icon}</div>
        </div>
      </div>
      {loading ? <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" /> : (
        <div className="text-2xl font-bold text-gray-900">{value}</div>
      )}
      {sub1 && <div className="text-xs text-gray-500">{sub1}</div>}
      {sub2 && <div className="text-xs font-medium" style={{ color: accent }}>{sub2}</div>}
      {onAction && actionLabel && (
        <button onClick={onAction} className="flex items-center gap-1 text-xs font-semibold mt-1 w-fit" style={{ color: accent }}>
          {actionLabel} <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
