import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ManagerTeamTab } from "@/components/ManagerTeamTab";
import { Users } from "lucide-react";

export default function ManagerTeam() {
  const { user, company } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId) return;
    fetch(`/api/clients/by-company/${user.companyId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { clientId: string } | null) => { if (d?.clientId) setClientId(d.clientId); })
      .catch(() => {});
  }, [user?.companyId]);

  if (!user?.companyId) return null;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[#E8622A]/10">
          <Users className="h-5 w-5 text-[#E8622A]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#284362]">My Team</h1>
          <p className="text-sm text-muted-foreground">{company?.name} — staff management</p>
        </div>
      </div>

      <ManagerTeamTab companyId={user.companyId} clientId={clientId} />
    </div>
  );
}
