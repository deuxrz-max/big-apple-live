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
  tags?: string[];
};

export type YouTubeVideoEligibility = {
  videoId: string;
  durationMs: number | null;
  embeddable: boolean;
  categoryId?: string | null;
  availableInUS?: boolean;
  ytRating?: string | null;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  thumbnailAspectRatios?: number[];
  description?: string | null;
  tags?: string[];
  width?: number | null;
  height?: number | null;
};

export const YOUTUBE_VIDEO_FILTER_VERSION = "english-landscape-no-shorts-3m-no-safe-search-v5";
export const MIN_AUTOMATIC_VIDEO_DURATION_MS = 3 * 60 * 1_000;

const CLEAR_NON_ENGLISH_LATIN = /\b(?:lucha libre|resumen|noticias|en vivo|partido|últimos momentos|últimas noticias|melhores momentos|lutte professionnelle|résumé officiel|français|en direct|match complet|ao vivo|luta livre|nachrichten|zusammenfassung|in diretta|hindi|tamil|telugu|bengali|urdu|punjabi|kannada|malayalam|marathi|spanish|portuguese|german|italian|japanese|korean|chinese|arabic|russian)\b/i;
const SHORTS_MARKER = /(?:#\s*shorts?\b|\bshorts?\b|\/shorts\/)/i;
const SIXTEEN_BY_NINE_MIN = 1.70;
const SIXTEEN_BY_NINE_MAX = 1.85;

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

export function youtubeRegionAllowsCountry(regionRestriction: unknown, countryCode = "US"): boolean {
  if (typeof regionRestriction !== "object" || regionRestriction === null) return true;
  const restriction = regionRestriction as { allowed?: unknown; blocked?: unknown };
  const country = countryCode.toUpperCase();
  if (Array.isArray(restriction.blocked)
    && restriction.blocked.some(item => typeof item === "string" && item.toUpperCase() === country)) {
    return false;
  }
  if (Array.isArray(restriction.allowed)) {
    return restriction.allowed.some(item => typeof item === "string" && item.toUpperCase() === country);
  }
  return true;
}

function isEnglishLanguage(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized === "english" || normalized === "eng" || normalized.split(/[-_]/)[0] === "en";
}

function titleIsMostlyNonLatin(title: string): boolean {
  const letters = Array.from(title).filter(character => /\p{L}/u.test(character));
  if (letters.length === 0) return true;
  const latinLetters = letters.filter(character => /\p{Script=Latin}/u.test(character)).length;
  return latinLetters / letters.length < 0.55;
}

export type YouTubeVideoSafetyReasons = {
  shortsMarker: boolean;
  underThreeMinutes: boolean;
  nonEnglish: boolean;
  nonWidescreen: boolean;
  notEmbeddable: boolean;
  notAvailableInUS: boolean;
  ageRestricted: boolean;
};

/** Shared strict screening for new picks and videos already saved in a room pool. */
export function youtubeVideoSafetyReasons(
  candidate: YouTubeVideoCandidate,
  details: YouTubeVideoEligibility | undefined,
): YouTubeVideoSafetyReasons {
  const textToScreen = [
    candidate.title,
    candidate.description ?? "",
    ...(candidate.tags ?? []),
    details?.description ?? "",
    ...(details?.tags ?? []),
  ];
  const audioLanguage = details?.defaultAudioLanguage ?? candidate.defaultAudioLanguage;
  const defaultLanguage = details?.defaultLanguage ?? candidate.defaultLanguage;
  const languageVerified = audioLanguage?.trim()
    ? isEnglishLanguage(audioLanguage)
    : Boolean(defaultLanguage?.trim() && isEnglishLanguage(defaultLanguage));
  const sourceWidth = details?.width;
  const sourceHeight = details?.height;
  let nonWidescreen: boolean;
  if (typeof sourceWidth === "number" && typeof sourceHeight === "number"
    && sourceWidth > 0 && sourceHeight > 0) {
    const ratio = sourceWidth / sourceHeight;
    nonWidescreen = sourceWidth <= sourceHeight
      || ratio < SIXTEEN_BY_NINE_MIN || ratio > SIXTEEN_BY_NINE_MAX;
  } else {
    const ratios = details?.thumbnailAspectRatios?.length
      ? details.thumbnailAspectRatios
      : candidate.thumbnailAspectRatios ?? [];
    const hasSquareOrPortraitVariant = ratios.some(
      ratio => Number.isFinite(ratio) && ratio > 0 && ratio <= 1,
    );
    const hasSixteenByNineVariant = ratios.some(
      ratio => Number.isFinite(ratio) && ratio >= SIXTEEN_BY_NINE_MIN && ratio <= SIXTEEN_BY_NINE_MAX,
    );
    nonWidescreen = hasSquareOrPortraitVariant || !hasSixteenByNineVariant;
  }
  const duration = details?.durationMs;
  return {
    shortsMarker: textToScreen.some(value => SHORTS_MARKER.test(value)),
    underThreeMinutes: typeof duration !== "number" || duration < MIN_AUTOMATIC_VIDEO_DURATION_MS,
    nonEnglish: !languageVerified
      || titleIsMostlyNonLatin(candidate.title)
      || CLEAR_NON_ENGLISH_LATIN.test(candidate.title),
    nonWidescreen,
    notEmbeddable: details?.embeddable !== true,
    notAvailableInUS: details?.availableInUS === false,
    ageRestricted: details?.ytRating === "ytAgeRestricted",
  };
}

function passesEnglishAndWidescreen(
  candidate: YouTubeVideoCandidate,
  details: YouTubeVideoEligibility | undefined,
): boolean {
  const reasons = youtubeVideoSafetyReasons(candidate, details);
  return !reasons.nonEnglish && !reasons.nonWidescreen;
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
  if (!details?.embeddable || details.availableInUS === false || details.ytRating === "ytAgeRestricted"
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
    if (!details || typeof details.durationMs !== "number") return false;
    const reasons = youtubeVideoSafetyReasons(candidate, details);
    if (reasons.shortsMarker || reasons.underThreeMinutes || reasons.nonEnglish
      || reasons.nonWidescreen || reasons.notEmbeddable || reasons.notAvailableInUS
      || reasons.ageRestricted) return false;
    durationMsByVideoId[candidate.videoId] = details.durationMs;
    return true;
  }).slice(0, Math.max(0, Math.min(300, resultLimit)));

  for (const videoId of Object.keys(durationMsByVideoId)) {
    if (!videos.some(video => video.videoId === videoId)) delete durationMsByVideoId[videoId];
  }

  return { videos, durationMsByVideoId };
}
