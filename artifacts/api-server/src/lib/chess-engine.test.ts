import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { CreateChessRoomResponse } from "@workspace/api-zod";
import { applyChessAction, chessSnapshot, chessBoard, joinChessGame, newChessGame, type ChessGame } from "./chess-engine";

const white = { accountId: "chess-test-white", username: "white", displayName: "White", photoUrl: null };
const black = { accountId: "chess-test-black", username: "black", displayName: "Black", photoUrl: null };
function ready() { return joinChessGame(newChessGame("test-room", white), black); }
function move(game: ChessGame, from: string, to: string, promotion?: string) {
  const id = chessBoard(game).turn() === "w" ? white.accountId : black.accountId;
  return applyChessAction(game, id, { action: "move", revision: game.revision, from, to, promotion });
}
test("exactly two players; reconnect idempotent; no audience", () => {
  const game = ready();
  assert.equal(joinChessGame(game, black), game);
  assert.throws(() => joinChessGame(game, { ...black, accountId: "outsider" }), /two players/);
  assert.throws(() => chessSnapshot(game, "outsider"), /Only the two/);
});
test("a waiting player cannot move", () => {
  const game = newChessGame("test", white);
  assert.equal(CreateChessRoomResponse.parse(chessSnapshot(game, white.accountId)).players.black, null);
  assert.deepEqual(chessSnapshot(game, white.accountId).legalMoves, []);
  assert.throws(() => move(game, "e2", "e4"), /Wait for/);
});
test("legal moves, illegal moves, turn checks, and stale revisions", () => {
  const game = ready();
  assert.equal(chessSnapshot(game, white.accountId).legalMoves.length, 20);
  assert.equal(chessSnapshot(game, black.accountId).legalMoves.length, 0);
  assert.throws(() => applyChessAction(game, black.accountId, { action: "move", revision: 1, from: "e7", to: "e5" }), /not your turn/);
  assert.throws(() => move(game, "e2", "e5"), /not a legal/);
  const next = move(game, "e2", "e4");
  assert.equal(chessSnapshot(next, black.accountId).turn, "b");
  assert.throws(() => applyChessAction(next, white.accountId, { action: "move", revision: 1, from: "d2", to: "d4" }), /board changed/);
  assert.equal(game.moves.length, 0);
});
test("checkmate result and mutual rematch; no unilateral reset", () => {
  let game = ready();
  for (const [from, to] of [["f2","f3"],["e7","e5"],["g2","g4"],["d8","h4"]]) game = move(game, from!, to!);
  assert.equal(game.status, "checkmate");
  assert.equal(chessSnapshot(game, white.accountId).inCheck, true);
  assert.match(game.result!, /Black wins by checkmate/);
  game = applyChessAction(game, white.accountId, { action: "rematch", revision: game.revision });
  assert.equal(game.status, "checkmate");
  game = applyChessAction(game, black.accountId, { action: "rematch", revision: game.revision });
  assert.equal(game.status, "playing");
  assert.equal(game.moves.length, 0);
});
test("castling moves both king and rook", () => {
  let game = ready();
  for (const [from,to] of [["e2","e4"],["e7","e5"],["g1","f3"],["b8","c6"],["f1","c4"],["g8","f6"],["e1","g1"]]) game = move(game, from!, to!);
  assert.equal(chessBoard(game).get("g1")?.type, "k");
  assert.equal(chessBoard(game).get("f1")?.type, "r");
});
test("en passant removes the captured pawn", () => {
  let game = ready();
  for (const [from,to] of [["e2","e4"],["a7","a6"],["e4","e5"],["d7","d5"],["e5","d6"]]) game = move(game, from!, to!);
  assert.equal(chessBoard(game).get("d6")?.color, "w");
  assert.equal(chessBoard(game).get("d5"), undefined);
});
test("pawn promotion choices include queen rook bishop knight", () => {
  const board = new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1");
  assert.deepEqual(board.moves({ verbose: true }).filter(m => m.from === "a7").map(m => m.promotion).sort(), ["b","n","q","r"]);
  board.move({ from: "a7", to: "a8", promotion: "n" });
  assert.equal(board.get("a8")?.type, "n");
});
test("engine requires explicit promotion and preserves the chosen underpromotion", () => {
  let game = ready();
  for (const [from,to] of [["a2","a4"],["h7","h5"],["a4","a5"],["h5","h4"],["a5","a6"],["h4","h3"],["a6","b7"],["h3","g2"]]) game = move(game, from!, to!);
  assert.throws(() => move(game, "b7", "a8"), /Choose a promotion/);
  game = move(game, "b7", "a8", "n");
  assert.equal(chessBoard(game).get("a8")?.type, "n");
});
test("cannot castle through check; fifty-move rule draws", () => {
  const attacked = new Chess("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1");
  assert.equal(attacked.moves({ verbose: true }).some(m => m.from === "e1" && m.to === "g1"), false);
  const board = new Chess("7k/8/8/8/8/8/R7/K7 w - - 99 50");
  board.move({ from: "a2", to: "b2" });
  assert.equal(board.isDrawByFiftyMoves(), true);
});
test("stalemate and insufficient material are draws, not checkmate", () => {
  const stalemate = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(stalemate.isStalemate(), true);
  assert.equal(stalemate.isCheckmate(), false);
  assert.equal(new Chess("7k/8/8/8/8/8/8/K7 w - - 0 1").isInsufficientMaterial(), true);
});
test("threefold repetition persists through saved move history", () => {
  let game = ready();
  for (let i=0;i<2;i++) for (const [from,to] of [["g1","f3"],["g8","f6"],["f3","g1"],["f6","g8"]]) game = move(game, from!, to!);
  assert.equal(game.status, "draw");
  const restored = JSON.parse(JSON.stringify(game));
  assert.equal(chessBoard(restored).isThreefoldRepetition(), true);
  assert.deepEqual(chessSnapshot(restored, white.accountId), chessSnapshot(game, white.accountId));
});
test("resignation and leaving close play, never rewards", () => {
  const game = ready();
  assert.throws(() => applyChessAction(game, white.accountId, { action: "rematch", revision: 1 }), /Finish/);
  const resigned = applyChessAction(game, white.accountId, { action: "resign", revision: 1 });
  assert.match(resigned.result!, /Black wins by resignation/);
  const closed = applyChessAction(resigned, black.accountId, { action: "leave", revision: 2 });
  assert.equal(closed.status, "closed");
  assert.throws(() => joinChessGame(closed, black), /closed/);
  assert.deepEqual(chessSnapshot(closed, black.accountId).legalMoves, []);
});
