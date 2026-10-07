import type { CommunityAtmosphere } from "@workspace/api-zod";

export const atmosphereConfig = {
  windowMs: 180_000,
  busyCount: 12,
  busyAuthors: 3,
  quietCount: 5,
  sustainMs: 20_000,
  minDwellMs: 60_000,
  heatedSamples: 8,
  heatedAuthors: 3,
  hostileShare: 0.65,
  confidence: 0.8,
};
export type ToneAssessment = {
  samples: number; authors: number; hostileShare: number;
  hostileConfidence: number; friendlyConfidence: number;
};
export type RecentActivity = { count: number; authors: number };

/** No classifier is installed. Passing no assessment DISABLES tone decisions:
 * activity cannot classify hostility, and there is no keyword fallback. */
export class CommunityAtmosphereTracker {
  private state: CommunityAtmosphere;
  private candidate: CommunityAtmosphere["scene"] | null = null;
  private candidateSince = 0;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly config = atmosphereConfig,
    saved?: { scene: CommunityAtmosphere["scene"]; since: number } | null,
  ) {
    this.state = { scene: saved?.scene === "city" ? "city" : "calm", since: saved?.since ?? now(),
      activity: 0, windowMs: config.windowMs, sentimentEnabled: false };
  }
  current() { return { ...this.state }; }
  evaluate(activity: RecentActivity, tone?: ToneAssessment): CommunityAtmosphere {
    const at = this.now();
    this.state.activity = activity.count;
    this.state.sentimentEnabled = !!tone;
    let next = this.state.scene;
    const heated = tone && tone.samples >= this.config.heatedSamples
      && tone.authors >= this.config.heatedAuthors && tone.hostileShare >= this.config.hostileShare
      && tone.hostileConfidence >= this.config.confidence;
    if (heated) next = "volcano";
    else if (tone && tone.friendlyConfidence >= this.config.confidence) next = "calm";
    else if (activity.count >= this.config.busyCount && activity.authors >= this.config.busyAuthors) next = "city";
    else if (activity.count <= this.config.quietCount || this.state.scene === "volcano") next = "calm";
    if (next === this.state.scene) { this.candidate = null; return this.current(); }
    if (this.candidate !== next) { this.candidate = next; this.candidateSince = at; }
    if (at - this.candidateSince >= this.config.sustainMs && at - this.state.since >= this.config.minDwellMs) {
      this.state.scene = next; this.state.since = at; this.candidate = null;
    }
    return this.current();
  }
}
