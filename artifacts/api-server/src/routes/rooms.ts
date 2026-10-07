import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  CreateRoomBody, CreateRoomResponse, GetRoomParams, GetRoomResponse,
  JoinRoomBody, JoinRoomParams, JoinRoomResponse,
  HeartbeatParticipantParams, HeartbeatParticipantResponse,
  LeaveRoomParams, StreamRoomEventsParams,
  ControlRoomMicrophoneParams, ControlRoomMicrophoneBody, ControlRoomMicrophoneResponse,
} from "@workspace/api-zod";
import { roomStore, RoomError } from "../lib/room-store";
import { ensureGuestNameAvailable, requireCompletedProfile } from "../lib/account-profiles";
import { accountId } from "./identity";
import { requireAdult } from "../lib/community";

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(async (req, _res, next) => {
  const match = /^\/rooms\/([^/]+)(?:\/participants\/([^/]+))?/.exec(req.path);
  if (match && roomStore.isCommunity(match[1]!)) {
    const id = accountId(req);
    await requireAdult(id);
    await requireCompletedProfile(id);
    roomStore.requireAccountMember(match[1]!, match[2] ?? req.get("X-Room-Session") ?? "", id);
  }
  next();
});

function displayName(value: string): string {
  const name = value.trim();
  if (!name) throw new RoomError(400, "Display name must not be blank");
  return name;
}

router.post("/rooms", async (req, res) => {
  const body = CreateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Valid university ID and display name are required" });
    return;
  }
  const name = displayName(body.data.displayName);
  await ensureGuestNameAvailable(name);
  res.status(201).json(CreateRoomResponse.parse(roomStore.create(name)));
});

router.get("/rooms/:roomId", (req, res) => {
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid university ID" });
    return;
  }
  res.json(GetRoomResponse.parse(roomStore.get(params.data.roomId)));
});

router.post("/rooms/:roomId/join", async (req, res) => {
  const params = JoinRoomParams.safeParse(req.params);
  const body = JoinRoomBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Valid university ID and display name are required" });
    return;
  }
  const name = displayName(body.data.displayName);
  await ensureGuestNameAvailable(name);
  const session = roomStore.join(params.data.roomId, name);
  res.status(201).json(JoinRoomResponse.parse(session));
});

router.post("/rooms/:roomId/participants/:sessionId/heartbeat", (req, res) => {
  const params = HeartbeatParticipantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid university ID or session ID" });
    return;
  }
  const participant = roomStore.heartbeat(params.data.roomId, params.data.sessionId);
  res.json(HeartbeatParticipantResponse.parse(participant));
});

router.delete("/rooms/:roomId/participants/:sessionId", (req, res) => {
  const params = LeaveRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid university ID or session ID" });
    return;
  }
  roomStore.leave(params.data.roomId, params.data.sessionId);
  res.status(204).end();
});

router.put("/rooms/:roomId/participants/:participantId/microphone", (req, res) => {
  const params = ControlRoomMicrophoneParams.safeParse(req.params);
  const body = ControlRoomMicrophoneBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Invalid microphone action or participant");
  const match = /^Bearer ([0-9a-f-]{36})$/i.exec(req.get("Authorization") ?? "");
  if (!match) throw new RoomError(401, "Private university session credential required");
  const room = roomStore.controlMicrophone(params.data.roomId, match[1]!, params.data.participantId, body.data.action);
  res.json(ControlRoomMicrophoneResponse.parse(room));
});

router.get("/rooms/:roomId/events", (req, res) => {
  const params = StreamRoomEventsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid university ID" });
    return;
  }
  const snapshot = GetRoomResponse.parse(roomStore.get(params.data.roomId));
  // Subscribe before sending headers so capacity failures remain normal JSON errors.
  const unsubscribe = roomStore.subscribe(params.data.roomId, (event) => {
    if (res.destroyed || res.writableEnded) return;
    // This legacy public stream exposes presence only, never private chat.
    // Public roster streams never expose private chat-derived effects.
    if (event.type !== "room.snapshot" && event.type !== "room.expired") return;
    const data = event.type === "room.snapshot" ? GetRoomResponse.parse(event.data) : event.data;
    // Slow consumers are disconnected rather than accumulating unbounded buffers.
    if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy();
    if (event.type === "room.expired") res.end();
  });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: room.snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  const keepalive = setInterval(() => {
    if (!res.write(": keepalive\n\n")) res.destroy();
  }, 15_000);
  keepalive.unref();
  res.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof RoomError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
