import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { newChessGame, joinChessGame, applyChessAction, chessBoard } from "./chess-engine";
import { transactChess } from "./chess-service";

test("database: concurrent moves, retries, reload and outsider isolation", async () => {
  const roomId = `chess-test-${randomUUID()}`;
  const white = { accountId: `test-${randomUUID()}`, username: "chess-test-white", displayName: "Chess test white", photoUrl: null };
  const black = { ...white, accountId: `test-${randomUUID()}`, username: "chess-test-black" };
  const game = joinChessGame(newChessGame(roomId, white), black);
  try {
    await pool.query("INSERT INTO chess_rooms (id,game) VALUES ($1,$2::jsonb)", [roomId, JSON.stringify(game)]);
    const operation = () => transactChess(roomId, white.accountId,
      stored => applyChessAction(stored, white.accountId, { action: "move", revision: 1, from: "e2", to: "e4" }));
    const results = await Promise.allSettled(Array.from({ length: 12 }, operation));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 11);
    await assert.rejects(operation, /board changed/);
    const reloaded = await transactChess(roomId, black.accountId);
    assert.equal(reloaded.moves.length, 1);
    assert.equal(chessBoard(reloaded).get("e4")?.type, "p");
    await assert.rejects(() => transactChess(roomId, "test-outsider"), /Only the two/);
  } finally {
    await pool.query("DELETE FROM chess_rooms WHERE id=$1", [roomId]);
    await pool.end();
  }
});
