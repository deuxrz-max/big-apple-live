import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import type { ParticipantInfo } from "livekit-server-sdk";
import { RoomError } from "./room-store";

export type BeamRole = "audience" | "speaker";
export type LiveKitSettings = { url: string; apiKey: string; apiSecret: string };

function settingsFromEnvironment(env: NodeJS.ProcessEnv = process.env): LiveKitSettings {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    throw new RoomError(503, "The video beam is not configured yet. Ask the app owner to check LiveKit setup.");
  }
  if (!/^wss?:\/\//i.test(url)) {
    throw new RoomError(503, "The video beam service URL is invalid.");
  }
  return { url, apiKey, apiSecret };
}

export class LiveKitBeamService {
  constructor(
    private readonly getSettings: () => LiveKitSettings = settingsFromEnvironment,
    private readonly clientFactory = (settings: LiveKitSettings) =>
      new RoomServiceClient(settings.url.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:"), settings.apiKey, settings.apiSecret),
  ) {}

  async createToken(input: {
    roomName: string;
    participantId: string;
    displayName: string;
    role: BeamRole;
  }): Promise<{ url: string; token: string }> {
    const settings = this.getSettings();
    const token = new AccessToken(settings.apiKey, settings.apiSecret, {
      identity: input.participantId,
      name: input.displayName,
      ttl: "1h",
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canSubscribe: true,
      canPublish: input.role === "speaker",
      // Speaker tokens start with no media permission. The server grants only
      // microphone publishing after validating the slot and Beam TV mic lock.
      canPublishSources: [],
      canPublishData: false,
    });
    return { url: settings.url, token: await token.toJwt() };
  }

  async listParticipants(roomName: string): Promise<ParticipantInfo[]> {
    const settings = this.getSettings();
    const client = this.clientFactory(settings);
    const rooms = await client.listRooms([roomName]);
    if (!rooms.length) return [];
    return client.listParticipants(roomName);
  }

  async createLiveStreamToken(input: {
    roomName: string;
    identity: string;
    displayName: string;
    username?: string;
    role: "host" | "viewer";
  }): Promise<{ url: string; token: string }> {
    const settings = this.getSettings();
    const token = new AccessToken(settings.apiKey, settings.apiSecret, {
      identity: input.identity,
      name: input.displayName,
      ...(input.username ? { metadata: JSON.stringify({ username: input.username }) } : {}),
      ttl: "1h",
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canSubscribe: true,
      canPublish: input.role === "host",
      canPublishSources: input.role === "host"
        ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
        : [],
      // Viewers can send lightweight app data (including live chat) without
      // gaining permission to publish camera or microphone tracks.
      canPublishData: input.role === "viewer",
    });
    return { url: settings.url, token: await token.toJwt() };
  }

  async listRooms(roomNames?: string[]) {
    const settings = this.getSettings();
    return this.clientFactory(settings).listRooms(roomNames);
  }

  async deleteRoom(roomName: string): Promise<void> {
    const settings = this.getSettings();
    await this.clientFactory(settings).deleteRoom(roomName);
  }

  async disableTrack(
    roomName: string,
    participantId: string,
    source: "mic" | "camera",
    allowedSources: TrackSource[],
  ): Promise<void> {
    await this.setTrackEnabled(roomName, participantId, source, false, allowedSources);
  }

  async setSelfTrackEnabled(
    roomName: string,
    participantId: string,
    source: "mic" | "camera",
    enabled: boolean,
    allowedSources: TrackSource[],
  ): Promise<void> {
    await this.setTrackEnabled(roomName, participantId, source, enabled, allowedSources);
  }

  async applySpeakerMediaPolicy(
    roomName: string,
    participantId: string,
    allowedSources: TrackSource[],
    microphoneEnabled: boolean,
  ): Promise<void> {
    const client = this.clientFactory(this.getSettings());
    const participant = await client.getParticipant(roomName, participantId);
    await client.updateParticipant(roomName, participantId, {
      permission: { canPublish: allowedSources.length > 0, canPublishSources: allowedSources },
    });
    const microphone = participant.tracks.find(item => item.source === TrackSource.MICROPHONE);
    if (microphone) {
      await client.mutePublishedTrack(roomName, participantId, microphone.sid, !microphoneEnabled);
    }
  }

  async removeParticipant(roomName: string, participantId: string): Promise<void> {
    const client = this.clientFactory(this.getSettings());
    await client.removeParticipant(roomName, participantId);
  }

  private async setTrackEnabled(
    roomName: string,
    participantId: string,
    source: "mic" | "camera",
    enabled: boolean,
    allowedSources: TrackSource[],
  ) {
    const client = this.clientFactory(this.getSettings());
    const participant = await client.getParticipant(roomName, participantId);
    const targetSource = source === "mic" ? TrackSource.MICROPHONE : TrackSource.CAMERA;
    const track = participant.tracks.find(item => item.source === targetSource);
    await client.updateParticipant(roomName, participantId, {
      permission: { canPublish: allowedSources.length > 0, canPublishSources: allowedSources },
    });
    if (track) await client.mutePublishedTrack(roomName, participantId, track.sid, !enabled);
  }
}

export function publicLiveKitFailure(error: unknown): RoomError {
  if (error instanceof RoomError) return error;
  return new RoomError(503, "Live video is temporarily unavailable. Please try again.");
}

export const liveKitBeamService = new LiveKitBeamService();
