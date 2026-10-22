import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getCardTestFace } from "./owner-card-game-test-card-policy";
import { CardFaceImage } from "./CardFaceImage";
import { fitCard, getHandGridLayout, isRedSuit, isSimpleNumberRank } from "./card-fan-layout";

export function CardHandFan({ cards, expanded = false }: { cards: string[]; expanded?: boolean }) {
  if (cards.length === 0) return null;
  if (expanded) return <ExpandedFan cards={cards.slice(0, 5)} />;
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

/** Popup-only face: 3-10 show big rank + suit; A/J/Q/K/Jokers keep uploaded art. */
function PopupCardFace({ code }: { code: string }) {
  const f = getCardTestFace(code);
  if (!f) return null;
  if (!f.isWild && isSimpleNumberRank(f.rank)) {
    return (
      <span className={`dw-card-simple${isRedSuit(f.suit) ? " is-red" : ""}`} aria-hidden="true">
        <b>{f.rank}</b><i>{f.symbol}</i>
      </span>
    );
  }
  return <CardFaceImage code={code} />;
}

function ExpandedFan({ cards }: { cards: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const returnTo = useRef<number | null>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [zoomed, setZoomed] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const key = cards.join(",");
  useEffect(() => { setZoomed(null); }, [key]);
  useEffect(() => {
    if (zoomed === null && returnTo.current !== null) { tileRefs.current[returnTo.current]?.focus(); returnTo.current = null; }
  }, [zoomed]);
  const innerW = size.w - 8, innerH = size.h - 8;
  const L = getHandGridLayout(cards.length, innerW, innerH);
  const zoom = fitCard(innerW, innerH - 48);
  const zf = zoomed !== null ? getCardTestFace(cards[zoomed]) : null;
  const back = () => { returnTo.current = zoomed; setZoomed(null); };
  return (
    <div ref={box} className="dw-card-fan-xl" data-testid="profile-card-fan">
      {zoomed !== null && zf ? (
        <div className="dw-card-fan-zoom">
          <button type="button" className="dw-card-tile dw-card-zoom-tile"
            aria-label={`${zf.label}, enlarged. Tap to return to hand`}
            data-testid="button-card-zoomed" autoFocus onClick={back}
            onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); back(); } }}
            style={{ width: zoom.width, height: zoom.height }}>
            <span className={`dw-card-tile-face${zf.isWild ? " is-wild" : ""}`}><PopupCardFace code={cards[zoomed]} /></span>
          </button>
          <button type="button" className="dw-card-fan-back" data-testid="button-card-back" onClick={back}
            onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); back(); } }}>Back to hand</button>
        </div>
      ) : (
        <div className="dw-card-grid" role="group" aria-label={`${cards.length} cards in hand`}
          style={{ width: L.width, height: L.height }}>
          {cards.map((code, i) => {
            const f = getCardTestFace(code);
            const p = L.cards[i];
            if (!f || !p) return null;
            return (
              <button type="button" key={`${code}-${i}`} ref={el => { tileRefs.current[i] = el; }}
                aria-label={`${f.label}. Enlarge`} data-testid={`button-card-${i}`}
                className="dw-card-tile" onClick={() => setZoomed(i)}
                style={{ width: L.cardW, height: L.cardH, left: p.left, top: p.top }}>
                <span className={`dw-card-tile-face${f.isWild ? " is-wild" : ""}`}><PopupCardFace code={code} /></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
