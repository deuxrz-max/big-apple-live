import { getPortrait } from './portraits';
import {
  EMOJI_MOOD_KEYS,
  MOOD_SPRITES,
  type MoodDefinition,
  type MoodKey,
} from './moodCatalog';
import type { Identity } from './types';

interface FaceMood extends MoodDefinition {
  moodKey: MoodKey;
}

/** Keep the existing composer whitelist derived from the same mood catalog. */
export const FACE_MOODS: Readonly<Record<string, FaceMood>> = Object.fromEntries(
  Object.entries(EMOJI_MOOD_KEYS).map(([emoji, moodKey]) => [
    emoji,
    { ...MOOD_SPRITES[moodKey], moodKey },
  ]),
);

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Last qualifying face wins; never match a face inside an unsupported ZWJ emoji. */
export function syncMood(identity: Identity, text: string): Identity {
  // Legacy identities keep the hairstyle they already display.
  const hair = identity.style === 'none' ? getPortrait(identity).style : identity.style;
  let lastFace: { emoji: string; moodKey: MoodKey } | undefined;
  for (const { segment } of segments.segment(text)) {
    const emoji = segment.replace(/[\uFE0E\uFE0F]/g, '');
    const face = FACE_MOODS[emoji];
    // A missing variant is not a qualifying face for this sender.
    if (face?.portraits[hair]) lastFace = { emoji, moodKey: face.moodKey };
  }
  if (!lastFace) return identity;

  const mood: MoodDefinition = MOOD_SPRITES[lastFace.moodKey];
  const portraitId = mood.portraits[hair];
  if (!portraitId) return identity;
  return {
    ...identity,
    portraitId,
    emoji: lastFace.emoji,
    currentMood: lastFace.moodKey,
  };
}