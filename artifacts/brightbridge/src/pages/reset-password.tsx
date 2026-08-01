import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [token, setToken]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [pending, setPending]       = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState(false);
  const [tokenError, setTokenError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") ?? "";
    if (!t) setTokenError("Invalid or missing reset link. Please request a new one.");
    setToken(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to reset password."); return; }
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#070d18" }}>
      <div className="w-full max-w-sm mx-auto px-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#E8622A,#c94d18)" }}>
            <KeyRound className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
            BrightBridge
          </span>
        </div>

        <div className="rounded-2xl p-6 space-y-5"
          style={{
            background: "rgba(255,255,255,0.045)",
            border: "1px solid rgba(255,255,255,0.09)",
            backdropFilter: "blur(24px)",
            boxShadow: "0 0 0 1px rgba(0,0,0,.35),0 24px 60px rgba(0,0,0,.55)",
          }}>

          <div>
            <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>
              Set a new password
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              Choose a strong password for your account
            </p>
          </div>

          {tokenError ? (
            <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-3"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{tokenError}</span>
            </div>
          ) : success ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-3"
                style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#86efac" }}>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Password updated! Redirecting to sign in…</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="pw" className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                  New password
                </Label>
                <Input
                  id="pw" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password" required minLength={8}
                  className="h-9 text-sm rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.85)",
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm" className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                  Confirm password
                </Label>
                <Input
                  id="confirm" type="password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password" required
                  className="h-9 text-sm rounded-lg"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.85)",
                  }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={pending || !password || !confirm}
                className="w-full h-9 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#E8622A,#c94d18)" }}>
                {pending ? "Saving…" : "Set new password"}
              </button>
            </form>
          )}

          <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.28)" }}>
            <button type="button" onClick={() => navigate("/login")}
              className="underline underline-offset-2 hover:opacity-70 transition-opacity">
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
