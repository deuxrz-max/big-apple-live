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
  type UniversityVideoBeamState,
  type UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import { TrackSource } from "livekit-server-sdk";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireCompletedProfile } from "../lib/account-profiles";
import { universityVideoBeamStore } from "../lib/university-video-beam";
import { liveKitBeamService, publicLiveKitFailure } from "../lib/livekit";
import {
  communityDefaultVideoSearch,
  communityLiveStreamPolicy,
  communityVideoSearchPolicy,
} from "../lib/community-config";
import { selectPlayableYouTubeVideos } from "../lib/youtube-video-selection";
import { resolveYouTubeChannelId, searchCnnLiveStream } from "../lib/cnn-live-news";
import { logger } from "../lib/logger";
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
const appliedSpeakerPolicies = new Map<string, Map<string, string>>();
const publicPlaybackTimers = new Map<string, { dueAt: number; timer: ReturnType<typeof setTimeout> }>();
const PARTICIPANT_SNAPSHOT_TTL_MS = 1_500;
type YouTubeSearchResult = {
  videoIds: string[];
  titles: string[];
  videos: UniversityVideoBeamTvVideoMetadata[];
  durationMsByVideoId: Record<string, number>;
};
const youtubeSearchCache = new Map<string, { expiresAt: number } & YouTubeSearchResult>();
const youtubeSearchFailureCache = new Map<string, { expiresAt: number; status: number; message: string }>();
const youtubeSearchInFlight = new Map<string, Promise<YouTubeSearchResult>>();
const YOUTUBE_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_SEARCH_TRANSIENT_FAILURE_MS = 10 * 60 * 1000;

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

