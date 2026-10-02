import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { fileURLToPath } from "node:url";
import {
  StreamAudioEventsParams, SendAudioSignalParams, SendAudioSignalBody, DisconnectAudioParams,
} from "@workspace/api-zod";
import { audioSignaling } from "../lib/audio-signaling";
import { RoomError } from "../lib/room-store";

const router: IRouter = Router();
function credential(req: Request): string {
  const match = /^Bearer ([0-9a-f-]{36})$/i.exec(req.get("Authorization") ?? "");
  if (!match) throw new RoomError(401, "Private room session credential required");
  return match[1]!;
}

router.get("/room-audio.js", (_req, res) => {
  res.set("Cache-Control", "no-store");
  // The server bundle and browser SDK are built into the same dist directory.
  res.sendFile(fileURLToPath(new URL("./room-audio.js", import.meta.url)));
});

router.get("/rooms/:roomId/audio/events", (req, res) => {
  const params = StreamAudioEventsParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid room ID");
  const token = credential(req);
  audioSignaling.authorize(params.data.roomId, token);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  let disconnect = () => {};
  const keepalive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded && !res.write(": keepalive\n\n")) res.destroy();
  }, 15_000);
  keepalive.unref();
  res.on("close", () => {
    clearInterval(keepalive);
    disconnect();
  });
  disconnect = audioSignaling.connect(params.data.roomId, token, {
    send(event) {
      if (res.destroyed || res.writableEnded) return;
      if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)) res.destroy();
    },
    close() { res.end(); },
  });
});

router.post("/rooms/:roomId/audio/signals", (req, res) => {
  const params = SendAudioSignalParams.safeParse(req.params);
  const body = SendAudioSignalBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Invalid room ID or signaling message");
  audioSignaling.signal(params.data.roomId, credential(req), body.data);
  res.status(204).end();
});

router.delete("/rooms/:roomId/audio/connections/:connectionId", (req, res) => {
  const params = DisconnectAudioParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Invalid room ID or connection ID");
  audioSignaling.disconnect(params.data.roomId, credential(req), params.data.connectionId);
  res.status(204).end();
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof RoomError && !res.headersSent) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;