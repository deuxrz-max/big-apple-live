import { randomUUID } from "node:crypto";

export type LiveStreamChatMessage = {
  id: string;
  streamId: string;
  accountId: string;
  username: string;
  displayName: string;
  displayNameColor: string;
  displayNameTierIndex: number;
  badgeName: string | null;
  badgeImage: string | null;
  text: string;
  createdAt: string;
};

export type LiveStreamGiftEvent = {
  id: string;
  streamId: string;
  senderAccountId: string;
  senderUsername: string;
  senderName: string;
  senderNameColor: string;
  senderNameTierIndex: number;
  recipientUsername: string;
  recipientName: string;
  giftId: string;
  giftName: string;
  cost: number;
  quantity: number;
  createdAt: string;
};

export type LiveStreamEngagement = { hearts: number; shares: number };

type RoomState = {
  messages: LiveStreamChatMessage[];
  listeners: Set<(message: LiveStreamChatMessage | null) => void>;
  gifts: LiveStreamGiftEvent[];
  giftListeners: Set<(gift: LiveStreamGiftEvent | null) => void>;
  engagement: LiveStreamEngagement;
  engagementListeners: Set<(engagement: LiveStreamEngagement | null) => void>;
  lastEngagementAt: Map<string, number>;
  ended: boolean;
};

class LiveStreamChatHub {
  private readonly rooms = new Map<string, RoomState>();

  start(streamId: string): void {
    this.rooms.set(streamId, {
      messages: [], listeners: new Set(), gifts: [], giftListeners: new Set(),
      engagement: { hearts: 0, shares: 0 }, engagementListeners: new Set(),
      lastEngagementAt: new Map(), ended: false,
    });
  }

  private state(streamId: string): RoomState {
    let state = this.rooms.get(streamId);
    if (!state) {
      state = {
        messages: [], listeners: new Set(), gifts: [], giftListeners: new Set(),
        engagement: { hearts: 0, shares: 0 }, engagementListeners: new Set(),
        lastEngagementAt: new Map(), ended: false,
      };
      this.rooms.set(streamId, state);
    }
    return state;
  }

  currentEngagement(streamId: string): LiveStreamEngagement {
    return { ...this.state(streamId).engagement };
  }

  recordEngagement(streamId: string, accountId: string, kind: "heart" | "share"): LiveStreamEngagement {
    const state = this.state(streamId);
    if (state.ended) throw new Error("Livestream has ended");
    const now = Date.now();
    const key = `${accountId}:${kind}`;
    const cooldownMs = kind === "heart" ? 120 : 1_000;
    const lastAt = state.lastEngagementAt.get(key);
    if (lastAt === undefined || now - lastAt >= cooldownMs) {
      state.lastEngagementAt.set(key, now);
      if (kind === "heart") state.engagement.hearts += 1;
      else state.engagement.shares += 1;
      const snapshot = { ...state.engagement };
      for (const listener of state.engagementListeners) listener(snapshot);
    }
    return { ...state.engagement };
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

  publishGift(input: Omit<LiveStreamGiftEvent, "id" | "createdAt">): LiveStreamGiftEvent {
    const state = this.state(input.streamId);
    const gift = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    if (state.ended) return gift;
    state.gifts.push(gift);
    for (const listener of state.giftListeners) listener(gift);
    return gift;
  }

  recentGifts(streamId: string): LiveStreamGiftEvent[] {
    return [...(this.rooms.get(streamId)?.gifts ?? [])];
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

  subscribeGifts(streamId: string, listener: (gift: LiveStreamGiftEvent | null) => void): () => void {
    const state = this.state(streamId);
    state.giftListeners.add(listener);
    if (state.ended) listener(null);
    return () => state.giftListeners.delete(listener);
  }

  subscribeEngagement(streamId: string, listener: (engagement: LiveStreamEngagement | null) => void): () => void {
    const state = this.state(streamId);
    state.engagementListeners.add(listener);
    if (state.ended) listener(null);
    return () => state.engagementListeners.delete(listener);
  }

  end(streamId: string): void {
    const state = this.state(streamId);
    state.ended = true;
    for (const listener of state.listeners) listener(null);
    state.listeners.clear();
    for (const listener of state.giftListeners) listener(null);
    state.giftListeners.clear();
    for (const listener of state.engagementListeners) listener(null);
    state.engagementListeners.clear();
    setTimeout(() => {
      if (this.rooms.get(streamId) === state && state.listeners.size === 0
        && state.giftListeners.size === 0 && state.engagementListeners.size === 0) this.rooms.delete(streamId);
    }, 5 * 60_000).unref();
  }
}

export const liveStreamChatHub = new LiveStreamChatHub();
