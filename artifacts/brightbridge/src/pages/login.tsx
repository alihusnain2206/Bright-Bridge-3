import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, LogIn, Zap } from "lucide-react";

const QUICK_LOGINS = [
  { label: "Super Admin — Joanne", email: "joanne@brightbridgeassist.com", password: "Admin123!", dot: "#dc2626" },
  { label: "Manager — Sunshine", email: "manager@sunshine.com", password: "Manager123!", dot: "#d97706" },
  { label: "Manager — Rainbow", email: "manager@rainbow.com", password: "Manager123!", dot: "#d97706" },
  { label: "Employee — John Smith", email: "john@sunshine.com", password: "Staff123!", dot: "#16a34a" },
  { label: "Employee — Tom Wilson", email: "tom@rainbow.com", password: "Staff123!", dot: "#16a34a" },
  { label: "Parent — Sarah", email: "sarah@parent.com", password: "Parent123!", dot: "#2563eb" },
];

export default function Login() {
  const { user, isLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isLoading && user) {
      navigate(dashboardPath(user.role as UserRole));
    }
  }, [user, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    const result = await login(email, password);
    setPending(false);
    if (result.success && result.user) {
      navigate(dashboardPath(result.user.role as UserRole));
    } else {
      setError(result.error ?? "Login failed");
    }
  };

  const fill = (q: typeof QUICK_LOGINS[0]) => {
    setEmail(q.email);
    setPassword(q.password);
    setError("");
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4fb]">
      <div className="w-6 h-6 border-2 border-[#284362] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f4fb]">
      {/* Top stripe */}
      <div className="flex items-center justify-center gap-2 px-4 py-2 bg-[#284362] text-white text-xs font-semibold">
        <Zap className="h-3.5 w-3.5 opacity-60" />
        <span>SANDBOX</span>
        <span className="opacity-40 mx-1">·</span>
        <span className="font-normal opacity-70">Testing environment — no real data or payments</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-5">

          {/* Logo + header */}
          <div className="text-center space-y-2">
            <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-14 mx-auto object-contain" />
            <h1 className="text-2xl font-bold" style={{ color: "#284362" }}>BrightBridge</h1>
            <p className="text-sm" style={{ color: "#6b7280" }}>EasyTeam Integration Test</p>
          </div>

          {/* Login form */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-base font-semibold" style={{ color: "#111827" }}>Sign in to your account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium" style={{ color: "#374151" }}>Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  className="border-gray-300"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium" style={{ color: "#374151" }}>Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="border-gray-300"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2" style={{ color: "#dc2626" }}>
                  <AlertCircle className="h-4 w-4 shrink-0" />{error}
                </div>
              )}
              <Button
                type="submit"
                disabled={pending || !email || !password}
                className="w-full text-white font-semibold"
                style={{ background: "#284362" }}
              >
                <LogIn className="h-4 w-4 mr-2" />
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          {/* Quick login */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "#111827" }}>Quick Login for Testing</h3>
              <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>Click any button to auto-fill credentials, then press Sign in</p>
            </div>

            <div className="space-y-2">
              {QUICK_LOGINS.map((q) => (
                <button
                  key={q.email}
                  type="button"
                  onClick={() => fill(q)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 text-left transition-colors hover:bg-gray-50 hover:border-gray-300"
                  style={{ background: email === q.email ? "#f0f4fb" : "#ffffff" }}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: q.dot }} />
                  <span className="flex-1 text-sm font-medium" style={{ color: "#111827" }}>{q.label}</span>
                  <span className="text-xs font-mono" style={{ color: "#6b7280" }}>{q.password}</span>
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-gray-100 space-y-1 text-xs" style={{ color: "#6b7280" }}>
              <div className="font-semibold" style={{ color: "#374151" }}>Test credentials:</div>
              <div>Super Admin: <span className="font-mono">joanne@brightbridgeassist.com / Admin123!</span></div>
              <div>Manager: <span className="font-mono">manager@sunshine.com / Manager123!</span></div>
              <div>Employee: <span className="font-mono">john@sunshine.com / Staff123!</span></div>
              <div>Parent: <span className="font-mono">sarah@parent.com / Parent123!</span></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
