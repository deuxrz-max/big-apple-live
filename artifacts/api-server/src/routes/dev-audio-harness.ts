import { createHash, randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import {
  PerformUniversityAudioActionBody,
  SendUniversityAudioSignalBody,
} from "@workspace/api-zod";
import { accountProfiles, db } from "@workspace/db";
import { requireCompletedProfile } from "../lib/account-profiles";
import { requireAdult } from "../lib/community";
import { devAudioHarnessEnabled, DEV_AUDIO_HARNESS_ROOM, DEV_AUDIO_HARNESS_SESSION_TTL_MS, mayDriveDevAudioAccount } from "../lib/dev-audio-harness-policy";
import { RoomError, roomStore } from "../lib/room-store";
import { universityAudioBeamStore } from "../lib/university-audio-beam";
import { universityAudioSignaling } from "../lib/university-audio-signaling";
import { sameOrigin } from "./identity";

type HarnessActor = {
  tokenHash: string;
  accountId: string;
  username: string;
  displayName: string;
  participantId: string;
  participantSessionId: string;
  expiresAt: number;
};

const router = Router();
const actorsByToken = new Map<string, HarnessActor>();
const tokenHashForAccount = new Map<string, string>();
const creatingAccounts = new Set<string>();
const HarnessActionBody = PerformUniversityAudioActionBody.strict();

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

function ensureTestRoom() {
  const { roomId, historyId, label } = DEV_AUDIO_HARNESS_ROOM;
  if (!roomStore.isCommunity(roomId)) {
    roomStore.registerCommunity({
      roomId, historyId, label, createdAt: new Date(), testOnly: true,
    });
  }
}

function assertDevOnly() {
  if (!devAudioHarnessEnabled(process.env.NODE_ENV))
    throw new RoomError(404, "Not found");
}

function forgetActor(actor: HarnessActor) {
  actorsByToken.delete(actor.tokenHash);
  if (tokenHashForAccount.get(actor.accountId) === actor.tokenHash)
    tokenHashForAccount.delete(actor.accountId);
}

function releaseActor(actor: HarnessActor) {
  try { universityAudioBeamStore.leaveSlot(DEV_AUDIO_HARNESS_ROOM.roomId, actor.participantId); } catch {}
  try { roomStore.leave(DEV_AUDIO_HARNESS_ROOM.roomId, actor.participantSessionId); } catch {}
  forgetActor(actor);
}

function removeActorForParticipant(participantId: string) {
  const actor = [...actorsByToken.values()].find(value => value.participantId === participantId);
  if (actor) forgetActor(actor);
}

async function requireActor(req: Request, roomId: string = DEV_AUDIO_HARNESS_ROOM.roomId): Promise<HarnessActor> {
  assertDevOnly();
  if (roomId.toUpperCase() !== DEV_AUDIO_HARNESS_ROOM.roomId)
    throw new RoomError(404, "Test audio room not found");

  const token = req.get("X-Room-Session") ?? "";
  if (!token || token.length > 160) throw new RoomError(401, "Connect a marked test account to the preview audio lab");
  const actor = actorsByToken.get(digest(token));
  if (!actor) throw new RoomError(401, "The preview audio session expired; connect again");
  if (actor.expiresAt <= Date.now()) {
    releaseActor(actor);
    throw new RoomError(401, "The preview audio session expired; connect again");
  }
  const [row] = await db.select({ isTestAccount: accountProfiles.isTestAccount })
    .from(accountProfiles).where(eq(accountProfiles.accountId, actor.accountId)).limit(1);
  if (!mayDriveDevAudioAccount(row)) {
    releaseActor(actor);
    throw new RoomError(403, "Only accounts marked as test accounts can use the preview audio lab");
  }
  roomStore.requireAccountMember(roomId, actor.participantSessionId, actor.accountId);
  actor.expiresAt = Date.now() + DEV_AUDIO_HARNESS_SESSION_TTL_MS;
  return actor;
}

function assertSameOrigin(req: Request) {
  assertDevOnly();
  if (!req.get("origin")) throw new RoomError(403, "Browser origin is required for preview test actions");
  sameOrigin(req);
}

function stateForClient() {
  const room = roomStore.get(DEV_AUDIO_HARNESS_ROOM.roomId);
  const names = new Map([...actorsByToken.values()].map(actor => [
    actor.participantId, { username: actor.username, displayName: actor.displayName },
  ]));
  return {
    room: { roomId: DEV_AUDIO_HARNESS_ROOM.roomId, label: DEV_AUDIO_HARNESS_ROOM.label },
    people: room.participants.flatMap(person => {
      const actor = names.get(person.participantId);
      return actor ? [{
        participantId: person.participantId,
        username: actor.username,
        displayName: actor.displayName,
      }] : [];
    }),
    beam: universityAudioBeamStore.getState(DEV_AUDIO_HARNESS_ROOM.roomId),
  };
}

router.get("/accounts", async (_req, res) => {
  assertDevOnly();
  const rows = await db.select({
    username: accountProfiles.username,
    displayName: accountProfiles.displayName,
    isTestAccount: accountProfiles.isTestAccount,
  }).from(accountProfiles).where(eq(accountProfiles.isTestAccount, true)).orderBy(accountProfiles.nameKey);
  res.set("Cache-Control", "no-store").json({
    accounts: rows.filter(mayDriveDevAudioAccount).map(row => ({
      username: row.username,
      displayName: row.displayName ?? row.username,
    })),
  });
});

router.post("/session", async (req, res) => {
  assertSameOrigin(req);
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)
    || Object.keys(req.body ?? {}).some(key => key !== "username"))
    throw new RoomError(400, "Choose a valid marked test account");
  const nameKey = username.toLowerCase();
  const [row] = await db.select({
    accountId: accountProfiles.accountId,
    username: accountProfiles.username,
    displayName: accountProfiles.displayName,
    isTestAccount: accountProfiles.isTestAccount,
  }).from(accountProfiles).where(eq(accountProfiles.nameKey, nameKey)).limit(1);
  if (!mayDriveDevAudioAccount(row)) throw new RoomError(404, "Marked test account not found");
  if (creatingAccounts.has(row.accountId) || tokenHashForAccount.has(row.accountId))
    throw new RoomError(409, "This test account is already connected to the preview audio lab");

  creatingAccounts.add(row.accountId);
  try {
    await requireAdult(row.accountId);
    const profile = await requireCompletedProfile(row.accountId);
    ensureTestRoom();
    universityAudioBeamStore.assertCanJoin(DEV_AUDIO_HARNESS_ROOM.roomId, row.accountId);
    const joined = roomStore.join(DEV_AUDIO_HARNESS_ROOM.roomId, profile.displayName ?? profile.username, {
      accountId: row.accountId, identity: profile.identity, capExempt: false, displayNameColor: "#FFFFFF",
    });
    const token = randomBytes(32).toString("base64url");
    const tokenHash = digest(token);
    const actor: HarnessActor = {
      tokenHash,
      accountId: row.accountId,
      username: row.username,
      displayName: row.displayName ?? row.username,
      participantId: joined.participantId,
      participantSessionId: joined.participantSessionId,
      expiresAt: Date.now() + DEV_AUDIO_HARNESS_SESSION_TTL_MS,
    };
    actorsByToken.set(tokenHash, actor);
    tokenHashForAccount.set(row.accountId, tokenHash);
    res.set("Cache-Control", "no-store").status(201).json({
      sessionToken: token,
      participantId: actor.participantId,
      username: actor.username,
      displayName: actor.displayName,
      room: { roomId: DEV_AUDIO_HARNESS_ROOM.roomId, label: DEV_AUDIO_HARNESS_ROOM.label },
      expiresInSeconds: Math.floor(DEV_AUDIO_HARNESS_SESSION_TTL_MS / 1000),
    });
  } catch (error) {
    if (tokenHashForAccount.has(row.accountId)) {
      const actor = actorsByToken.get(tokenHashForAccount.get(row.accountId)!);
      if (actor) releaseActor(actor);
    }
    throw error;
  } finally {
    creatingAccounts.delete(row.accountId);
  }
});

