import type { CSSProperties } from "react";
import { getCardTestFace } from "./owner-card-game-test-card-policy";
import { CardFaceImage } from "./CardFaceImage";

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
            aria-label={face.label}>
            <CardFaceImage code={code} />
          </article>
        );
      })}
    </div>
  );
}
