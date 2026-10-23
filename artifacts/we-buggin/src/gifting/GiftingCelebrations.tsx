import { useEffect, useRef } from 'react';
import { giftingTier } from '@workspace/beam-identity';
import { GiftingShield } from './GiftingShield';
import { giftingPerks } from './gifting';
import './gifting-shield.css';

export type GiftingArrival = { id: string; at: number; displayName: string; level: number };

/** Gold+ entrance banner; Platinum adds a sweep; Deux Wild adds a neon fullscreen frame. */
export function GiftingEntranceOverlay({ arrival, onFinish }: { arrival: GiftingArrival | null; onFinish: (id: string) => void }) {
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    if (!arrival) return;
    const t = window.setTimeout(() => finishRef.current(arrival.id), 2900);
    return () => window.clearTimeout(t);
  }, [arrival]);
  if (!arrival) return null;
  const perks = giftingPerks(arrival.level);
  if (!perks.entranceBanner) return null;
  const tier = giftingTier(arrival.level);
  return <>
    {perks.neonEntrance && <div className="gifting-entrance-fullscreen" aria-hidden="true" />}
    {perks.entranceEffect && !perks.neonEntrance && <div className="gifting-entrance-sweep" aria-hidden="true" />}
    <div className={`gifting-entrance gifting-entrance--${tier.key}`} role="status" aria-live="polite" data-testid="banner-gifting-entrance">
      <GiftingShield level={arrival.level} size={30} decorative />
      <span><small>{tier.name} gifter</small>{arrival.displayName} has entered</span>
    </div>
  </>;
}
