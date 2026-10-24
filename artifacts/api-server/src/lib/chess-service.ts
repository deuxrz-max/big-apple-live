import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getProfile, requireCompletedProfile } from "./account-profiles";
import { visibleProfilePhotos } from "./photo-visibility";
import { nameColorProfilesForAccounts } from "./social/gift-name-color-data";
import { assertRoomAccessAllowed } from "./room-moderation";
import { ChessError, newChessGame, chessSnapshot, type ChessGame, type ChessPlayer } from "./chess-engine";

export async function chessPlayer(accountId: string): Promise<ChessPlayer> {
  const profile = await requireCompletedProfile(accountId);
  return { accountId, username: profile.username, displayName: profile.displayName || profile.username, photoUrl: null };
}
export async function createChess(accountId: string) {
  const id = randomUUID();
  const game = newChessGame(id, await chessPlayer(accountId));
  await pool.query("INSERT INTO chess_rooms (id, game) VALUES ($1, $2::jsonb)", [id, JSON.stringify(game)]);
  return projectChess(game, accountId);
}
/** PostgreSQL row locks serialize joins, moves and rematches across API processes. */
export async function transactChess(id: string, accountId: string, update?: (game: ChessGame) => ChessGame) {
  const preview = await pool.query<{ game: ChessGame }>("SELECT game FROM chess_rooms WHERE id=$1", [id]);
  const room = preview.rows[0]?.game;
  if (!room) throw new ChessError(404, "Chess room not found.");
  // Moderation uses the shared pool. Check before reserving a transaction client
  // so concurrent polls cannot exhaust the pool while waiting on one another.
  await assertRoomAccessAllowed({ type: "community", key: `chess:${id}`, hostAccountId: room.players.white.accountId }, accountId);
  const client = await pool.connect();
  let game: ChessGame;
  try {
    await client.query("BEGIN");
    const rows = await client.query<{ game: ChessGame }>("SELECT game FROM chess_rooms WHERE id=$1 FOR UPDATE", [id]);
    const stored = rows.rows[0]?.game;
    if (!stored) throw new ChessError(404, "Chess room not found.");
    game = update ? update(stored) : stored;
    // Authorize reads too: no spectators or private board access by a third account.
    chessSnapshot(game, accountId);
    if (update) await client.query("UPDATE chess_rooms SET game=$2::jsonb, updated_at=now() WHERE id=$1", [id, JSON.stringify(game)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return game!;
}
export async function projectChess(game: ChessGame, viewerId: string) {
  const snapshot = chessSnapshot(game, viewerId);
  const levels = await nameColorProfilesForAccounts(
    Object.values(snapshot.players).filter((p): p is ChessPlayer => !!p).map(p => p.accountId),
  );
  for (const side of ["white", "black"] as const) {
    const player = snapshot.players[side];
    if (!player) continue;
    const profile = await getProfile(player.accountId);
    // The carousel, like the Me-page hero, shows only approved saved photos.
    // Never expose pending photos to another player (or through persisted game data).
    const photos = await visibleProfilePhotos(player.accountId, undefined, {
      photoUrl: profile?.photoUrl ?? null, photoUrls: profile?.photoUrls,
    });
    const orderedPhotos = photos.photoUrl
      ? [photos.photoUrl, ...photos.photoUrls.filter(url => url !== photos.photoUrl)]
      : photos.photoUrls;
    snapshot.players = { ...snapshot.players, [side]: {
      ...player, displayName: profile?.displayName || player.displayName,
      photoUrl: photos.photoUrl, photoUrls: orderedPhotos,
      giftingLevel: levels.get(player.accountId)?.tierIndex ?? 0,
    } };
  }
  return snapshot;
}
