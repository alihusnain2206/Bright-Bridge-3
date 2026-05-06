import React from "react";

export function DashboardHeroIllustration() {
  return (
    <svg viewBox="0 0 420 220" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">

      {/* Ground */}
      <ellipse cx="210" cy="208" rx="170" ry="10" fill="rgba(255,255,255,0.05)" />

      {/* Back wall / chalkboard */}
      <rect x="120" y="40" width="110" height="75" rx="6" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      {/* Chalk lines on board */}
      <line x1="135" y1="68" x2="215" y2="68" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="135" y1="80" x2="195" y2="80" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="135" y1="92" x2="205" y2="92" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" />
      {/* ABC on board */}
      <text x="175" y="62" textAnchor="middle" fill="#E8622A" fontSize="11" fontWeight="bold" opacity="0.9">ABC</text>
      {/* Board frame */}
      <rect x="120" y="40" width="110" height="75" rx="6" fill="none" stroke="rgba(232,98,42,0.4)" strokeWidth="2" />

      {/* Teacher — center-left, taller */}
      {/* body */}
      <line x1="100" y1="138" x2="100" y2="172" stroke="rgba(255,255,255,0.75)" strokeWidth="4" strokeLinecap="round" />
      {/* head */}
      <circle cx="100" cy="128" r="12" fill="#E8622A" opacity="0.9" />
      {/* hair */}
      <path d="M90 124 Q100 118 110 124" stroke="rgba(255,255,255,0.6)" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* arms — pointing at board */}
      <line x1="100" y1="148" x2="120" y2="138" stroke="rgba(255,255,255,0.75)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="100" y1="148" x2="85" y2="158" stroke="rgba(255,255,255,0.75)" strokeWidth="3.5" strokeLinecap="round" />
      {/* legs */}
      <line x1="100" y1="172" x2="93" y2="190" stroke="rgba(255,255,255,0.75)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="100" y1="172" x2="107" y2="190" stroke="rgba(255,255,255,0.75)" strokeWidth="3.5" strokeLinecap="round" />
      {/* Teacher label dot */}
      <circle cx="100" cy="128" r="4" fill="rgba(255,255,255,0.9)" />

      {/* Kid 1 — left, raising hand */}
      <circle cx="50" cy="152" r="10" fill="#E8622A" opacity="0.8" />
      <line x1="50" y1="162" x2="50" y2="183" stroke="rgba(255,255,255,0.65)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="50" y1="168" x2="37" y2="175" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      {/* raised arm */}
      <line x1="50" y1="168" x2="60" y2="152" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      <line x1="50" y1="183" x2="43" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      <line x1="50" y1="183" x2="57" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />

      {/* Kid 2 — sitting cross-legged with book */}
      <circle cx="270" cy="155" r="10" fill="#E8622A" opacity="0.8" />
      <line x1="270" y1="165" x2="270" y2="182" stroke="rgba(255,255,255,0.65)" strokeWidth="3.5" strokeLinecap="round" />
      {/* cross-legs */}
      <line x1="270" y1="182" x2="258" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      <line x1="270" y1="182" x2="282" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      {/* book */}
      <rect x="258" y="170" width="24" height="16" rx="3" fill="rgba(232,98,42,0.5)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      <line x1="270" y1="170" x2="270" y2="186" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      {/* arms holding book */}
      <line x1="270" y1="170" x2="260" y2="175" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      <line x1="270" y1="170" x2="280" y2="175" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />

      {/* Kid 3 — right, holding balloon */}
      <circle cx="350" cy="150" r="10" fill="#E8622A" opacity="0.8" />
      <line x1="350" y1="160" x2="350" y2="183" stroke="rgba(255,255,255,0.65)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="350" y1="168" x2="338" y2="178" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      {/* balloon string + balloon */}
      <line x1="350" y1="168" x2="358" y2="148" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="360" cy="135" r="10" fill="rgba(232,98,42,0.6)" stroke="rgba(232,98,42,0.8)" strokeWidth="1.5" />
      <line x1="350" y1="183" x2="342" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />
      <line x1="350" y1="183" x2="358" y2="196" stroke="rgba(255,255,255,0.65)" strokeWidth="3" strokeLinecap="round" />

      {/* Kid 4 — far right, waving */}
      <circle cx="400" cy="155" r="9" fill="#E8622A" opacity="0.75" />
      <line x1="400" y1="164" x2="400" y2="183" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="400" y1="170" x2="390" y2="180" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      {/* waving */}
      <line x1="400" y1="168" x2="412" y2="158" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="400" y1="183" x2="394" y2="196" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="400" y1="183" x2="406" y2="196" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* ABC Blocks scattered */}
      <rect x="22" y="184" width="18" height="18" rx="4" fill="rgba(232,98,42,0.35)" stroke="rgba(232,98,42,0.5)" strokeWidth="1.5" />
      <text x="31" y="197" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" opacity="0.8">A</text>
      <rect x="42" y="186" width="16" height="16" rx="3" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <text x="50" y="198" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" opacity="0.7">B</text>
      <rect x="310" y="185" width="16" height="16" rx="3" fill="rgba(232,98,42,0.3)" stroke="rgba(232,98,42,0.45)" strokeWidth="1.5" />
      <text x="318" y="197" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" opacity="0.8">C</text>

      {/* Stars / sparkles */}
      <circle cx="30" cy="50" r="3" fill="#E8622A" opacity="0.7" />
      <circle cx="75" cy="35" r="2" fill="white" opacity="0.5" />
      <circle cx="240" cy="25" r="3" fill="#E8622A" opacity="0.6" />
      <circle cx="310" cy="40" r="2" fill="white" opacity="0.4" />
      <circle cx="385" cy="55" r="2.5" fill="#E8622A" opacity="0.55" />
      <circle cx="20" cy="130" r="2" fill="white" opacity="0.35" />
      <circle cx="415" cy="110" r="2" fill="white" opacity="0.3" />

      {/* Star shape top-right */}
      <path d="M390 28 L392 22 L394 28 L400 28 L395 32 L397 38 L392 34 L387 38 L389 32 L384 28 Z"
        fill="rgba(232,98,42,0.5)" />

      {/* Sun / circle top center */}
      <circle cx="210" cy="18" r="8" fill="rgba(232,98,42,0.2)" stroke="rgba(232,98,42,0.4)" strokeWidth="1.5" />
      <circle cx="210" cy="18" r="4" fill="rgba(232,98,42,0.6)" />

      {/* Small hearts */}
      <path d="M155 32 C155 30 152 28 150 30 C148 28 145 30 145 32 C145 35 150 38 150 38 C150 38 155 35 155 32Z"
        fill="rgba(232,98,42,0.5)" />
      <path d="M280 30 C280 28.5 277.5 27 276 28.5 C274.5 27 272 28.5 272 30 C272 32.5 276 35 276 35 C276 35 280 32.5 280 30Z"
        fill="rgba(255,255,255,0.2)" />
    </svg>
  );
}

