import { randomUUID } from "node:crypto";
import type { AudioEvent, AudioPeer, AudioSignalInput } from "@workspace/room-audio";
import { RoomError, RoomStore, roomStore } from "./room-store";

export interface AudioSink {
  send(event: AudioEvent): void;
  close(): void;
}
type Connection = AudioPeer & {
  sink: AudioSink;
  windowStartedAt: number;
  signalCount: number;
};
type Group = { connections: Map<string, Connection>; unsubscribe: () => void };

/** Relays SDP only. No microphone data, SDP history, or session credentials are stored here. */
export class AudioSignaling {
  private readonly groups = new Map<string, Group>();

  constructor(private readonly store: RoomStore = roomStore) {}

  authorize(roomId: string, credential: string): string {
    try {
      return this.store.getSessionParticipant(roomId, credential).participantId;
    } catch (err) {
      if (err instanceof RoomError && err.status === 404) {
        throw new RoomError(401, "Invalid or expired room session");
      }
      throw err;
    }
  }

  connect(roomId: string, credential: string, sink: AudioSink): () => void {
    const id = roomId.toUpperCase();
    const participantId = this.authorize(id, credential);
    let group = this.groups.get(id);
    if (!group) {
      group = { connections: new Map(), unsubscribe: () => {} };
      this.groups.set(id, group);
      try {
        group.unsubscribe = this.store.subscribe(id, (event) => {
          const active = new Set(
            event.type === "room.snapshot" ? event.data.participants.map((p) => p.participantId) : [],
          );
          const current = this.groups.get(id);
          if (!current) return;
          if (event.type === "room.snapshot") {
            for (const connection of current.connections.values()) {
              connection.sink.send({
                type: "audio.microphones",
                data: { participants: event.data.participants.map(p => ({ participantId: p.participantId, micEnabled: p.micEnabled })) },
              });
            }
          }
          for (const connection of [...current.connections.values()]) {
            if (!active.has(connection.participantId)) {
              this.remove(id, connection, "participant-left");
            }
          }
        });
      } catch (err) {
        this.groups.delete(id);
        throw err;
      }
    }
    // Replace atomically; an old stream's close handler cannot remove its successor.
    const previous = group.connections.get(participantId);
    const connection: Connection = {
      participantId, connectionId: randomUUID(), sink,
      windowStartedAt: Date.now(), signalCount: 0,
    };
    group.connections.set(participantId, connection);
    if (previous) {
      previous.sink.send({ type: "audio.ended", data: { reason: "replaced" } });
      previous.sink.close();
    }
    sink.send({
      type: "audio.ready",
      data: { self: this.publicPeer(connection), peers: this.peers(group, participantId) },
    });
    sink.send({
      type: "audio.microphones",
      data: { participants: this.store.get(id).participants.map(p => ({ participantId: p.participantId, micEnabled: p.micEnabled })) },
    });
    this.broadcastPeers(group);
    return () => {
      if (this.groups.get(id)?.connections.get(participantId) === connection) {
        this.remove(id, connection, "disconnected");
      }
    };
  }

  signal(roomId: string, credential: string, input: AudioSignalInput): void {
    const id = roomId.toUpperCase();
    const participantId = this.authorize(id, credential);
    const group = this.groups.get(id);
    const source = group?.connections.get(participantId);
    if (!source || source.connectionId !== input.sourceConnectionId) {
      throw new RoomError(409, "Source signaling connection is stale; reconnect");
    }
    const target = group?.connections.get(input.targetParticipantId);
    if (!target || target.participantId === participantId) {
      throw new RoomError(404, "Target is not an audio peer in this room");
    }
    if (target.connectionId !== input.targetConnectionId) {
      throw new RoomError(409, "Target signaling connection is stale");
    }
    const shouldOffer = participantId < target.participantId;
    if ((input.description.type === "offer") !== shouldOffer) {
      throw new RoomError(409, "Invalid negotiation direction");
    }
    const now = Date.now();
    if (now - source.windowStartedAt >= 60_000) {
      source.windowStartedAt = now;
      source.signalCount = 0;
    }
    if (++source.signalCount > 120) throw new RoomError(429, "Signaling rate limit exceeded");
    target.sink.send({
      type: "audio.signal",
      data: { from: this.publicPeer(source), description: input.description },
    });
  }

  disconnect(roomId: string, credential: string, connectionId: string): void {
    const id = roomId.toUpperCase();
    const participantId = this.authorize(id, credential);
    const connection = this.groups.get(id)?.connections.get(participantId);
    if (connection?.connectionId === connectionId) this.remove(id, connection, "disconnected");
  }

  private publicPeer(connection: Connection): AudioPeer {
    return { participantId: connection.participantId, connectionId: connection.connectionId };
  }

  private peers(group: Group, except: string): AudioPeer[] {
    return [...group.connections.values()]
      .filter((p) => p.participantId !== except)
      .map((p) => this.publicPeer(p));
  }

  private broadcastPeers(group: Group): void {
    for (const connection of group.connections.values()) {
      connection.sink.send({
        type: "audio.peers", data: { peers: this.peers(group, connection.participantId) },
      });
    }
  }

  private remove(id: string, connection: Connection, reason: "disconnected" | "participant-left"): void {
    const group = this.groups.get(id);
    if (!group || group.connections.get(connection.participantId) !== connection) return;
    group.connections.delete(connection.participantId);
    connection.sink.send({ type: "audio.ended", data: { reason } });
    connection.sink.close();
    this.broadcastPeers(group);
    if (group.connections.size === 0) {
      group.unsubscribe();
      this.groups.delete(id);
    }
  }
}

export const audioSignaling = new AudioSignaling();