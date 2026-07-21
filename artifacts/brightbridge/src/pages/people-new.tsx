import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export default function PeopleNewPage() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    const companyId = user?.companyId;
    if (companyId) {
      navigate(`/clients/${companyId}/employees/new`, { replace: true });
    } else {
      navigate("/clients", { replace: true });
    }
  }, [user, isLoading, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  );
}
