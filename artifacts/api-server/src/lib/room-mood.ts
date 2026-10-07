import {
  PARTICLE_EMOJIS, ROOM_MOOD_WINDOW_MS, ROOM_ATMOSPHERE_SCENE_MS, particleEmojis, roomMoodStyle,
  type EmojiParticleEvent, type ParticleEmoji, type RoomMoodUpdate,
} from '@workspace/beam-identity';

/** One tracker belongs to one room incarnation, never to a reusable share code. */
export class RoomMoodTracker {
  private usage: { at: number; emoji: ParticleEmoji; count: number }[] = [];
  private seen = new Map<string, number>();
  private dominant: ParticleEmoji | null = null;
  private activity: { at: number; weight: number }[] = [];
  private readonly bornAt: number;
  constructor(private readonly now: () => number = Date.now) { this.bornAt = now(); }

  private purge(at: number) {
    const cutoff = at - ROOM_MOOD_WINDOW_MS;
    this.usage = this.usage.filter(entry => entry.at > cutoff);
    this.activity = this.activity.filter(entry => entry.at > cutoff);
    for (const [id, time] of this.seen) if (time <= cutoff) this.seen.delete(id);
  }
  /** Only accepted server actions contribute; heartbeats and sockets never do. */
  recordActivity(weight = 1) {
    const at = this.now();
    this.purge(at);
    this.activity.push({ at, weight: Math.max(0, Math.min(3, weight)) });
    // Bound memory and saturation even during a large reaction burst.
    if (this.activity.length > 120) this.activity.shift();
  }
  record(roomId: string, messageId: string, text: string): EmojiParticleEvent[] {
    const at = this.now();
    this.purge(at);
    if (this.seen.has(messageId)) return [];
    const counts = new Map<ParticleEmoji, number>();
    for (const emoji of particleEmojis(text)) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    this.seen.set(messageId, at);
    if (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value!);
    this.recordActivity(1 + Math.min(2, [...counts.values()].reduce((sum, count) => sum + count, 0) * .2));
    if (!counts.size) return [];
    return [...counts].map(([emoji, count]) => {
      this.usage.push({ at, emoji, count });
      if (this.usage.length > 2048) this.usage.shift();
      const eventId = `${messageId}:${emoji}`;
      let seed = 2166136261;
      for (const character of eventId) seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619) >>> 0;
      return { roomId, emoji, burstSize: 3 + seed % 6, seed, eventId, emittedAt: at };
    });
  }
  current(roomId: string): RoomMoodUpdate {
    const at = this.now();
    this.purge(at);
    const cycleId = Math.floor(Math.max(0, at - this.bornAt) / ROOM_ATMOSPHERE_SCENE_MS);
    const phase = (['drift', 'bloom', 'aurora'] as const)[cycleId % 3]!;
    const energy = Math.min(1, this.activity.reduce((sum, entry) =>
      sum + entry.weight * Math.pow(Math.max(0, 1 - (at - entry.at) / ROOM_MOOD_WINDOW_MS), 2), 0) / 20);
    let seed = 2166136261;
    for (const character of `${roomId}:${this.bornAt}:${cycleId}`)
      seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619) >>> 0;
    const mood = roomMoodStyle(roomId, this.dominant);
    if (!this.dominant) {
      mood.moodColor = ['#3b5bff', '#6557ef', '#547bff'][cycleId % 3]!;
      mood.glowColor = ['rgba(59,91,255,0.35)', 'rgba(101,87,239,0.35)', 'rgba(84,123,255,0.35)'][cycleId % 3]!;
    }
    return { ...mood, atmosphere: {
      phase, energy: Math.round(energy * 1000) / 1000, cycleId, seed,
      startedAt: this.bornAt + cycleId * ROOM_ATMOSPHERE_SCENE_MS,
      durationMs: ROOM_ATMOSPHERE_SCENE_MS, serverTime: at,
    } };
  }
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
