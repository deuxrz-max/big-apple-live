/** One flag disables the additional transport, server events, and visual layer. */
export const ENABLE_ROOM_MOOD_VISUALS = true;
export const ROOM_MOOD_WINDOW_MS = 3 * 60 * 1000;
export const ROOM_VISUALS_SOCKET_PATH = '/api/room-visuals/socket.io';
export const PARTICLE_EMOJIS = ['❤️', '💖', '💜', '😊', '😄', '😂', '🎤', '🎵', '🎶'] as const;
export type ParticleEmoji = typeof PARTICLE_EMOJIS[number];
export interface EmojiParticleEvent {
  roomId: string;
  emoji: ParticleEmoji;
  burstSize: number;
  seed: number;
  eventId: string;
  emittedAt: number;
}
export interface RoomMoodUpdate {
  roomId: string;
  emoji: ParticleEmoji | null;
  moodColor: string;
  glowColor: string;
}
const styles: Record<ParticleEmoji, [string, string]> = {
  '❤️': ['#ff4b8b', 'rgba(255,75,139,0.7)'],
  '💖': ['#ff65b6', 'rgba(255,101,182,0.7)'],
  '💜': ['#b16cff', 'rgba(177,108,255,0.7)'],
  '😊': ['#ffc94b', 'rgba(255,201,75,0.7)'],
  '😄': ['#ffb13b', 'rgba(255,177,59,0.7)'],
  '😂': ['#ff914b', 'rgba(255,145,75,0.7)'],
  '🎤': ['#646bff', 'rgba(100,107,255,0.7)'],
  '🎵': ['#547bff', 'rgba(84,123,255,0.7)'],
  '🎶': ['#9365ff', 'rgba(147,101,255,0.7)'],
};
export function roomMoodStyle(roomId: string, emoji: ParticleEmoji | null): RoomMoodUpdate {
  const [moodColor, glowColor] = emoji ? styles[emoji] : ['#3b5bff', 'rgba(59,91,255,0.25)'];
  return { roomId, emoji, moodColor, glowColor };
}
/** Count real occurrences, treating text and emoji presentation hearts identically. */
export function particleEmojis(text: string): ParticleEmoji[] {
  return Array.from(text.replace(/\uFE0F/g, '')).flatMap(character => {
    const emoji = character === '❤' ? '❤️' : character;
    return PARTICLE_EMOJIS.includes(emoji as ParticleEmoji) ? [emoji as ParticleEmoji] : [];
  });
}
