import { randomUUID } from "node:crypto";

export type LiveStreamChatMessage = {
  id: string;
  streamId: string;
  accountId: string;
  username: string;
  displayName: string;
  text: string;
  createdAt: string;
};

type RoomState = {
  messages: LiveStreamChatMessage[];
  listeners: Set<(message: LiveStreamChatMessage | null) => void>;
  ended: boolean;
};

class LiveStreamChatHub {
  private readonly rooms = new Map<string, RoomState>();

  start(streamId: string): void {
    this.rooms.set(streamId, { messages: [], listeners: new Set(), ended: false });
  }

  private state(streamId: string): RoomState {
    let state = this.rooms.get(streamId);
    if (!state) {
      state = { messages: [], listeners: new Set(), ended: false };
      this.rooms.set(streamId, state);
    }
    return state;
  }

  publish(input: Omit<LiveStreamChatMessage, "id" | "createdAt">): LiveStreamChatMessage {
    const state = this.state(input.streamId);
    if (state.ended) throw new Error("Livestream chat has ended");
    const message = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    state.messages.push(message);
    if (state.messages.length > 120) state.messages.splice(0, state.messages.length - 120);
    for (const listener of state.listeners) listener(message);
    return message;
  }

  recent(streamId: string): LiveStreamChatMessage[] {
    return [...(this.rooms.get(streamId)?.messages ?? [])];
  }

  find(streamId: string, messageId: string): LiveStreamChatMessage | undefined {
    return this.rooms.get(streamId)?.messages.find(message => message.id === messageId);
  }

  subscribe(streamId: string, listener: (message: LiveStreamChatMessage | null) => void): () => void {
    const state = this.state(streamId);
    state.listeners.add(listener);
    if (state.ended) listener(null);
    return () => state.listeners.delete(listener);
  }

  end(streamId: string): void {
    const state = this.state(streamId);
    state.ended = true;
    for (const listener of state.listeners) listener(null);
    state.listeners.clear();
    setTimeout(() => {
      if (this.rooms.get(streamId) === state && state.listeners.size === 0) this.rooms.delete(streamId);
    }, 5 * 60_000).unref();
  }
}

export const liveStreamChatHub = new LiveStreamChatHub();
