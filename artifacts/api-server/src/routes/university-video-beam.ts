import { Router, type Request } from "express";
import {
  GetUniversityVideoBeamStateResponse,
  GetUniversityVideoBeamTokenBody,
  GetUniversityVideoBeamTokenResponse,
  GetUniversityVideoBeamTvStateResponse,
  PerformUniversityVideoBeamActionBody,
  PerformUniversityVideoBeamActionResponse,
  PerformUniversityVideoBeamTvActionBody,
  PerformUniversityVideoBeamTvActionResponse,
  SearchYouTubeForVideoBeamBody,
  SearchYouTubeForVideoBeamResponse,
  type UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import { TrackSource } from "livekit-server-sdk";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireCompletedProfile } from "../lib/account-profiles";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import { communityDefaultVideoSearch } from "../lib/community-config";
import {
  postBeamTvVoteAnnouncement,
  scheduleBeamTvVideoStart,
  updateBeamTvVideoMetadata,
} from "../lib/moderator-bots";

const router = Router();
universityVideoBeamStore.setAutomaticVideoStartListener((roomId, videoId, metadata) => {
  scheduleBeamTvVideoStart(roomId, videoId, metadata);
});
const participantSnapshots = new Map<string, { expiresAt: number; identities: Set<string> }>();
const PARTICIPANT_SNAPSHOT_TTL_MS = 1_500;
type YouTubeSearchResult = {
  videoIds: string[];
  titles: string[];
  videos: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};
const youtubeSearchCache = new Map<string, { expiresAt: number } & YouTubeSearchResult>();
const youtubeSearchInFlight = new Map<string, Promise<YouTubeSearchResult>>();
const YOUTUBE_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function parseYouTubeDurationMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000) : null;
}

async function searchYouTube(query: string, apiKey: string) {
  const cacheKey = normalizeSearchQuery(query);
  const cached = youtubeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
      return {
        videoIds: cached.videoIds,
        titles: cached.titles,
        videos: cached.videos,
        durationMsByVideoId: cached.durationMsByVideoId,
      };
  }
  const pending = youtubeSearchInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.search = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "strict",
      maxResults: "10",
      q: query,
      key: apiKey,
    }).toString();
    let response: Response;
    try {
      response = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new RoomError(502, "YouTube search could not be reached. Paste a video or playlist link instead.");
    }
    if (!response.ok) throw new RoomError(502, "YouTube search is unavailable right now. Paste a video or playlist link instead.");
    const payload: unknown = await response.json().catch(() => null);
    const items = typeof payload === "object" && payload !== null && "items" in payload
      && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items : [];
    const results = items.flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as { id?: { videoId?: unknown }; snippet?: {
        title?: unknown; channelTitle?: unknown; description?: unknown;
      } };
      const videoId = record.id?.videoId;
      if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return [];
      const title = typeof record.snippet?.title === "string" ? record.snippet.title.slice(0, 200) : "YouTube video";
      const channelTitle = typeof record.snippet?.channelTitle === "string"
        ? record.snippet.channelTitle.slice(0, 120) : null;
      const description = typeof record.snippet?.description === "string"
        ? record.snippet.description.slice(0, 500) : null;
      return [{ videoId, title, channelTitle, description }];
    });
    if (results.length === 0) throw new RoomError(404, "No embeddable YouTube videos were found for that topic.");

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.search = new URLSearchParams({
      part: "contentDetails",
      id: results.map(item => item.videoId).join(","),
      key: apiKey,
    }).toString();
    let detailsResponse: Response;
    try {
      detailsResponse = await fetch(detailsUrl, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new RoomError(502, "YouTube video details could not be reached. Try again shortly.");
    }
    if (!detailsResponse.ok) {
      throw new RoomError(502, "YouTube video details are unavailable right now. Try again shortly.");
    }
    const detailsPayload: unknown = await detailsResponse.json().catch(() => null);
    const details = typeof detailsPayload === "object" && detailsPayload !== null && "items" in detailsPayload
      && Array.isArray((detailsPayload as { items?: unknown }).items)
      ? (detailsPayload as { items: unknown[] }).items : [];
    const durationMsByVideoId: Record<string, number> = {};
    for (const item of details) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as { id?: unknown; contentDetails?: { duration?: unknown } };
      const durationMs = parseYouTubeDurationMs(record.contentDetails?.duration);
      if (typeof record.id === "string" && durationMs) durationMsByVideoId[record.id] = durationMs;
    }
    const timedResults = results.filter(item => durationMsByVideoId[item.videoId] !== undefined);
    if (timedResults.length === 0) {
      throw new RoomError(404, "No playable videos with a known duration were found for that topic.");
    }
    return {
      videoIds: timedResults.map(item => item.videoId),
      titles: timedResults.map(item => item.title),
      videos: timedResults,
      durationMsByVideoId,
    };
  })();
  youtubeSearchInFlight.set(cacheKey, request);
  try {
    const result = await request;
    youtubeSearchCache.set(cacheKey, { ...result, expiresAt: Date.now() + YOUTUBE_SEARCH_CACHE_MS });
    if (youtubeSearchCache.size > 100) {
      const oldestKey = youtubeSearchCache.keys().next().value;
      if (oldestKey) youtubeSearchCache.delete(oldestKey);
    }
    return result;
  } finally {
    if (youtubeSearchInFlight.get(cacheKey) === request) youtubeSearchInFlight.delete(cacheKey);
  }
}

