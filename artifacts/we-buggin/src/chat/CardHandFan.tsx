import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getCardTestFace } from "./owner-card-game-test-card-policy";
import { CardFaceImage } from "./CardFaceImage";
import { fitCard, getExpandedFanLayout } from "./card-fan-layout";

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

export const FAN_SHARE = 0.42; // share of expanded height given to the chooser fan; preview fills the rest

function ExpandedFan({ cards }: { cards: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const returnToPreview = useRef(false);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [active, setActive] = useState(cards.length - 1);
  const [zoomed, setZoomed] = useState(false);
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
  useEffect(() => { setActive(cards.length - 1); setZoomed(false); }, [key, cards.length]);
  useEffect(() => {
    if (!zoomed && returnToPreview.current) { previewRef.current?.focus(); returnToPreview.current = false; }
  }, [zoomed]);
  const back = () => { returnToPreview.current = true; setZoomed(false); };
  const faces = cards.map(getCardTestFace);
  const idx = Math.min(Math.max(active, 0), cards.length - 1);
  const face = faces[idx];
  const solo = cards.length === 1;
  const innerW = size.w - 8, innerH = size.h - 8;
  const L = getExpandedFanLayout(cards.length, innerW, solo ? 0 : Math.floor(innerH * FAN_SHARE));
  const preview = fitCard(innerW, solo ? innerH : innerH - L.height - 10);
  const zoom = fitCard(innerW, innerH - 48);
  if (!face) return null;
  return (
    <div ref={box} className="dw-card-fan-xl" data-testid="profile-card-fan">
      {zoomed ? (
        <div className="dw-card-fan-zoom">
          <button type="button" className={`dw-test-card dw-card-fan-zoom-card${face.isWild ? " is-wild" : ""}`}
            aria-label={`${face.label}, enlarged. Tap to return to hand`}
            data-testid="button-card-zoomed" autoFocus onClick={back}
            onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); back(); } }}
            style={{ width: zoom.width, height: zoom.height }}>
            <CardFaceImage code={cards[idx]} />
          </button>
          <button type="button" className="dw-card-fan-back" data-testid="button-card-back" onClick={back}
            onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); back(); } }}>Back to hand</button>
        </div>
      ) : (
        <div className="dw-card-fan-stage">
          <button type="button" ref={previewRef} key={`${cards[idx]}-${idx}`}
            className={`dw-test-card dw-card-fan-preview${face.isWild ? " is-wild" : ""}`}
            aria-label={`Showing ${face.label}. Enlarge`} data-testid="button-card-preview"
            onClick={() => setZoomed(true)}
            style={{ width: preview.width, height: preview.height }}>
            <CardFaceImage code={cards[idx]} />
          </button>
          {!solo && (
            <div className="dw-card-fan-xl-row" role="group" aria-label={`${cards.length} cards in hand. Choose a card to show`}
              style={{ width: L.width, height: L.height }}>
              {cards.map((code, i) => {
                const f = faces[i];
                if (!f) return null;
                const p = L.cards[i];
                const on = i === idx;
                return (
                  <button type="button" key={`${code}-${i}`} aria-pressed={on} aria-label={`Show ${f.label}`}
                    data-testid={`button-card-${i}`}
                    className={`dw-test-card dw-card-fan-xl-card${f.isWild ? " is-wild" : ""}${on ? " is-selected" : ""}`}
                    onClick={() => setActive(i)}
                    style={{ width: L.cardW, height: L.cardH, left: p.left, top: p.top, zIndex: i + 1,
                      "--fan-angle": `${p.angle}deg` } as CSSProperties}>
                    <CardFaceImage code={code} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
