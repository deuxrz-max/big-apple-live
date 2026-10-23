import { Chess } from "chess.js";

export type PieceCode = { type: "p" | "n" | "b" | "r" | "q" | "k"; color: "w" | "b" };
export type BoardCell = { square: string; piece: PieceCode | null; dark: boolean };
export type LegalMove = { from: string; to: string; promotion?: string };

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Fixed orientation: white pieces at TOP (rank 1 first row), files h..a so the board is a true rotation. */
export function boardCells(fen: string): BoardCell[] {
  let grid: ReturnType<Chess["board"]>;
  try { grid = new Chess(fen).board(); } catch { grid = new Chess().board(); }
  const cells: BoardCell[] = [];
  for (let rank = 1; rank <= 8; rank++) {
    for (let f = 7; f >= 0; f--) {
      const row = grid[8 - rank];
      const p = row?.[f] ?? null;
      cells.push({ square: `${FILES[f]}${rank}`, piece: p ? { type: p.type, color: p.color } : null, dark: (f + rank) % 2 === 1 });
    }
  }
  return cells;
}

export function movesFrom(moves: LegalMove[], from: string) { return moves.filter(m => m.from === from); }
export function selectableSquares(moves: LegalMove[]) { return new Set(moves.map(m => m.from)); }
export function needsPromotion(moves: LegalMove[], from: string, to: string) {
  return moves.some(m => m.from === from && m.to === to && Boolean(m.promotion));
}
export function isLegal(moves: LegalMove[], from: string, to: string, promotion?: string) {
  return moves.some(m => m.from === from && m.to === to && (!m.promotion || m.promotion === promotion));
}
export const FINISHED = new Set(["checkmate", "stalemate", "draw", "resigned"]);
export function resultTitle(status: string, result: string | null, yourColor: "w" | "b") {
  const text = (result ?? "").toLowerCase();
  const winner = /white wins|^1-0/.test(text) ? "w" : /black wins|^0-1/.test(text) ? "b" : null;
  if (winner) return winner === yourColor ? "You won" : "You lost";
  if (status === "stalemate") return "Stalemate";
  if (status === "draw") return "Drawn game";
  return "Game over";
}