function requireMember(req: Request, roomId: string, id: string) {
  const sessionId = req.get("X-Room-Session") ?? "";
  const participant = roomStore.requireAccountMember(roomId, sessionId, id);
  return { sessionId, participant };
}

async function reconcileState(roomId: string, viewerAccountId?: string) {
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
    viewerAccountId,
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
  const state = await reconcileState(req.params.roomId, id);
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

router.get("/account/rooms/:roomId/video-beam/tv", (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  res.set("Cache-Control", "no-store")
    .json(GetUniversityVideoBeamTvStateResponse.parse(universityVideoBeamStore.getState(req.params.roomId, id).tv));
});

router.post("/account/rooms/:roomId/video-beam/tv", async (req, res): Promise<void> => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = PerformUniversityVideoBeamTvActionBody.safeParse(req.body);
  const allowed = [
    "action", "sourceType", "sourceValue", "playlistId", "queue", "currentVideoId",
    "startedAtMs", "skipVotingEnabled", "videoMetadata",
  ];
  if (!input.success || Object.keys(req.body ?? {}).some(key => !allowed.includes(key))) {
    throw new RoomError(400, "Choose a valid Beam TV action.");
  }
  const roomId = req.params.roomId;
  const before = universityVideoBeamStore.getState(roomId).tv;
  const state = universityVideoBeamStore.actOnTv(roomId, participant.participantId, input.data, id);
  const videoChanged = state.tv.currentVideoId !== before.currentVideoId;
  const restarted = input.data.action === "start" || input.data.action === "enable";
  if (state.tv.currentVideoId && (videoChanged || restarted)) {
    const metadata = input.data.videoMetadata
      ?? state.tv.videoMetadata.find(item => item.videoId === state.tv.currentVideoId);
    scheduleBeamTvVideoStart(roomId, state.tv.currentVideoId, metadata, restarted);
  }
  if (input.data.action === "publish-playback" && input.data.videoMetadata) {
    updateBeamTvVideoMetadata(roomId, input.data.videoMetadata);
  }
  const skipWasAccepted = input.data.action === "vote-skip"
    && (state.tv.currentVideoId !== before.currentVideoId || state.tv.skipSequence !== before.skipSequence);
  if (skipWasAccepted) {
    void postBeamTvVoteAnnouncement(roomId).catch(error => {
      req.log.error({ err: error, roomId }, "Could not post Beam TV vote announcement");
    });
  }
  res.set("Cache-Control", "no-store")
    .json(PerformUniversityVideoBeamTvActionResponse.parse(state.tv));
});

router.post("/account/rooms/:roomId/video-beam/tv/search", async (req, res) => {
  sameOrigin(req);
  const id = accountId(req);
  const { participant } = requireMember(req, req.params.roomId, id);
  const input = SearchYouTubeForVideoBeamBody.safeParse(req.body);
  if (!input.success || Object.keys(req.body ?? {}).some(key => key !== "query")) {
    throw new RoomError(400, "Enter a YouTube search topic.");
  }
  const query = input.data.query.trim().replace(/\s+/g, " ");
  if (!query) throw new RoomError(400, "Enter a YouTube search topic.");
  const roomId = req.params.roomId;
  const tv = universityVideoBeamStore.getState(roomId).tv;
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const autoDefaultSearch = tv.enabled && tv.sourceType === "search"
    && tv.queue.length === 0 && tv.currentVideoId === null
    && normalizeSearchQuery(tv.sourceValue ?? "") === normalizeSearchQuery(defaultSearch)
    && normalizeSearchQuery(query) === normalizeSearchQuery(defaultSearch);
  if (!autoDefaultSearch) universityVideoBeamStore.assertTvHost(roomId, participant.participantId);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new RoomError(503, "YouTube search needs YOUTUBE_API_KEY. Paste a video or playlist link instead.");
  }
  const result = await searchYouTube(query, apiKey);
  if (autoDefaultSearch) {
    const before = universityVideoBeamStore.getState(roomId).tv.currentVideoId;
    const state = universityVideoBeamStore.initializeDefaultTvQueue(
      roomId, query, result.videos, result.durationMsByVideoId,
    );
    if (state.tv.currentVideoId && state.tv.currentVideoId !== before) {
      scheduleBeamTvVideoStart(roomId, state.tv.currentVideoId,
        result.videos.find(video => video.videoId === state.tv.currentVideoId));
    }
  }
  const { durationMsByVideoId: _durations, ...publicResult } = result;
  res.set("Cache-Control", "no-store")
    .json(SearchYouTubeForVideoBeamResponse.parse(publicResult));
});

export default router;
