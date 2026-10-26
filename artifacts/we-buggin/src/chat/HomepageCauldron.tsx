import { useState } from 'react';
import { cauldronDisplayLevel } from './cauldron-display-level';
import './homepage-cauldron.css';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');

/**
 * A still from the existing artwork, never an independent animation.
 * Tracking/targets remain deferred: Home supplies no invented progress, so stays empty.
 * A future authoritative progress source can supply progressPercent.
 */
export function HomepageCauldron({ progressPercent }: { progressPercent?: number | null }) {
  const level = cauldronDisplayLevel(progressPercent);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const src = `${BASE}api/gift-media/system-cauldron/still/${level}`;
  return (
    <div className="hp-cauldron" data-testid="homepage-cauldron" data-display-level={level}>
      {failedSource === src ? (
        <span role="status">Cauldron image unavailable.</span>
      ) : (
        <img key={src} className="hp-cauldron-media" data-testid="homepage-cauldron-still"
          src={src} alt="" aria-hidden="true" decoding="async"
          onError={() => setFailedSource(src)} />
      )}
    </div>
  );
}
