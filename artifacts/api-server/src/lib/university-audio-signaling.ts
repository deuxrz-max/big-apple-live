import { randomUUID } from "node:crypto";
import type { UniversityAudioSignalInput, UniversityAudioState } from "@workspace/api-zod";
import type { AudioEvent, AudioPeer } from "@workspace/room-audio";
import { RoomError, RoomStore, roomStore } from "./room-store";
import { UniversityAudioBeamStore, universityAudioBeamStore } from "./university-audio-beam";

export interface UniversityAudioSink {
  send(event: AudioEvent): void;
  close(): void;
}
type Connection = AudioPeer & {
  accountId: string;
  sink: UniversityAudioSink;
  windowStartedAt: number;
  signalCount: number;
};
type Group = {
  connections: Map<string, Connection>;
  unsubscribeRoom: () => void;
  unsubscribeBeam: () => void;
  speakerIds: Set<string>;
};

/**
 * Authenticated signaling only. Audio packets are peer-to-peer; this process
 * stores neither media nor SDP history.
 */
export class UniversityAudioSignaling {
  private readonly groups = new Map<string, Group>();

  constructor(
    private readonly rooms: RoomStore = roomStore,
    private readonly beams: UniversityAudioBeamStore = universityAudioBeamStore,
  ) {}

  connect(roomId: string, sessionId: string, accountId: string, sink: UniversityAudioSink): () => void {
    const id = roomId.toUpperCase();
    if (!this.rooms.isCommunity(id)) throw new RoomError(404, "Room not found.");
    const participant = this.rooms.requireAccountMember(id, sessionId, accountId);
    let group = this.groups.get(id);
    if (!group) {
      group = { connections: new Map(), unsubscribeRoom: () => {}, unsubscribeBeam: () => {}, speakerIds: new Set() };
      this.groups.set(id, group);
      try {
        group.unsubscribeRoom = this.rooms.subscribe(id, event => {
          if (event.type !== "room.snapshot" && event.type !== "room.expired") return;
          const active = new Set(event.type === "room.snapshot" ? event.data.participants.map(p => p.participantId) : []);
          for (const connection of [...group!.connections.values()]) {
            if (!active.has(connection.participantId)) this.remove(id, connection, "participant-left");
          }
        });
        group.unsubscribeBeam = this.beams.subscribe(id, state => this.onBeamState(id, state));
      } catch (error) {
        this.groups.delete(id);
        group.unsubscribeRoom();
        throw error;
      }
    }
    const previous = group.connections.get(participant.participantId);
    if (previous) {
      group.connections.delete(participant.participantId);
      previous.sink.send({ type: "audio.ended", data: { reason: "replaced" } });
      previous.sink.close();
      if (previous.role === "speaker") this.beams.leaveSlot(id, participant.participantId);
    }
    const current = this.beams.getState(id);
    const role = current.slots.some(slot => slot.participantId === participant.participantId) ? "speaker" : "listener";
    const connection: Connection = {
      participantId: participant.participantId,
      connectionId: randomUUID(),
      role,
      accountId,
      sink,
      windowStartedAt: Date.now(),
      signalCount: 0,
    };
    group.connections.set(participant.participantId, connection);
    sink.send({ type: "audio.ready", data: { self: this.publicPeer(connection), peers: this.peers(group, connection) } });
    const state = this.beams.getState(id);
    sink.send({ type: "audio.beam", data: state });
    sink.send({ type: "audio.microphones", data: { participants: this.microphones(state) } });
    this.broadcastPeers(group);
    return () => {
      if (this.groups.get(id)?.connections.get(participant.participantId) === connection) {
        this.remove(id, connection, "disconnected");
      }
    };
  }

