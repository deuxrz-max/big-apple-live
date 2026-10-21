import type { CSSProperties } from "react";
import { getCardTestFace } from "./owner-card-game-test-card-policy";

export function CardHandFan({ cards }: { cards: string[] }) {
  if (cards.length === 0) return null;
  const shownCards = cards.slice(0, 5);
  return (
    <div className="dw-card-hand-fan" role="group" aria-label={`${shownCards.length} cards in hand`}>
      {shownCards.map((code, index) => {
        const face = getCardTestFace(code);
        if (!face) return null;
        const fanAngle = (index - (shownCards.length - 1) / 2) * 6;
        return (
          <article key={`${code}-${index}`}
            className={`dw-test-card${face.isWild ? " is-wild" : ""}`}
            style={{ "--fan-angle": `${fanAngle}deg`, "--fan-index": index } as CSSProperties}
            aria-label={`${face.rank} of ${face.suitName}${face.isWild ? ", wild" : ""}`}>
            <span className="dw-test-card-corner dw-test-card-top">
              <b>{face.rank}</b><i>{face.symbol}</i>
            </span>
            {face.isWild
              ? <span className="dw-test-card-wild-mark" aria-hidden="true">{face.wildMark}</span>
              : <span className="dw-test-card-center" aria-hidden="true">{face.symbol}</span>}
            {face.isWild && <span className="dw-test-card-wild-label">WILD</span>}
            <span className="dw-test-card-corner dw-test-card-bottom" aria-hidden="true">
              <b>{face.rank}</b><i>{face.symbol}</i>
            </span>
          </article>
        );
      })}
    </div>
  );
}