export function SDKStatusMini() {
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-60">
      {/* Monitor */}
      <rect x="15" y="20" width="50" height="35" rx="5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <rect x="20" y="25" width="40" height="23" rx="3" fill="rgba(255,255,255,0.06)" />
      {/* Stand */}
      <rect x="33" y="55" width="14" height="8" rx="2" fill="rgba(255,255,255,0.1)" />
      <rect x="27" y="62" width="26" height="4" rx="2" fill="rgba(255,255,255,0.1)" />
      {/* Green check on screen */}
      <circle cx="40" cy="36" r="8" fill="rgba(34,197,94,0.3)" stroke="rgba(34,197,94,0.6)" strokeWidth="1.5" />
      <polyline points="35,36 39,40 46,32" stroke="rgba(34,197,94,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Small character next to monitor */}
      <circle cx="72" cy="38" r="6" fill="#E8622A" opacity="0.8" />
      <line x1="72" y1="44" x2="72" y2="58" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="72" y1="49" x2="65" y2="53" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
      <line x1="72" y1="49" x2="79" y2="52" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ActivityMini() {
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-60">
      {/* Clipboard */}
      <rect x="20" y="18" width="36" height="48" rx="5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <rect x="28" y="13" width="20" height="10" rx="5" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      {/* Lines */}
      {[32, 42, 52].map((y, i) => (
        <g key={y}>
          <circle cx="29" cy={y} r="3" fill={i < 2 ? "rgba(232,98,42,0.7)" : "rgba(255,255,255,0.15)"} />
          {i < 2 && <polyline points={`27,${y} 29,${y+2} 32,${y-2}`} stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
          <rect x="35" y={y - 2.5} width={i < 2 ? 16 : 10} height="3" rx="1.5" fill="rgba(255,255,255,0.12)" />
        </g>
      ))}
      {/* Character peeking right */}
      <circle cx="66" cy="42" r="7" fill="#E8622A" opacity="0.8" />
      <line x1="66" y1="49" x2="66" y2="64" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="66" y1="53" x2="58" y2="58" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
      <line x1="66" y1="53" x2="74" y2="57" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function QuickLinksMini() {
  return (
    <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-60">
      {/* Signpost */}
      <line x1="40" y1="15" x2="40" y2="68" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Signs */}
      <rect x="20" y="20" width="38" height="13" rx="3" fill="rgba(232,98,42,0.4)" stroke="rgba(232,98,42,0.6)" strokeWidth="1.5" />
      <polygon points="58,26.5 62,26.5 58,26.5" fill="rgba(232,98,42,0.6)" />
      <text x="37" y="30.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" opacity="0.9">Time Clock</text>

      <rect x="15" y="38" width="38" height="12" rx="3" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <text x="33" y="47.5" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" opacity="0.7">Timesheets</text>

      <rect x="22" y="55" width="36" height="12" rx="3" fill="rgba(232,98,42,0.3)" stroke="rgba(232,98,42,0.5)" strokeWidth="1.5" />
      <text x="39" y="64.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" opacity="0.8">Schedule</text>

      {/* Kid character next to signpost */}
      <circle cx="14" cy="46" r="6" fill="#E8622A" opacity="0.8" />
      <line x1="14" y1="52" x2="14" y2="64" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="14" y1="56" x2="8" y2="60" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="56" x2="20" y2="53" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ClockIllustration() {
  return (
    <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-[220px]">
      {/* Ground / floor */}
      <ellipse cx="120" cy="188" rx="85" ry="8" fill="rgba(255,255,255,0.06)" />

      {/* Big clock */}
      <circle cx="120" cy="95" r="62" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" />
      <circle cx="120" cy="95" r="54" fill="rgba(40,67,98,0.4)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      {/* Hour marks */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg, i) => {
        const r = deg * Math.PI / 180;
        const x1 = 120 + 44 * Math.sin(r); const y1 = 95 - 44 * Math.cos(r);
        const x2 = 120 + (i % 3 === 0 ? 37 : 40) * Math.sin(r); const y2 = 95 - (i % 3 === 0 ? 37 : 40) * Math.cos(r);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.3)" strokeWidth={i % 3 === 0 ? 2.5 : 1.5} strokeLinecap="round" />;
      })}
      {/* Minute hand */}
      <line x1="120" y1="95" x2="120" y2="55" stroke="white" strokeWidth="3" strokeLinecap="round" />
      {/* Hour hand */}
      <line x1="120" y1="95" x2="142" y2="108" stroke="#E8622A" strokeWidth="3.5" strokeLinecap="round" />
      {/* Center */}
      <circle cx="120" cy="95" r="5" fill="#E8622A" />
      <circle cx="120" cy="95" r="2.5" fill="white" />

      {/* Kid left — standing */}
      <circle cx="40" cy="148" r="10" fill="#E8622A" opacity="0.85" />
      <line x1="40" y1="158" x2="40" y2="182" stroke="rgba(255,255,255,0.6)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="40" y1="165" x2="28" y2="175" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="40" y1="165" x2="52" y2="175" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="40" y1="182" x2="32" y2="194" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="40" y1="182" x2="48" y2="194" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* Kid right — waving */}
      <circle cx="198" cy="148" r="10" fill="#E8622A" opacity="0.85" />
      <line x1="198" y1="158" x2="198" y2="182" stroke="rgba(255,255,255,0.6)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="198" y1="163" x2="185" y2="155" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="198" y1="163" x2="212" y2="172" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="198" y1="182" x2="190" y2="194" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="198" y1="182" x2="206" y2="194" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* ABC block left */}
      <rect x="12" y="172" width="22" height="22" rx="4" fill="rgba(232,98,42,0.3)" stroke="rgba(232,98,42,0.5)" strokeWidth="1.5" />
      <text x="23" y="187" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" opacity="0.8">A</text>

      {/* ABC block right */}
      <rect x="204" y="172" width="22" height="22" rx="4" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <text x="215" y="187" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" opacity="0.8">B</text>

      {/* Stars */}
      <circle cx="72" cy="30" r="3" fill="#E8622A" opacity="0.7" />
      <circle cx="168" cy="22" r="2" fill="white" opacity="0.5" />
      <circle cx="195" cy="48" r="2.5" fill="#E8622A" opacity="0.5" />
      <circle cx="48" cy="55" r="2" fill="white" opacity="0.4" />
    </svg>
  );
}

