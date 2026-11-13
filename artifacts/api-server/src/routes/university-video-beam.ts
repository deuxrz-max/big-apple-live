import { Router, type Request } from "express";
import { TrackSource } from "livekit-server-sdk";
import {
  GetUniversityVideoBeamStateResponse,
  GetUniversityVideoBeamTokenBody,
  GetUniversityVideoBeamTokenResponse,
  PerformUniversityVideoBeamActionBody,
  PerformUniversityVideoBeamActionResponse,
  type UniversityVideoBeamState,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireCompletedProfile } from "../lib/account-profiles";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import {
  assertRoomAccessAllowed, communityRoomScope, isExistingModerator, publishRoomKick, saveRoomKick,
} from "../lib/room-moderation";
import { mayModerateAppRunRoom } from "../lib/room-moderation-policy";
import { isPublicTopicRoom } from "../lib/community-config";
import { logger } from "../lib/logger";

const router = Router();
const PARTICIPANT_SNAPSHOT_TTL_MS = 1_500;
const participantSnapshots = new Map<string, { expiresAt: number; identities: Set<string> }>();
const appliedSpeakerPolicies = new Map<string, Map<string, string>>();

// The retained API prefix exists for the room audio seat protocol. Video playback
// and its controls are permanently retired; reject old TV clients before any handler.
router.use("/account/rooms/:roomId/video-beam/tv", (_req, res) => {
  res.status(410).json({ error: "Room video playback has been retired. This room supports audio only." });
});

function requireMember(req: Request, roomId: string, id: string) {
  const sessionId = req.get("X-Room-Session") ?? "";
  const participant = roomStore.requireAccountMember(roomId, sessionId, id);
  return { sessionId, participant };
}

async function mayControlRoomSpeakers(roomId: string, actorId: string): Promise<boolean> {
  if (roomStore.isSocialRoom(roomId) && roomStore.hostAccountId(roomId) === actorId) return true;
  return mayModerateAppRunRoom(await isExistingModerator(actorId));
}

async function refreshParticipantSnapshot(roomName: string): Promise<Set<string>> {
  const participants = await liveKitBeamService.listParticipants(roomName);
  const identities = new Set(participants.map(participant => participant.identity));
  participantSnapshots.set(roomName, { expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS, identities });
  return identities;
}

function sourcesForSlot(slot: UniversityVideoBeamState["slots"][number], micOverride?: boolean) {
  const microphoneEnabled = micOverride ?? (!slot.micMuted && !slot.mutedByHost);
  return { sources: microphoneEnabled ? [TrackSource.MICROPHONE] : [], microphoneEnabled };
}

async function synchronizeSpeakerMediaPermissions(
  roomId: string,
  state: UniversityVideoBeamState,
  identities: ReadonlySet<string>,
  viewerAccountId?: string,
): Promise<UniversityVideoBeamState> {
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let policies = appliedSpeakerPolicies.get(roomName);
  if (!policies) {
    policies = new Map();
    appliedSpeakerPolicies.set(roomName, policies);
  }
  const occupied = new Set(state.slots.flatMap(slot => slot.participantId ? [slot.participantId] : []));
  for (const participantId of policies.keys()) {
    if (!occupied.has(participantId)) policies.delete(participantId);
  }
  for (const slot of state.slots) {
    const participantId = slot.participantId;
    if (!participantId || !identities.has(participantId)) continue;
    const policy = sourcesForSlot(slot);
    const signature = `${policy.microphoneEnabled}:${policy.sources.join(",")}`;
    if (policies.get(participantId) === signature) continue;
    try {
      await liveKitBeamService.applySpeakerMediaPolicy(
        roomName, participantId, policy.sources, policy.microphoneEnabled,
      );
      policies.set(participantId, signature);
    } catch (failure) {
      throw publicLiveKitFailure(failure);
    }
  }
  return universityVideoBeamStore.getState(roomId, viewerAccountId);
}

async function reconcileRoomAudio(roomId: string, viewerAccountId?: string): Promise<UniversityVideoBeamState> {
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let snapshot = participantSnapshots.get(roomName);
  if (!snapshot || snapshot.expiresAt <= Date.now()) {
    try {
      const identities = await refreshParticipantSnapshot(roomName);
      snapshot = participantSnapshots.get(roomName)!;
      snapshot.identities = identities;
    } catch (error) {
      if (!isPublicTopicRoom(roomId, roomStore)) throw error;
      logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
        "Room audio presence could not be refreshed");
      snapshot = { expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS, identities: snapshot?.identities ?? new Set() };
      participantSnapshots.set(roomName, snapshot);
    }
  }
  const state = universityVideoBeamStore.reconcileLiveKitParticipants(roomId, snapshot.identities, viewerAccountId);
  return synchronizeSpeakerMediaPermissions(roomId, state, snapshot.identities, viewerAccountId);
}

router.get("/account/rooms/:roomId/video-beam", async (req, res) => {
  const id = accountId(req);
  await assertRoomAccessAllowed(communityRoomScope(req.params.roomId), id);
  requireMember(req, req.params.roomId, id);
  res.set("Cache-Control", "no-store")
    .json(GetUniversityVideoBeamStateResponse.parse(await reconcileRoomAudio(req.params.roomId, id)));
});

