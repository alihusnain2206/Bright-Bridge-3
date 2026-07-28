/**
 * Account Settings — personal account preferences for the logged-in user.
 * (Profile, password, notifications, etc. — coming soon.)
 */
import React from "react";
import { UserCog } from "lucide-react";

export default function AccountSettingsPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your personal account preferences and security settings.</p>
      </div>

      <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-xl border shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <UserCog className="h-7 w-7 text-gray-400" />
        </div>
        <h3 className="text-base font-semibold text-gray-700 mb-1">Account Settings</h3>
        <p className="text-sm text-gray-400 max-w-xs">
          Update your profile, change your password, and configure notification preferences here.
          This section is coming soon.
        </p>
        <span className="mt-4 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-400 uppercase tracking-widest">
          Soon
        </span>
      </div>
    </div>
  );
}
