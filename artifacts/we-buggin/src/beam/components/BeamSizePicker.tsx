import { useRef } from 'react';
import { BEAM_CAPACITIES, capacityColumns, type BeamCapacity, type Identity } from '../types';
import { IdentityGlyph } from './IdentityGlyph';

interface Props {
  value: BeamCapacity;
  onChange: (c: BeamCapacity) => void;
  host: Identity;
}

export function BeamSizePicker({ value, onChange, host }: Props) {
  const cols = capacityColumns(value);
  const group = useRef<HTMLDivElement>(null);
  const move = (dir: number) => {
    const i = BEAM_CAPACITIES.indexOf(value);
    const next = BEAM_CAPACITIES[(i + dir + BEAM_CAPACITIES.length) % BEAM_CAPACITIES.length];
    onChange(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-testid="button-size-${next}"]`)?.focus();
  };
  return (
    <div className="bm-size">
      <div className="bm-label" id="bm-size-label">
        People per beam
      </div>
      <div
        ref={group}
        className="bm-size-opts"
        role="radiogroup"
        aria-labelledby="bm-size-label"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
        }}
      >
        {BEAM_CAPACITIES.map((c) => {
          const on = c === value;
          const k = capacityColumns(c);
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${c} per beam`}
              tabIndex={on ? 0 : -1}
              className={`bm-size-opt ${on ? 'is-on' : ''}`}
              onClick={() => onChange(c)}
              data-testid={`button-size-${c}`}
            >
              <span className="bm-mini" style={{ gridTemplateColumns: `repeat(${k}, 1fr)` }} aria-hidden="true">
                {Array.from({ length: c }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <b>{c}</b>
            </button>
          );
        })}
      </div>
      <div className="bm-seat-preview" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} data-testid="preview-seats">
        {Array.from({ length: value }, (_, i) => (
          <div key={i} className={`bm-seat ${i === 0 ? 'is-host' : ''}`}>
            {i === 0 ? <IdentityGlyph identity={host} size={value >= 9 ? 48 : 64} /> : <span>Open</span>}
          </div>
        ))}
      </div>
      <p className="bm-seat-count" aria-live="polite" data-testid="text-seat-count">
        {value} spots · 1 taken by you · {value - 1} open
      </p>
    </div>
  );
}