export function TimesheetIllustration() {
  return (
    <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-[220px]">
      <ellipse cx="120" cy="188" rx="85" ry="8" fill="rgba(255,255,255,0.06)" />

      {/* Clipboard body */}
      <rect x="60" y="30" width="110" height="140" rx="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
      {/* Clipboard clip */}
      <rect x="95" y="22" width="40" height="18" rx="9" fill="rgba(40,67,98,0.6)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      <rect x="103" y="26" width="24" height="10" rx="5" fill="rgba(255,255,255,0.15)" />

      {/* Rows on clipboard */}
      {[60, 80, 100, 120, 140].map((y, i) => (
        <g key={y}>
          {/* Checkmark circle */}
          <circle cx="82" cy={y} r="7" fill={i < 3 ? "rgba(232,98,42,0.7)" : "rgba(255,255,255,0.1)"} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          {i < 3 && <polyline points={`78,${y} 81,${y+3} 87,${y-3}`} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
          {/* Row lines */}
          <rect x="97" y={y - 4} width={i < 3 ? 55 : 40} height="5" rx="2.5" fill="rgba(255,255,255,0.12)" />
          <rect x="97" y={y + 2} width={i < 3 ? 35 : 25} height="3.5" rx="1.75" fill="rgba(255,255,255,0.07)" />
        </g>
      ))}

      {/* Pencil leaning */}
      <g transform="rotate(-30, 190, 120)">
        <rect x="182" y="80" width="12" height="60" rx="3" fill="#E8622A" opacity="0.9" />
        <polygon points="182,80 194,80 188,65" fill="rgba(255,255,255,0.9)" />
        <rect x="182" y="136" width="12" height="8" rx="2" fill="rgba(255,200,150,0.8)" />
        <line x1="186" y1="80" x2="186" y2="136" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
      </g>

      {/* Kid left */}
      <circle cx="30" cy="148" r="9" fill="#E8622A" opacity="0.85" />
      <line x1="30" y1="157" x2="30" y2="179" stroke="rgba(255,255,255,0.6)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="30" y1="164" x2="19" y2="173" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="164" x2="41" y2="173" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="179" x2="23" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="179" x2="37" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* ABC block */}
      <rect x="8" y="168" width="20" height="20" rx="4" fill="rgba(232,98,42,0.3)" stroke="rgba(232,98,42,0.5)" strokeWidth="1.5" />
      <text x="18" y="182" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" opacity="0.8">C</text>

      <circle cx="75" cy="22" r="3" fill="#E8622A" opacity="0.7" />
      <circle cx="170" cy="18" r="2" fill="white" opacity="0.5" />
      <circle cx="205" cy="40" r="2" fill="#E8622A" opacity="0.4" />
    </svg>
  );
}

export function ScheduleIllustration() {
  return (
    <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-[220px]">
      <ellipse cx="120" cy="188" rx="85" ry="8" fill="rgba(255,255,255,0.06)" />

      {/* Calendar body */}
      <rect x="45" y="35" width="140" height="130" rx="10" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
      {/* Calendar header */}
      <rect x="45" y="35" width="140" height="32" rx="10" fill="rgba(232,98,42,0.55)" />
      <rect x="45" y="52" width="140" height="15" fill="rgba(232,98,42,0.55)" />
      {/* Ring hooks */}
      <rect x="80" y="26" width="8" height="18" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="108" y="26" width="8" height="18" rx="4" fill="rgba(255,255,255,0.4)" />
      <rect x="136" y="26" width="8" height="18" rx="4" fill="rgba(255,255,255,0.4)" />
      {/* Month label */}
      <text x="115" y="56" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" opacity="0.9">WEEKLY PLAN</text>

      {/* Day columns grid */}
      {["M","T","W","T","F"].map((d, i) => {
        const x = 58 + i * 26;
        return (
          <g key={i}>
            <text x={x + 8} y={82} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9" fontWeight="600">{d}</text>
            {/* Events blocks */}
            {[0,1,2].map(j => {
              const colors = ["rgba(232,98,42,0.7)","rgba(255,255,255,0.15)","rgba(232,98,42,0.35)"];
              const heights = [28, 18, 22];
              const skip = (i + j) % 4 === 0;
              if (skip) return null;
              return (
                <rect key={j} x={x} y={88 + j * 32} width="18" height={heights[j]} rx="4"
                  fill={colors[(i + j) % 3]} />
              );
            })}
          </g>
        );
      })}

      {/* Kid left */}
      <circle cx="22" cy="148" r="9" fill="#E8622A" opacity="0.85" />
      <line x1="22" y1="157" x2="22" y2="179" stroke="rgba(255,255,255,0.6)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="22" y1="163" x2="11" y2="172" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="22" y1="163" x2="33" y2="172" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="22" y1="179" x2="15" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="22" y1="179" x2="29" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* Kid right */}
      <circle cx="215" cy="148" r="9" fill="#E8622A" opacity="0.85" />
      <line x1="215" y1="157" x2="215" y2="179" stroke="rgba(255,255,255,0.6)" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="215" y1="163" x2="204" y2="172" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="215" y1="163" x2="226" y2="170" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="215" y1="179" x2="208" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      <line x1="215" y1="179" x2="222" y2="192" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />

      {/* ABC block */}
      <rect x="197" y="168" width="20" height="20" rx="4" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <text x="207" y="182" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" opacity="0.8">A</text>

      <circle cx="68" cy="22" r="3" fill="#E8622A" opacity="0.7" />
      <circle cx="175" cy="18" r="2" fill="white" opacity="0.5" />
      <circle cx="210" cy="42" r="2" fill="#E8622A" opacity="0.45" />
    </svg>
  );
}
