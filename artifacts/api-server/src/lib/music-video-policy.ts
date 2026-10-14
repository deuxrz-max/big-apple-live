type MusicVideoMetadata = {
  title: string;
  channelTitle: string | null;
  description?: string | null;
  tags?: string[];
  categoryId?: string | null;
};

const OFFICIAL_VIDEO_TITLE = /\bofficial\s+(?:music\s+)?video\b/i;
const EXCLUDED_MUSIC_CONTENT = /\b(?:reaction|reacts?|review|interview|tutorial|podcast|lyrics?|lyric\s+video|audio(?:\s+only)?|visuali[sz]er|compilations?|covers?|karaoke|full\s+album|album\s+mix|live|concert|performance)\b/i;

function normalizeArtistName(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/vevo$/i, "")
    .replace(/\b(?:official|topic|records?|music|entertainment|vevo)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Require YouTube's Music category, an official-video title, and a channel that
 * is either VEVO or matches the artist credited before the title separator.
 */
export function isOfficialMusicVideo(video: MusicVideoMetadata): boolean {
  if (video.categoryId !== "10" || !OFFICIAL_VIDEO_TITLE.test(video.title)) return false;

  const searchableText = [video.title, video.description ?? "", ...(video.tags ?? [])].join(" ");
  if (EXCLUDED_MUSIC_CONTENT.test(searchableText)) return false;

  const channel = (video.channelTitle ?? "").trim();
  if (!channel) return false;
  if (/vevo$/i.test(channel)) return true;

  const creditedArtist = video.title.split(/\s+(?:-|–|—|\|)\s+/, 1)[0] ?? "";
  const normalizedArtist = normalizeArtistName(creditedArtist);
  const normalizedChannel = normalizeArtistName(channel);
  return normalizedArtist.length >= 2
    && normalizedChannel.length >= 2
    && (normalizedArtist === normalizedChannel
      || normalizedArtist.startsWith(`${normalizedChannel} `)
      || normalizedChannel.startsWith(`${normalizedArtist} `));
}