async function searchYouTube(
  query: string,
  apiKey: string,
  policy: ReturnType<typeof communityVideoSearchPolicy> = null,
  options: { channelId?: string; cacheTtlMs?: number } = {},
) {
  const cacheKey = [
    normalizeSearchQuery(query),
    policy?.order ?? "relevance",
    policy?.publishedWithinDays ?? "any-date",
    policy?.trustedChannelTitles?.map(normalizeSearchQuery).sort().join(",") ?? "all-channels",
    options.channelId ?? "any-channel",
  ].join("|");
  const cached = youtubeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
      return {
        videoIds: cached.videoIds,
        titles: cached.titles,
        videos: cached.videos,
        durationMsByVideoId: cached.durationMsByVideoId,
      };
  }
  const cachedFailure = youtubeSearchFailureCache.get(cacheKey);
  if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
    throw new RoomError(cachedFailure.status, cachedFailure.message);
  }
  if (cachedFailure) youtubeSearchFailureCache.delete(cacheKey);
  const pending = youtubeSearchInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "strict",
      maxResults: "10",
      q: query,
      key: apiKey,
    });
    if (policy?.order) searchParams.set("order", policy.order);
    if (options.channelId) searchParams.set("channelId", options.channelId);
    if (policy?.publishedWithinDays) {
      searchParams.set("publishedAfter", new Date(
        Date.now() - policy.publishedWithinDays * 24 * 60 * 60 * 1_000,
      ).toISOString());
    }
    searchUrl.search = searchParams.toString();
    let response: Response;
    try {
      response = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new RoomError(502, "YouTube search could not be reached. Paste a video or playlist link instead.");
    }
    if (!response.ok) {
      const quotaOrCredentialFailure = response.status === 403 || response.status === 429;
      throw new RoomError(
        quotaOrCredentialFailure ? 503 : 502,
        "YouTube search is unavailable right now. A room-matched video will appear when it is available.",
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    const items = typeof payload === "object" && payload !== null && "items" in payload
      && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items : [];
    const results = items.flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as { id?: { videoId?: unknown }; snippet?: {
        title?: unknown; channelTitle?: unknown; channelId?: unknown;
        description?: unknown; liveBroadcastContent?: unknown;
      } };
      const videoId = record.id?.videoId;
      if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return [];
      const title = typeof record.snippet?.title === "string" ? record.snippet.title.slice(0, 200) : "YouTube video";
      const channelTitle = typeof record.snippet?.channelTitle === "string"
        ? record.snippet.channelTitle.slice(0, 120) : null;
      const description = typeof record.snippet?.description === "string"
        ? record.snippet.description.slice(0, 500) : null;
      const liveBroadcastContent = typeof record.snippet?.liveBroadcastContent === "string"
        ? record.snippet.liveBroadcastContent : null;
      const channelId = typeof record.snippet?.channelId === "string"
        ? record.snippet.channelId : null;
      return [{ videoId, title, channelTitle, description, liveBroadcastContent, channelId }];
    });
    if (results.length === 0) throw new RoomError(404, "No embeddable YouTube videos were found for that topic.");

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.search = new URLSearchParams({
      part: "contentDetails,status",
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
      throw new RoomError(
        detailsResponse.status === 403 || detailsResponse.status === 429 ? 503 : 502,
        "YouTube video details are unavailable right now.",
      );
    }
    const detailsPayload: unknown = await detailsResponse.json().catch(() => null);
    const details = typeof detailsPayload === "object" && detailsPayload !== null && "items" in detailsPayload
      && Array.isArray((detailsPayload as { items?: unknown }).items)
      ? (detailsPayload as { items: unknown[] }).items : [];
    const eligibility = details.flatMap(item => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as {
        id?: unknown;
        contentDetails?: { duration?: unknown; contentRating?: { ytRating?: unknown } };
        status?: { embeddable?: unknown };
      };
      if (typeof record.id !== "string") return [];
      return [{
        videoId: record.id,
        durationMs: parseYouTubeDurationMs(record.contentDetails?.duration),
        embeddable: record.status?.embeddable === true,
        ytRating: typeof record.contentDetails?.contentRating?.ytRating === "string"
          ? record.contentDetails.contentRating.ytRating : null,
      }];
    });
    const playable = selectPlayableYouTubeVideos(results, eligibility, policy?.trustedChannelTitles);
    if (playable.videos.length === 0) {
      throw new RoomError(404, "No suitable videos are available for this room right now.");
    }
    return {
      videoIds: playable.videos.map(item => item.videoId),
      titles: playable.videos.map(item => item.title),
      videos: playable.videos.map(({ liveBroadcastContent: _live, ...video }) => video),
      durationMsByVideoId: playable.durationMsByVideoId,
    };
  })();
  youtubeSearchInFlight.set(cacheKey, request);
  try {
    const result = await request;
    youtubeSearchCache.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + (options.cacheTtlMs ?? YOUTUBE_SEARCH_CACHE_MS),
    });
    youtubeSearchFailureCache.delete(cacheKey);
    if (youtubeSearchCache.size > 100) {
      const oldestKey = youtubeSearchCache.keys().next().value;
      if (oldestKey) youtubeSearchCache.delete(oldestKey);
    }
    return result;
  } catch (error) {
    if (error instanceof RoomError) {
      const cacheMs = error.status === 404 || error.status === 503
        ? YOUTUBE_SEARCH_CACHE_MS
        : YOUTUBE_SEARCH_TRANSIENT_FAILURE_MS;
      youtubeSearchFailureCache.set(cacheKey, {
        expiresAt: Date.now() + cacheMs,
        status: error.status,
        message: error.message,
      });
      if (youtubeSearchFailureCache.size > 100) {
        const oldestKey = youtubeSearchFailureCache.keys().next().value;
        if (oldestKey) youtubeSearchFailureCache.delete(oldestKey);
      }
    }
    throw error;
  } finally {
    if (youtubeSearchInFlight.get(cacheKey) === request) youtubeSearchInFlight.delete(cacheKey);
  }
}

async function searchDefaultCommunityVideos(roomId: string, apiKey: string) {
  const livePolicy = communityLiveStreamPolicy(roomId, roomStore);
  if (!livePolicy) {
    return searchYouTube(
      communityDefaultVideoSearch(roomId, roomStore) ?? "popular videos",
      apiKey,
      communityVideoSearchPolicy(roomId, roomStore),
    );
  }

  const channelId = await resolveYouTubeChannelId(apiKey, livePolicy.channelHandle, livePolicy.channelTitle);
  try {
    const liveVideo = await searchCnnLiveStream(apiKey, channelId, livePolicy);
    if (liveVideo) {
      return {
        videoIds: [liveVideo.videoId],
        titles: [liveVideo.title],
        videos: [liveVideo],
        durationMsByVideoId: { [liveVideo.videoId]: livePolicy.segmentDurationMs },
      };
    }
  } catch (error) {
    // A cached latest-video fallback can still serve the room when live search is temporarily unavailable.
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "CNN live search failed; trying the News fallback queue");
  }

  return searchYouTube(
    livePolicy.fallbackSearch,
    apiKey,
    communityVideoSearchPolicy(roomId, roomStore),
    { channelId, cacheTtlMs: 60 * 60_000 },
  );
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
  const state = universityVideoBeamStore.reconcileLiveKitParticipants(
    roomId,
    snapshot.identities,
    viewerAccountId,
  );
  const synchronized = await synchronizeSpeakerMediaPermissions(
    roomId, state, snapshot.identities, viewerAccountId,
  );
  schedulePublicPlaybackTransition(roomId);
  return synchronized;
}

