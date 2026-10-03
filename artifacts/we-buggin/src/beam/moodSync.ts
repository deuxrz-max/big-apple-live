import { getPortrait, type PortraitId } from './portraits';
import type { Identity } from './types';

type BrandedHair = 'spiked' | 'ponytails';
interface FaceMood {
  emotion: string;
  portraits: Partial<Record<BrandedHair, PortraitId>>;
}

/** Exact whitelist: only supplied expressions with a matching hair variant. */
export const FACE_MOODS: Readonly<Record<string, FaceMood>> = {
  '😆': { emotion: 'laughing', portraits: { spiked: 'spiked-laugh', ponytails: 'laugh' } },
  '😂': { emotion: 'tears of joy', portraits: { spiked: 'spiked-tears-of-joy', ponytails: 'laugh-alternate' } },
  '😭': { emotion: 'loudly crying', portraits: { spiked: 'spiked-loudly-crying' } },
  '🤣': { emotion: 'rolling on the floor laughing', portraits: { spiked: 'spiked-rofl' } },
  '😍': { emotion: 'heart-eyes', portraits: { spiked: 'spiked-heart-eyes' } },
  '🥰': { emotion: 'smiling with hearts', portraits: { spiked: 'spiked-smiling-hearts' } },
  '🫠': { emotion: 'melting', portraits: { spiked: 'spiked-melting' } },
  '🤔': { emotion: 'thinking', portraits: { spiked: 'spiked-thinking' } },
  '😉': { emotion: 'winking', portraits: { spiked: 'spiked-winking' } },
  '😐': { emotion: 'neutral', portraits: { spiked: 'spiked-neutral' } },
  '😊': { emotion: 'smiling eyes', portraits: { spiked: 'spiked-smiling-eyes', ponytails: 'ponytail-soft-smile' } },
  '😃': { emotion: 'delighted', portraits: { spiked: 'spiked-delighted', ponytails: 'ponytail-delighted' } },
  '😁': { emotion: 'grinning', portraits: { spiked: 'spiked-grin', ponytails: 'ponytail-grin' } },
  '🙂': { emotion: 'smiling', portraits: { spiked: 'spiked-smile', ponytails: 'ponytail-smile' } },
  '😘': { emotion: 'kissing', portraits: { spiked: 'spiked-blowing-kiss', ponytails: 'kiss' } },
  '😜': { emotion: 'playful wink', portraits: { ponytails: 'wink' } },
  '🤨': { emotion: 'skeptical', portraits: { spiked: 'skeptical' } },
};

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Last qualifying face wins; never match a face inside an unsupported ZWJ emoji. */
export function syncMood(identity: Identity, text: string): Identity {
  // Legacy identities keep the hairstyle they already display.
  const hair = identity.style === 'none' ? getPortrait(identity).style : identity.style;
  let next = identity;
  for (const { segment } of segments.segment(text)) {
    const emoji = segment.replace(/[\uFE0E\uFE0F]/g, '');
    const portraitId = FACE_MOODS[emoji]?.portraits[hair];
    if (portraitId) next = { ...identity, portraitId, emoji };
  }
  return next;
}