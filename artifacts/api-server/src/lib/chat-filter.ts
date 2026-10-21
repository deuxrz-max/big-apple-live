const CENSOR_TOKEN = "$%<&";

const BASE_CENSORED_WORDS = [
  "fuck", "fucking", "fucked", "fucker", "motherfucker",
  "shit", "shitty", "bullshit", "bitch", "bitches", "bitching",
  "asshole", "assholes", "bastard", "bastards", "damn", "goddamn",
  "piss", "prick", "twat", "arse",
  "dick", "dicks", "cock", "cocks", "pussy", "pussies", "cunt", "cunts",
  "whore", "whores", "slut", "sluts", "blowjob", "handjob", "dildo", "dildos",
  "porn", "pornography", "orgasm", "orgasms", "cum", "jizz", "tits",
  "nigger", "faggot", "kike", "chink", "raghead", "tranny",
] as const;

const HIDE_ONLY_PHRASES = new Set([
  "kill yourself", "i will kill you", "i'll kill you", "go die", "you are worthless",
]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function censorableWords(configuredWords: readonly string[]) {
  const terms = new Set<string>(BASE_CENSORED_WORDS);
  for (const configured of configuredWords) {
    const term = configured.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (!term || HIDE_ONLY_PHRASES.has(term)) continue;
    // Admin-configured individual terms are censored inline. Existing threat
    // and harassment phrases continue through the public moderation path.
    if (/^[\p{L}\p{N}_'-]+$/u.test(term)) terms.add(term);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

/** Replace prohibited words in place while preserving all other message text. */
export function censorChatText(text: string, configuredWords: readonly string[] = []): string {
  const words = censorableWords(configuredWords);
  if (!words.length) return text;
  const alternatives = words.map(escapeRegex).join("|");
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${alternatives})(?=$|[^\\p{L}\\p{N}_])`, "giu");
  return text.replace(pattern, (_match, prefix: string) => `${prefix}${CENSOR_TOKEN}`);
}
