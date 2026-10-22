/** Pure geometry for the expanded (profile popup) hand: a non-overlapping 3-over-2 grid. */
export const CARD_ASPECT = 53 / 76; // width / height of uploaded faces
export const MAX_CARD_W = 112; // modest: readable without dominating the popup
export const MIN_CARD_W = 40;
export const GRID_GAP = 10;

export interface GridCardPos { left: number; top: number; row: number; col: number }
export interface HandGridLayout { cardW: number; cardH: number; gap: number; width: number; height: number; rows: number; cards: GridCardPos[] }

/** Rows: 1-3 cards on one row; 4-5 as top row of 3 and bottom row of the rest, each row centred. */
export function getHandGridLayout(count: number, availW: number, availH: number, gap = GRID_GAP): HandGridLayout {
  const n = Math.max(0, Math.min(5, Math.floor(count)));
  if (!n) return { cardW: 0, cardH: 0, gap, width: 0, height: 0, rows: 0, cards: [] };
  const rowCounts = n <= 3 ? [n] : [3, n - 3];
  const cols = rowCounts[0], rows = rowCounts.length;
  const byW = (availW - gap * (cols - 1)) / cols;
  const byH = ((availH - gap * (rows - 1)) / rows) * CARD_ASPECT;
  const cardW = Math.max(MIN_CARD_W, Math.floor(Math.min(byW, byH, MAX_CARD_W)));
  const cardH = Math.floor(cardW / CARD_ASPECT);
  const width = cols * cardW + (cols - 1) * gap;
  const height = rows * cardH + (rows - 1) * gap;
  const cards: GridCardPos[] = [];
  rowCounts.forEach((rc, row) => {
    const rowW = rc * cardW + (rc - 1) * gap, x0 = (width - rowW) / 2;
    for (let col = 0; col < rc; col++) cards.push({ row, col, left: x0 + col * (cardW + gap), top: row * (cardH + gap) });
  });
  return { cardW, cardH, gap, width, height, rows, cards };
}

/** Largest card that fits a box without distortion. */
export function fitCard(availW: number, availH: number) {
  const width = Math.max(MIN_CARD_W, Math.floor(Math.min(availW, availH * CARD_ASPECT)));
  return { width, height: Math.floor(width / CARD_ASPECT) };
}

/** Number ranks render as large rank + suit in the popup (no pip art). */
export const SIMPLE_NUMBER_RANKS = ["3", "4", "5", "6", "7", "8", "9", "10"] as const;
export function isSimpleNumberRank(rank: string) { return (SIMPLE_NUMBER_RANKS as readonly string[]).includes(rank); }
export function isRedSuit(suit: string | null) { return suit === "H" || suit === "D"; }
