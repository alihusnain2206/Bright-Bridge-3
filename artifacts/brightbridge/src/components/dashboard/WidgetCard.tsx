import React from "react";

export function WidgetCard({
  title, subtitle, children, footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-white/10 overflow-hidden flex flex-col h-full"
      style={{ background: "rgba(255,255,255,0.04)" }}
    >
      <div className="px-5 py-3.5 border-b border-white/10">
        <p className="text-white font-semibold text-sm">{title}</p>
        {subtitle && <p className="text-white/40 text-[11px] mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-white/10">{footer}</div>}
    </div>
  );
}
