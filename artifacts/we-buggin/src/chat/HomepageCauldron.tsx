import { useEffect, useRef, useState } from 'react';
import { cauldronDisplayLevel } from './cauldron-display-level';
import { cauldronArtworkBounds, cauldronArtworkFit, type ArtworkBounds } from './cauldron-artwork-fit';
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
  const container = useRef<HTMLDivElement>(null);
  const [artwork, setArtwork] = useState<{ src: string; width: number; height: number; bounds: ArtworkBounds } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = container.current;
    if (!element || !element.closest('.rc-cauldron-tile')) return;
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const fit = artwork?.src === src && size.width > 0 && size.height > 0
    ? cauldronArtworkFit(artwork.width, artwork.height, artwork.bounds, size.width, size.height) : undefined;
  return (
    <div ref={container} className="hp-cauldron" data-testid="homepage-cauldron" data-display-level={level}>
      {failedSource === src ? (
        <span role="status">Cauldron image unavailable.</span>
      ) : (
        <img key={src} className="hp-cauldron-media" data-testid="homepage-cauldron-still"
          src={src} alt="" aria-hidden="true" decoding="async"
          style={fit ? { position: 'absolute', ...fit } : undefined}
          onLoad={event => {
            if (!container.current?.closest('.rc-cauldron-tile')) return;
            const image = event.currentTarget;
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            try {
              const context = canvas.getContext('2d');
              if (!context) return;
              context.drawImage(image, 0, 0);
              const bounds = cauldronArtworkBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
              if (bounds) setArtwork({ src, width: canvas.width, height: canvas.height, bounds });
            } catch {
              // A restricted image still uses the existing full, uncropped contain fit.
            }
          }}
          onError={() => setFailedSource(src)} />
      )}
    </div>
  );
}
