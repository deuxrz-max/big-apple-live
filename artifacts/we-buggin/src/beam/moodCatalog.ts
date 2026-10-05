import type { PortraitId } from './portraits';

export type BrandedHair = 'spiked' | 'ponytails';

export interface MoodDefinition {
  emotion: string;
  /** Missing artwork stays unsupported; never substitute the other hairstyle. */
  portraits: Partial<Record<BrandedHair, PortraitId>>;
}

/** Normalized keys retain distinct expressions, especially 😉 versus 😜. */
export const MOOD_SPRITES = {
  laughing: { emotion: 'laughing', portraits: { spiked: 'spiked-laugh', ponytails: 'laugh' } },
  tears_of_joy: { emotion: 'tears of joy', portraits: { spiked: 'spiked-tears-of-joy', ponytails: 'ponytail-tears-of-joy' } },
  crying: { emotion: 'loudly crying', portraits: { spiked: 'spiked-loudly-crying' } },
  rofl: { emotion: 'rolling on the floor laughing', portraits: { spiked: 'spiked-rofl', ponytails: 'ponytail-rofl' } },
  heart_eyes: { emotion: 'heart-eyes', portraits: { spiked: 'spiked-heart-eyes', ponytails: 'ponytail-heart-eyes' } },
  affectionate: { emotion: 'smiling with hearts', portraits: { spiked: 'spiked-smiling-hearts', ponytails: 'ponytail-smiling-hearts' } },
  melting: { emotion: 'melting', portraits: { spiked: 'spiked-melting', ponytails: 'ponytail-melting' } },
  grateful: { emotion: 'grateful / deeply touched', portraits: { ponytails: 'ponytail-grateful' } },
  thinking: { emotion: 'thinking', portraits: { spiked: 'spiked-thinking', ponytails: 'ponytail-thinking' } },
  winking: { emotion: 'winking', portraits: { spiked: 'spiked-winking', ponytails: 'ponytail-winking' } },
  neutral: { emotion: 'neutral', portraits: { spiked: 'spiked-neutral', ponytails: 'ponytail-neutral' } },
  smiling_eyes: { emotion: 'smiling eyes', portraits: { spiked: 'spiked-smiling-eyes', ponytails: 'ponytail-smiling-eyes' } },
  delighted: { emotion: 'delighted', portraits: { spiked: 'spiked-delighted', ponytails: 'ponytail-delighted' } },
  grinning: { emotion: 'grinning', portraits: { spiked: 'spiked-grin', ponytails: 'ponytail-grin' } },
  smiling: { emotion: 'smiling', portraits: { spiked: 'spiked-smile', ponytails: 'ponytail-smile' } },
  kissing: { emotion: 'kissing', portraits: { spiked: 'spiked-blowing-kiss', ponytails: 'ponytail-blowing-kiss' } },
  playful_wink: { emotion: 'playful wink', portraits: { spiked: 'spiked-silly-wink', ponytails: 'wink' } },
  skeptical: { emotion: 'skeptical', portraits: { spiked: 'skeptical', ponytails: 'ponytail-raised-eyebrow' } },
} as const satisfies Record<string, MoodDefinition>;

export type MoodKey = keyof typeof MOOD_SPRITES;

/** Only these supplied facial expressions can change the active mood. */
export const EMOJI_MOOD_KEYS: Readonly<Record<string, MoodKey>> = {
  '😆': 'laughing',
  '😂': 'tears_of_joy',
  '😭': 'crying',
  '🤣': 'rofl',
  '😍': 'heart_eyes',
  '🥰': 'affectionate',
  '🫠': 'melting',
  '🥹': 'grateful',
  '🤔': 'thinking',
  '😉': 'winking',
  '😐': 'neutral',
  '😊': 'smiling_eyes',
  '😃': 'delighted',
  '😁': 'grinning',
  '🙂': 'smiling',
  '😘': 'kissing',
  '😜': 'playful_wink',
  '🤨': 'skeptical',
};

export function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(MOOD_SPRITES, value);
}