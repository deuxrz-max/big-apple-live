export type YouTubeVideoCandidate = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  description: string | null;
  liveBroadcastContent?: string | null;
};

export type YouTubeVideoEligibility = {
  videoId: string;
  durationMs: number | null;
  embeddable: boolean;
  ytRating?: string | null;
};

export function selectPlayableYouTubeVideos(
  candidates: YouTubeVideoCandidate[],
  eligibility: YouTubeVideoEligibility[],
  trustedChannelTitles?: readonly string[],
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
    durationMsByVideoId[candidate.videoId] = details.durationMs;
    return true;
  }).slice(0, 10);

  for (const videoId of Object.keys(durationMsByVideoId)) {
    if (!videos.some(video => video.videoId === videoId)) delete durationMsByVideoId[videoId];
  }

  return { videos, durationMsByVideoId };
}
