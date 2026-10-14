export const MIN_FEATURE_FILM_DURATION_MS = 60 * 60_000;

export type MovieVideoMetadata = {
  title: string;
  durationMs: number;
};

const FULL_FEATURE_TITLE = /\b(?:full|complete)\s+(?:length\s+)?(?:feature\s+)?(?:movie|film)\b/i;
const NON_FILM_TITLE = /\b(?:trailer|teaser|clip|clips|review|reaction|reacts?|recap|explained|explainer|breakdown|scene|featurette|interview|behind\s+the\s+scenes|highlights?)\b/i;

/** Only accept complete feature-film uploads, never commentary or promotional edits. */
export function isCompleteFeatureFilm(video: MovieVideoMetadata): boolean {
  return video.durationMs >= MIN_FEATURE_FILM_DURATION_MS
    && FULL_FEATURE_TITLE.test(video.title)
    && !NON_FILM_TITLE.test(video.title);
}