router.post("/account/rooms/:roomId/video-beam/token", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  await assertRoomAccessAllowed(communityRoomScope(req.params.roomId), id);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = GetUniversityVideoBeamTokenBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key => key !== "role")) {
    throw new RoomError(400, "Choose a valid room audio role.");
  }
  const profile = await requireCompletedProfile(id);
  const roomName = universityVideoBeamStore.getRoomName(req.params.roomId);
  let slotNumber: number | null = null;
  if (input.data.role === "speaker") {
    universityVideoBeamStore.assertCanJoin(req.params.roomId, id);
    const reserved = universityVideoBeamStore.joinSlot(req.params.roomId, participant.participantId, id);
    slotNumber = reserved.slots.find(slot => slot.participantId === participant.participantId)?.slotNumber ?? null;
  } else {
    const state = await reconcileRoomAudio(req.params.roomId);
    if (!state.beamActive) throw new RoomError(409, "A speaker needs to start the room audio before listeners can join.");
    if (state.slots.some(slot => slot.participantId === participant.participantId)) {
      throw new RoomError(409, "Use your speaker connection to rejoin your room audio spot.");
    }
  }
  try {
    const ownSlot = input.data.role === "speaker"
      ? universityVideoBeamStore.slotFor(req.params.roomId, participant.participantId)
      : null;
    const token = await liveKitBeamService.createToken({
      roomName,
      participantId: participant.participantId,
      displayName: profile.displayName || profile.username,
      role: input.data.role,
      canSubscribe: ownSlot ? !ownSlot.micMuted && !ownSlot.mutedByHost : false,
    });
    res.set("Cache-Control", "no-store").json(GetUniversityVideoBeamTokenResponse.parse({
      ...token, role: input.data.role, slotNumber,
    }));
  } catch (failure) {
    if (input.data.role === "speaker") universityVideoBeamStore.leaveSlot(req.params.roomId, participant.participantId);
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/rooms/:roomId/video-beam/actions", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const roomId = req.params.roomId;
  await assertRoomAccessAllowed(communityRoomScope(roomId), id);
  const { participant } = requireMember(req, roomId, id);
  const input = PerformUniversityVideoBeamActionBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key =>
    !["action", "enabled", "targetParticipantId", "targetSlotNumber"].includes(key))) {
    throw new RoomError(400, "Choose a valid room audio action.");
  }
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let state = universityVideoBeamStore.getState(roomId, id);
  try {
    switch (input.data.action) {
      case "reserve-slot":
        state = universityVideoBeamStore.joinSlot(roomId, participant.participantId, id, input.data.targetSlotNumber);
        break;
      case "speaker-connected": {
        const connected = await refreshParticipantSnapshot(roomName);
        if (!connected.has(participant.participantId)) {
          throw new RoomError(409, "The room audio connection is not ready yet. Try joining again.");
        }
        state = universityVideoBeamStore.markConnected(roomId, participant.participantId);
        break;
      }
      case "leave-slot": {
        const liveParticipants = await liveKitBeamService.listParticipants(roomName);
        if (liveParticipants.some(item => item.identity === participant.participantId)) {
          await liveKitBeamService.removeParticipant(roomName, participant.participantId);
        }
        await refreshParticipantSnapshot(roomName);
        state = universityVideoBeamStore.leaveSlot(roomId, participant.participantId);
        break;
      }
      case "move-slot":
        if (!Number.isInteger(input.data.targetSlotNumber)) throw new RoomError(400, "Choose one of the nine speaker spots.");
        state = universityVideoBeamStore.moveSlot(roomId, participant.participantId, id, input.data.targetSlotNumber!);
        break;
      case "set-self-mic": {
        if (typeof input.data.enabled !== "boolean") throw new RoomError(400, "Choose whether your microphone is on or off.");
        universityVideoBeamStore.assertSelfMedia(roomId, participant.participantId, "mic", input.data.enabled);
        const slot = universityVideoBeamStore.slotFor(roomId, participant.participantId);
        const policy = sourcesForSlot(slot, input.data.enabled);
        await liveKitBeamService.setSelfTrackEnabled(roomName, participant.participantId, "mic",
          input.data.enabled, policy.sources);
        state = universityVideoBeamStore.setSelfMedia(roomId, participant.participantId, "mic", input.data.enabled);
        break;
      }
      case "host-mute-mic": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        if (!(await mayControlRoomSpeakers(roomId, id))) {
          throw new RoomError(403, "Only this room's host or an existing moderator can control speakers.");
        }
        const target = input.data.targetParticipantId;
        const slot = universityVideoBeamStore.assertHostControl(roomId, participant.participantId, target);
        const policy = sourcesForSlot(slot, false);
        await liveKitBeamService.disableTrack(roomName, target, "mic", policy.sources);
        state = universityVideoBeamStore.moderatorDisableMedia(roomId, participant.participantId, target, "mic");
        break;
      }
      case "kick": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        const target = input.data.targetParticipantId;
        if (target === participant.participantId) throw new RoomError(400, "You cannot remove yourself from the room.");
        if (!(await mayControlRoomSpeakers(roomId, id))) {
          throw new RoomError(403, "Only this room's host or an existing moderator can remove someone.");
        }
        const targetAccountId = roomStore.sessionAccountId(roomId, target);
        if (!targetAccountId) throw new RoomError(404, "That person is no longer in this room.");
        await saveRoomKick(communityRoomScope(roomId), id, targetAccountId);
        publishRoomKick(roomId, targetAccountId);
        const liveParticipants = await liveKitBeamService.listParticipants(roomName);
        if (liveParticipants.some(item => item.identity === target)) await liveKitBeamService.removeParticipant(roomName, target);
        await refreshParticipantSnapshot(roomName);
        try { universityVideoBeamStore.leaveSlot(roomId, target); } catch { /* target may not have a seat */ }
        roomStore.leaveParticipant(roomId, target);
        state = universityVideoBeamStore.getState(roomId, id);
        break;
      }
    }
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }
  const identities = await refreshParticipantSnapshot(roomName);
  state = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  res.set("Cache-Control", "no-store").json(PerformUniversityVideoBeamActionResponse.parse(state));
});

export default router;