router.delete("/session", async (req, res) => {
  assertSameOrigin(req);
  const actor = await requireActor(req);
  releaseActor(actor);
  res.status(204).end();
});

router.post("/heartbeat", async (req, res) => {
  assertSameOrigin(req);
  const actor = await requireActor(req);
  roomStore.heartbeat(DEV_AUDIO_HARNESS_ROOM.roomId, actor.participantSessionId);
  res.status(204).end();
});

router.get("/state", async (req, res) => {
  await requireActor(req);
  res.set("Cache-Control", "no-store").json(stateForClient());
});

router.get("/account/rooms/:roomId/audio", async (req, res) => {
  const actor = await requireActor(req, req.params.roomId);
  res.set("Cache-Control", "no-store").json(universityAudioBeamStore.getState(req.params.roomId));
});

router.post("/account/rooms/:roomId/audio/actions", async (req, res) => {
  assertSameOrigin(req);
  const actor = await requireActor(req, req.params.roomId);
  const parsed = HarnessActionBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).some(key => !["action", "targetParticipantId"].includes(key)))
    throw new RoomError(400, "Choose a valid audio action");

  const participant = roomStore.requireAccountMember(req.params.roomId, actor.participantSessionId, actor.accountId);
  let state;
  switch (parsed.data.action) {
    case "join-slot":
      state = universityAudioBeamStore.joinSlot(req.params.roomId, participant.participantId, actor.accountId);
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
      if (!parsed.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first");
      state = universityAudioBeamStore.hostMute(
        req.params.roomId, participant.participantId, parsed.data.targetParticipantId,
        parsed.data.action === "host-mute",
      );
      break;
    case "kick": {
      if (!parsed.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first");
      const result = universityAudioBeamStore.kick(
        req.params.roomId, participant.participantId, parsed.data.targetParticipantId,
      );
      roomStore.leaveParticipant(req.params.roomId, parsed.data.targetParticipantId);
      removeActorForParticipant(parsed.data.targetParticipantId);
      state = result.state;
      break;
    }
  }
  res.set("Cache-Control", "no-store").json(state);
});

