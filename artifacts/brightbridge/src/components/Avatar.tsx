import React, { useState } from "react";

const AVATAR_COLORS = [
  "#3B82F6","#8B5CF6","#EC4899","#EF4444",
  "#F59E0B","#10B981","#14B8A6","#E8622A",
];

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(firstName: string, lastName: string): string {
  return `${(firstName[0] ?? "").toUpperCase()}${(lastName[0] ?? "").toUpperCase()}`;
}

const SIZE_MAP = {
  sm:  { px: 28,  text: "text-[10px]", font: "font-bold" },
  md:  { px: 40,  text: "text-xs",     font: "font-bold" },
  lg:  { px: 96,  text: "text-2xl",    font: "font-bold" },
};

interface AvatarProps {
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function Avatar({ firstName, lastName, photoUrl, size = "md", className = "" }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const cfg = SIZE_MAP[size];
  const bg  = avatarColor(`${firstName} ${lastName}`);
  const ini = initials(firstName, lastName);

  const style: React.CSSProperties = {
    width:  cfg.px,
    height: cfg.px,
    minWidth: cfg.px,
    minHeight: cfg.px,
  };

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={`${firstName} ${lastName}`}
        onError={() => setImgError(true)}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={style}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 text-white ${cfg.text} ${cfg.font} ${className}`}
      style={{ ...style, background: bg }}
    >
      {ini}
    </div>
  );
}
