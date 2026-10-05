import { getPortrait } from './portraits';
import {
  EMOJI_MOOD_KEYS,
  MOOD_SPRITES,
  type MoodDefinition,
  type MoodKey,
} from './moodCatalog';
import type { Identity } from './types';
import { messageMood } from '@workspace/beam-identity';

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

/** Last qualifying face wins; never match a face inside an unsupported ZWJ emoji. */
export function syncMood(identity: Identity, text: string): Identity {
  // Legacy identities keep the hairstyle they already display.
  const hair = identity.style === 'none' ? getPortrait(identity).style : identity.style;
  const mood = messageMood(hair, text);
  return mood ? { ...identity, ...mood } : identity;
}