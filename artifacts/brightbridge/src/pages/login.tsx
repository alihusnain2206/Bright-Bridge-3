import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth, dashboardPath, type UserRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, AlertTriangle, CheckCircle2, FlaskConical, LogIn, X, Zap } from "lucide-react";
import { useRollfiEnv } from "@/hooks/useRollfiEnv";

const QUICK_LOGINS = [
  { label: "Super Admin — Joanne",  email: "joanne@brightbridgeassist.com", password: "Admin123!",   dot: "#ef4444" },
  { label: "Owner — Sunshine",      email: "manager@sunshine.com",          password: "Manager123!", dot: "#7c3aed" },
  { label: "Owner — Rainbow",       email: "manager@rainbow.com",           password: "Manager123!", dot: "#7c3aed" },
  { label: "Employee — John Smith", email: "john@sunshine.com",             password: "Staff123!",   dot: "#22c55e" },
  { label: "Employee — Tom Wilson", email: "tom@rainbow.com",               password: "Staff123!",   dot: "#22c55e" },
  { label: "Employee — Ali Husnain",email: "ali@rainbow.com",               password: "Staff123!",   dot: "#22c55e" },
  { label: "Employee — Lisa Chen",  email: "lisa.chen@rainbow.com",         password: "Staff123!",   dot: "#22c55e" },
  { label: "Parent — Sarah",        email: "sarah@parent.com",              password: "Parent123!",  dot: "#3b82f6" },
];

/* ── Canvas mesh animation ── */
interface Node { x: number; y: number; vx: number; vy: number; pulse: number }

function MeshCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const nodes = useRef<Node[]>([]);
  const raf = useRef(0);

  const init = useCallback((w: number, h: number) => {
    const count = Math.floor((w * h) / 14000);
    nodes.current = Array.from({ length: Math.min(count, 55) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      pulse: Math.random() * Math.PI * 2,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      init(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMouse = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("mousemove", onMouse);

    const MAX_DIST = 160;
    const MOUSE_DIST = 200;

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      /* subtle radial glow at bottom-center */
      const rg = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 0.6, H * 0.85);
      rg.addColorStop(0,   "rgba(40,67,98,0.35)");
      rg.addColorStop(0.5, "rgba(30,45,72,0.12)");
      rg.addColorStop(1,   "transparent");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      /* top-right faint orange accent */
      const og = ctx.createRadialGradient(W * 0.88, H * 0.08, 0, W * 0.88, H * 0.08, W * 0.35);
      og.addColorStop(0,   "rgba(232,98,42,0.07)");
      og.addColorStop(1,   "transparent");
      ctx.fillStyle = og;
      ctx.fillRect(0, 0, W, H);

      /* move nodes */
      const ns = nodes.current;
      ns.forEach(n => {
        n.pulse += 0.012;
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;

        /* mouse repulsion */
        const dx = n.x - mouse.current.x;
        const dy = n.y - mouse.current.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < MOUSE_DIST) {
          const force = (MOUSE_DIST - d) / MOUSE_DIST * 0.6;
          n.vx += (dx / d) * force;
          n.vy += (dy / d) * force;
          const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
          if (speed > 2) { n.vx = (n.vx / speed) * 2; n.vy = (n.vy / speed) * 2; }
        } else {
          n.vx *= 0.998;
          n.vy *= 0.998;
        }
      });

      /* draw edges */
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[i].x - ns[j].x;
          const dy = ns[i].y - ns[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            const alpha = (1 - d / MAX_DIST) * 0.18;
            ctx.beginPath();
            ctx.moveTo(ns[i].x, ns[i].y);
            ctx.lineTo(ns[j].x, ns[j].y);
            ctx.strokeStyle = `rgba(120,160,220,${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      /* draw nodes */
      ns.forEach(n => {
        const r = 1.6 + Math.sin(n.pulse) * 0.6;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(140,175,230,0.55)";
        ctx.fill();
      });

      raf.current = requestAnimationFrame(draw);
    };

    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
    };
  }, [init]);

  return (
    <canvas ref={canvasRef}
      className="pointer-events-none absolute inset-0 w-full h-full" />
  );
}

// ── Forgot-password modal ─────────────────────────────────────

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [fpEmail, setFpEmail]   = useState("");
  const [fpPending, setFpPending] = useState(false);
  const [fpError, setFpError]   = useState("");
  const [fpSent, setFpSent]     = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setFpError("");
    setFpPending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setFpError(d.error ?? "Something went wrong. Please try again.");
      } else {
        setFpSent(true);
      }
    } catch {
      setFpError("Network error. Please try again.");
    } finally {
      setFpPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{
          background: "rgba(15,20,35,0.97)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Reset password</h3>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              We'll email you a secure link
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {fpSent ? (
          <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-3"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#86efac" }}>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>If that email is registered you'll receive a reset link shortly. Check your inbox.</span>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="fp-email" className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                Your email address
              </Label>
              <Input
                id="fp-email" type="email" value={fpEmail}
                onChange={(e) => setFpEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus autoComplete="email" required
                className="dark-input h-9 text-sm rounded-lg"
              />
            </div>
            {fpError && (
              <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />{fpError}
              </div>
            )}
            <button type="submit" disabled={fpPending || !fpEmail}
              className="sign-btn w-full h-9 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
              {fpPending ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Main login page ───────────────────────────────────────────

export default function Login() {
  const { user, isLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [pending, setPending]   = useState(false);
  const [mounted, setMounted]   = useState(false);
  const [showFP, setShowFP]     = useState(false);
  const rollfiEnv = useRollfiEnv();

  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!isLoading && user) navigate(dashboardPath(user.role as UserRole)); }, [user, isLoading, navigate]);

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

  const fill = (q: typeof QUICK_LOGINS[0]) => { setEmail(q.email); setPassword(q.password); setError(""); };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#070d18" }}>
      <div className="w-5 h-5 border-2 border-[#E8622A] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      {showFP && <ForgotPasswordModal onClose={() => setShowFP(false)} />}
      <style>{`
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(18px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .login-in { animation: fadeUp .55s cubic-bezier(.22,1,.36,1) both; }
        .glass-card {
          background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.09);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 24px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,0.07);
        }
        .glass-card-light {
          background: rgba(255,255,255,0.96);
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 20px 50px rgba(0,0,0,.22), inset 0 1px 0 white;
        }
        .qbtn {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.09);
          transition: background .15s, border-color .15s, transform .1s;
        }
        .qbtn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.16); }
        .qbtn.active { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.22); }
        .divider-line {
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.08);
        }
        input.dark-input {
          background: rgba(255,255,255,0.05) !important;
          border-color: rgba(255,255,255,0.1) !important;
          color: white !important;
        }
        input.dark-input::placeholder { color: rgba(255,255,255,0.25) !important; }
        input.dark-input:focus {
          background: rgba(255,255,255,0.08) !important;
          border-color: rgba(232,98,42,0.5) !important;
          box-shadow: 0 0 0 3px rgba(232,98,42,0.12) !important;
        }
        .sign-btn {
          background: linear-gradient(135deg, #E8622A 0%, #d45520 100%);
          box-shadow: 0 4px 20px rgba(232,98,42,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
          transition: box-shadow .2s, transform .1s, opacity .2s;
        }
        .sign-btn:hover:not(:disabled) {
          box-shadow: 0 6px 28px rgba(232,98,42,0.5), inset 0 1px 0 rgba(255,255,255,0.15);
          transform: translateY(-1px);
        }
        .sign-btn:active:not(:disabled) { transform: translateY(0); }
        .sign-btn:disabled { opacity: .45; box-shadow: none; }
      `}</style>

      <div className="min-h-screen flex flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #070d18 0%, #0b1220 50%, #0d1525 100%)" }}>

        {/* Animated mesh background */}
        <MeshCanvas />

        {/* Fine dot grid */}
        <div className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(5,10,20,0.65) 100%)" }} />

        {/* Environment stripe — driven by live /api/config/env */}
        {rollfiEnv === "production" ? (
          <div className="relative z-10 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-bold tracking-wide"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#DC2626", color: "#fff" }}>
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>PRODUCTION · LIVE PAYROLL</span>
            <span style={{ opacity: 0.6, margin: "0 4px" }}>—</span>
            <span style={{ fontWeight: 400, opacity: 0.9 }}>real employees and real money</span>
          </div>
        ) : rollfiEnv === "unknown" ? (
          <div className="relative z-10 flex items-center justify-center gap-2 px-4 py-1.5 text-xs"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.25)" }}>
            <Zap className="h-3 w-3" style={{ color: "#E8622A" }} />
            <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: "0.05em" }}>LOADING</span>
          </div>
        ) : (
          <div className="relative z-10 flex items-center justify-center gap-2 px-4 py-1.5 text-xs"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.25)" }}>
            <FlaskConical className="h-3 w-3" style={{ color: "rgba(255,255,255,0.4)" }} />
            <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: "0.05em" }}>SANDBOX</span>
            <span style={{ color: "rgba(255,255,255,0.12)" }}>·</span>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>Testing environment — no real data or payments</span>
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm space-y-4"
            style={mounted ? { animation: "fadeUp .6s cubic-bezier(.22,1,.36,1) both" } : { opacity: 0 }}>

            {/* Logo + wordmark */}
            <div className="text-center space-y-3 pb-2">
              <img src="/brightbridge-logo.png" alt="BrightBridge" className="h-12 mx-auto object-contain"
                style={{ filter: "brightness(0) invert(1) opacity(0.9)" }} />
              <div>
                <h1 className="text-xl font-bold tracking-tight" style={{ color: "rgba(255,255,255,0.92)" }}>BrightBridge</h1>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>Workforce management platform</p>
              </div>
            </div>

            {/* Form card */}
            <div className="glass-card rounded-2xl p-6 space-y-5" style={{ animationDelay: "0.05s" }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Sign in</h2>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Enter your credentials to continue</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="email" className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>Email</Label>
                  <Input id="email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" required
                    className="dark-input h-9 text-sm rounded-lg" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>Password</Label>
                    <button type="button" onClick={() => setShowFP(true)}
                      className="text-[11px] hover:opacity-80 transition-opacity"
                      style={{ color: "rgba(232,98,42,0.8)" }}>
                      Forgot password?
                    </button>
                  </div>
                  <Input id="password" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="current-password" required
                    className="dark-input h-9 text-sm rounded-lg" />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                    style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
                  </div>
                )}
                <button type="submit" disabled={pending || !email || !password}
                  className="sign-btn w-full h-9 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 cursor-pointer">
                  <LogIn className="h-3.5 w-3.5" />
                  {pending ? "Signing in…" : "Sign in"}
                </button>
              </form>
            </div>

            {/* Quick logins */}
            <div className="glass-card rounded-2xl p-4 space-y-3" style={{ animationDelay: "0.1s" }}>
              <div className="flex items-center gap-3">
                <div className="divider-line" />
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.22)" }}>Quick Login</span>
                <div className="divider-line" />
              </div>

              <div className="space-y-1.5">
                {QUICK_LOGINS.map((q) => (
                  <button key={q.email} type="button" onClick={() => fill(q)}
                    className={`qbtn w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${email === q.email ? "active" : ""}`}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: q.dot }} />
                    <span className="flex-1 text-xs font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>{q.label}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      {q.password}
                    </span>
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
