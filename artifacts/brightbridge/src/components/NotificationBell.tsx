import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Bell, AlertCircle, AlertTriangle, CheckCircle, Loader2, X } from "lucide-react";

// ── API shape ─────────────────────────────────────────────────────────────────

interface NotificationItem {
  id: string;
  level: "red" | "yellow";
  title: string;
  detail: string;
  link?: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  redCount: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (res.ok) {
        const json = await res.json() as NotificationsResponse;
        setData(json);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when opened
  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open, fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const redCount = data?.redCount ?? 0;

  const handleItemClick = (item: NotificationItem) => {
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  return (
    <div className="relative shrink-0">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(prev => !prev)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {redCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {redCount > 9 ? "9+" : redCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl border border-gray-200 shadow-xl z-50 overflow-hidden"
          style={{ maxHeight: "480px" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close notifications"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {!loading && (!data || data.items.length === 0) && (
              <div className="flex flex-col items-center gap-2 py-10 text-sm text-gray-400">
                <CheckCircle className="h-8 w-8 text-green-400" />
                <span className="font-medium text-gray-600">You're all caught up</span>
                <span className="text-xs">Nothing needs your attention right now.</span>
              </div>
            )}

            {!loading && data && data.items.length > 0 && (
              <ul className="divide-y divide-gray-50">
                {data.items.map(item => (
                  <li key={item.id}>
                    <button
                      onClick={() => handleItemClick(item)}
                      className="w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors flex items-start gap-3 group"
                    >
                      {/* Icon */}
                      <span className="mt-0.5 shrink-0">
                        {item.level === "red" ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                        )}
                      </span>

                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold leading-snug ${item.level === "red" ? "text-red-700" : "text-amber-700"}`}>
                          {item.title}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">
                          {item.detail}
                        </div>
                        {item.link && (
                          <div className="text-xs text-[#284362] font-medium mt-1 group-hover:underline">
                            View →
                          </div>
                        )}
                      </div>

                      {/* Level pill */}
                      <span className={`shrink-0 self-center text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                        item.level === "red"
                          ? "bg-red-50 text-red-600"
                          : "bg-amber-50 text-amber-600"
                      }`}>
                        {item.level === "red" ? "Urgent" : "Action"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
