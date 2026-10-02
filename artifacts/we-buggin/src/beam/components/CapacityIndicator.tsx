import { CAPACITY } from '../types';

export function CapacityIndicator({ count, capacity = CAPACITY }: { count: number; capacity?: number }) {
  const full = count >= capacity;
  return (
    <div className={`bm-cap ${full ? 'is-full' : ''}`} data-testid="text-capacity" aria-label={`${count} of ${capacity} participants${full ? ', full' : ''}`}>
      <span className="bm-cap-num">
        {count}/{capacity}
      </span>
      <span className="bm-cap-bar" aria-hidden>
        {Array.from({ length: capacity }, (_, i) => (
          <i key={i} className={i < count ? 'on' : ''} />
        ))}
      </span>
      {full && <span className="bm-cap-flag">FULL</span>}
    </div>
  );
}
