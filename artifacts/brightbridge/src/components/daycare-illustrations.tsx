import React from "react";

export function DashboardSceneIllustration() {
  const navy = "rgba(40,67,98,";
  const orange = "rgba(232,98,42,";
  return (
    <svg viewBox="0 0 1200 260" fill="none" xmlns="http://www.w3.org/2000/svg"
      className="w-full" style={{ display: "block" }} aria-hidden="true">

      {/* Ground line */}
      <path d="M0 200 Q300 192 600 198 Q900 204 1200 196" stroke={`${navy}0.08)`} strokeWidth="1.5" fill="none" />

      {/* ── LEFT: School building ── */}
      {/* Main body */}
      <rect x="60" y="110" width="130" height="90" rx="3" fill={`${navy}0.06)`} />
      {/* Roof */}
      <polygon points="50,112 125,68 200,112" fill={`${navy}0.08)`} />
      {/* Door */}
      <rect x="107" y="152" width="34" height="48" rx="3" fill={`${navy}0.07)`} />
      {/* Windows */}
      <rect x="72" y="128" width="24" height="20" rx="2" fill={`${navy}0.05)`} stroke={`${navy}0.08)`} strokeWidth="1" />
      <rect x="152" y="128" width="24" height="20" rx="2" fill={`${navy}0.05)`} stroke={`${navy}0.08)`} strokeWidth="1" />
      {/* Flag pole */}
      <line x1="125" y1="68" x2="125" y2="40" stroke={`${navy}0.07)`} strokeWidth="1.5" />
      <rect x="125" y="40" width="20" height="12" rx="1" fill={`${orange}0.09)`} />
      {/* Sign */}
      <rect x="80" y="200" width="90" height="16" rx="2" fill={`${navy}0.05)`} />
      <rect x="88" y="204" width="60" height="4" rx="1" fill={`${navy}0.07)`} />
      <rect x="88" y="210" width="40" height="3" rx="1" fill={`${navy}0.05)`} />

      {/* ── LEFT: Kid running toward school ── */}
      <circle cx="240" cy="158" r="12" fill={`${navy}0.07)`} />
      <line x1="240" y1="170" x2="240" y2="195" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="240" y1="178" x2="226" y2="188" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="240" y1="178" x2="253" y2="185" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="240" y1="195" x2="228" y2="208" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="240" y1="195" x2="250" y2="210" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      {/* Backpack */}
      <rect x="248" y="172" width="10" height="16" rx="3" fill={`${orange}0.08)`} />

      {/* ── CENTER-LEFT: ABC blocks cluster ── */}
      <rect x="360" y="175" width="32" height="32" rx="4" fill={`${navy}0.06)`} stroke={`${navy}0.08)`} strokeWidth="1" />
      <text x="376" y="196" textAnchor="middle" fill={`${navy}0.12)`} fontSize="13" fontWeight="700">A</text>
      <rect x="395" y="180" width="28" height="28" rx="4" fill={`${orange}0.06)`} stroke={`${orange}0.08)`} strokeWidth="1" />
      <text x="409" y="199" textAnchor="middle" fill={`${orange}0.12)`} fontSize="12" fontWeight="700">B</text>
      <rect x="340" y="183" width="26" height="26" rx="4" fill={`${navy}0.05)`} stroke={`${navy}0.07)`} strokeWidth="1" />
      <text x="353" y="200" textAnchor="middle" fill={`${navy}0.10)`} fontSize="11" fontWeight="700">C</text>

      {/* ── CENTER-LEFT: Kid with balloon ── */}
      <circle cx="460" cy="155" r="11" fill={`${navy}0.07)`} />
      <line x1="460" y1="166" x2="460" y2="190" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="460" y1="174" x2="449" y2="184" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />
      <line x1="460" y1="174" x2="472" y2="183" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />
      <line x1="460" y1="190" x2="452" y2="203" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />
      <line x1="460" y1="190" x2="468" y2="203" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />
      {/* Balloon */}
      <ellipse cx="472" cy="133" rx="14" ry="16" fill={`${orange}0.08)`} />
      <line x1="472" y1="149" x2="467" y2="163" stroke={`${navy}0.06)`} strokeWidth="1" />

      {/* ── CENTER: Two kids playing with a ball ── */}
      {/* Kid left */}
      <circle cx="570" cy="156" r="12" fill={`${navy}0.07)`} />
      <line x1="570" y1="168" x2="570" y2="193" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="570" y1="176" x2="556" y2="184" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="570" y1="176" x2="582" y2="172" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="570" y1="193" x2="562" y2="207" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="570" y1="193" x2="578" y2="207" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      {/* Ball */}
      <circle cx="610" cy="180" r="12" fill={`${orange}0.08)`} stroke={`${orange}0.10)`} strokeWidth="1" />
      <path d="M600 175 Q610 170 620 175" stroke={`${navy}0.08)`} strokeWidth="1" fill="none" />
      <line x1="610" y1="168" x2="610" y2="192" stroke={`${navy}0.06)`} strokeWidth="1" />
      {/* Kid right */}
      <circle cx="650" cy="156" r="12" fill={`${navy}0.07)`} />
      <line x1="650" y1="168" x2="650" y2="193" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="650" y1="176" x2="638" y2="172" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="650" y1="176" x2="663" y2="184" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="650" y1="193" x2="642" y2="207" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="650" y1="193" x2="658" y2="207" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />

      {/* ── CENTER-RIGHT: Tree ── */}
      <line x1="760" y1="200" x2="760" y2="130" stroke={`${navy}0.07)`} strokeWidth="6" strokeLinecap="round" />
      <circle cx="760" cy="110" r="32" fill={`${navy}0.06)`} />
      <circle cx="742" cy="120" r="22" fill={`${navy}0.05)`} />
      <circle cx="778" cy="118" r="24" fill={`${navy}0.055)`} />
      {/* Apples */}
      <circle cx="750" cy="108" r="5" fill={`${orange}0.08)`} />
      <circle cx="769" cy="100" r="4" fill={`${orange}0.07)`} />
      <circle cx="760" cy="118" r="4.5" fill={`${orange}0.07)`} />

      {/* ── RIGHT: Kid reading/sitting ── */}
      <circle cx="860" cy="165" r="11" fill={`${navy}0.07)`} />
      {/* Sitting body */}
      <line x1="860" y1="176" x2="860" y2="196" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="860" y1="183" x2="846" y2="192" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="860" y1="183" x2="874" y2="192" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      {/* Book */}
      <rect x="838" y="192" width="44" height="14" rx="3" fill={`${orange}0.07)`} />
      <line x1="860" y1="192" x2="860" y2="206" stroke={`${navy}0.07)`} strokeWidth="1" />
      {/* Legs on ground */}
      <line x1="860" y1="196" x2="845" y2="210" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="860" y1="196" x2="875" y2="210" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />

      {/* ── RIGHT: Swing set ── */}
      {/* Frame */}
      <line x1="960" y1="100" x2="980" y2="200" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="1060" y1="100" x2="1040" y2="200" stroke={`${navy}0.07)`} strokeWidth="4" strokeLinecap="round" />
      <line x1="960" y1="100" x2="1060" y2="100" stroke={`${navy}0.08)`} strokeWidth="3" strokeLinecap="round" />
      {/* Swing ropes */}
      <line x1="990" y1="100" x2="985" y2="155" stroke={`${navy}0.06)`} strokeWidth="1.5" />
      <line x1="1010" y1="100" x2="1015" y2="155" stroke={`${navy}0.06)`} strokeWidth="1.5" />
      {/* Swing seat */}
      <rect x="982" y="152" width="36" height="6" rx="3" fill={`${navy}0.08)`} />
      {/* Kid on swing */}
      <circle cx="1000" cy="140" r="10" fill={`${navy}0.07)`} />
      <line x1="1000" y1="150" x2="1000" y2="166" stroke={`${navy}0.07)`} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="1000" y1="157" x2="988" y2="165" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />
      <line x1="1000" y1="157" x2="1012" y2="165" stroke={`${navy}0.07)`} strokeWidth="3" strokeLinecap="round" />

      {/* ── FAR RIGHT: Flower patch ── */}
      {[1105, 1120, 1132, 1115, 1128].map((x, i) => {
        const y = 195 - (i % 2) * 6;
        const stemH = 18 + (i % 3) * 8;
        return (
          <g key={i}>
            <line x1={x} y1={y} x2={x} y2={y + stemH} stroke={`${navy}0.07)`} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx={x} cy={y} r={5 + (i % 2)} fill={i % 2 === 0 ? `${orange}0.08)` : `${navy}0.07)`} />
          </g>
        );
      })}

      {/* ── Scattered decorative dots / stars ── */}
      {[
        [310, 140], [510, 90], [680, 80], [800, 155], [900, 95],
        [1070, 130], [430, 130], [730, 60], [550, 125],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 === 0 ? 3 : 2} fill={i % 3 === 0 ? `${orange}0.09)` : `${navy}0.08)`} />
      ))}

      {/* ── Small stars (4-pointed) ── */}
      {[[200, 95], [480, 70], [820, 75], [1085, 85], [340, 75]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x},${y})`}>
          <line x1="0" y1="-6" x2="0" y2="6" stroke={i % 2 === 0 ? `${orange}0.10)` : `${navy}0.09)`} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="-6" y1="0" x2="6" y2="0" stroke={i % 2 === 0 ? `${orange}0.10)` : `${navy}0.09)`} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
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
