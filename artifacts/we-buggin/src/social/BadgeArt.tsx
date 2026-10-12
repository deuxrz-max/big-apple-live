import { useEffect, useState } from 'react';

export const BADGE_ART: Record<string, string> = {
  'good-neighbor': 'peak-presenter.png',
  'marathon-master': 'marathon-master.png',
  'night-owl': 'night-owl.png',
};

export function BadgeArt({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return (
    <span className="sc-badge-art-slot">
      {failed
        ? <span role="img" aria-label={`${name} artwork unavailable`}>Artwork unavailable</span>
        : <img className="sc-badge-art" src={`${import.meta.env.BASE_URL}badges/${BADGE_ART[id]}`}
          alt={`${name} badge`} width={80} height={80} onError={() => setFailed(true)} />}
    </span>
  );
}
