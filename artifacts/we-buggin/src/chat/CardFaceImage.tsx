import { getCardTestFace } from "./owner-card-game-test-card-policy";

/** One source for every face; card backs and the logo deck are unchanged. */
export function CardFaceImage({ code }: { code: string }) {
  const face = getCardTestFace(code);
  if (!face) return null;
  return <img className="dw-card-face-image"
    src={`${import.meta.env.BASE_URL}${face.imagePath}`}
    alt={face.label} draggable={false} />;
}
