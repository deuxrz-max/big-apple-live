import { getCardTestFace } from "./owner-card-game-test-card-policy";

/** One source for every face; card backs and the logo deck are unchanged. */
export function CardFaceImage({ code }: { code: string }) {
  const face = getCardTestFace(code);
  if (!face) return null;
  return (
    <span className={`dw-card-face-neon${face.suit ? "" : " is-joker"}`} data-suit={face.suitName || undefined}>
      <img className="dw-card-face-image"
        src={`${import.meta.env.BASE_URL}${face.imagePath}`}
        alt={face.label} draggable={false} />
      {face.suit && <>
        <span className="dw-card-neon-corner dw-card-neon-corner-top" aria-hidden="true"><b>{face.rank}</b><i>{face.symbol}</i></span>
        <span className="dw-card-neon-corner dw-card-neon-corner-bottom" aria-hidden="true"><b>{face.rank}</b><i>{face.symbol}</i></span>
      </>}
      {face.rank === "A" && <span className="dw-card-ace-brand" aria-hidden="true">BIG APPLE LIVE</span>}
    </span>
  );
}
