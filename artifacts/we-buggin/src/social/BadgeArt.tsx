import { useEffect, useState } from 'react';

export const BADGE_ART: Record<string, string> = {
  'monthly-tier-2': 'monthly-credit-tiers/tier2.png',
  'monthly-tier-3': 'monthly-credit-tiers/tier3.png',
  'monthly-tier-4': 'monthly-credit-tiers/tier4.png',
  'lion-entrance': 'monthly-credit-tiers/lion-entrance.svg',
};

export function BadgeArt({ id, name, imageUrl, size = 80 }: { id: string; name: string; imageUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (id === 'monthly-tier-1' || id === 'monthly-tier-5') return null;
  return (
    <span className="sc-badge-art-slot">
      {failed
        ? <span role="img" aria-label={`${name} artwork unavailable`}>Artwork unavailable</span>
        : <img className="sc-badge-art" src={imageUrl
          ? `${import.meta.env.BASE_URL}${imageUrl.replace(/^\/+/, '')}`
          : `${import.meta.env.BASE_URL}badges/${BADGE_ART[id]}`}
          alt={`${name} badge`} width={size} height={size} onError={() => setFailed(true)} />}
    </span>
  );
}
