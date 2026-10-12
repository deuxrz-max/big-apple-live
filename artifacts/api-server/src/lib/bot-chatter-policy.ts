export type BotChatterFrequency = "rare" | "normal" | "often";
export type BotChatterProfile = {
  id: "ghost" | "vampire" | "wolf" | "zombie";
  name: string;
  personality: string;
  lines: string[];
};
export type BotChatterSettings = {
  enabled: boolean;
  frequency: BotChatterFrequency;
  bots: BotChatterProfile[];
};

export const DEFAULT_BOT_CHATTER_SETTINGS: BotChatterSettings = {
  enabled: true,
  frequency: "normal",
  bots: [
    {
      id: "ghost",
      name: "Ghost Bot",
      personality: "Quiet, observant hype phantom who spots good moments and adds a little stardust.",
      lines: [
        "The chat has a nice glow tonight.",
        "That gift entrance was pure magic.",
        "Fresh faces, welcome to the night shift.",
        "This room has excellent after-hours energy.",
        "A little chat keeps the night bright.",
        "The beam has an open spot if you want in.",
        "That combo deserves a tiny round of applause.",
        "The night crew is showing up strong.",
        "Sending good vibes down the timeline.",
        "Somebody just raised the room's sparkle level.",
        "The quiet corner is officially less quiet now.",
        "Lovely timing on that gift.",
        "Who's got a fun stream tip?",
        "The room is warming up nicely.",
        "That beam spot is waiting for a brave voice.",
        "A friendly hello can start a whole conversation.",
        "This chat has main-character lighting.",
        "Midnight and the vibes are aligned.",
        "Let's keep the good energy rolling.",
        "That was a smooth entrance.",
        "A little stardust for everyone here.",
        "Welcome to the cozy side of the feed.",
        "Great moment to say hey.",
        "Somebody cue the imaginary applause.",
        "The glow-up is happening in real time.",
      ],
    },
    {
      id: "vampire",
      name: "Vampire Bot",
      personality: "Dry, clever night-shift jokester; the joke is always on the hour, never a person.",
      lines: [
        "I stayed up for this chat. No regrets. Probably.",
        "That gift arrived with suspiciously good timing.",
        "I would applaud, but my cape is busy.",
        "The room is lively. My coffin says it is past bedtime.",
        "A concise hello beats a dramatic entrance. Usually.",
        "Another excellent use of being awake at midnight.",
        "The beam has an open spot. I promise the mic is harmless.",
        "That was almost as smooth as my getaway.",
        "Nobody tell the sun we are having fun.",
        "The chat is getting positively nocturnal.",
        "A gift? How delightfully generous of you.",
        "Tonight's energy is better than my sleep schedule.",
        "I approve of this level of late-night enthusiasm.",
        "The room is warmer than a candlelit crypt.",
        "That joke was almost fang-tastic. Almost.",
        "Keep chatting; the silence is getting dramatic.",
        "A fresh face. I shall pretend not to be impressed.",
        "That beam spot looks less intimidating than daylight.",
        "We are making excellent use of the moonlight.",
        "One small message for chat, one giant step past bedtime.",
        "The feed is alive. Convenient.",
        "The night shift has excellent taste in company.",
        "I see good vibes. I will allow it.",
        "Smooth gift delivery. No bats were inconvenienced.",
        "This is my favorite kind of after-hours plot twist.",
      ],
    },
    {
      id: "wolf",
      name: "Wolf Bot",
      personality: "Upbeat pack-minded cheerleader who welcomes people and points out open beam spots.",
      lines: [
        "Pack check: everyone getting a chance to jump in?",
        "That gift brought the whole pack some sparkle.",
        "Open beam spot! Come share your stream energy.",
        "Great teamwork in this chat tonight.",
        "A warm welcome makes the whole room better.",
        "The pack is growing. Plenty of good vibes to go around.",
        "Your next hello could start a great chat.",
        "That was a strong entrance, packmate.",
        "Keep the conversation rolling, one friendly message at a time.",
        "Who has a favorite streaming tip to share?",
        "Nice gift! The room just got brighter.",
        "There is room for another voice on the beam.",
        "We are stronger when everyone feels welcome.",
        "That chat moment deserves a tail wag.",
        "Good energy travels fast through this pack.",
        "The beam is open if you want to join.",
        "Solid vibes from the whole crew tonight.",
        "A friendly question can get the pack talking.",
        "Great timing, packmates.",
        "This room is finding its rhythm.",
        "Thanks for keeping the chat kind.",
        "Someone's bringing excellent howl-after-dark energy.",
        "Ready for one more voice on the beam?",
        "The night pack is in good spirits.",
        "Keep those friendly hellos coming.",
      ],
    },
    {
      id: "zombie",
      name: "Zombie Bot",
      personality: "Chill night-owl with sleepy puns, gentle encouragement, and a relaxed pace.",
      lines: [
        "I woke up for this chat. Worth the brain cells.",
        "That gift just gave the room a little extra life.",
        "Open beam spot if your voice is feeling undead.",
        "This is a very alive chat for a zombie.",
        "A friendly hello? My favorite kind of resurrection.",
        "I am shambling toward a good conversation.",
        "The room has risen to the occasion.",
        "That was a lively gift delivery.",
        "Anyone have a favorite late-night stream snack?",
        "The beam has room for one more not-so-sleepy voice.",
        "My night shift playlist is just chat notifications.",
        "Those good vibes are contagious. In a non-zombie way.",
        "The chat is moving faster than my walking speed.",
        "Glad you made it through the graveyard shift.",
        "This room is keeping the night alive.",
        "A quick hello; no brains required.",
        "That was a surprisingly energetic entrance.",
        "Someone just upgraded the vibes from sleepy to spooky.",
        "More friendly chat, fewer awkward silences.",
        "The night is young. I am... technically.",
        "Nice gift! Even my stitches are smiling.",
        "Want to jump into the open beam spot?",
        "The conversation is alive and well.",
        "I would dance, but my knees are on backorder.",
        "Thanks for making this room feel welcoming.",
      ],
    },
  ],
};

const FREQUENCY_MINUTES: Record<BotChatterFrequency, [number, number]> = {
  rare: [8, 10],
  normal: [6, 9],
  often: [5, 7],
};

export function nextBotChatterDelayMs(frequency: BotChatterFrequency, random = Math.random) {
  const [minMinutes, maxMinutes] = FREQUENCY_MINUTES[frequency];
  const span = maxMinutes - minMinutes;
  const unit = Math.min(0.999999, Math.max(0, random()));
  return (minMinutes + unit * span) * 60_000;
}

export function chooseBotChatterLine(lines: string[], previousLine: string | null, random = Math.random) {
  const options = lines.filter(line => line !== previousLine);
  const available = options.length ? options : lines;
  if (!available.length) return null;
  const unit = Math.min(0.999999, Math.max(0, random()));
  return available[Math.floor(unit * available.length)] ?? null;
}

export function hasRecentHumanRoomActivity(
  lastHumanMessageAt: Date | null,
  now: number,
  latestChatterAt: Date | null,
  quietAfterMs = 15 * 60_000,
) {
  if (!lastHumanMessageAt) return false;
  const messageAt = lastHumanMessageAt.getTime();
  if (now - messageAt > quietAfterMs || messageAt > now) return false;
  return !latestChatterAt || messageAt > latestChatterAt.getTime();
}
