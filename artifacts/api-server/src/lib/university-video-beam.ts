import { createHash } from "node:crypto";
import type {
  UniversityVideoBeamState,
  UniversityVideoBeamTvActionInput,
  UniversityVideoBeamTvState,
  UniversityVideoBeamTvVideoMetadata,
} from "@workspace/api-zod";
import { RoomError, RoomStore, roomStore } from "./room-store";
import {
  communityDefaultVideoSearch,
  communityLiveStreamPolicy,
  isCommunityDailyWebSeriesRoom,
  isPublicTopicRoom,
} from "./community-config";

export const VIDEO_BEAM_SLOT_COUNT = 9;
export const VIDEO_BEAM_CONNECT_GRACE_MS = 90_000;
export const PUBLIC_BEAM_TV_BREAK_MS = 3 * 60_000;

function utcDateFromKey(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

type BeamSlot = {
  slotNumber: number;
  participantId: string | null;
  accountId: string | null;
  joinedAt: number | null;
  connectedAt: number | null;
  micMuted: boolean;
  cameraOff: boolean;
  mutedByHost: boolean;
  cameraDisabledByHost: boolean;
};

type Beam = {
  roomId: string;
  historyId: string;
  hostParticipantId: string | null;
  slots: BeamSlot[];
  tv: Omit<UniversityVideoBeamTvState,
    "searchAvailable" | "skipVoteCount" | "skipVoteTotal" | "hasVotedToSkip"
    | "micLockedDuringVideo" | "serverNowMs">;
  skipVotes: Set<string>;
  videoDurationsMs: Map<string, number>;
};

export type BeamSeatLifecycleEvent = {
  type: "joined" | "left";
  roomId: string;
  accountId: string;
  participantId: string;
  at: number;
};

export class UniversityVideoBeamStore {
  private readonly beams = new Map<string, Beam>();
  private automaticVideoStartListener:
    ((roomId: string, videoId: string, metadata: UniversityVideoBeamTvVideoMetadata | undefined) => void) | null = null;
  private seatLifecycleListener: ((event: BeamSeatLifecycleEvent) => void) | null = null;

  constructor(
    private readonly rooms: RoomStore = roomStore,
    private readonly now: () => number = Date.now,
  ) {}

  setAutomaticVideoStartListener(
    listener: (roomId: string, videoId: string, metadata: UniversityVideoBeamTvVideoMetadata | undefined) => void,
  ) {
    this.automaticVideoStartListener = listener;
  }

  setSeatLifecycleListener(listener: ((event: BeamSeatLifecycleEvent) => void) | null): void {
    this.seatLifecycleListener = listener;
  }

  /** Server-only identity view used by reward eligibility; never serialized to room clients. */
  connectedSeatOccupants(roomId: string): { accountId: string; participantId: string; slotNumber: number }[] {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) return [];
    const key = `${id}:${this.rooms.getHistoryId(id)}`;
    const beam = this.beams.get(key);
    if (!beam) return [];
    return beam.slots.flatMap(slot => slot.accountId && slot.participantId && slot.connectedAt !== null
      ? [{ accountId: slot.accountId, participantId: slot.participantId, slotNumber: slot.slotNumber }]
      : []);
  }

  getRoomName(roomId: string): string {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "Room not found.");
    return `streamtalk-${createHash("sha256")
      .update(`${id}:${this.rooms.getHistoryId(id)}`)
      .digest("hex")
      .slice(0, 32)}`;
  }

  getState(roomId: string, viewerAccountId?: string): UniversityVideoBeamState {
    return this.toState(this.ensure(roomId), viewerAccountId);
  }

  /** Read currently playing metadata for directory cards without initializing playback. */
  getDirectoryNowPlaying(roomId: string): { videoId: string; title: string } | null {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) return null;
    const key = `${id}:${this.rooms.getHistoryId(id)}`;
    const beam = this.beams.get(key);
    const videoId = beam?.tv.currentVideoId;
    if (!beam || !videoId || beam.tv.breakEndsAtMs !== null) return null;
    const metadata = beam.tv.videoMetadata.find(video => video.videoId === videoId);
    return metadata ? { videoId, title: metadata.title } : null;
  }

  getNextAutomaticPlaybackTransitionAt(roomId: string): number | null {
    const beam = this.ensure(roomId);
    this.advanceOwnerlessTopicPlayback(beam);
    const tv = beam.tv;
    if (!this.isOwnerlessTopicRoom(beam.roomId) || !tv.enabled || !tv.currentVideoId || tv.startedAtMs === null) {
      return null;
    }
    if (tv.breakEndsAtMs !== null) {
      if (tv.breakEndsAtMs <= this.now()
        && !communityLiveStreamPolicy(beam.roomId, this.rooms)
        && !isCommunityDailyWebSeriesRoom(beam.roomId, this.rooms)) return null;
      return tv.breakEndsAtMs;
    }
    const durationMs = beam.videoDurationsMs.get(tv.currentVideoId);
    return durationMs ? tv.startedAtMs + durationMs : null;
  }

  getAutomaticVideoDurationsMs(roomId: string): Record<string, number> {
    const beam = this.ensure(roomId);
    return Object.fromEntries(beam.videoDurationsMs);
  }

  assertTvHost(roomId: string, participantId: string): void {
    this.requireHost(this.ensure(roomId), participantId);
  }

  initializeDefaultTvQueue(
    roomId: string,
    query: string,
    videos: UniversityVideoBeamTvVideoMetadata[],
    durationMsByVideoId: Readonly<Record<string, number>> = {},
    series?: { title: string; date: string; episodeNumber: number },
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!tv.enabled || tv.sourceType !== "search" || tv.queue.length
      || normalize(query) !== normalize(tv.defaultSearch)
      || normalize(tv.sourceValue ?? "") !== normalize(tv.defaultSearch)) {
      return this.toState(beam);
    }
    const validVideos = videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId))
      .slice(0, 50)
      .map(video => this.normalizeMetadata(video));
    const validIds = validVideos.map(video => video.videoId);
    if (!validIds.length) throw new RoomError(400, "No playable YouTube videos were found.");
    tv.queue = [...validIds];
    tv.videoMetadata = validVideos;
    beam.videoDurationsMs.clear();
    for (const [videoId, durationMs] of Object.entries(durationMsByVideoId)) {
      if (validIds.includes(videoId) && Number.isFinite(durationMs) && durationMs > 0) {
        beam.videoDurationsMs.set(videoId, durationMs);
      }
    }
    tv.currentVideoId = validIds[0]!;
    tv.startedAtMs = this.now();
    tv.breakEndsAtMs = null;
    tv.seriesTitle = series?.title ?? null;
    tv.seriesDate = utcDateFromKey(series?.date);
    tv.seriesEpisodeNumber = series?.episodeNumber ?? null;
    beam.skipVotes.clear();
    return this.toState(beam);
  }

  restoreAutomaticDefaultTvQueue(
    roomId: string,
    videos: UniversityVideoBeamTvVideoMetadata[],
    durationMsByVideoId: Readonly<Record<string, number>>,
    currentVideoId: string,
    startedAtMs: number,
    breakEndsAtMs: number | null = null,
    series?: { title: string | null; date: string | null; episodeNumber: number | null },
    preserveQueueOrder = false,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    if (!this.isOwnerlessTopicRoom(beam.roomId)) {
      throw new RoomError(404, "Automatic topic playback is not available in this room.");
    }
    const validVideos = videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId));
    if (!validVideos.some(video => video.videoId === currentVideoId)
      || !Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
      throw new RoomError(400, "The saved room playback schedule is invalid.");
    }
    const ordered = (preserveQueueOrder
      ? validVideos
      : [
        ...validVideos.filter(video => video.videoId === currentVideoId),
        ...validVideos.filter(video => video.videoId !== currentVideoId),
      ]).slice(0, 50);
    beam.tv.enabled = true;
    beam.tv.defaultSearch = communityDefaultVideoSearch(beam.roomId, this.rooms);
    beam.tv.sourceType = "search";
    beam.tv.sourceValue = beam.tv.defaultSearch;
    beam.tv.playlistId = null;
    beam.tv.queue = ordered.map(video => video.videoId);
    beam.tv.videoMetadata = ordered.map(video => this.normalizeMetadata(video));
    beam.tv.currentVideoId = currentVideoId;
    beam.tv.startedAtMs = startedAtMs;
    beam.tv.breakEndsAtMs = breakEndsAtMs;
    beam.tv.skipVotingEnabled = false;
    beam.tv.seriesTitle = series?.title ?? null;
    beam.tv.seriesDate = series?.date ? utcDateFromKey(series.date) : null;
    beam.tv.seriesEpisodeNumber = series?.episodeNumber ?? null;
    beam.skipVotes.clear();
    beam.videoDurationsMs.clear();
    for (const [videoId, durationMs] of Object.entries(durationMsByVideoId)) {
      if (beam.tv.queue.includes(videoId) && Number.isFinite(durationMs) && durationMs > 0) {
        beam.videoDurationsMs.set(videoId, durationMs);
      }
    }
    return this.toState(beam);
  }

  advanceAutomaticDefaultTvQueue(
    roomId: string,
    nextVideoId: string,
    expectedCurrentVideoId: string,
    expectedStartedAtMs: number,
    expectedBreakEndsAtMs: number,
    nextStartedAtMs: number,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const normalize = (value: string | null) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!this.isOwnerlessTopicRoom(beam.roomId)
      || communityLiveStreamPolicy(beam.roomId, this.rooms)
      || !tv.enabled
      || tv.sourceType !== "search"
      || normalize(tv.sourceValue) !== normalize(tv.defaultSearch)
      || tv.currentVideoId !== expectedCurrentVideoId
      || tv.startedAtMs !== expectedStartedAtMs
      || tv.breakEndsAtMs !== expectedBreakEndsAtMs
      || expectedBreakEndsAtMs > this.now()
      || !tv.queue.includes(nextVideoId)
      || !Number.isSafeInteger(nextStartedAtMs)
      || nextStartedAtMs !== expectedBreakEndsAtMs) {
      return this.toState(beam);
    }
    tv.currentVideoId = nextVideoId;
    tv.startedAtMs = nextStartedAtMs;
    tv.breakEndsAtMs = null;
    beam.skipVotes.clear();
    tv.skipSequence += 1;
    return this.toState(beam);
  }

  replaceDailyWebSeries(
    roomId: string,
    query: string,
    date: string,
    selection: {
      title: string;
      episodes: UniversityVideoBeamTvVideoMetadata[];
      durationMsByVideoId: Readonly<Record<string, number>>;
    } | null,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!isCommunityDailyWebSeriesRoom(beam.roomId, this.rooms)
      || !this.isOwnerlessTopicRoom(beam.roomId)
      || normalize(query) !== normalize(tv.defaultSearch)
      || normalize(tv.sourceValue ?? "") !== normalize(tv.defaultSearch)) {
      return this.toState(beam);
    }
    const videos = selection?.episodes
      .filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId))
      .slice(0, 50) ?? [];
    const videoIds = videos.map(video => video.videoId);
    tv.enabled = true;
    tv.sourceType = "search";
    tv.sourceValue = tv.defaultSearch;
    tv.playlistId = null;
    tv.queue = videoIds;
    tv.videoMetadata = videos.map(video => this.normalizeMetadata(video));
    tv.seriesTitle = selection?.title ?? null;
    tv.seriesDate = utcDateFromKey(date);
    tv.seriesEpisodeNumber = videos.length ? 1 : null;
    tv.currentVideoId = videoIds[0] ?? null;
    tv.startedAtMs = tv.currentVideoId ? this.now() : null;
    tv.breakEndsAtMs = null;
    beam.videoDurationsMs.clear();
    for (const [videoId, videoDurationMs] of Object.entries(selection?.durationMsByVideoId ?? {})) {
      if (videoIds.includes(videoId) && Number.isFinite(videoDurationMs) && videoDurationMs > 0) {
        beam.videoDurationsMs.set(videoId, videoDurationMs);
      }
    }
    beam.skipVotes.clear();
    tv.skipSequence += 1;
    if (tv.currentVideoId) {
      this.automaticVideoStartListener?.(
        beam.roomId,
        tv.currentVideoId,
        tv.videoMetadata.find(item => item.videoId === tv.currentVideoId),
      );
    }
    return this.toState(beam);
  }

  refreshAutomaticDefaultTvQueue(
    roomId: string,
    query: string,
    videos: UniversityVideoBeamTvVideoMetadata[],
    durationMsByVideoId: Readonly<Record<string, number>>,
    expectedCurrentVideoId: string,
    expectedStartedAtMs: number,
    nextStartedAtMs?: number,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!this.isOwnerlessTopicRoom(beam.roomId)
      || !tv.enabled
      || tv.sourceType !== "search"
      || normalize(query) !== normalize(tv.defaultSearch)
      || normalize(tv.sourceValue ?? "") !== normalize(tv.defaultSearch)
      || tv.breakEndsAtMs !== null
      || tv.currentVideoId !== expectedCurrentVideoId
      || tv.startedAtMs !== expectedStartedAtMs) {
      return this.toState(beam);
    }

    const validVideos = videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId)).slice(0, 10);
    const validIds = validVideos.map(video => video.videoId);
    if (!validIds.length) throw new RoomError(400, "No playable YouTube videos were found.");

    tv.queue = [...validIds];
    tv.videoMetadata = validVideos;
    beam.videoDurationsMs.clear();
    for (const [videoId, durationMs] of Object.entries(durationMsByVideoId)) {
      if (validIds.includes(videoId) && Number.isFinite(durationMs) && durationMs > 0) {
        beam.videoDurationsMs.set(videoId, durationMs);
      }
    }
    tv.currentVideoId = validIds[0]!;
    tv.startedAtMs = nextStartedAtMs ?? this.now();
    tv.breakEndsAtMs = null;
    tv.seriesTitle = null;
    tv.seriesDate = null;
    tv.seriesEpisodeNumber = null;
    beam.skipVotes.clear();
    return this.toState(beam);
  }

  advanceAutomaticVideoAfterPlayerFailure(
    roomId: string,
    videos: UniversityVideoBeamTvVideoMetadata[],
    durationMsByVideoId: Readonly<Record<string, number>>,
    expectedFailedVideoId: string,
    selectedVideoId: string | null,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    if (!this.isOwnerlessTopicRoom(beam.roomId) || !tv.enabled
      || tv.currentVideoId !== expectedFailedVideoId) return this.toState(beam);

    const validVideos = videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId)).slice(0, 50);
    const chosen = selectedVideoId ? validVideos.find(video => video.videoId === selectedVideoId) : undefined;
    if (selectedVideoId && !chosen) return this.toState(beam);

    tv.queue = chosen
      ? [chosen.videoId, ...validVideos.filter(video => video.videoId !== chosen.videoId).map(video => video.videoId)]
      : [];
    tv.videoMetadata = validVideos.map(video => this.normalizeMetadata(video));
    beam.videoDurationsMs.clear();
    for (const [videoId, durationMs] of Object.entries(durationMsByVideoId)) {
      if (validVideos.some(video => video.videoId === videoId) && Number.isFinite(durationMs) && durationMs > 0) {
        beam.videoDurationsMs.set(videoId, durationMs);
      }
    }
    tv.currentVideoId = chosen?.videoId ?? null;
    tv.startedAtMs = chosen ? this.now() : null;
    tv.breakEndsAtMs = null;
    tv.seriesTitle = null;
    tv.seriesDate = null;
    tv.seriesEpisodeNumber = null;
    tv.skipSequence += 1;
    beam.skipVotes.clear();
    if (chosen) {
      this.automaticVideoStartListener?.(beam.roomId, chosen.videoId, tv.videoMetadata[0]);
    }
    return this.toState(beam);
  }

  advanceAutomaticDefaultTvVideo(
    roomId: string,
    videos: UniversityVideoBeamTvVideoMetadata[],
    durationMsByVideoId: Readonly<Record<string, number>>,
    selectedVideoId: string,
    expectedCurrentVideoId: string,
    expectedStartedAtMs: number,
    expectedBreakEndsAtMs: number | null,
    series?: { title: string; date: string; episodeNumber: number },
    nextStartedAtMs?: number,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const normalize = (value: string | null) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    const comedyContinuousDue = beam.roomId === "COMEDY"
      && expectedBreakEndsAtMs === null
      && tv.breakEndsAtMs === null
      && tv.currentVideoId === expectedCurrentVideoId
      && tv.startedAtMs === expectedStartedAtMs
      && (beam.videoDurationsMs.get(expectedCurrentVideoId) ?? 0) > 0
      && expectedStartedAtMs + (beam.videoDurationsMs.get(expectedCurrentVideoId) ?? 0) <= this.now();
    if (!this.isOwnerlessTopicRoom(beam.roomId)
      || communityLiveStreamPolicy(beam.roomId, this.rooms)
      || !tv.enabled
      || tv.sourceType !== "search"
      || normalize(tv.sourceValue) !== normalize(tv.defaultSearch)
      || tv.currentVideoId !== expectedCurrentVideoId
      || tv.startedAtMs !== expectedStartedAtMs
      || tv.breakEndsAtMs !== expectedBreakEndsAtMs
      || (tv.breakEndsAtMs === null ? !comedyContinuousDue : tv.breakEndsAtMs > this.now())) {
      return this.toState(beam);
    }

    const validVideos = videos
      .filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.videoId))
      .slice(0, 50);
    const validIds = validVideos.map(video => video.videoId);
    if (!validIds.includes(selectedVideoId)) return this.toState(beam);

    tv.queue = [selectedVideoId, ...validIds.filter(videoId => videoId !== selectedVideoId)];
    tv.videoMetadata = validVideos;
    beam.videoDurationsMs.clear();
    for (const [videoId, durationMs] of Object.entries(durationMsByVideoId)) {
      if (validIds.includes(videoId) && Number.isFinite(durationMs) && durationMs > 0) {
        beam.videoDurationsMs.set(videoId, durationMs);
      }
    }
    tv.currentVideoId = selectedVideoId;
    tv.startedAtMs = nextStartedAtMs ?? this.now();
    tv.breakEndsAtMs = null;
    tv.seriesTitle = series?.title ?? null;
    tv.seriesDate = utcDateFromKey(series?.date);
    tv.seriesEpisodeNumber = series?.episodeNumber ?? null;
    tv.skipSequence += 1;
    beam.skipVotes.clear();
    this.automaticVideoStartListener?.(
      beam.roomId,
      selectedVideoId,
      validVideos.find(item => item.videoId === selectedVideoId),
    );
    return this.toState(beam);
  }

  actOnTv(
    roomId: string,
    participantId: string,
    input: UniversityVideoBeamTvActionInput,
    accountId?: string,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const tv = beam.tv;
    const beforeVideoId = tv.currentVideoId;
    const ownerlessTopicRoom = this.isOwnerlessTopicRoom(beam.roomId);
    const defaultPlaybackSync = input.action === "publish-playback"
      && tv.enabled && tv.sourceType === "search"
      && tv.sourceValue === tv.defaultSearch
      && tv.queue.length > 0
      && tv.breakEndsAtMs === null
      && tv.queue.includes(input.currentVideoId ?? "")
      && (!ownerlessTopicRoom || input.currentVideoId === tv.currentVideoId);
    const defaultQueueSync = ownerlessTopicRoom && input.action === "publish-queue"
      && tv.enabled && tv.sourceType === "search" && tv.sourceValue === tv.defaultSearch
      && input.currentVideoId === tv.currentVideoId
      && JSON.stringify(input.queue ?? []) === JSON.stringify(tv.queue);
    if (!defaultPlaybackSync && !defaultQueueSync && input.action !== "vote-skip") {
      this.requireHost(beam, participantId);
    }
    switch (input.action) {
      case "start": {
        const sourceType = input.sourceType;
        if (!sourceType) throw new RoomError(400, "Choose a YouTube video, playlist, or search.");
        const queue = input.queue ?? [];
        if (sourceType === "playlist" && !input.playlistId && queue.length === 0) {
          throw new RoomError(400, "That playlist link could not be read.");
        }
        if (sourceType !== "playlist" && queue.length === 0) {
          throw new RoomError(400, "No playable YouTube videos were found.");
        }
        tv.enabled = true;
        tv.sourceType = sourceType;
        tv.sourceValue = input.sourceValue?.trim() || null;
        tv.playlistId = input.playlistId ?? null;
        tv.queue = [...queue];
        tv.videoMetadata = input.videoMetadata ? [this.normalizeMetadata(input.videoMetadata)] : [];
        tv.currentVideoId = input.currentVideoId
          ?? queue[0]
          ?? null;
        tv.startedAtMs = tv.currentVideoId ? this.now() : null;
        tv.breakEndsAtMs = null;
        tv.seriesTitle = null;
        tv.seriesDate = null;
        tv.seriesEpisodeNumber = null;
        beam.skipVotes.clear();
        break;
      }
      case "enable": {
        if (!tv.sourceType || (!tv.queue.length && !tv.playlistId)) {
          throw new RoomError(409, "Set a video, playlist, or search before turning Beam TV on.");
        }
        tv.enabled = true;
        if (tv.queue.length && !tv.currentVideoId) tv.currentVideoId = tv.queue[0]!;
        tv.startedAtMs = tv.currentVideoId ? this.now() : null;
        tv.breakEndsAtMs = null;
        beam.skipVotes.clear();
        break;
      }
      case "stop":
        tv.enabled = false;
        tv.startedAtMs = null;
        tv.breakEndsAtMs = null;
        tv.seriesTitle = null;
        tv.seriesDate = null;
        tv.seriesEpisodeNumber = null;
        beam.skipVotes.clear();
        break;
      case "reset":
        tv.enabled = true;
        tv.sourceType = "search";
        tv.sourceValue = tv.defaultSearch;
        tv.playlistId = null;
        tv.queue = [];
        tv.videoMetadata = [];
        tv.currentVideoId = null;
        tv.startedAtMs = null;
        tv.breakEndsAtMs = null;
        tv.seriesTitle = null;
        tv.seriesDate = null;
        tv.seriesEpisodeNumber = null;
        beam.skipVotes.clear();
        break;
      case "publish-queue": {
        if (!tv.enabled) throw new RoomError(409, "Beam TV is turned off.");
        const queue = input.queue ?? [];
        if (!queue.length) throw new RoomError(400, "The YouTube player did not provide a playlist.");
        const current = input.currentVideoId ?? tv.currentVideoId;
        if (ownerlessTopicRoom && JSON.stringify(queue) !== JSON.stringify(tv.queue)) {
          throw new RoomError(403, "The public room queue can only be changed by a room vote.");
        }
        tv.queue = [...queue];
        tv.videoMetadata = tv.videoMetadata.filter(item => queue.includes(item.videoId));
        if (current && queue.includes(current)) {
          const changed = current !== tv.currentVideoId;
          if (ownerlessTopicRoom && changed) {
            throw new RoomError(403, "The public room video can only be changed by a room vote.");
          }
          tv.currentVideoId = current;
          if (changed || tv.startedAtMs === null) tv.startedAtMs = this.now();
          tv.breakEndsAtMs = null;
        } else {
          tv.currentVideoId = queue[0]!;
          tv.startedAtMs = this.now();
        }
        if (tv.currentVideoId !== beforeVideoId) beam.skipVotes.clear();
        if (input.videoMetadata && input.videoMetadata.videoId === tv.currentVideoId) {
          this.storeVideoMetadata(tv, input.videoMetadata);
        }
        break;
      }
      case "publish-playback": {
        if (!tv.enabled) throw new RoomError(409, "Beam TV is turned off.");
        const current = input.currentVideoId;
        if (!current) throw new RoomError(400, "The YouTube player has no current video.");
        if (tv.queue.length && !tv.queue.includes(current)) {
          throw new RoomError(400, "That video is not in the current Beam TV queue.");
        }
        if (ownerlessTopicRoom && current !== tv.currentVideoId) {
          throw new RoomError(403, "The public room video can only be changed by a room vote.");
        }
        if (tv.currentVideoId !== current) beam.skipVotes.clear();
        tv.currentVideoId = current;
        if (!ownerlessTopicRoom) {
          tv.startedAtMs = this.validPlaybackTime(input.startedAtMs);
          tv.breakEndsAtMs = null;
        }
        if (input.videoMetadata && input.videoMetadata.videoId === current) {
          this.storeVideoMetadata(tv, input.videoMetadata);
        }
        break;
      }
      case "skip": {
        if (!tv.enabled) throw new RoomError(409, "Beam TV is turned off.");
        if ((!tv.queue.length && !tv.playlistId) || !tv.currentVideoId) {
          throw new RoomError(409, "The YouTube playlist is still loading. Try skip again in a moment.");
        }
        if (tv.queue.length > 1) {
          const currentIndex = tv.queue.indexOf(tv.currentVideoId);
          const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tv.queue.length;
          tv.currentVideoId = tv.queue[nextIndex]!;
        } else if (tv.playlistId) {
          tv.skipSequence += 1;
        } else {
          throw new RoomError(409, "There is no next video in this Beam TV queue.");
        }
        tv.startedAtMs = this.now();
        tv.breakEndsAtMs = null;
        beam.skipVotes.clear();
        break;
      }
      case "set-skip-voting": {
        this.requireHost(beam, participantId);
        if (typeof input.skipVotingEnabled !== "boolean") {
          throw new RoomError(400, "Choose whether room skip voting is on or off.");
        }
        tv.skipVotingEnabled = input.skipVotingEnabled;
        if (!tv.skipVotingEnabled) beam.skipVotes.clear();
        break;
      }
      case "vote-skip": {
        if (ownerlessTopicRoom) {
          throw new RoomError(403, "Beam TV plays automatically in public topic rooms.");
        }
        if (!tv.enabled || !tv.currentVideoId) throw new RoomError(409, "There is no active Beam TV video to vote on.");
        if (!tv.skipVotingEnabled) throw new RoomError(409, "Skip voting is off for this room.");
        if (!accountId || !this.rooms.activeAccountIds(roomId).includes(accountId)) {
          throw new RoomError(403, "Only a current room member can vote to skip.");
        }
        if (tv.queue.length < 2 && !tv.playlistId) {
          throw new RoomError(409, "This Beam TV source has no next video to skip to.");
        }
        beam.skipVotes.add(accountId);
        if (this.skipThresholdReached(beam)) {
          if (tv.queue.length > 1) {
            const currentIndex = tv.queue.indexOf(tv.currentVideoId);
            const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tv.queue.length;
            tv.currentVideoId = tv.queue[nextIndex]!;
          } else {
            tv.skipSequence += 1;
          }
          tv.startedAtMs = this.now();
          tv.breakEndsAtMs = null;
          beam.skipVotes.clear();
        }
        break;
      }
    }
    return this.toState(beam, accountId);
  }

  assertCanJoin(roomId: string, accountId: string): void {
    // Persistent room-incarnation kick checks are enforced by the route layer.
  }

  joinSlot(roomId: string, participantId: string, accountId: string): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    if (this.rooms.sessionAccountId(beam.roomId, participantId) !== accountId) {
      throw new RoomError(401, "This room session does not belong to your account.");
    }
    const existing = beam.slots.find(slot => slot.participantId === participantId);
    if (existing) return this.toState(beam);
    if (beam.slots.some(slot => slot.accountId === accountId)) {
      throw new RoomError(409, "You already have a speaker spot in this beam.");
    }
    const slot = beam.slots.find(candidate => candidate.participantId === null);
    if (!slot) throw new RoomError(409, "All nine speaker spots are full. You can still watch and chat.");
    slot.participantId = participantId;
    slot.accountId = accountId;
    slot.joinedAt = this.now();
    slot.connectedAt = null;
    // Joining during playback stays opt-in for the conversation; microphone
    // use can then be enabled independently of the room video's sound.
    slot.micMuted = this.isVideoActivelyPlaying(beam);
    slot.cameraOff = true;
    slot.mutedByHost = false;
    slot.cameraDisabledByHost = false;
    this.notifySeatLifecycle({
      type: "joined", roomId: beam.roomId, accountId, participantId, at: this.now(),
    });
    if (!this.isOwnerlessTopicRoom(beam.roomId) && !beam.hostParticipantId) {
      beam.hostParticipantId = participantId;
    }
    return this.toState(beam);
  }

  moveSlot(roomId: string, participantId: string, accountId: string, targetSlotNumber: number): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertCanJoin(roomId, accountId);
    if (this.rooms.sessionAccountId(beam.roomId, participantId) !== accountId) {
      throw new RoomError(401, "This room session does not belong to your account.");
    }
    const current = beam.slots.find(slot => slot.participantId === participantId && slot.accountId === accountId);
    if (!current) throw new RoomError(404, "You are not in a speaker spot.");
    const target = beam.slots.find(slot => slot.slotNumber === targetSlotNumber);
    if (!target) throw new RoomError(400, "Choose one of the nine speaker spots.");
    if (target === current) return this.toState(beam);
    if (target.participantId !== null) throw new RoomError(409, "That speaker spot is already occupied.");

    // Move the existing seat state without ending the account's continuous
    // room tenure or disrupting its LiveKit participant and microphone.
    target.participantId = current.participantId;
    target.accountId = current.accountId;
    target.joinedAt = current.joinedAt;
    target.connectedAt = current.connectedAt;
    target.micMuted = current.micMuted;
    target.cameraOff = current.cameraOff;
    target.mutedByHost = current.mutedByHost;
    target.cameraDisabledByHost = current.cameraDisabledByHost;
    current.participantId = null;
    current.accountId = null;
    current.joinedAt = null;
    current.connectedAt = null;
    current.micMuted = false;
    current.cameraOff = true;
    current.mutedByHost = false;
    current.cameraDisabledByHost = false;
    return this.toState(beam);
  }

  reconcileLiveKitParticipants(
    roomId: string,
    identities: ReadonlySet<string>,
    viewerAccountId?: string,
  ): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    let changed = false;
    for (const slot of beam.slots) {
      if (!slot.participantId || identities.has(slot.participantId)) continue;
      if (slot.connectedAt === null && slot.joinedAt !== null
        && this.now() - slot.joinedAt < VIDEO_BEAM_CONNECT_GRACE_MS) continue;
      this.release(beam, slot);
      changed = true;
    }
    if (changed) this.transferHostIfNeeded(beam);
    return this.toState(beam, viewerAccountId);
  }

  leaveSlot(roomId: string, participantId: string): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    const slot = this.requireSlot(beam, participantId);
    this.release(beam, slot);
    this.transferHostIfNeeded(beam);
    return this.toState(beam);
  }

  markConnected(roomId: string, participantId: string): UniversityVideoBeamState {
    const slot = this.requireSlot(this.ensure(roomId), participantId);
    slot.connectedAt = this.now();
    return this.getState(roomId);
  }

  assertSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", enabled: boolean): void {
    const beam = this.ensure(roomId);
    this.requireSlot(beam, participantId);
    if (media === "camera") {
      throw new RoomError(410, "Room beam seats are audio-only. Camera access is available through Go Live.");
    }
  }

  setSelfMedia(roomId: string, participantId: string, media: "mic" | "camera", enabled: boolean): UniversityVideoBeamState {
    const beam = this.ensure(roomId);
    this.assertSelfMedia(roomId, participantId, media, enabled);
    const slot = this.requireSlot(beam, participantId);
    if (media === "mic") {
      slot.micMuted = !enabled;
      if (enabled) slot.mutedByHost = false;
    } else {
      slot.cameraOff = !enabled;
      if (enabled) slot.cameraDisabledByHost = false;
    }
    return this.toState(beam);
  }

  assertHostControl(roomId: string, actorId: string, targetId: string): BeamSlot {
    const beam = this.ensure(roomId);
    this.requireHost(beam, actorId);
    if (actorId === targetId) throw new RoomError(400, "Use your own controls for your media.");
    return this.requireSlot(beam, targetId);
  }

  hostDisableMedia(roomId: string, actorId: string, targetId: string, media: "mic" | "camera"): UniversityVideoBeamState {
    if (media === "camera") {
      throw new RoomError(410, "Room beam seats are audio-only. Camera access is available through Go Live.");
    }
    const beam = this.ensure(roomId);
    const slot = this.assertHostControl(roomId, actorId, targetId);
    if (media === "mic") {
      slot.micMuted = true;
      slot.mutedByHost = true;
    } else {
      slot.cameraOff = true;
      slot.cameraDisabledByHost = true;
    }
    return this.toState(beam);
  }

  moderatorDisableMedia(roomId: string, actorId: string, targetId: string, media: "mic" | "camera"): UniversityVideoBeamState {
    if (media === "camera") {
      throw new RoomError(410, "Room beam seats are audio-only. Camera access is available through Go Live.");
    }
    if (actorId === targetId) throw new RoomError(400, "Use your own controls for your media.");
    const beam = this.ensure(roomId);
    const slot = this.requireSlot(beam, targetId);
    slot.micMuted = true;
    slot.mutedByHost = true;
    return this.toState(beam);
  }

  kick(roomId: string, actorId: string, targetId: string): { state: UniversityVideoBeamState; accountId: string } {
    const beam = this.ensure(roomId);
    const target = this.assertHostControl(roomId, actorId, targetId);
    const accountId = target.accountId;
    if (!accountId) throw new RoomError(404, "Speaker is no longer in this room.");
    this.release(beam, target);
    this.transferHostIfNeeded(beam);
    return { state: this.toState(beam), accountId };
  }

  slotFor(roomId: string, participantId: string): UniversityVideoBeamState["slots"][number] {
    const slot = this.requireSlot(this.ensure(roomId), participantId);
    return this.toState(this.ensure(roomId)).slots[slot.slotNumber - 1]!;
  }

  isAccountMicrophoneActive(accountId: string): boolean {
    for (const beam of this.beams.values()) {
      if (beam.slots.some(slot => slot.accountId === accountId && slot.connectedAt !== null
        && !slot.micMuted && !slot.mutedByHost)) return true;
    }
    return false;
  }

  accountIdForParticipant(roomId: string, participantId: string): string | null {
    return this.requireSlot(this.ensure(roomId), participantId).accountId;
  }

  hostSeatNumber(roomId: string): number | null {
    const beam = this.ensure(roomId);
    return beam.slots.find(slot => slot.participantId === beam.hostParticipantId)?.slotNumber ?? null;
  }

  muteAccountMicrophones(accountId: string): Array<{ roomId: string; participantId: string }> {
    const muted: Array<{ roomId: string; participantId: string }> = [];
    for (const beam of this.beams.values()) {
      for (const slot of beam.slots) {
        if (slot.accountId !== accountId || !slot.participantId) continue;
        slot.micMuted = true;
        muted.push({ roomId: beam.roomId, participantId: slot.participantId });
      }
    }
    return muted;
  }

  private ensure(roomId: string): Beam {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "Room not found.");
    const historyId = this.rooms.getHistoryId(id);
    const key = `${id}:${historyId}`;
    let beam = this.beams.get(key);
    if (!beam) {
      beam = {
        roomId: id,
        historyId,
        hostParticipantId: null,
        tv: {
          enabled: true,
          defaultSearch: communityDefaultVideoSearch(id, this.rooms),
          sourceType: "search",
          sourceValue: communityDefaultVideoSearch(id, this.rooms),
          playlistId: null,
          queue: [],
          videoMetadata: [],
          currentVideoId: null,
          startedAtMs: null,
          breakEndsAtMs: null,
          seriesTitle: null,
          seriesDate: null,
          seriesEpisodeNumber: null,
          skipVotingEnabled: true,
          skipSequence: 0,
        },
        skipVotes: new Set(),
        videoDurationsMs: new Map(),
        slots: Array.from({ length: VIDEO_BEAM_SLOT_COUNT }, (_, i) => ({
          slotNumber: i + 1,
          participantId: null,
          accountId: null,
          joinedAt: null,
          connectedAt: null,
          micMuted: true,
          cameraOff: true,
          mutedByHost: false,
          cameraDisabledByHost: false,
        })),
      };
      this.beams.set(key, beam);
    }
    if (this.isOwnerlessTopicRoom(id)) {
      this.enforceOwnerlessTopicDefaults(beam);
      this.advanceOwnerlessTopicPlayback(beam);
    }
    return beam;
  }

  private isOwnerlessTopicRoom(roomId: string): boolean {
    return isPublicTopicRoom(roomId, this.rooms);
  }

  private enforceOwnerlessTopicDefaults(beam: Beam): void {
    beam.hostParticipantId = null;
    beam.tv.enabled = true;
    const defaultSearch = communityDefaultVideoSearch(beam.roomId, this.rooms);
    beam.tv.defaultSearch = defaultSearch;
    beam.tv.skipVotingEnabled = false;
    const normalize = (value: string | null) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    const isDefaultSource = beam.tv.sourceType === "search"
      && normalize(beam.tv.sourceValue) === normalize(defaultSearch)
      && beam.tv.playlistId === null;
    if (isDefaultSource) return;

    beam.tv.sourceType = "search";
    beam.tv.sourceValue = defaultSearch;
    beam.tv.playlistId = null;
    beam.tv.queue = [];
    beam.tv.videoMetadata = [];
    beam.tv.currentVideoId = null;
    beam.tv.startedAtMs = null;
    beam.tv.breakEndsAtMs = null;
    beam.tv.seriesTitle = null;
    beam.tv.seriesDate = null;
    beam.tv.seriesEpisodeNumber = null;
    beam.videoDurationsMs.clear();
    beam.skipVotes.clear();
  }

  private advanceOwnerlessTopicPlayback(beam: Beam): void {
    const tv = beam.tv;
    if (!tv.enabled || !tv.queue.length || !tv.currentVideoId || tv.startedAtMs === null) return;
    const now = this.now();
    for (let steps = 0; steps < 10_000; steps += 1) {
      if (tv.breakEndsAtMs !== null) {
        if (now < tv.breakEndsAtMs) return;
        // Public topic rooms choose the next item from the durable rotation service.
        // Keep the existing timed CNN stream behavior unchanged.
        if (!communityLiveStreamPolicy(beam.roomId, this.rooms)) return;
        const index = tv.queue.indexOf(tv.currentVideoId);
        const next = tv.queue[(index + 1 + tv.queue.length) % tv.queue.length];
        if (!next) return;
        tv.currentVideoId = next;
        tv.startedAtMs = tv.breakEndsAtMs;
        tv.breakEndsAtMs = null;
        tv.seriesTitle = null;
        tv.seriesDate = null;
        tv.seriesEpisodeNumber = null;
        tv.skipSequence += 1;
        beam.skipVotes.clear();
        this.automaticVideoStartListener?.(
          beam.roomId,
          next,
          tv.videoMetadata.find(item => item.videoId === next),
        );
        continue;
      }

      const durationMs = beam.videoDurationsMs.get(tv.currentVideoId);
      if (!durationMs || tv.startedAtMs + durationMs > now) return;
      // Comedy runs continuously: the server schedules the next saved item at
      // the exact end of this one, without inserting the other rooms' mic break.
      if (beam.roomId === "COMEDY") return;
      tv.breakEndsAtMs = tv.startedAtMs + durationMs + PUBLIC_BEAM_TV_BREAK_MS;
      beam.skipVotes.clear();
      if (now < tv.breakEndsAtMs) return;
    }
  }

  private requireSlot(beam: Beam, participantId: string): BeamSlot {
    const slot = beam.slots.find(candidate => candidate.participantId === participantId);
    if (!slot) throw new RoomError(404, "You are not in a speaker spot.");
    return slot;
  }

  private requireHost(beam: Beam, participantId: string): void {
    if (this.isOwnerlessTopicRoom(beam.roomId)) {
      throw new RoomError(403, "Public topic rooms do not have host controls.");
    }
    if (!beam.hostParticipantId || beam.hostParticipantId !== participantId) {
      throw new RoomError(403, "Only the beam host can control another speaker.");
    }
  }

  private release(beam: Beam, slot: BeamSlot): void {
    if (slot.accountId && slot.participantId) {
      this.notifySeatLifecycle({
        type: "left", roomId: beam.roomId, accountId: slot.accountId,
        participantId: slot.participantId, at: this.now(),
      });
    }
    slot.participantId = null;
    slot.accountId = null;
    slot.joinedAt = null;
    slot.connectedAt = null;
    slot.micMuted = true;
    slot.cameraOff = true;
    slot.mutedByHost = false;
    slot.cameraDisabledByHost = false;
  }

  private notifySeatLifecycle(event: BeamSeatLifecycleEvent): void {
    try {
      this.seatLifecycleListener?.(event);
    } catch {
      // Reward persistence must not prevent a room seat from being used or released.
    }
  }

  private transferHostIfNeeded(beam: Beam): void {
    if (this.isOwnerlessTopicRoom(beam.roomId)) {
      beam.hostParticipantId = null;
      return;
    }
    if (beam.hostParticipantId && !beam.slots.some(slot => slot.participantId === beam.hostParticipantId)) {
      beam.hostParticipantId = [...beam.slots]
        .filter(slot => slot.participantId && slot.joinedAt !== null)
        .sort((a, b) => a.joinedAt! - b.joinedAt!)[0]?.participantId ?? null;
    }
  }

  private skipThresholdReached(beam: Beam): boolean {
    const activeAccounts = new Set(this.rooms.activeAccountIds(beam.roomId));
    for (const voter of beam.skipVotes) {
      if (!activeAccounts.has(voter)) beam.skipVotes.delete(voter);
    }
    const voteCount = beam.skipVotes.size;
    return voteCount >= 2 && voteCount > activeAccounts.size / 2;
  }

  private normalizeMetadata(metadata: UniversityVideoBeamTvVideoMetadata): UniversityVideoBeamTvVideoMetadata {
    return {
      videoId: metadata.videoId,
      title: metadata.title.replace(/\s+/g, " ").trim().slice(0, 200) || "YouTube video",
      channelTitle: metadata.channelTitle?.replace(/\s+/g, " ").trim().slice(0, 120) || null,
      description: metadata.description?.replace(/\s+/g, " ").trim().slice(0, 500) || null,
    };
  }

  private storeVideoMetadata(
    tv: Beam["tv"],
    metadata: UniversityVideoBeamTvVideoMetadata,
  ): void {
    const normalized = this.normalizeMetadata(metadata);
    tv.videoMetadata = [
      ...tv.videoMetadata.filter(item => item.videoId !== normalized.videoId),
      normalized,
    ].slice(-50);
  }

  private toState(beam: Beam, viewerAccountId?: string): UniversityVideoBeamState {
    const activeAccounts = new Set(this.rooms.activeAccountIds(beam.roomId));
    for (const voter of beam.skipVotes) {
      if (!activeAccounts.has(voter)) beam.skipVotes.delete(voter);
    }
    return {
      roomId: beam.roomId,
      beamActive: beam.slots.some(slot => slot.participantId !== null),
      hostParticipantId: beam.hostParticipantId,
      tv: {
        ...beam.tv,
        searchAvailable: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
        videoMetadata: beam.tv.videoMetadata.map(item => ({ ...item })),
          // Retained in the response for API compatibility; video no longer
          // locks the seat microphone.
          micLockedDuringVideo: false,
          serverNowMs: this.now(),
        skipVoteCount: beam.skipVotes.size,
        skipVoteTotal: activeAccounts.size,
        hasVotedToSkip: viewerAccountId ? beam.skipVotes.has(viewerAccountId) : false,
      },
      slots: beam.slots.map(({ slotNumber, participantId, micMuted, cameraOff, mutedByHost, cameraDisabledByHost }) => ({
        slotNumber,
        participantId,
        micMuted,
        cameraOff,
        mutedByHost,
        cameraDisabledByHost,
      })),
    };
  }

  private isVideoActivelyPlaying(beam: Beam): boolean {
    return this.isOwnerlessTopicRoom(beam.roomId)
      && beam.tv.enabled
      && beam.tv.currentVideoId !== null
      && beam.tv.breakEndsAtMs === null;
  }

  getAutomaticVideoDurationMs(roomId: string, videoId: string): number | null {
    const duration = this.ensure(roomId).videoDurationsMs.get(videoId);
    return duration && duration > 0 ? duration : null;
  }

  private validPlaybackTime(startedAtMs: number | undefined): number {
    const now = this.now();
    if (!startedAtMs || startedAtMs > now + 5_000 || startedAtMs < now - 12 * 60 * 60 * 1000) {
      return now;
    }
    return startedAtMs;
  }

}

export const universityVideoBeamStore = new UniversityVideoBeamStore();
