import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, LogIn, Zap } from "lucide-react";

const QUICK_LOGINS = [
  { label: "Super Admin — Joanne", email: "joanne@brightbridgeassist.com", password: "Admin123!", dot: "#ef4444", role: "Super Admin" },
  { label: "Manager — Sunshine", email: "manager@sunshine.com", password: "Manager123!", dot: "#f59e0b", role: "Manager" },
  { label: "Manager — Rainbow", email: "manager@rainbow.com", password: "Manager123!", dot: "#f59e0b", role: "Manager" },
  { label: "Employee — John Smith", email: "john@sunshine.com", password: "Staff123!", dot: "#22c55e", role: "Employee" },
  { label: "Employee — Tom Wilson", email: "tom@rainbow.com", password: "Staff123!", dot: "#22c55e", role: "Employee" },
  { label: "Parent — Sarah", email: "sarah@parent.com", password: "Parent123!", dot: "#3b82f6", role: "Parent" },
];

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: `${5 + Math.random() * 90}%`,
  size: 3 + Math.random() * 5,
  delay: Math.random() * 12,
  duration: 10 + Math.random() * 14,
  opacity: 0.12 + Math.random() * 0.2,
}));

export default function Login() {
  const { user, isLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const mouse = useRef({ x: 0, y: 0 });
  const blob1 = useRef<HTMLDivElement>(null);
  const blob2 = useRef<HTMLDivElement>(null);
  const blob3 = useRef<HTMLDivElement>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 };
    };
    window.addEventListener("mousemove", onMove);

    const tick = () => {
      const { x, y } = mouse.current;
      if (blob1.current) {
        blob1.current.style.transform = `translate(${x * -40}px, ${y * -30}px)`;
      }
      if (blob2.current) {
        blob2.current.style.transform = `translate(${x * 30}px, ${y * 40}px)`;
      }
      if (blob3.current) {
        blob3.current.style.transform = `translate(${x * -20}px, ${y * 25}px)`;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  useEffect(() => {
    if (!isLoading && user) navigate(dashboardPath(user.role as UserRole));
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0d1b2e" }}>
      <div className="w-6 h-6 border-2 border-[#E8622A] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes blob-drift-1 {
          0%, 100% { border-radius: 60% 40% 55% 45% / 50% 60% 40% 50%; transform: translate(0, 0) scale(1); }
          33%       { border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%; transform: translate(18px, -24px) scale(1.04); }
          66%       { border-radius: 55% 45% 65% 35% / 45% 55% 45% 55%; transform: translate(-12px, 16px) scale(0.97); }
        }
        @keyframes blob-drift-2 {
          0%, 100% { border-radius: 50% 50% 40% 60% / 60% 45% 55% 40%; transform: translate(0, 0) scale(1); }
          40%       { border-radius: 65% 35% 55% 45% / 40% 65% 35% 60%; transform: translate(-20px, 20px) scale(1.06); }
          75%       { border-radius: 45% 55% 45% 55% / 55% 45% 65% 35%; transform: translate(16px, -10px) scale(0.96); }
        }
        @keyframes blob-drift-3 {
          0%, 100% { border-radius: 50% 60% 40% 55% / 55% 40% 60% 50%; transform: translate(0, 0) scale(1); }
          50%       { border-radius: 40% 55% 60% 45% / 45% 60% 40% 55%; transform: translate(14px, 18px) scale(1.05); }
        }
        @keyframes float-up {
          0%   { transform: translateY(100vh) scale(0.5); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(-80px) scale(1.1); opacity: 0; }
        }
        @keyframes slide-up-fade {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 rgba(232,98,42,0.4); }
          50%       { box-shadow: 0 0 0 8px rgba(232,98,42,0); }
        }
        .animate-blob-1 { animation: blob-drift-1 22s ease-in-out infinite; }
        .animate-blob-2 { animation: blob-drift-2 28s ease-in-out infinite; }
        .animate-blob-3 { animation: blob-drift-3 18s ease-in-out infinite; }
        .animate-float-up { animation: float-up linear infinite; }
        .animate-slide-up { animation: slide-up-fade 0.55s cubic-bezier(.22,1,.36,1) both; }
        .card-glass {
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.6);
          box-shadow: 0 8px 40px rgba(15,30,55,0.18), 0 2px 8px rgba(15,30,55,0.10);
        }
        .quick-btn:hover { background: rgba(40,67,98,0.06) !important; border-color: rgba(40,67,98,0.25) !important; }
        .quick-btn.selected { background: rgba(40,67,98,0.08) !important; border-color: rgba(40,67,98,0.35) !important; }
      `}</style>

      <div className="min-h-screen flex flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0d1b2e 0%, #112340 45%, #1a1a35 100%)" }}>

        {/* ── Animated blobs ── */}
        <div ref={blob1} className="animate-blob-1 pointer-events-none absolute"
          style={{ top: "-10%", right: "-8%", width: "55vw", height: "55vw", maxWidth: 700, maxHeight: 700,
            background: "radial-gradient(ellipse, rgba(232,98,42,0.55) 0%, rgba(232,98,42,0.12) 55%, transparent 75%)",
            transition: "transform 0.12s linear", willChange: "transform" }} />
        <div ref={blob2} className="animate-blob-2 pointer-events-none absolute"
          style={{ bottom: "-14%", left: "-10%", width: "60vw", height: "60vw", maxWidth: 750, maxHeight: 750,
            background: "radial-gradient(ellipse, rgba(40,67,98,0.8) 0%, rgba(40,100,180,0.25) 50%, transparent 72%)",
            transition: "transform 0.18s linear", willChange: "transform" }} />
        <div ref={blob3} className="animate-blob-3 pointer-events-none absolute"
          style={{ top: "30%", left: "20%", width: "40vw", height: "40vw", maxWidth: 520, maxHeight: 520,
            background: "radial-gradient(ellipse, rgba(80,120,200,0.22) 0%, transparent 70%)",
            transition: "transform 0.22s linear", willChange: "transform" }} />
        {/* Small accent blob */}
        <div className="animate-blob-1 pointer-events-none absolute"
          style={{ top: "55%", right: "5%", width: "20vw", height: "20vw", maxWidth: 260, maxHeight: 260,
            background: "radial-gradient(ellipse, rgba(232,98,42,0.28) 0%, transparent 70%)",
            animationDuration: "16s", animationDelay: "-8s" }} />

        {/* ── Floating particles ── */}
        {PARTICLES.map((p) => (
          <div key={p.id} className="animate-float-up pointer-events-none absolute rounded-full"
            style={{ left: p.left, bottom: 0, width: p.size, height: p.size,
              background: `rgba(255,255,255,${p.opacity})`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s` }} />
        ))}

        {/* ── Grid overlay (subtle) ── */}
        <div className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "60px 60px" }} />

        {/* ── Sandbox stripe ── */}
        <div className="relative z-10 flex items-center justify-center gap-2 px-4 py-2 text-white text-xs font-semibold"
          style={{ background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Zap className="h-3.5 w-3.5 text-[#E8622A]" />
          <span className="text-white/80">SANDBOX</span>
          <span className="text-white/30 mx-1">·</span>
          <span className="font-normal text-white/50">Testing environment — no real data or payments</span>
        </div>

        {/* ── Main content ── */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md space-y-4"
            style={mounted ? { animation: "slide-up-fade 0.6s cubic-bezier(.22,1,.36,1) both" } : { opacity: 0 }}>

            {/* Logo */}
            <div className="text-center space-y-2 mb-2">
              <div className="relative inline-block">
                <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-16 mx-auto object-contain drop-shadow-lg" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">BrightBridge</h1>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>EasyTeam Embedded SDK — Sandbox</p>
            </div>

            {/* Login form card */}
            <div className="rounded-2xl card-glass p-6 space-y-4"
              style={{ animationDelay: "0.08s" }}>
              <h2 className="text-base font-semibold" style={{ color: "#111827" }}>Sign in to your account</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium" style={{ color: "#374151" }}>Email address</Label>
                  <Input id="email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" required
                    className="border-gray-200 bg-gray-50 focus:bg-white transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium" style={{ color: "#374151" }}>Password</Label>
                  <Input id="password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="current-password" required
                    className="border-gray-200 bg-gray-50 focus:bg-white transition-colors" />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2" style={{ color: "#dc2626" }}>
                    <AlertCircle className="h-4 w-4 shrink-0" />{error}
                  </div>
                )}
                <Button type="submit" disabled={pending || !email || !password}
                  className="w-full text-white font-semibold transition-all"
                  style={{ background: "linear-gradient(135deg, #284362 0%, #1e3a5f 100%)",
                    boxShadow: pending ? "none" : "0 4px 16px rgba(40,67,98,0.4)",
                    animation: !pending && email && password ? "pulse-ring 2.5s ease-in-out infinite" : "none" }}>
                  <LogIn className="h-4 w-4 mr-2" />
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </div>

            {/* Quick login card */}
            <div className="rounded-2xl card-glass p-5 space-y-3"
              style={{ animationDelay: "0.16s" }}>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "#111827" }}>Quick Login for Testing</h3>
                <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>Click any button to auto-fill, then press Sign in</p>
              </div>

              <div className="space-y-1.5">
                {QUICK_LOGINS.map((q) => (
                  <button key={q.email} type="button" onClick={() => fill(q)}
                    className={`quick-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${email === q.email ? "selected" : ""}`}
                    style={{ borderColor: email === q.email ? "rgba(40,67,98,0.3)" : "rgba(0,0,0,0.08)",
                      background: email === q.email ? "rgba(40,67,98,0.06)" : "rgba(255,255,255,0.5)" }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: q.dot, boxShadow: `0 0 6px ${q.dot}80` }} />
                    <span className="flex-1 text-sm font-medium" style={{ color: "#111827" }}>{q.label}</span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: "#6b7280", background: "rgba(0,0,0,0.05)" }}>{q.password}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
