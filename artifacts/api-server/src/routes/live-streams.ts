import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { accountProfiles, chatAdmissions, db } from "@workspace/db";
import { z } from "zod";
import {
  EndLiveStreamParams,
  EndLiveStreamResponse,
  GetLiveStreamsResponse,
  SendLiveStreamChatMessageBody,
  SendLiveStreamChatMessageResponse,
  JoinLiveStreamParams,
  JoinLiveStreamResponse,
  StartLiveStreamResponse,
  StartLiveStreamBody,
  StreamLiveStreamChatParams,
  HeartbeatLiveStreamResponse,
} from "@workspace/api-zod";
import { requireCompletedProfile } from "../lib/account-profiles";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import { RoomError } from "../lib/room-store";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { requireAdult } from "../lib/community";
import { liveStreamChatHub } from "../lib/live-stream-chat";
import {
  adoptLegacyLiveStreamSession,
  cleanupStaleLiveStreamSession,
  endLiveStreamSession,
  getLiveStreamSession,
  getLiveStreamSessionByStreamId,
  liveStreamIdForAccount,
  liveStreamRoomName,
  liveStreamSessionIsFresh,
  renewLiveStreamHeartbeat,
  reserveLiveStreamStart,
  clearLiveStreamStart,
  sweepStaleLiveStreamSessions,
} from "../lib/live-stream-policy";
import { pairBlocked } from "../lib/social/core";
import { targetAccount } from "../lib/social/core";
import {
  assertHostOrModerator, assertRoomAccessAllowed, listHostRoomBlocks, liveStreamScope,
  saveRoomKick, setHostRoomBlock,
} from "../lib/room-moderation";
import { visibleMonthlyPurchaseBadgeSummary } from "../lib/social/monthly-credit-badges";
import { nameColorProfileForAccount, nameColorProfilesForAccounts } from "../lib/social/gift-name-color-data";
import { accountId, sameOrigin } from "./identity";
import { logger } from "../lib/logger";

const router = Router();
const LIVE_ROOM_RE = /^st-live-([a-f0-9]{32})$/;
const hostBlockInput = z.object({ active: z.boolean() }).strict();

async function disconnectBlockedViewer(streamId: string, hostAccountId: string, targetAccountId: string) {
  if (hostAccountId === targetAccountId) throw new RoomError(400, "You cannot block the host from their own room.");
  const roomName = liveStreamRoomName(streamId);
  const identity = `viewer-${liveStreamIdForAccount(targetAccountId)}`;
  const participants = await liveKitBeamService.listParticipants(roomName);
  if (participants.some(participant => participant.identity === identity)) {
    await liveKitBeamService.removeParticipant(roomName, identity);
  }
}

const liveStreamLeaseSweep = setInterval(() => {
  void sweepStaleLiveStreamSessions().catch(error => {
    logger.warn({ error }, "Live stream lease sweep failed");
  });
}, 5_000);
liveStreamLeaseSweep.unref();

