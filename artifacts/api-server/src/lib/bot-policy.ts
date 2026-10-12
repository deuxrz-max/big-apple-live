export const BOT_VISIT_MS = 60_000;
export const DEFAULT_BOT_BREAK_SECONDS = 45;
export const BOT_WARNING_COOLDOWN_MS = 15_000;
export type BotId = "ghost" | "vampire" | "wolf" | "zombie";
export type Bot = {
  id: BotId;
  name: string;
  avatarUrl: string;
  participantId: string;
  arrival: string;
  departure: string;
};
export const BOT_ACCOUNTS = [
  { id: "ghost", name: "Ghost Bot", avatarUrl: "/bots/ghost.webp", participantId: "10000000-0000-4000-8000-000000000001",
    arrival: "Ghost Bot has arrived", departure: "Ghost Bot slips quietly away." },
  { id: "vampire", name: "Vampire Bot", avatarUrl: "/bots/vampire.webp", participantId: "10000000-0000-4000-8000-000000000002",
    arrival: "Vampire Bot has arrived", departure: "Vampire Bot fades into the shadows." },
  { id: "wolf", name: "Wolf Bot", avatarUrl: "/bots/wolf.webp", participantId: "10000000-0000-4000-8000-000000000003",
    arrival: "Wolf Bot has arrived", departure: "Wolf Bot heads out on patrol." },
  { id: "zombie", name: "Zombie Bot", avatarUrl: "/bots/zombie.webp", participantId: "10000000-0000-4000-8000-000000000004",
    arrival: "Zombie Bot has arrived", departure: "Zombie Bot shuffles quietly away." },
] as const satisfies readonly Bot[];
export const DEFAULT_BANNED_WORDS = [
  "nigger", "faggot", "kike", "chink", "raghead", "tranny",
  "kill yourself", "i will kill you", "i'll kill you", "go die",
  "shut the fuck up", "you are worthless",
];
function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function urls(text: string) {
  return text.match(/https?:\/\/[^\s]+/gi)?.map(u => u.toLowerCase().replace(/[.,!?;]+$/, "")) ?? [];
}
/** Deterministic word/phrase and spam checks, not sentiment analysis. Public text only. */
export function publicViolation(text: string, words: string[], recent: { text: string; createdAt: Date }[], now: number) {
  const normalized = ` ${normalize(text)} `;
  if (words.some(word => { const n = normalize(word); return n && normalized.includes(` ${n} `); }))
    return "Banned word or phrase";
  if (recent.filter(m => now - m.createdAt.getTime() < 10_000).length >= 5) return "Flooding";
  const links = urls(text);
  if (links.length >= 3 || links.some(url =>
    recent.filter(m => now - m.createdAt.getTime() < 30_000 && urls(m.text).includes(url)).length >= 2))
    return "Repeated links";
  return null;
}
type Visit = { bot: Bot; roomId: string | null; lastRoom: string | null; nextAt: number };
export type BotVisitEvent = { type: "join" | "leave"; bot: Bot; roomId: string };
export class BotRotation {
  private visits: Visit[];
  constructor(now = Date.now(), private readonly random: () => number = Math.random) {
    this.visits = BOT_ACCOUNTS.map((bot, i) => ({ bot, roomId: null, lastRoom: null, nextAt: now + i * 15_000 }));
  }
  people(roomId: string) { return this.visits.filter(v => v.roomId === roomId).map(v => v.bot); }
  botById(id: BotId) { return this.visits.find(v => v.bot.id === id)?.bot ?? BOT_ACCOUNTS.find(bot => bot.id === id)!; }
  setDisplayNames(names: Partial<Record<BotId, string>>) {
    this.visits = this.visits.map(visit => {
      const base = BOT_ACCOUNTS.find(bot => bot.id === visit.bot.id)!;
      const name = names[base.id]?.trim() || base.name;
      return {
        ...visit,
        bot: {
          ...base,
          name,
          arrival: `${name}${base.arrival.slice(base.name.length)}`,
          departure: `${name}${base.departure.slice(base.name.length)}`,
        },
      };
    });
  }
  tick(occupiedRooms: string[], now: number, breakSeconds = DEFAULT_BOT_BREAK_SECONDS): BotVisitEvent[] {
    const events: BotVisitEvent[] = [];
    const occupied = new Set(this.visits.flatMap(v => v.roomId ? [v.roomId] : []));
    for (const v of this.visits) {
      if (now < v.nextAt) continue;
      if (v.roomId) {
        events.push({ type: "leave", bot: v.bot, roomId: v.roomId });
        occupied.delete(v.roomId); v.lastRoom = v.roomId; v.roomId = null;
        v.nextAt = now + breakSeconds * 1000;
        continue;
      }
      const available = [...new Set(occupiedRooms)].filter(id => !occupied.has(id));
      const other = available.filter(id => id !== v.lastRoom);
      const choices = other.length ? other : available;
      if (!choices.length) { v.nextAt = now + 5000; continue; }
      const roomId = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))]!;
      v.roomId = roomId; v.nextAt = now + BOT_VISIT_MS; occupied.add(roomId);
      events.push({ type: "join", bot: v.bot, roomId });
    }
    return events;
  }
  cancelJoin(botId: string, now: number) {
    const visit = this.visits.find(v => v.bot.id === botId);
    if (visit) { visit.roomId = null; visit.nextAt = now + 5000; }
  }
}
