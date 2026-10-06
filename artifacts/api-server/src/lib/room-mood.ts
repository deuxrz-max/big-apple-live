import {
  PARTICLE_EMOJIS, ROOM_MOOD_WINDOW_MS, particleEmojis, roomMoodStyle,
  type EmojiParticleEvent, type ParticleEmoji, type RoomMoodUpdate,
} from '@workspace/beam-identity';

/** One tracker belongs to one room incarnation, never to a reusable share code. */
export class RoomMoodTracker {
  private usage: { at: number; emoji: ParticleEmoji; count: number }[] = [];
  private seen = new Map<string, number>();
  private dominant: ParticleEmoji | null = null;
  constructor(private readonly now: () => number = Date.now) {}

  private purge(at: number) {
    const cutoff = at - ROOM_MOOD_WINDOW_MS;
    this.usage = this.usage.filter(entry => entry.at > cutoff);
    for (const [id, time] of this.seen) if (time <= cutoff) this.seen.delete(id);
  }
  record(roomId: string, messageId: string, text: string): EmojiParticleEvent[] {
    const at = this.now();
    this.purge(at);
    if (this.seen.has(messageId)) return [];
    const counts = new Map<ParticleEmoji, number>();
    for (const emoji of particleEmojis(text)) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    if (!counts.size) return [];
    this.seen.set(messageId, at);
    return [...counts].map(([emoji, count]) => {
      this.usage.push({ at, emoji, count });
      const eventId = `${messageId}:${emoji}`;
      let seed = 2166136261;
      for (const character of eventId) seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619) >>> 0;
      return { roomId, emoji, burstSize: 3 + seed % 6, seed, eventId, emittedAt: at };
    });
  }
  current(roomId: string): RoomMoodUpdate { return roomMoodStyle(roomId, this.dominant); }
  compute(roomId: string): RoomMoodUpdate {
    this.purge(this.now());
    const counts = new Map<ParticleEmoji, number>();
    for (const entry of this.usage) counts.set(entry.emoji, (counts.get(entry.emoji) ?? 0) + entry.count);
    let highest = 0;
    this.dominant = null;
    // Fixed ordering makes tied counts deterministic for every client.
    for (const emoji of PARTICLE_EMOJIS) {
      const count = counts.get(emoji) ?? 0;
      if (count > highest) { highest = count; this.dominant = emoji; }
    }
    return this.current(roomId);
  }
}
