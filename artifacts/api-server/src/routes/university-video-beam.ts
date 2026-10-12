import { Router, type Request } from "express";
import {
  GetUniversityVideoBeamStateResponse,
  GetUniversityVideoBeamTokenBody,
  GetUniversityVideoBeamTokenResponse,
  PerformUniversityVideoBeamActionBody,
  PerformUniversityVideoBeamActionResponse,
} from "@workspace/api-zod";
import { TrackSource } from "livekit-server-sdk";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireCompletedProfile } from "../lib/account-profiles";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";

const router = Router();
const participantSnapshots = new Map<string, { expiresAt: number; identities: Set<string> }>();
const PARTICIPANT_SNAPSHOT_TTL_MS = 1_500;

function requireMember(req: Request, roomId: string, id: string) {
  const sessionId = req.get("X-Room-Session") ?? "";
  const participant = roomStore.requireAccountMember(roomId, sessionId, id);
  return { sessionId, participant };
}

async function reconcileState(roomId: string) {
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let snapshot = participantSnapshots.get(roomName);
  if (!snapshot || snapshot.expiresAt <= Date.now()) {
    const participants = await liveKitBeamService.listParticipants(roomName);
    snapshot = {
      expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS,
      identities: new Set(participants.map(participant => participant.identity)),
    };
    participantSnapshots.set(roomName, snapshot);
  }
  return universityVideoBeamStore.reconcileLiveKitParticipants(
    roomId,
    snapshot.identities,
  );
}

async function refreshParticipantSnapshot(roomName: string) {
  const participants = await liveKitBeamService.listParticipants(roomName);
  const identities = new Set(participants.map(participant => participant.identity));
  participantSnapshots.set(roomName, {
    expiresAt: Date.now() + PARTICIPANT_SNAPSHOT_TTL_MS,
    identities,
  });
  return identities;
}

router.get("/account/rooms/:roomId/video-beam", async (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  const state = await reconcileState(req.params.roomId);
  res.set("Cache-Control", "no-store");
  res.json(GetUniversityVideoBeamStateResponse.parse(state));
});

router.post("/account/rooms/:roomId/video-beam/token", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = GetUniversityVideoBeamTokenBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key => key !== "role")) {
    throw new RoomError(400, "Choose a valid beam role.");
  }
  const profile = await requireCompletedProfile(id);
  const roomName = universityVideoBeamStore.getRoomName(req.params.roomId);
  let slotNumber: number | null = null;

  if (input.data.role === "speaker") {
    universityVideoBeamStore.assertCanJoin(req.params.roomId, id);
    const reserved = universityVideoBeamStore.joinSlot(
      req.params.roomId, participant.participantId, id,
    );
    slotNumber = reserved.slots.find(slot => slot.participantId === participant.participantId)?.slotNumber ?? null;
  } else {
    const state = await reconcileState(req.params.roomId);
    if (!state.beamActive) throw new RoomError(409, "A speaker needs to start the beam before audience members can join.");
    if (state.slots.some(slot => slot.participantId === participant.participantId)) {
      throw new RoomError(409, "Use your speaker connection to rejoin your beam spot.");
    }
  }

  try {
    const token = await liveKitBeamService.createToken({
      roomName,
      participantId: participant.participantId,
      displayName: profile.displayName || profile.username,
      role: input.data.role,
    });
    res.set("Cache-Control", "no-store").json(GetUniversityVideoBeamTokenResponse.parse({
      ...token,
      role: input.data.role,
      slotNumber,
    }));
  } catch (failure) {
    if (input.data.role === "speaker") {
      universityVideoBeamStore.leaveSlot(req.params.roomId, participant.participantId);
    }
    throw publicLiveKitFailure(failure);
  }
});

router.post("/account/rooms/:roomId/video-beam/actions", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = PerformUniversityVideoBeamActionBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key =>
    !["action", "enabled", "targetParticipantId"].includes(key))) {
    throw new RoomError(400, "Choose a valid video beam action.");
  }
  const roomId = req.params.roomId;
  const roomName = universityVideoBeamStore.getRoomName(roomId);
  let state;

  try {
    switch (input.data.action) {
      case "reserve-slot": {
        state = universityVideoBeamStore.joinSlot(
          roomId, participant.participantId, id,
        );
        break;
      }
      case "speaker-connected": {
        const connected = await refreshParticipantSnapshot(roomName);
        if (!connected.has(participant.participantId)) {
          throw new RoomError(409, "The LiveKit connection is not ready yet. Try joining again.");
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
      case "set-self-mic":
      case "set-self-camera": {
        if (typeof input.data.enabled !== "boolean") throw new RoomError(400, "Choose whether the device is on or off.");
        const media = input.data.action === "set-self-mic" ? "mic" : "camera";
        universityVideoBeamStore.assertSelfMedia(roomId, participant.participantId, media, input.data.enabled);
        const slot = universityVideoBeamStore.slotFor(roomId, participant.participantId);
        const allowedSources = [
          (media === "mic" ? input.data.enabled : !slot.micMuted) ? TrackSource.MICROPHONE : null,
          (media === "camera" ? input.data.enabled : !slot.cameraOff) ? TrackSource.CAMERA : null,
        ].filter((source): source is TrackSource => source !== null);
        await liveKitBeamService.setSelfTrackEnabled(
          roomName, participant.participantId, media, input.data.enabled, allowedSources,
        );
        state = universityVideoBeamStore.setSelfMedia(
          roomId, participant.participantId, media, input.data.enabled,
        );
        break;
      }
      case "host-mute-mic":
      case "host-disable-camera": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        const target = input.data.targetParticipantId;
        const media = input.data.action === "host-mute-mic" ? "mic" : "camera";
        const slot = universityVideoBeamStore.assertHostControl(roomId, participant.participantId, target);
        const allowedSources = [
          media !== "mic" && !slot.micMuted ? TrackSource.MICROPHONE : null,
          media !== "camera" && !slot.cameraOff ? TrackSource.CAMERA : null,
        ].filter((source): source is TrackSource => source !== null);
        await liveKitBeamService.disableTrack(roomName, target, media, allowedSources);
        state = universityVideoBeamStore.hostDisableMedia(
          roomId, participant.participantId, target, media,
        );
        break;
      }
      case "kick": {
        if (!input.data.targetParticipantId) throw new RoomError(400, "Choose a speaker first.");
        const target = input.data.targetParticipantId;
        universityVideoBeamStore.assertHostControl(roomId, participant.participantId, target);
        await liveKitBeamService.removeParticipant(roomName, target);
        await refreshParticipantSnapshot(roomName);
        const result = universityVideoBeamStore.kick(roomId, participant.participantId, target);
        roomStore.leaveParticipant(roomId, target);
        state = result.state;
        break;
      }
    }
  } catch (failure) {
    throw publicLiveKitFailure(failure);
  }

  res.set("Cache-Control", "no-store").json(PerformUniversityVideoBeamActionResponse.parse(state));
});

export default router;