async function requireLiveParticipant(accountId: string, streamId: string) {
  const lease = await getLiveStreamSession(accountId);
  if (!lease || lease.streamId !== streamId || lease.state !== "live" || !(await liveStreamSessionIsFresh(lease))) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  await assertRoomAccessAllowed(liveStreamScope(streamId, lease.startedAt, lease.accountId), accountId);
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

async function streamUsername(streamId: string, metadata?: string): Promise<string> {
  const fromMetadata = usernameFromMetadata(metadata);
  if (fromMetadata) return fromMetadata;
  // Older preview streams may predate participant metadata; resolve their deterministic
  // stream ID from saved account profiles without exposing account IDs to the client.
  const profiles = await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
    .from(accountProfiles);
  return profiles.find(profile => liveStreamIdForAccount(profile.accountId) === streamId)?.username ?? "Live creator";
}

async function streamOwnerProfiles() {
  const profiles = await db.select({ accountId: accountProfiles.accountId, username: accountProfiles.username })
    .from(accountProfiles);
  return new Map(profiles.map(profile => [liveStreamIdForAccount(profile.accountId), profile]));
}

router.get("/account/live-streams", async (req, res) => {
  const id = accountId(req);
  await requireCompletedProfile(id);
  await requireAdult(id);
  try {
    const rooms = await liveKitBeamService.listRooms();
    const liveRooms = rooms.filter(room => LIVE_ROOM_RE.test(room.name));
    const owners = await streamOwnerProfiles();
    const nameColors = await nameColorProfilesForAccounts([...owners.values()].map(owner => owner.accountId));
    const streams = (await Promise.all(liveRooms.map(async room => {
      const match = LIVE_ROOM_RE.exec(room.name);
      if (!match) return null;
      const streamId = match[1]!;
      const participants = await liveKitBeamService.listParticipants(room.name);
      const host = participants.find(participant => participant.identity === "host");
      if (!host) return null;
      const owner = owners.get(streamId);
      if (!owner) return null;
      let lease = await getLiveStreamSession(owner.accountId);
      if (!lease) {
        await adoptLegacyLiveStreamSession(owner.accountId, streamId);
        lease = await getLiveStreamSession(owner.accountId);
      }
      if (!lease || lease.streamId !== streamId || lease.state !== "live") return null;
      if (!(await liveStreamSessionIsFresh(lease))) {
        await cleanupStaleLiveStreamSession(lease);
        return null;
      }
      return {
        streamId,
        displayName: host.name?.trim() || "Live creator",
        username: usernameFromMetadata(host.metadata) ?? owner.username,
        displayNameColor: nameColors.get(owner.accountId)?.color ?? "#FFFFFF",
        displayNameTierIndex: nameColors.get(owner.accountId)?.tierIndex ?? 0,
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
  const input = StartLiveStreamBody.safeParse(req.body ?? {});
  if (!input.success) throw new RoomError(400, "Could not start the live stream. Check the request and try again.");
  const displayName = profile.displayName?.trim() || profile.username;
  const streamId = liveStreamIdForAccount(id);
  const roomName = liveStreamRoomName(streamId);
  try {
    const existing = await getLiveStreamSession(id);
    if (existing) {
      if (await liveStreamSessionIsFresh(existing)) {
        if (!input.data.replaceExisting) {
          throw new RoomError(409, "Your stream may still be live on another device.");
        }
        await endLiveStreamSession(id, existing.streamId);
      } else {
        await cleanupStaleLiveStreamSession(existing);
      }
    } else {
      const participants = await liveKitBeamService.listParticipants(roomName);
      if (participants.some(participant => participant.identity === "host")) {
        if (!input.data.replaceExisting) {
          throw new RoomError(409, "Your stream may still be live on another device.");
        }
        await endLiveStreamSession(id, streamId);
      } else {
        const rooms = await liveKitBeamService.listRooms([roomName]);
        if (rooms.length) await endLiveStreamSession(id, streamId);
      }
    }
    await reserveLiveStreamStart(id, streamId);
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
      const nameColor = await nameColorProfileForAccount(id);
      res.set("Cache-Control", "no-store").json(StartLiveStreamResponse.parse({
        streamId, ...token, displayName, username: profile.username,
        displayNameColor: nameColor.color, displayNameTierIndex: nameColor.tierIndex,
      }));
    } catch (failure) {
      clearLiveStreamStart(id);
      await endLiveStreamSession(id, streamId).catch(() => undefined);
      throw failure;
    }
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/live-streams/:streamId/heartbeat", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinLiveStreamParams.safeParse(req.params);
  if (!params.success || params.data.streamId !== liveStreamIdForAccount(id)) {
    throw new RoomError(404, "This livestream is no longer available.");
  }
  await requireCompletedProfile(id);
  await requireAdult(id);
  try {
    const session = await getLiveStreamSession(id);
    if (!session || session.streamId !== params.data.streamId || session.state === "ending") {
      throw new RoomError(404, "This livestream has ended.");
    }
    const participants = await liveKitBeamService.listParticipants(liveStreamRoomName(params.data.streamId));
    if (!participants.some(participant => participant.identity === "host")) {
      await endLiveStreamSession(id, params.data.streamId);
      throw new RoomError(404, "This livestream has ended.");
    }
    if (!(await renewLiveStreamHeartbeat(id, params.data.streamId))) {
      throw new RoomError(404, "This livestream has ended.");
    }
    res.set("Cache-Control", "no-store").json(HeartbeatLiveStreamResponse.parse({ active: true }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/live-streams/:streamId/rejoin", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const params = JoinLiveStreamParams.safeParse(req.params);
  if (!params.success || params.data.streamId !== liveStreamIdForAccount(id)) {
    throw new RoomError(403, "Only the stream creator can rejoin this stream.");
  }
  const profile = await requireCompletedProfile(id);
  await requireAdult(id);
  try {
    const session = await getLiveStreamSession(id);
    if (!session || session.streamId !== params.data.streamId || session.state !== "live"
      || !(await liveStreamSessionIsFresh(session))) {
      if (session) await cleanupStaleLiveStreamSession(session);
      throw new RoomError(404, "That stream has already ended.");
    }
    await assertRoomAccessAllowed(liveStreamScope(session.streamId, session.startedAt, session.accountId), id);
    const roomName = liveStreamRoomName(params.data.streamId);
    const participants = await liveKitBeamService.listParticipants(roomName);
    if (!participants.some(participant => participant.identity === "host")) {
      await endLiveStreamSession(id, params.data.streamId);
      throw new RoomError(404, "That stream has already ended.");
    }
    const displayName = profile.displayName?.trim() || profile.username;
    const nameColor = await nameColorProfileForAccount(id);
    const token = await liveKitBeamService.createLiveStreamToken({
      roomName, identity: "host", displayName, username: profile.username, role: "host",
    });
    res.set("Cache-Control", "no-store").json(StartLiveStreamResponse.parse({
      streamId: params.data.streamId, ...token, displayName, username: profile.username,
      displayNameColor: nameColor.color, displayNameTierIndex: nameColor.tierIndex,
    }));
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
  const roomName = liveStreamRoomName(params.data.streamId);
  try {
    const lease = await getLiveStreamSessionByStreamId(params.data.streamId);
    if (!lease || lease.state !== "live" || !(await liveStreamSessionIsFresh(lease))) {
      if (lease) await cleanupStaleLiveStreamSession(lease);
      throw new RoomError(404, "This livestream is no longer available.");
    }
    await assertRoomAccessAllowed(liveStreamScope(lease.streamId, lease.startedAt, lease.accountId), id);
    const participants = await liveKitBeamService.listParticipants(roomName);
    const host = participants.find(participant => participant.identity === "host");
    if (!host) throw new RoomError(404, "This livestream is no longer available.");
    const hostUsername = await streamUsername(params.data.streamId, host.metadata);
    const hostOwner = (await streamOwnerProfiles()).get(params.data.streamId);
    const hostNameColor = hostOwner ? await nameColorProfileForAccount(hostOwner.accountId) : null;
    const token = await liveKitBeamService.createLiveStreamToken({
      roomName, identity: `viewer-${liveStreamIdForAccount(id)}`,
      displayName: profile.displayName?.trim() || profile.username, username: profile.username, role: "viewer",
    });
    res.set("Cache-Control", "no-store").json(JoinLiveStreamResponse.parse({
      ...token, displayName: host.name?.trim() || "Live creator", username: hostUsername,
      displayNameColor: hostNameColor?.color ?? "#FFFFFF",
      displayNameTierIndex: hostNameColor?.tierIndex ?? 0,
      viewerUsername: profile.username,
    }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
});

router.get("/account/host-room-blocks", async (req, res) => {
  res.set("Cache-Control", "no-store").json({ people: await listHostRoomBlocks(accountId(req)) });
});

router.put("/account/host-room-blocks/:username", async (req, res) => {
  sameOrigin(req);
  const parsed = hostBlockInput.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Choose whether this person is blocked from your rooms.");
  const hostAccountId = accountId(req);
  const target = await targetAccount(String(req.params.username));
  await setHostRoomBlock(hostAccountId, target.accountId, parsed.data.active);
  if (parsed.data.active) {
    const lease = await getLiveStreamSession(hostAccountId);
    if (lease?.state === "live") {
      try { await disconnectBlockedViewer(lease.streamId, hostAccountId, target.accountId); }
      catch (error) {
        req.log.error({ error }, "A host-blocked live viewer could not be disconnected");
        throw new RoomError(503, "The block is saved, but the active connection could not be removed yet.");
      }
    }
  }
  res.set("Cache-Control", "no-store").json({ active: parsed.data.active, username: target.username });
});

router.get("/account/live-streams/:streamId/host-blocks", async (req, res) => {
  const { streamId } = req.params;
  const lease = await getLiveStreamSessionByStreamId(streamId);
  if (!lease || lease.state !== "live") throw new RoomError(404, "This livestream is no longer available.");
  await assertHostOrModerator(lease.accountId, accountId(req));
  res.set("Cache-Control", "no-store").json({ people: await listHostRoomBlocks(lease.accountId) });
});

router.put("/account/live-streams/:streamId/host-blocks/:username", async (req, res) => {
  sameOrigin(req);
  const parsed = hostBlockInput.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "Choose whether this person is blocked from the host's rooms.");
  const lease = await getLiveStreamSessionByStreamId(String(req.params.streamId));
  if (!lease || lease.state !== "live") throw new RoomError(404, "This livestream is no longer available.");
  await assertHostOrModerator(lease.accountId, accountId(req));
  const target = await targetAccount(String(req.params.username));
  await setHostRoomBlock(lease.accountId, target.accountId, parsed.data.active);
  if (parsed.data.active) {
    try { await disconnectBlockedViewer(lease.streamId, lease.accountId, target.accountId); }
    catch (error) {
      req.log.error({ error }, "A host-blocked live viewer could not be disconnected");
      throw new RoomError(503, "The block is saved, but the active connection could not be removed yet.");
    }
  }
  res.set("Cache-Control", "no-store").json({ active: parsed.data.active, username: target.username });
});

router.post("/account/live-streams/:streamId/kick/:username", async (req, res) => {
  sameOrigin(req);
  const lease = await getLiveStreamSessionByStreamId(String(req.params.streamId));
  if (!lease || lease.state !== "live") throw new RoomError(404, "This livestream is no longer available.");
  const actorAccountId = accountId(req);
  await assertHostOrModerator(lease.accountId, actorAccountId);
  const target = await targetAccount(String(req.params.username));
  if (target.accountId === lease.accountId) throw new RoomError(400, "You cannot remove the host from their own room.");
  const scope = liveStreamScope(lease.streamId, lease.startedAt, lease.accountId);
  await saveRoomKick(scope, actorAccountId, target.accountId);
  try {
    const roomName = liveStreamRoomName(lease.streamId);
    const identity = `viewer-${liveStreamIdForAccount(target.accountId)}`;
    const participants = await liveKitBeamService.listParticipants(roomName);
    if (participants.some(participant => participant.identity === identity)) {
      await liveKitBeamService.removeParticipant(roomName, identity);
    }
  } catch (error) {
    req.log.error({ error }, "A kicked live viewer could not be disconnected");
    throw new RoomError(503, "The removal is saved, but the active connection could not be ended yet.");
  }
  res.status(204).end();
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
    const { senderAccountId: _privateAccountId, ...publicGift } = gift;
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${eventName}\ndata: ${JSON.stringify(publicGift)}\n\n`);
  };
  let flushingGiftHistory = true;
  const pendingGifts: ReturnType<typeof liveStreamChatHub.recentGifts> = [];
  const giftHistoryIds = new Set<string>();
  let giftWriteTail = Promise.resolve();
  const enqueueGift = (gift: ReturnType<typeof liveStreamChatHub.recentGifts>[number], eventName = "gift") => {
    giftWriteTail = giftWriteTail.then(() => writeGift(gift, eventName)).catch(error => {
      req.log.warn({ error }, "Live stream gift event could not be delivered");
    });
  };
  const unsubscribe = liveStreamChatHub.subscribe(params.data.streamId, message => {
    if (!message) { res.end(); return; }
    void writeMessage(message).catch(error => {
      req.log.warn({ error }, "Live stream chat event could not be delivered");
    });
  });
  const unsubscribeGifts = liveStreamChatHub.subscribeGifts(params.data.streamId, gift => {
    if (!gift) { res.end(); return; }
    if (flushingGiftHistory) pendingGifts.push(gift);
    else enqueueGift(gift);
  });
  for (const message of liveStreamChatHub.recent(params.data.streamId)) await writeMessage(message);
  const gifts = liveStreamChatHub.recentGifts(params.data.streamId);
  for (const gift of gifts) {
    giftHistoryIds.add(gift.id);
    await writeGift(gift, "gift-history-item");
  }
  flushingGiftHistory = false;
  for (const gift of pendingGifts) {
    if (!giftHistoryIds.has(gift.id)) enqueueGift(gift);
  }
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
    nameColorProfilesForAccounts([id]),
    visibleMonthlyPurchaseBadgeSummary(id),
  ]);
  const message = liveStreamChatHub.publish({
    streamId: params.data.streamId,
    accountId: id,
    username: profile.username,
    displayName: profile.displayName?.trim() || profile.username,
    displayNameColor: nameColors.get(id)?.color ?? "#FFFFFF",
    displayNameTierIndex: nameColors.get(id)?.tierIndex ?? 0,
    badgeName: equippedBadge?.tier.name ?? null,
    badgeImage: equippedBadge?.tier.badgeImage ?? null,
    text: body,
  });
  const { accountId: _privateAccountId, ...publicMessage } = message;
  res.status(201).json(SendLiveStreamChatMessageResponse.parse(publicMessage));
});

async function endOwnedLiveStream(req: Request, res: Response): Promise<void> {
  sameOrigin(req);
  const id = accountId(req);
  const params = EndLiveStreamParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "Livestream not found.");
  if (params.data.streamId !== liveStreamIdForAccount(id)) {
    throw new RoomError(403, "Only the person who started this livestream can end it.");
  }
  try {
    await endLiveStreamSession(id, params.data.streamId);
    res.set("Cache-Control", "no-store").json(EndLiveStreamResponse.parse({ ended: true }));
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
}

router.delete("/account/live-streams/:streamId", endOwnedLiveStream);
router.post("/account/live-streams/:streamId/end", endOwnedLiveStream);

export default router;
