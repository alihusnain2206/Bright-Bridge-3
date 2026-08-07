/**
 * /support-admin — placeholder page for the Support Tickets feature.
 * Accessible to: super_admin, technical, super_manager.
 */
import React from "react";
import { Headphones } from "lucide-react";

const NAVY  = "#1B3A6B";
const TEAL  = "#0EA5C9";

export default function SupportAdminPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-xl">
        {/* Navy header */}
        <div className="flex items-center gap-4 px-8 py-6" style={{ background: NAVY }}>
          <div className="flex items-center justify-center w-12 h-12 rounded-xl"
               style={{ background: TEAL }}>
            <Headphones className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Support Tickets</h1>
            <p className="text-sm mt-0.5" style={{ color: "#a8c4e0" }}>BrightBridge Assist</p>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white px-8 py-10 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
               style={{ background: "#e0f2fe" }}>
            <Headphones className="w-8 h-8" style={{ color: TEAL }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: NAVY }}>Coming Soon</h2>
            <p className="mt-2 text-gray-500 leading-relaxed">
              The support ticket system is under construction. This page is reserved for{" "}
              <span className="font-medium" style={{ color: TEAL }}>Technical</span> and{" "}
              <span className="font-medium" style={{ color: NAVY }}>Super Manager</span> team
              members and will be available in a future release.
            </p>
          </div>
          <div className="mt-2 px-4 py-2 rounded-full text-sm font-medium"
               style={{ background: "#e0f2fe", color: TEAL }}>
            In active development
          </div>
        </div>
      </div>
    </div>
  );
}
