import type { PieceCode } from "./chess-logic";

const SHAPES: Record<PieceCode["type"], string> = {
  p: "M50 22a11 11 0 1 1 0 22a11 11 0 1 1 0-22ZM40 46h20l5 24H35ZM28 72h44l4 12H24Z",
  r: "M30 20h8v8h8v-8h8v8h8v-8h8v16l-6 4v28h-36V40l-6-4ZM26 72h48l4 12H22Z",
  n: "M36 70c0-14 6-22 12-28l-16 4c-4-2-4-6-2-9l14-12c2-6 8-9 16-8 12 2 16 14 16 26 0 12-4 20-4 27ZM26 72h50l4 12H22Z",
  b: "M50 12a5 5 0 1 1 0 10a5 5 0 1 1 0-10ZM50 22c12 8 16 18 14 28-2 6-6 10-6 14h-16c0-4-4-8-6-14-2-10 2-20 14-28ZM36 66h28l4 6H32ZM26 74h48l4 10H22Z",
  q: "M22 30a5 5 0 1 1 0 .1ZM36 22a5 5 0 1 1 0 .1ZM50 18a5 5 0 1 1 0 .1ZM64 22a5 5 0 1 1 0 .1ZM78 30a5 5 0 1 1 0 .1ZM22 32l12 34h32l12-34-14 14-6-24-8 24-8-24-6 24ZM30 68h40l4 6H26ZM24 76h52l4 8H20Z",
  k: "M47 8h6v7h7v6h-7v7h-6v-7h-7v-6h7ZM50 30c16 0 26 8 24 18-2 8-8 12-10 18H36c-2-6-8-10-10-18-2-10 8-18 24-18ZM32 68h36l4 6H28ZM24 76h52l4 8H20Z",
};

export function ChessPiece({ piece, size = "100%" }: { piece: PieceCode; size?: string | number }) {
  const id = `cp-${piece.color}`;
  return <svg viewBox="0 0 100 100" width={size} height={size} className={`chess-piece is-${piece.color}`} aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
        {piece.color === "w"
          ? <><stop offset="0" stopColor="hsl(40 60% 98%)" /><stop offset=".55" stopColor="hsl(38 30% 84%)" /><stop offset="1" stopColor="hsl(32 22% 62%)" /></>
          : <><stop offset="0" stopColor="hsl(30 10% 34%)" /><stop offset=".5" stopColor="hsl(28 14% 12%)" /><stop offset="1" stopColor="hsl(24 20% 5%)" /></>}
      </linearGradient>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="hsl(46 92% 72%)" /><stop offset=".5" stopColor="hsl(40 78% 48%)" /><stop offset="1" stopColor="hsl(34 70% 30%)" />
      </linearGradient>
      <radialGradient id={`${id}-gloss`} cx=".35" cy=".25" r=".5">
        <stop offset="0" stopColor="white" stopOpacity={piece.color === "w" ? .85 : .35} /><stop offset="1" stopColor="white" stopOpacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="50" cy="88" rx="30" ry="5" fill="hsl(20 40% 4% / .45)" />
    <path d={SHAPES[piece.type]} fill={`url(#${id}-body)`} stroke={`url(#${id}-gold)`} strokeWidth="2.6" strokeLinejoin="round" />
    <path d={SHAPES[piece.type]} fill={`url(#${id}-gloss)`} />
    <rect x="22" y="80" width="56" height="3" rx="1" fill={`url(#${id}-gold)`} />
  </svg>;
}
