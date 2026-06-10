import React, { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  Baby, Camera, CheckCircle2, Clock, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PANEL = { background: "#284362", borderColor: "rgba(255,255,255,0.1)" } as const;

interface Child {
  id: string;
  name: string;
  age: number;
  checkedIn: boolean;
  checkInTime?: string;
}

interface CheckInRecord {
  childId: string;
  childName: string;
  time: string;
  photo?: string;
}

function useChildren() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = async () => {
    try {
      const res = await fetch("/api/auth/children", { credentials: "include" });
      const d = await res.json() as { children: Child[] };
      setChildren(d.children ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void fetch_(); }, []);
  return { children, loading, refetch: fetch_, setChildren };
}

function ChildCard({ child, onCheckIn, onCheckOut }: {
  child: Child;
  onCheckIn: (id: string) => Promise<void>;
  onCheckOut: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [photo, setPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    setShowCamera(true);
    setCountdown(3);
    setPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      let c = 3;
      const iv = setInterval(() => {
        c--;
        setCountdown(c);
        if (c === 0) {
          clearInterval(iv);
          capturePhoto();
        }
      }, 1000);
    } catch {
      setShowCamera(false);
      // Camera not available — check in without photo
      await doCheckIn();
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setPhoto(dataUrl);
    stopStream();
    void doCheckIn();
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const doCheckIn = async () => {
    setBusy(true);
    setShowCamera(false);
    await onCheckIn(child.id);
    setBusy(false);
  };

  const handleCheckOut = async () => {
    setBusy(true);
    setPhoto(null);
    await onCheckOut(child.id);
    setBusy(false);
  };

  useEffect(() => () => stopStream(), []);

  return (
    <div className="rounded-2xl bg-white border p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-lg text-gray-900">{child.name}</h3>
          <p className="text-sm text-muted-foreground">Age {child.age} · ID: {child.id}</p>
        </div>
        {child.checkedIn ? (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />Checked In ✅
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
            Not checked in
          </span>
        )}
      </div>

      {child.checkedIn && child.checkInTime && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200">
          <Clock className="h-3.5 w-3.5" />
          Checked in at {new Date(child.checkInTime).toLocaleTimeString()}
        </div>
      )}

      {photo && (
        <div className="rounded-lg overflow-hidden border">
          <img src={photo} alt="Check-in photo" className="w-full h-32 object-cover" />
          <div className="px-3 py-1.5 bg-emerald-50 text-xs text-emerald-700 font-medium">Photo captured ✓</div>
        </div>
      )}

      {showCamera && (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-40 object-cover" />
            {countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-4xl font-bold drop-shadow">{countdown}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">Taking photo in {countdown}s…</p>
        </div>
      )}

      {!child.checkedIn ? (
        <Button
          onClick={startCamera}
          disabled={busy || showCamera}
          className="w-full gap-2 font-semibold text-white"
          style={{ background: "#0d9488" }}
        >
          <Camera className="h-4 w-4" />
          {busy ? "Checking in…" : "Check In"}
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={handleCheckOut}
          disabled={busy}
          className="w-full gap-2 text-red-500 border-red-200 hover:bg-red-50"
        >
          {busy ? "Checking out…" : "Check Out"}
        </Button>
      )}
    </div>
  );
}

export default function ParentDashboard() {
  const { user } = useAuth();
  const { children, loading, refetch } = useChildren();
  const [checkInLog, setCheckInLog] = useState<CheckInRecord[]>([]);

  const handleCheckIn = async (childId: string) => {
    await fetch("/api/auth/children/checkin", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId }),
    });
    const child = children.find(c => c.id === childId);
    if (child) {
      setCheckInLog(prev => [{ childId, childName: child.name, time: new Date().toISOString() }, ...prev].slice(0, 10));
    }
    await refetch();
  };

  const handleCheckOut = async (childId: string) => {
    await fetch("/api/auth/children/checkout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId }),
    });
    await refetch();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#284362]">Parent Portal</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#2563eb" }}>Parent</span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">Welcome, {user?.name}!</p>
      </div>
        {/* EasyTeam notice */}
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-800 text-sm">Parents do not have access to EasyTeam workforce features.</div>
            <div className="text-amber-700 text-sm mt-0.5">Parent check-in for children is a <span className="font-semibold">custom BrightBridge feature</span>, separate from EasyTeam.</div>
          </div>
        </div>

        {/* Children */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Baby className="h-5 w-5 text-[#E8622A]" />
            <h2 className="text-lg font-bold text-[#284362]">Your Children</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#284362] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {children.map(child => (
                <ChildCard key={child.id} child={child} onCheckIn={handleCheckIn} onCheckOut={handleCheckOut} />
              ))}
            </div>
          )}
        </div>

        {/* No EasyTeam message */}
        <div className="rounded-2xl overflow-hidden border" style={PANEL}>
          <div className="px-6 py-4 border-b border-white/10">
            <h3 className="text-white font-semibold text-sm">EasyTeam JWT Status</h3>
          </div>
          <div className="px-6 py-8 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
              <AlertCircle className="h-6 w-6 text-white/30" />
            </div>
            <div className="text-white/70 font-semibold">No EasyTeam JWT generated for parent accounts.</div>
            <div className="text-white/40 text-sm">
              Parents use BrightBridge's custom check-in system<br />instead of EasyTeam.
            </div>
          </div>
        </div>

        {/* Check-in log */}
        {checkInLog.length > 0 && (
          <div className="rounded-2xl overflow-hidden border" style={PANEL}>
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-white font-semibold text-sm">Today's Check-In Activity</h3>
            </div>
            <div className="divide-y divide-white/5">
              {checkInLog.map((entry, i) => (
                <div key={i} className="px-6 py-3 flex items-center gap-4 text-sm">
                  <span className="text-white/40 text-xs font-mono w-20 shrink-0">{new Date(entry.time).toLocaleTimeString()}</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-white/80">{entry.childName} checked in</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center">
          <Link href="/roles" className="text-xs text-[#284362] underline underline-offset-2 hover:no-underline">
            View role comparison to see what other roles can access →
          </Link>
        </div>
      </div>
  );
}
