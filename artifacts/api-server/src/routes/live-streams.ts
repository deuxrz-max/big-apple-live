import { Router } from "express";
import { and, eq, or } from "drizzle-orm";
import { accountProfiles, chatAdmissions, db, socialRelations } from "@workspace/db";
import {
  EndLiveStreamParams,
  EndLiveStreamResponse,
  GetLiveStreamsResponse,
  SendLiveStreamChatMessageBody,
  SendLiveStreamChatMessageResponse,
  JoinLiveStreamParams,
  JoinLiveStreamResponse,
  StartLiveStreamResponse,
  StreamLiveStreamChatParams,
} from "@workspace/api-zod";
import { requireCompletedProfile } from "../lib/account-profiles";
import { isLiveStreamActiveOrStarting, isLiveStreamStarting, liveStreamIdForAccount, liveStreamRoomName,
  reserveLiveStreamStart, clearLiveStreamStart } from "../lib/live-stream-policy";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import { RoomError } from "../lib/room-store";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { requireAdult } from "../lib/community";
import { liveStreamChatHub } from "../lib/live-stream-chat";
import { pairBlocked } from "../lib/social/core";
import { visibleMonthlyPurchaseBadgeSummary } from "../lib/social/monthly-credit-badges";
import { giftNameColorsForAccounts } from "../lib/social/gift-name-color-data";
import { accountId, sameOrigin } from "./identity";

const router = Router();
const LIVE_ROOM_RE = /^st-live-([a-f0-9]{32})$/;

async function requireLiveParticipant(accountId: string, streamId: string) {
  const roomName = liveStreamRoomName(streamId);
  const participants = await liveKitBeamService.listParticipants(roomName);
  if (!participants.some(participant => participant.identity === "host")) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  const identity = liveStreamIdForAccount(accountId) === streamId
    ? "host" : `viewer-${liveStreamIdForAccount(accountId)}`;
  if (!participants.some(participant => participant.identity === identity)) {
    throw new RoomError(403, "Join this livestream before using its chat.");
  }
  return { roomName, participants };
}

function usernameFromMetadata(metadata?: string): string | null {
  if (!metadata) return null;
  try {
    const value = JSON.parse(metadata) as { username?: unknown };
    return typeof value.username === "string" && value.username.length <= 40 ? value.username : null;
  } catch { return null; }
}

async function hiddenStreamsFor(accountId: string): Promise<Set<string>> {
  const relations = await db.select().from(socialRelations).where(and(
    eq(socialRelations.kind, "block"),
    or(eq(socialRelations.ownerId, accountId), eq(socialRelations.targetId, accountId)),
  ));
  return new Set(relations.map(relation =>
    liveStreamIdForAccount(relation.ownerId === accountId ? relation.targetId : relation.ownerId)));
}

async function streamUsername(streamId: string, metadata?: string): Promise<string> {
  const fromMetadata = usernameFromMetadata(metadata);
  if (fromMetadata) return fromMetadata;
  // Older preview streams may predate participant metadata; resolve their deterministic
  // stream ID from saved account profiles without exposing account IDs to the client.
  const profiles = await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
    .from(accountProfiles);
  return profiles.find(profile => liveStreamIdForAccount(profile.accountId) === streamId)?.username ?? "Live creator";
}

