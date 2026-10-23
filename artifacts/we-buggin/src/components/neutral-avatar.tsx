/** Neutral default picture: initials when a name is known, otherwise a plain silhouette. */
export function avatarInitials(name?: string | null): string {
  const parts = (name ?? '').replace(/[_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const a = [...parts[0]][0] ?? '';
  const b = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? '' : '';
  return (a + b).toUpperCase();
}

/** fill=true paints a full rectangle so a seat/card container keeps its own shape (no forced circle). */
export function NeutralAvatar({ name, size = 64, className, fill = false }: { name?: string | null; size?: number | string; className?: string; fill?: boolean }) {
  const text = avatarInitials(name);
  const label = name?.trim() ? `${name.trim()} (default picture)` : 'Default profile picture';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} className={className}
      data-testid="img-neutral-avatar" data-shape={fill ? 'fill' : 'circle'} preserveAspectRatio={fill ? 'xMidYMid slice' : undefined}
      style={{ display: 'block', flexShrink: 0 }}>
      {fill
        ? <rect x="-50" y="-50" width="200" height="200" fill="#ece6ef" />
        : <circle cx="50" cy="50" r="49" fill="#ece6ef" stroke="#d6cede" strokeWidth="2" />}
      {text
        ? <text x="50" y="51" textAnchor="middle" dominantBaseline="central" fontSize={text.length > 1 ? 34 : 40} fontWeight="800" fill="#4a4352" fontFamily="'Nunito Sans',system-ui,sans-serif">{text}</text>
        : <g fill="#a99fb3"><circle cx="50" cy="38" r="17" /><path d="M18 86c3-18 16-27 32-27s29 9 32 27z" /></g>}
    </svg>
  );
}
