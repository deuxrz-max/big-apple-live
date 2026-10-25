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

export function UserPhoto({ username, displayName, photoUrl, size = 36, reviewStatus, fit = 'contain' }: {
  username?: string | null; displayName?: string | null; photoUrl?: string | null; size?: number;
  reviewStatus?: string;
  fit?: 'cover' | 'contain';
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  const label = displayName?.trim() || username || 'User';
  const box = { width: size, height: size, minWidth: size, borderRadius: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#e6c878', border: '1px solid #8a6d2f', fontWeight: 800, fontSize: Math.max(10, size * 0.38), fontFamily: "'Nunito Sans',system-ui,sans-serif", flexShrink: 0 } as const;
  if (photoUrl && !failed) return <span>
    <span style={box}><img className="dw-user-photo-image" src={photoSrc(photoUrl)} alt={`${label} profile photo`} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: fit }} /></span>
    {reviewStatus && reviewStatus !== 'approved' && <span className="ch-note" role="status" style={{ display: 'block' }}>
      {reviewStatus === 'pending' ? 'Pending review' : 'Not approved — upload another photo'}
    </span>}
  </span>;
  return <span style={box} role="img" aria-label={`${label} (no photo)`}>{initials(displayName, username)}</span>;
}
