import { Router } from "express";
import { ActChessRoomBody, CreateChessRoomResponse, GetChessRoomResponse, ConnectChessAudioResponse } from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { ChessError, applyChessAction, joinChessGame } from "../lib/chess-engine";
import { chessPlayer, createChess, transactChess, projectChess } from "../lib/chess-service";
import { liveKitBeamService } from "../lib/livekit";

const router = Router();
const path = "/social/chess/rooms";
router.post(path, async (req, res) => {
  sameOrigin(req);
  res.status(201).json(CreateChessRoomResponse.parse(await createChess(accountId(req))));
});
router.get(`${path}/:chessRoomId`, async (req, res) => {
  const id = accountId(req);
  const game = await transactChess(req.params.chessRoomId, id);
  res.set("Cache-Control", "no-store").json(GetChessRoomResponse.parse(await projectChess(game, id)));
});
router.post(`${path}/:chessRoomId/join`, async (req, res) => {
  sameOrigin(req);
  const id = accountId(req), player = await chessPlayer(id);
  const game = await transactChess(req.params.chessRoomId, id, stored => joinChessGame(stored, player));
  res.json(GetChessRoomResponse.parse(await projectChess(game, id)));
});
router.post(`${path}/:chessRoomId/actions`, async (req, res) => {
  sameOrigin(req);
  const parsed = ActChessRoomBody.safeParse(req.body);
  if (!parsed.success) throw new ChessError(400, "Choose a valid Chess action.");
  const id = accountId(req);
  const game = await transactChess(req.params.chessRoomId, id, stored => applyChessAction(stored, id, parsed.data));
  if (parsed.data.action === "leave") {
    // A closed room also closes its voice session, not just the board.
    await Promise.allSettled([game.players.white, game.players.black].filter(Boolean).map(player =>
      liveKitBeamService.removeParticipant(`chess-${game.roomId}`, player!.accountId)));
  }
  res.json(GetChessRoomResponse.parse(await projectChess(game, id)));
});
router.post(`${path}/:chessRoomId/audio`, async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const game = await transactChess(req.params.chessRoomId, id);
  if (game.status === "closed") throw new ChessError(410, "This Chess room has closed.");
  const player = game.players.white.accountId === id ? game.players.white : game.players.black!;
  res.json(ConnectChessAudioResponse.parse(await liveKitBeamService.createChessToken({
    roomName: `chess-${game.roomId}`, participantId: id, displayName: player.displayName,
  })));
});
export default router;
