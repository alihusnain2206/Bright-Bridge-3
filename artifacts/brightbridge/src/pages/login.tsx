import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, LogIn, Zap } from "lucide-react";

const QUICK_LOGINS = [
  { label: "Super Admin — Joanne", email: "joanne@brightbridgeassist.com", password: "Admin123!", color: "#dc2626", role: "super_admin" },
  { label: "Manager — Sunshine", email: "manager@sunshine.com", password: "Manager123!", color: "#d97706", role: "manager" },
  { label: "Manager — Rainbow", email: "manager@rainbow.com", password: "Manager123!", color: "#d97706", role: "manager" },
  { label: "Employee — John Smith", email: "john@sunshine.com", password: "Staff123!", color: "#16a34a", role: "employee" },
  { label: "Employee — Tom Wilson", email: "tom@rainbow.com", password: "Staff123!", color: "#16a34a", role: "employee" },
  { label: "Parent — Sarah", email: "sarah@parent.com", password: "Parent123!", color: "#2563eb", role: "parent" },
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>
      <div className="w-6 h-6 border-2 border-[#284362] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #f0f4fb 0%, #f7f8fc 60%, #fdf6f3 100%)" }}>
      {/* Sandbox banner */}
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide text-white"
        style={{ background: "linear-gradient(90deg, #284362 0%, #325278 100%)" }}>
        <Zap className="h-3.5 w-3.5 opacity-70" />
        <span className="opacity-80">SANDBOX</span>
        <span className="opacity-40 mx-1">·</span>
        <span className="opacity-70 font-normal">Testing environment — no real data or payments</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          {/* Logo + header */}
          <div className="text-center space-y-3">
            <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-14 mx-auto object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-[#284362]">BrightBridge</h1>
              <p className="text-sm text-muted-foreground mt-0.5">EasyTeam Integration Test</p>
            </div>
          </div>

          {/* Login form */}
          <div className="rounded-2xl border bg-white shadow-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-foreground">Sign in to your account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />{error}
                </div>
              )}
              <Button type="submit" disabled={pending || !email || !password} className="w-full bg-[#284362] hover:bg-[#1e3352] text-white">
                <LogIn className="h-4 w-4 mr-2" />
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          {/* Quick login */}
          <div className="rounded-2xl border bg-white shadow-sm p-5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Quick Login for Testing</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Click any button to auto-fill credentials</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {QUICK_LOGINS.map((q) => (
                <button
                  key={q.email}
                  type="button"
                  onClick={() => fill(q)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors hover:bg-muted/50 text-sm"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: q.color }} />
                  <span className="font-medium text-foreground">{q.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{q.password}</span>
                </button>
              ))}
            </div>

            <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground mb-1">Test credentials:</div>
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
