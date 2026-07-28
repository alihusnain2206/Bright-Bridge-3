/**
 * /settings — redirects to the only currently functional sub-page.
 * As more sections are built this can be replaced with a landing hub.
 */
import React, { useEffect } from "react";
import { useLocation } from "wouter";

export default function SettingsPage() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/settings/state-tax", { replace: true }); }, [navigate]);
  return null;
}
