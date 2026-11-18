// Game art gems reused as UI icons. The gem PNGs already ship with the
// game (battle-assets/gems) — no new assets. One distinct color per
// destination so each tab/screen is recognizable at a glance.
import './game-gem.css';

export const GEM_COLORS = ['blue', 'brown', 'green', 'orange', 'red', 'silver', 'sword', 'yellow'] as const;
export type GemColor = (typeof GEM_COLORS)[number];

export function GameGem({ color, size = 26, className = '' }: {
  color: GemColor;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}battle-assets/gems/gem_${color}.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`game-gem ${className}`.trim()}
      draggable={false}
    />
  );
}