router.get("/account/rooms/:roomId/audio/events", async (req, res) => {
  const actor = await requireActor(req, req.params.roomId);
  const roomId = DEV_AUDIO_HARNESS_ROOM.roomId;
  let ready = false;
  let closed = false;
  const pending: string[] = [];
  const write = (frame: string) => {
    if (closed || res.destroyed || res.writableEnded) return;
    if (!ready) { pending.push(frame); return; }
    if (!res.write(frame)) res.destroy();
  };
  const disconnect = universityAudioSignaling.connect(roomId, actor.participantSessionId, actor.accountId, {
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
    void requireActor(req, roomId).catch(() => res.end());
    try { roomStore.requireAccountMember(roomId, actor.participantSessionId, actor.accountId); }
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
  assertSameOrigin(req);
  const actor = await requireActor(req, req.params.roomId);
  const input = SendUniversityAudioSignalBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Invalid peer audio signal");
  universityAudioSignaling.signal(
    DEV_AUDIO_HARNESS_ROOM.roomId, actor.participantSessionId, actor.accountId, input.data,
  );
  res.status(204).end();
});

router.delete("/account/rooms/:roomId/audio/connections/:connectionId", async (req, res) => {
  const actor = await requireActor(req, req.params.roomId);
  universityAudioSignaling.disconnect(
    DEV_AUDIO_HARNESS_ROOM.roomId, actor.participantSessionId, actor.accountId, req.params.connectionId,
  );
  res.status(204).end();
});

export default router;
