import { Router, type IRouter } from "express";
import {
  GetRoomMessagesParams, GetRoomMessagesResponse, SendRoomMessageBody, SendRoomMessageResponse,
  StreamAccountRoomEventsParams, GetRoomResponse,
  GetOlderRoomMessagesParams,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { roomStore, RoomError } from "../lib/room-store";
import { acceptMessage, getMessages } from "../lib/room-chat";
import { pairBlocked } from "../lib/social/core";
import { requireAdult } from "../lib/community";
import { isIgnored } from "../lib/university-chat";

const router: IRouter = Router();
router.get("/account/rooms/:roomId/history/:beforeId", async (req, res) => {
  const params = GetOlderRoomMessagesParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid history cursor");
  const id = accountId(req);
  roomStore.requireAccountMember(params.data.roomId, req.get("X-Room-Session") ?? "", id);
  res.set("Cache-Control", "no-store");
  res.json(GetRoomMessagesResponse.parse(await getMessages(params.data.roomId, roomStore, id, params.data.beforeId)));
});
router.get("/account/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = GetRoomMessagesParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid university code");
  roomStore.requireAccountMember(params.data.roomId, req.get("X-Room-Session") ?? "", accountId(req));
  res.set("Cache-Control", "no-store");
  res.json(GetRoomMessagesResponse.parse(await getMessages(params.data.roomId, roomStore, accountId(req))));
});
router.post("/account/rooms/:roomId/messages", async (req, res): Promise<void> => {
  sameOrigin(req);
  const params = GetRoomMessagesParams.safeParse(req.params);
  const body = SendRoomMessageBody.safeParse(req.body);
  // Explicit allow-list even if generated validation strips additional fields.
  if (!params.success || !body.success || Object.keys(req.body).some(key => key !== "kind" && key !== "text")) {
    throw new RoomError(400, "Send only text and kind; the server selects the sender");
  }
  const accepted = await acceptMessage(params.data.roomId, req.get("X-Room-Session") ?? "", accountId(req), body.data);
  res.set("Cache-Control", "no-store");
  res.status(201).json(SendRoomMessageResponse.parse(accepted));
});
router.get("/account/rooms/:roomId/events", (req, res): void => {
  const params = StreamAccountRoomEventsParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid university code");
  const roomId = params.data.roomId;
  const sessionId = req.get("X-Room-Session") ?? "";
  const id = accountId(req);
  roomStore.requireAccountMember(roomId, sessionId, id);
  const unsubscribe = roomStore.subscribe(roomId, (event) => {
    void (async () => {
    if (res.destroyed || res.writableEnded) return;
    // Removed/expired sessions cannot continue receiving private chat.
    try { roomStore.requireAccountMember(roomId, sessionId, id); }
    catch { res.end(); return; }
    try { await requireAdult(id); } catch { res.end(); return; }
    if (event.type === "chat.accepted" && event.senderAccountId
      && (await pairBlocked(id, event.senderAccountId) || await isIgnored(id, event.senderAccountId))) return;
    if (res.destroyed || res.writableEnded) return;
    try { roomStore.requireAccountMember(roomId, sessionId, id); }
    catch { res.end(); return; }
    const data = event.type === "room.snapshot" ? GetRoomResponse.parse(event.data)
      : event.type === "chat.accepted" ? SendRoomMessageResponse.parse(event.data) : event.data;
    if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy();
    })().catch(error => { req.log.error({ error }, "Room event delivery failed"); res.destroy(); });
  });
  res.set({
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: room.snapshot\ndata: ${JSON.stringify(GetRoomResponse.parse(roomStore.get(roomId)))}\n\n`);
  const keepalive = setInterval(() => {
    void requireAdult(id).catch(() => res.end());
    try { roomStore.requireAccountMember(roomId, sessionId, id); }
    catch { res.end(); return; }
    if (!res.write(": keepalive\n\n")) res.destroy();
  }, 15_000);
  keepalive.unref();
  res.on("close", () => { clearInterval(keepalive); unsubscribe(); });
});
export default router;