async function refreshNewsQueueAtTransition(
  roomId: string,
  state: UniversityVideoBeamState,
  transitionAt: number,
) {
  const livePolicy = communityLiveStreamPolicy(roomId, roomStore);
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const tv = state.tv;
  if (!livePolicy || !defaultSearch || !tv.enabled || tv.sourceType !== "search"
    || normalizeSearchQuery(tv.sourceValue ?? "") !== normalizeSearchQuery(defaultSearch)
    || tv.breakEndsAtMs !== null || tv.startedAtMs !== transitionAt || !tv.currentVideoId) {
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return;
  try {
    const result = await searchDefaultCommunityVideos(roomId, apiKey);
    const refreshed = universityVideoBeamStore.refreshAutomaticDefaultTvQueue(
      roomId,
      defaultSearch,
      result.videos,
      result.durationMsByVideoId,
      tv.currentVideoId,
      transitionAt,
    );
    if (refreshed.tv.currentVideoId !== tv.currentVideoId && refreshed.tv.currentVideoId) {
      scheduleBeamTvVideoStart(
        roomId,
        refreshed.tv.currentVideoId,
        refreshed.tv.videoMetadata.find(video => video.videoId === refreshed.tv.currentVideoId),
        true,
      );
    }
    const roomName = universityVideoBeamStore.getRoomName(roomId);
    const identities = await refreshParticipantSnapshot(roomName);
    await synchronizeSpeakerMediaPermissions(roomId, refreshed, identities);
    schedulePublicPlaybackTransition(roomId);
  } catch (error) {
    logger.warn({ roomId, error: error instanceof Error ? error.message : "unknown" },
      "Could not refresh the News room's automatic Beam TV queue");
  }
}

function schedulePublicPlaybackTransition(roomId: string) {
  const dueAt = universityVideoBeamStore.getNextAutomaticPlaybackTransitionAt(roomId);
  const previous = publicPlaybackTimers.get(roomId);
  if (previous?.dueAt === dueAt) return;
  if (previous) clearTimeout(previous.timer);
  publicPlaybackTimers.delete(roomId);
  if (dueAt === null) return;

  const timer = setTimeout(() => {
    const current = publicPlaybackTimers.get(roomId);
    if (current?.dueAt !== dueAt) return;
    publicPlaybackTimers.delete(roomId);
    void reconcileState(roomId).then(state => refreshNewsQueueAtTransition(roomId, state, dueAt)).catch(() => {
      const retryDueAt = Date.now() + 2_500;
      const retryTimer = setTimeout(() => {
        const retry = publicPlaybackTimers.get(roomId);
        if (retry?.dueAt !== retryDueAt) return;
        publicPlaybackTimers.delete(roomId);
        schedulePublicPlaybackTransition(roomId);
      }, 2_500);
      publicPlaybackTimers.set(roomId, { dueAt: retryDueAt, timer: retryTimer });
    });
  }, Math.max(0, dueAt - Date.now()));
  publicPlaybackTimers.set(roomId, { dueAt, timer });
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

function sourcesForSlot(
  slot: UniversityVideoBeamState["slots"][number],
  micLockedDuringVideo: boolean,
  micOverride?: boolean,
  cameraOverride?: boolean,
): { sources: TrackSource[]; microphoneEnabled: boolean } {
  const microphoneEnabled = !micLockedDuringVideo
    && (micOverride ?? (!slot.micMuted && !slot.mutedByHost));
  const cameraEnabled = cameraOverride ?? (!slot.cameraOff && !slot.cameraDisabledByHost);
  return {
    sources: [
      microphoneEnabled ? TrackSource.MICROPHONE : null,
      cameraEnabled ? TrackSource.CAMERA : null,
    ].filter((source): source is TrackSource => source !== null),
    microphoneEnabled,
  };
}

async function synchronizeSpeakerMediaPermissions(
  roomId: string,
  state: UniversityVideoBeamState,
  liveIdentities: ReadonlySet<string>,
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
    if (!participantId || !liveIdentities.has(participantId)) continue;
    const policy = sourcesForSlot(slot, state.tv.micLockedDuringVideo);
    const signature = `${policy.microphoneEnabled}:${policy.sources.join(",")}`;
    if (policies.get(participantId) === signature) continue;
    try {
      await liveKitBeamService.applySpeakerMediaPolicy(
        roomName, participantId, policy.sources, policy.microphoneEnabled,
      );
      policies.set(participantId, signature);
    } catch (failure) {
      if (state.tv.micLockedDuringVideo) {
        try {
          await liveKitBeamService.removeParticipant(roomName, participantId);
          universityVideoBeamStore.leaveSlot(roomId, participantId);
          policies.delete(participantId);
          continue;
        } catch {
          throw publicLiveKitFailure(failure);
        }
      }
      throw publicLiveKitFailure(failure);
    }
  }
  return universityVideoBeamStore.getState(roomId, viewerAccountId);
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
        const current = universityVideoBeamStore.getState(roomId);
        const policy = sourcesForSlot(
          slot,
          current.tv.micLockedDuringVideo,
          media === "mic" ? input.data.enabled : undefined,
          media === "camera" ? input.data.enabled : undefined,
        );
        await liveKitBeamService.setSelfTrackEnabled(
          roomName, participant.participantId, media, input.data.enabled, policy.sources,
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
        const current = universityVideoBeamStore.getState(roomId);
        const policy = sourcesForSlot(
          slot,
          current.tv.micLockedDuringVideo,
          media === "mic" ? false : undefined,
          media === "camera" ? false : undefined,
        );
        await liveKitBeamService.disableTrack(roomName, target, media, policy.sources);
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

  const identities = await refreshParticipantSnapshot(roomName);
  state = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  res.set("Cache-Control", "no-store").json(PerformUniversityVideoBeamActionResponse.parse(state));
});

router.get("/account/rooms/:roomId/video-beam/tv", async (req, res) => {
  const id = accountId(req);
  requireMember(req, req.params.roomId, id);
  const state = await reconcileState(req.params.roomId, id);
  res.set("Cache-Control", "no-store")
    .json(GetUniversityVideoBeamTvStateResponse.parse(state.tv));
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
  const before = (await reconcileState(roomId, id)).tv;
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
  const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
  const synchronized = await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
  schedulePublicPlaybackTransition(roomId);
  res.set("Cache-Control", "no-store")
    .json(PerformUniversityVideoBeamTvActionResponse.parse(synchronized.tv));
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
  const tv = (await reconcileState(roomId, id)).tv;
  const defaultSearch = communityDefaultVideoSearch(roomId, roomStore);
  const autoDefaultSearch = tv.enabled && tv.sourceType === "search"
    && tv.queue.length === 0 && tv.currentVideoId === null
    && normalizeSearchQuery(tv.sourceValue ?? "") === normalizeSearchQuery(defaultSearch)
    && normalizeSearchQuery(query) === normalizeSearchQuery(defaultSearch);
  if (!autoDefaultSearch) universityVideoBeamStore.assertTvHost(roomId, participant.participantId);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new RoomError(503, "YouTube search is temporarily unavailable. A room-matched video will appear when it is available.");
  }
  const result = autoDefaultSearch
    ? await searchDefaultCommunityVideos(roomId, apiKey)
    : await searchYouTube(query, apiKey);
  if (autoDefaultSearch) {
    const before = universityVideoBeamStore.getState(roomId).tv.currentVideoId;
    const state = universityVideoBeamStore.initializeDefaultTvQueue(
      roomId, query, result.videos, result.durationMsByVideoId,
    );
    const identities = await refreshParticipantSnapshot(universityVideoBeamStore.getRoomName(roomId));
    await synchronizeSpeakerMediaPermissions(roomId, state, identities, id);
    schedulePublicPlaybackTransition(roomId);
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
