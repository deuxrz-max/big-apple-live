import { Chess } from "chess.js";

export type ChessPlayer = { accountId: string; username: string; displayName: string; photoUrl: string | null };
export type ChessMove = { from: string; to: string; promotion?: string };
export type ChessAction = {
  action: "move" | "rematch" | "resign" | "leave"; revision: number;
  from?: string; to?: string; promotion?: string;
};
export type ChessGame = {
  roomId: string; players: { white: ChessPlayer; black: ChessPlayer | null };
  moves: ChessMove[]; revision: number;
  status: "waiting" | "playing" | "checkmate" | "stalemate" | "draw" | "resigned" | "closed";
  result: string | null; rematchRequestedBy: string | null;
};
export class ChessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function chessColor(game: ChessGame, accountId: string): "w" | "b" {
  if (game.players.white.accountId === accountId) return "w";
  if (game.players.black?.accountId === accountId) return "b";
  throw new ChessError(403, "Only the two players can enter this Chess room.");
}
export function chessBoard(game: ChessGame): Chess {
  const board = new Chess();
  for (const move of game.moves) board.move(move);
  return board;
}
export function newChessGame(roomId: string, player: ChessPlayer): ChessGame {
  return { roomId, players: { white: player, black: null }, moves: [], revision: 0,
    status: "waiting", result: null, rematchRequestedBy: null };
}
export function joinChessGame(current: ChessGame, player: ChessPlayer): ChessGame {
  if (current.status === "closed") throw new ChessError(410, "This Chess room has closed.");
  if ([current.players.white.accountId, current.players.black?.accountId].includes(player.accountId)) return current;
  if (current.players.black) throw new ChessError(409, "This Chess room already has two players.");
  return { ...current, players: { ...current.players, black: player }, status: "playing", revision: current.revision + 1 };
}
export function applyChessAction(current: ChessGame, accountId: string, action: ChessAction): ChessGame {
  const color = chessColor(current, accountId);
  if (current.revision !== action.revision) throw new ChessError(409, "The board changed. Please try again.");
  if (current.status === "closed") throw new ChessError(410, "This Chess room has closed.");
  const game = structuredClone(current);
  if (action.action === "leave") {
    game.status = "closed";
    game.result = "A player left. This Chess room is closed.";
  } else if (action.action === "rematch") {
    if (["waiting", "playing"].includes(game.status)) throw new ChessError(409, "Finish this game before a rematch.");
    if (game.rematchRequestedBy && game.rematchRequestedBy !== accountId) {
      game.moves = []; game.result = null; game.status = "playing"; game.rematchRequestedBy = null;
    } else game.rematchRequestedBy = accountId;
  } else if (action.action === "resign") {
    if (game.status !== "playing") throw new ChessError(409, "There is no active game to resign.");
    game.status = "resigned";
    game.result = `${color === "w" ? game.players.black!.displayName : game.players.white.displayName} wins by resignation.`;
  } else {
    if (game.status !== "playing") throw new ChessError(409, "Wait for an active two-player game.");
    const board = chessBoard(game);
    if (board.turn() !== color) throw new ChessError(403, "It is not your turn.");
    if (!action.from || !action.to) throw new ChessError(400, "Choose a piece and a legal destination.");
    // No implicit queen: promotion requires the player's explicit choice.
    const options = board.moves({ verbose: true }).filter(m => m.from === action.from && m.to === action.to);
    if (options.some(m => m.promotion) && !action.promotion) throw new ChessError(400, "Choose a promotion piece.");
    let move;
    try { move = board.move({ from: action.from, to: action.to, promotion: action.promotion }); }
    catch { throw new ChessError(400, "That is not a legal chess move."); }
    game.moves.push({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    if (board.isCheckmate()) {
      game.status = "checkmate";
      game.result = `${color === "w" ? game.players.white.displayName : game.players.black!.displayName} wins by checkmate.`;
    } else if (board.isStalemate()) {
      game.status = "stalemate"; game.result = "Draw by stalemate.";
    } else if (board.isDraw()) {
      game.status = "draw"; game.result = "Draw.";
    }
  }
  game.revision++;
  return game;
}
export function chessSnapshot(game: ChessGame, accountId: string) {
  const yourColor = chessColor(game, accountId);
  const board = chessBoard(game);
  return { roomId: game.roomId, fen: board.fen(), players: game.players,
    turn: board.turn(), status: game.status, revision: game.revision, yourColor,
    result: game.result, rematchRequestedBy: game.rematchRequestedBy, inCheck: board.isCheck(),
    legalMoves: game.status === "playing" && board.turn() === yourColor
      ? board.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })) : [] };
}