  signal(roomId: string, sessionId: string, accountId: string, input: UniversityAudioSignalInput): void {
    const id = roomId.toUpperCase();
    const participant = this.rooms.requireAccountMember(id, sessionId, accountId);
    const group = this.groups.get(id);
    const source = group?.connections.get(participant.participantId);
    if (!source || source.connectionId !== input.sourceConnectionId) throw new RoomError(409, "Audio connection is stale.");
    const target = group?.connections.get(input.targetParticipantId);
    if (!target || target.participantId === source.participantId) throw new RoomError(404, "Audio peer is no longer connected.");
    if (target.connectionId !== input.targetConnectionId) throw new RoomError(409, "Audio peer connection is stale.");
    if (input.kind === "description") {
      if (!input.description || input.candidate !== undefined) {
        throw new RoomError(400, "Provide exactly one WebRTC description or ICE candidate.");
      }
      if (source.role !== "speaker" && sdpCanSendAudio(input.description.sdp)) {
        throw new RoomError(403, "Listeners cannot send microphone audio.");
      }
      const shouldOffer = source.participantId < target.participantId;
      if ((input.description.type === "offer") !== shouldOffer) {
        throw new RoomError(409, "Invalid audio negotiation direction.");
      }
    } else if (input.kind === "candidate") {
      if (input.description !== undefined || input.candidate === undefined) {
        throw new RoomError(400, "Provide exactly one WebRTC description or ICE candidate.");
      }
    } else {
      throw new RoomError(400, "Invalid audio signal type.");
    }
    const now = Date.now();
    if (now - source.windowStartedAt >= 60_000) {
      source.windowStartedAt = now;
      source.signalCount = 0;
    }
    if (++source.signalCount > 120) throw new RoomError(429, "Audio signaling rate limit exceeded.");
    if (input.kind === "description") {
      target.sink.send({ type: "audio.signal", data: { from: this.publicPeer(source), description: input.description! } });
    } else {
      target.sink.send({ type: "audio.candidate", data: { from: this.publicPeer(source), candidate: input.candidate! } });
    }
  }

  disconnect(roomId: string, sessionId: string, accountId: string, connectionId: string): void {
    const id = roomId.toUpperCase();
    const participant = this.rooms.requireAccountMember(id, sessionId, accountId);
    const connection = this.groups.get(id)?.connections.get(participant.participantId);
    if (connection?.connectionId === connectionId) this.remove(id, connection, "disconnected");
  }

  private onBeamState(roomId: string, state: UniversityAudioState): void {
    const group = this.groups.get(roomId);
    if (!group) return;
    const speakerIds = new Set(state.slots.flatMap(slot => slot.participantId ? [slot.participantId] : []));
    const changed = speakerIds.size !== group.speakerIds.size
      || [...speakerIds].some(participantId => !group!.speakerIds.has(participantId));
    group.speakerIds = speakerIds;
    for (const connection of group.connections.values()) {
      connection.sink.send({ type: "audio.beam", data: state });
      connection.sink.send({ type: "audio.microphones", data: { participants: this.microphones(state) } });
      // Role belongs to this signaling connection's handshake. A listener may
      // have reserved a slot but still be answering the browser mic prompt; do
      // not promote that old connection or its normal disconnect would release
      // the reservation before the speaker connection is established.
    }
    if (changed) this.broadcastPeers(group);
  }

  private microphones(state: UniversityAudioState) {
    return state.slots.flatMap(slot => slot.participantId
      ? [{ participantId: slot.participantId, micEnabled: slot.micEnabled && !slot.mutedByHost }]
      : []);
  }

  private publicPeer(connection: Connection): AudioPeer {
    return { participantId: connection.participantId, connectionId: connection.connectionId, role: connection.role };
  }

  private peers(group: Group, self: Connection): AudioPeer[] {
    return [...group.connections.values()]
      .filter(peer => peer.participantId !== self.participantId)
      .filter(peer => self.role === "speaker" || peer.role === "speaker")
      .map(peer => this.publicPeer(peer));
  }

  private broadcastPeers(group: Group): void {
    for (const connection of group.connections.values()) {
      connection.sink.send({ type: "audio.peers", data: { peers: this.peers(group, connection) } });
    }
  }

  private remove(roomId: string, connection: Connection, reason: "disconnected" | "participant-left"): void {
    const group = this.groups.get(roomId);
    if (!group || group.connections.get(connection.participantId) !== connection) return;
    group.connections.delete(connection.participantId);
    connection.sink.send({ type: "audio.ended", data: { reason } });
    connection.sink.close();
    if (connection.role === "speaker") this.beams.leaveSlot(roomId, connection.participantId);
    this.broadcastPeers(group);
    if (group.connections.size === 0) {
      group.unsubscribeRoom();
      group.unsubscribeBeam();
      this.groups.delete(roomId);
    }
  }
}

function sdpCanSendAudio(sdp: string): boolean {
  let sessionDirection = "sendrecv";
  let inAudio = false;
  let audioDirection: string | null = null;
  const sections: string[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith("m=")) {
      if (inAudio) sections.push(audioDirection ?? sessionDirection);
      inAudio = line.startsWith("m=audio ");
      audioDirection = null;
    } else if (/^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line)) {
      const direction = line.slice(2);
      if (inAudio) audioDirection = direction;
      else sessionDirection = direction;
    }
  }
  if (inAudio) sections.push(audioDirection ?? sessionDirection);
  return sections.some(direction => direction === "sendrecv" || direction === "sendonly");
}

export const universityAudioSignaling = new UniversityAudioSignaling();
