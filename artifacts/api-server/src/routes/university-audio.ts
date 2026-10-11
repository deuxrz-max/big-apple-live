import { Router, type Request } from "express";
import {
  GetUniversityAudioStateResponse,
  PerformUniversityAudioActionBody,
  PerformUniversityAudioActionResponse,
  SendUniversityAudioSignalBody,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { universityAudioBeamStore } from "../lib/university-audio-beam";
import { universityAudioSignaling } from "../lib/university-audio-signaling";
import { requireAdult } from "../lib/community";

const router = Router();

function requireMember(req: Request, roomId: string, id: string) {
  const sessionId = req.get("X-Room-Session") ?? "";
  roomStore.requireAccountMember(roomId, sessionId, id);
  return sessionId;
}

router.get("/account/rooms/:roomId/audio", async (req, res) => {
  const id = accountId(req);
  const sessionId = requireMember(req, req.params.roomId, id);
  res.set("Cache-Control", "no-store");
  const state = universityAudioBeamStore.getState(req.params.roomId);
  res.json(GetUniversityAudioStateResponse.parse(state));
});

router.post("/account/rooms/:roomId/audio/actions", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const sessionId = requireMember(req, req.params.roomId, id);
  const parsed = PerformUniversityAudioActionBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).some(key => !["action", "targetParticipantId"].includes(key))) {
    throw new RoomError(400, "Choose a valid audio action.");
  }
  const participant = roomStore.requireAccountMember(req.params.roomId, sessionId, id);
  let state;
  switch (parsed.data.action) {
    case "join-slot":
      state = universityAudioBeamStore.joinSlot(req.params.roomId, participant.participantId, id);
      break;
    case "leave-slot":
      state = universityAudioBeamStore.leaveSlot(req.params.roomId, participant.participantId);
      break;
    case "mute-self":
      state = universityAudioBeamStore.setOwnMicrophone(req.params.roomId, participant.participantId, false);
      break;
    case "unmute-self":
      state = universityAudioBeamStore.setOwnMicrophone(req.params.roomId, participant.participantId, true);
      break;
    case "host-mute":
    case "host-unmute":
      if (!parsed.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
      state = universityAudioBeamStore.hostMute(
        req.params.roomId, participant.participantId, parsed.data.targetParticipantId,
        parsed.data.action === "host-mute",
      );
      break;
    case "kick": {
      if (!parsed.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
      const result = universityAudioBeamStore.kick(
        req.params.roomId, participant.participantId, parsed.data.targetParticipantId,
      );
      roomStore.leaveParticipant(req.params.roomId, parsed.data.targetParticipantId);
      state = result.state;
      break;
    }
  }
  res.set("Cache-Control", "no-store").json(PerformUniversityAudioActionResponse.parse(state));
});

router.get("/account/rooms/:roomId/audio/events", async (req, res) => {
  const id = accountId(req);
  const roomId = req.params.roomId;
  const sessionId = requireMember(req, roomId, id);
  await requireAdult(id);

  let ready = false;
  let closed = false;
  const pending: string[] = [];
  const write = (frame: string) => {
    if (closed || res.destroyed || res.writableEnded) return;
    if (!ready) { pending.push(frame); return; }
    if (!res.write(frame)) res.destroy();
  };
  const disconnect = universityAudioSignaling.connect(roomId, sessionId, id, {
    send(event) { write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`); },
    close() { if (!res.writableEnded) res.end(); },
  });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  ready = true;
  for (const frame of pending.splice(0)) write(frame);
  const keepalive = setInterval(() => {
    void requireAdult(id).catch(() => res.end());
    try { roomStore.requireAccountMember(roomId, sessionId, id); }
    catch { res.end(); return; }
    if (!res.write(": keepalive\n\n")) res.destroy();
  }, 15_000);
  keepalive.unref();
  res.on("close", () => {
    closed = true;
    clearInterval(keepalive);
    disconnect();
  });
});

router.post("/account/rooms/:roomId/audio/signals", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const sessionId = requireMember(req, req.params.roomId, id);
  const input = SendUniversityAudioSignalBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Invalid peer audio signal.");
  universityAudioSignaling.signal(req.params.roomId, sessionId, id, input.data);
  res.status(204).end();
});

router.delete("/account/rooms/:roomId/audio/connections/:connectionId", async (req, res) => {
  const id = accountId(req);
  const sessionId = requireMember(req, req.params.roomId, id);
  universityAudioSignaling.disconnect(req.params.roomId, sessionId, id, req.params.connectionId);
  res.status(204).end();
});

export default router;
