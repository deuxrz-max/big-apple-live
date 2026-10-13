export type YouTubeVideoCandidate = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  description: string | null;
  liveBroadcastContent?: string | null;
  channelId?: string | null;
  publishedAt?: string | null;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  thumbnailAspectRatios?: number[];
};

export type YouTubeVideoEligibility = {
  videoId: string;
  durationMs: number | null;
  embeddable: boolean;
  ytRating?: string | null;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  thumbnailAspectRatios?: number[];
};

const NON_ENGLISH_SCRIPTS = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Greek}\p{Script=Armenian}\p{Script=Georgian}]/u;
const CLEAR_NON_ENGLISH_LATIN = /\b(?:lucha libre|resumen|últimos momentos|últimas noticias|melhores momentos|lutte professionnelle|résumé officiel)\b/i;
const SHORTS_TITLE = /(?:#shorts?\b|\byoutube shorts?\b|\bshorts\b)/i;

export function youtubeThumbnailAspectRatios(value: unknown): number[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(item => {
    if (typeof item !== "object" || item === null) return [];
    const width = (item as { width?: unknown }).width;
    const height = (item as { height?: unknown }).height;
    if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return [];
    return [width / height];
  });
}

function isEnglishLanguage(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized === "english" || normalized === "eng" || normalized.split(/[-_]/)[0] === "en";
}

function passesEnglishAndWidescreen(
  candidate: YouTubeVideoCandidate,
  details: YouTubeVideoEligibility | undefined,
): boolean {
  if (SHORTS_TITLE.test(candidate.title)
    || NON_ENGLISH_SCRIPTS.test(candidate.title)
    || CLEAR_NON_ENGLISH_LATIN.test(candidate.title)) return false;

  const languageHints = [
    candidate.defaultAudioLanguage,
    candidate.defaultLanguage,
    details?.defaultAudioLanguage,
    details?.defaultLanguage,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (languageHints.some(language => !isEnglishLanguage(language))) return false;

  const ratios = details?.thumbnailAspectRatios?.length
    ? details.thumbnailAspectRatios
    : candidate.thumbnailAspectRatios ?? [];
  const hasPortraitVariant = ratios.some(ratio => Number.isFinite(ratio) && ratio > 0 && ratio < 1);
  const hasSixteenByNineVariant = ratios.some(
    ratio => Number.isFinite(ratio) && ratio >= 1.70 && ratio <= 1.85,
  );
  return hasSixteenByNineVariant && !hasPortraitVariant;
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

export function selectExactLiveYouTubeVideo(
  candidates: YouTubeVideoCandidate[],
  eligibility: YouTubeVideoEligibility[],
  options: {
    channelId: string;
    channelTitle: string;
    streamTitle: string;
    segmentDurationMs: number;
  },
): { video: Omit<YouTubeVideoCandidate, "liveBroadcastContent" | "channelId">; durationMs: number } | null {
  const channelTitle = options.channelTitle.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const exactTitle = normalizeTitle(options.streamTitle);
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  const candidate = candidates.find(item =>
    /^[A-Za-z0-9_-]{11}$/.test(item.videoId)
    && item.channelId === options.channelId
    && (item.channelTitle ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") === channelTitle
    && normalizeTitle(item.title) === exactTitle
    && item.liveBroadcastContent === "live",
  );
  if (!candidate || !Number.isFinite(options.segmentDurationMs) || options.segmentDurationMs <= 0) return null;

  const details = eligibilityById.get(candidate.videoId);
  if (!details?.embeddable || details.ytRating === "ytAgeRestricted"
    || !passesEnglishAndWidescreen(candidate, details)) return null;

  return {
    video: {
      videoId: candidate.videoId,
      title: candidate.title,
      channelTitle: candidate.channelTitle,
      description: candidate.description,
    },
    durationMs: options.segmentDurationMs,
  };
}

export function selectPlayableYouTubeVideos(
  candidates: YouTubeVideoCandidate[],
  eligibility: YouTubeVideoEligibility[],
  trustedChannelTitles?: readonly string[],
  resultLimit = 10,
) {
  const eligibilityById = new Map(eligibility.map(item => [item.videoId, item]));
  const trustedChannels = trustedChannelTitles
    ? new Set(trustedChannelTitles.map(title => title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")))
    : null;
  const durationMsByVideoId: Record<string, number> = {};
  const videos = candidates.filter(candidate => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(candidate.videoId)) return false;
    if (trustedChannels && !trustedChannels.has(
      (candidate.channelTitle ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
    )) return false;
    if (candidate.liveBroadcastContent === "live" || candidate.liveBroadcastContent === "upcoming") return false;
    const details = eligibilityById.get(candidate.videoId);
    if (!details?.embeddable || !details.durationMs || details.durationMs <= 0) return false;
    if (details.ytRating === "ytAgeRestricted") return false;
    if (!passesEnglishAndWidescreen(candidate, details)) return false;
    durationMsByVideoId[candidate.videoId] = details.durationMs;
    return true;
  }).slice(0, Math.max(0, Math.min(50, resultLimit)));

  for (const videoId of Object.keys(durationMsByVideoId)) {
    if (!videos.some(video => video.videoId === videoId)) delete durationMsByVideoId[videoId];
  }

  return { videos, durationMsByVideoId };
}
