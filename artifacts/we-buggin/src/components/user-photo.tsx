import { useEffect, useState } from 'react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function photoSrc(url: string): string {
  if (/^(https?:|blob:)/.test(url)) return url;
  if (url.startsWith('/') && basePath && !url.startsWith(`${basePath}/`)) return `${basePath}${url}`;
  return url;
}

function initials(displayName?: string | null, username?: string | null): string {
  const src = (displayName?.trim() || username || '').replace(/[_]+/g, ' ').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = [...parts[0]][0] ?? '';
  const b = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? '' : '';
  return (a + b).toUpperCase();
}

export function UserPhoto({ username, displayName, photoUrl, size = 36 }: {
  username?: string | null; displayName?: string | null; photoUrl?: string | null; size?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const label = displayName?.trim() || username || 'User';
  const box = { width: size, height: size, minWidth: size, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#2a2a2a', color: '#f2f2ee', border: '1px solid #555', fontWeight: 800, fontSize: Math.max(10, size * 0.38), fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif", flexShrink: 0 } as const;
  if (photoUrl && !failed) return <span style={box}><img src={photoSrc(photoUrl)} alt={`${label} profile photo`} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  return <span style={box} role="img" aria-label={`${label} (no photo)`}>{initials(displayName, username)}</span>;
}
