import React from "react";

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