router.get("/account/live-streams", async (req, res) => {
  const id = accountId(req);
  await requireCompletedProfile(id);
  await requireAdult(id);
  try {
    const hiddenStreamIds = await hiddenStreamsFor(id);
    const rooms = await liveKitBeamService.listRooms();
    const liveRooms = rooms.filter(room => LIVE_ROOM_RE.test(room.name));
    const streams = (await Promise.all(liveRooms.map(async room => {
      const match = LIVE_ROOM_RE.exec(room.name);
      if (!match) return null;
      const streamId = match[1]!;
      if (hiddenStreamIds.has(streamId)) return null;
      const participants = await liveKitBeamService.listParticipants(room.name);
      const host = participants.find(participant => participant.identity === "host");
      if (!host) return null;
      return {
        streamId,
        displayName: host.name?.trim() || "Live creator",
        username: await streamUsername(streamId, host.metadata),
        viewerCount: Math.max(0, participants.length - 1),
      };
    }))).filter((stream): stream is NonNullable<typeof stream> => stream !== null);
    res.set("Cache-Control", "no-store").json(GetLiveStreamsResponse.parse({ streams }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/live-streams", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const profile = await requireCompletedProfile(id);
  await requireAdult(id);
  const displayName = profile.displayName?.trim() || profile.username;
  const streamId = liveStreamIdForAccount(id);
  const roomName = liveStreamRoomName(streamId);
  try {
    if (await isLiveStreamActiveOrStarting(id) || isLiveStreamStarting(id)) {
      throw new RoomError(409, "You are already live or a Go Live session is still starting.");
    }
    reserveLiveStreamStart(id);
    try {
      const token = await liveKitBeamService.createLiveStreamToken({
        roomName, identity: "host", displayName, username: profile.username, role: "host",
      });
      const beamSpeakers = universityVideoBeamStore.muteAccountMicrophones(id);
      for (const speaker of beamSpeakers) {
        const beamRoomName = universityVideoBeamStore.getRoomName(speaker.roomId);
        try {
          await liveKitBeamService.applySpeakerMediaPolicy(beamRoomName, speaker.participantId, [], false);
        } catch (failure) {
          try {
            await liveKitBeamService.removeParticipant(beamRoomName, speaker.participantId);
            universityVideoBeamStore.leaveSlot(speaker.roomId, speaker.participantId);
          } catch {
            // Do not issue a camera-stream token if the room microphone cannot be stopped.
          }
          throw failure;
        }
      }
      liveStreamChatHub.start(streamId);
      res.set("Cache-Control", "no-store").json(StartLiveStreamResponse.parse({
        streamId, ...token, displayName, username: profile.username,
      }));
    } catch (failure) {
      clearLiveStreamStart(id);
      throw failure;
    }
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/live-streams/:streamId/token", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinLiveStreamParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "This livestream is no longer available.");
  const profile = await requireCompletedProfile(id);
  await requireAdult(id);
  if ((await hiddenStreamsFor(id)).has(params.data.streamId)) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  const roomName = liveStreamRoomName(params.data.streamId);
  try {
    const participants = await liveKitBeamService.listParticipants(roomName);
    const host = participants.find(participant => participant.identity === "host");
    if (!host) throw new RoomError(404, "This livestream is no longer available.");
    const hostUsername = await streamUsername(params.data.streamId, host.metadata);
    const token = await liveKitBeamService.createLiveStreamToken({
      roomName, identity: `viewer-${liveStreamIdForAccount(id)}`,
      displayName: profile.displayName?.trim() || profile.username, username: profile.username, role: "viewer",
    });
    res.set("Cache-Control", "no-store").json(JoinLiveStreamResponse.parse({
      ...token, displayName: host.name?.trim() || "Live creator", username: hostUsername,
      viewerUsername: profile.username,
    }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.get("/account/live-streams/:streamId/chat/events", async (req, res) => {
  const params = StreamLiveStreamChatParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "This livestream is no longer available.");
  const id = accountId(req);
  await requireCompletedProfile(id);
  await requireAdult(id);
  const { roomName } = await requireLiveParticipant(id, params.data.streamId);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const writeMessage = async (message: ReturnType<typeof liveStreamChatHub.recent>[number]) => {
    if (await pairBlocked(id, message.accountId)) return;
    const { accountId: _privateAccountId, ...publicMessage } = message;
    if (!res.destroyed && !res.writableEnded) res.write(`event: message\ndata: ${JSON.stringify(publicMessage)}\n\n`);
  };
  const writeGift = async (gift: ReturnType<typeof liveStreamChatHub.recentGifts>[number], eventName = "gift") => {
    if (await pairBlocked(id, gift.senderAccountId)) return;
    const { senderAccountId: _privateAccountId, ...publicGift } = gift;
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${eventName}\ndata: ${JSON.stringify(publicGift)}\n\n`);
  };
  const unsubscribe = liveStreamChatHub.subscribe(params.data.streamId, message => {
    if (!message) { res.end(); return; }
    void writeMessage(message).catch(error => {
      req.log.warn({ error }, "Live stream chat event could not be delivered");
    });
  });
  const unsubscribeGifts = liveStreamChatHub.subscribeGifts(params.data.streamId, gift => {
    if (!gift) { res.end(); return; }
    void writeGift(gift).catch(error => {
      req.log.warn({ error }, "Live stream gift event could not be delivered");
    });
  });
  for (const message of liveStreamChatHub.recent(params.data.streamId)) await writeMessage(message);
  const gifts = liveStreamChatHub.recentGifts(params.data.streamId);
  for (const gift of gifts) await writeGift(gift, "gift-history-item");
  const keepalive = setInterval(() => {
    void requireLiveParticipant(id, params.data.streamId).catch(() => res.end());
    if (!res.destroyed && !res.writableEnded) res.write(": keepalive\n\n");
  }, 15_000);
  keepalive.unref();
  res.on("close", () => { clearInterval(keepalive); unsubscribe(); unsubscribeGifts(); });
});

router.post("/account/live-streams/:streamId/chat", async (req, res) => {
  sameOrigin(req);
  const params = JoinLiveStreamParams.safeParse(req.params);
  const input = SendLiveStreamChatMessageBody.safeParse(req.body);
  if (!params.success || !input.success) throw new RoomError(400, "Write a message up to 280 characters");
  const id = accountId(req);
  const profile = await requireCompletedProfile(id);
  await requireAdult(id);
  await requireLiveParticipant(id, params.data.streamId);
  const [admission] = await db.select().from(chatAdmissions).where(eq(chatAdmissions.accountId, id));
  if (admission?.chatMuted || admission?.reportsMuted) {
    throw new RoomError(403, "Chat is temporarily muted while a moderator reviews reports");
  }
  const body = input.data.text.trim();
  if (!body || body.length > 280) throw new RoomError(400, "Write 1–280 characters");
  const [nameColors, equippedBadge] = await Promise.all([
    giftNameColorsForAccounts([id]),
    visibleMonthlyPurchaseBadgeSummary(id),
  ]);
  const message = liveStreamChatHub.publish({
    streamId: params.data.streamId,
    accountId: id,
    username: profile.username,
    displayName: profile.displayName?.trim() || profile.username,
    displayNameColor: nameColors.get(id) ?? "#FFFFFF",
    badgeName: equippedBadge?.tier.name ?? null,
    badgeImage: equippedBadge?.tier.badgeImage ?? null,
    text: body,
  });
  const { accountId: _privateAccountId, ...publicMessage } = message;
  res.status(201).json(SendLiveStreamChatMessageResponse.parse(publicMessage));
});

router.delete("/account/live-streams/:streamId", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = EndLiveStreamParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "Livestream not found.");
  if (params.data.streamId !== liveStreamIdForAccount(id)) {
    throw new RoomError(403, "Only the person who started this livestream can end it.");
  }
  clearLiveStreamStart(id);
  try {
    const roomName = liveStreamRoomName(params.data.streamId);
    const rooms = await liveKitBeamService.listRooms([roomName]);
    if (rooms.length) await liveKitBeamService.deleteRoom(roomName);
      liveStreamChatHub.end(params.data.streamId);
    res.set("Cache-Control", "no-store").json(EndLiveStreamResponse.parse({ ended: true }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

export default router;
