type WeatheredStreetSignProps = {
  label: string;
  slug: string;
  testId?: string;
};

/** Crisp, scalable street-sign artwork; texture is layered over paint and lettering. */
export function WeatheredStreetSign({ label, slug, testId }: WeatheredStreetSignProps) {
  const id = `street-sign-${slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
  const fontSize = Math.min(42, 324 / Math.max(1, label.trim().length * 0.62));

  return (
    <svg
      className="rc-channel-sign"
      viewBox="0 0 360 68"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={label}
      data-testid={testId ?? `label-channel-${slug}`}
    >
      <defs>
        <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#356447" />
          <stop offset="0.52" stopColor="#28573b" />
          <stop offset="1" stopColor="#1c452f" />
        </linearGradient>
        <filter id={`${id}-letter-shadow`} x="-10%" y="-20%" width="120%" height="150%">
          <feDropShadow dx="1" dy="1.5" stdDeviation="1" floodColor="#07150d" floodOpacity=".92" />
        </filter>
        <pattern id={`${id}-grain`} width="74" height="68" patternUnits="userSpaceOnUse">
          <path d="M4 11h17 M32 6l9 1 M56 17h12 M10 51l15-1 M48 58h20" fill="none" stroke="#a9b79a" strokeWidth="1" opacity=".25" />
          <path d="M25 24l8-2 M61 38l8 1 M2 34h9 M37 47l7-1" fill="none" stroke="#102d1d" strokeWidth="1.5" opacity=".38" />
          <circle cx="52" cy="8" r=".9" fill="#d2d7c8" opacity=".4" />
          <circle cx="18" cy="39" r=".7" fill="#102d1d" opacity=".48" />
          <circle cx="67" cy="53" r=".8" fill="#d2d7c8" opacity=".32" />
        </pattern>
      </defs>

      <rect x="1" y="1" width="358" height="66" fill={`url(#${id}-paint)`} stroke="#e4e4d7" strokeWidth="2" />
      <rect x="4" y="4" width="352" height="60" fill="none" stroke="#152f20" strokeWidth="1" opacity=".78" />
      <text
        x="18"
        y="44"
        fill="#f5f4e9"
        filter={`url(#${id}-letter-shadow)`}
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={fontSize}
        fontWeight="900"
        letterSpacing=".8"
      >
        {label.toUpperCase()}
      </text>

      {/* Light, irregular wear crosses the sign face and the lettering. */}
      <rect x="2" y="2" width="356" height="64" fill={`url(#${id}-grain)`} pointerEvents="none" />
      <g fill="none" pointerEvents="none" strokeLinecap="round">
        <path d="M17 31l25-2 M83 49l32 1 M148 24l18-1 M218 52l27-2 M300 29l39 1" stroke="#102d1d" strokeWidth="2.4" opacity=".62" />
        <path d="M31 17l20 1 M117 34l24-2 M190 39l16 1 M265 16l28-1 M324 47l16-2" stroke="#c2c8b7" strokeWidth="1.2" opacity=".5" />
        <path d="M4 12h9 M348 57h8 M67 63l14-1 M281 5l17 1 M42 1h12 M245 1h8 M358 18v7 M359 46v8 M99 67h14" stroke="#102d1d" strokeWidth="2.8" opacity=".68" />
      </g>
    </svg>
  );
}
