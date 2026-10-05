/** Supplied artwork only. Keep older IDs selectable and never substitute hair. */
export const PORTRAIT_IDS = [
  'kiss', 'skeptical', 'wink', 'laugh', 'laugh-alternate', 'braided-tears',
  'braided-laugh', 'ponytail-soft-smile', 'ponytail-delighted', 'ponytail-grin',
  'ponytail-smile', 'spiked-laugh-left', 'spiked-laugh-right', 'spiked-tears',
  'spiked-laugh', 'spiked-soft-smile', 'spiked-delighted', 'spiked-grin',
  'spiked-smile', 'spiked-tears-of-joy', 'spiked-loudly-crying', 'spiked-rofl',
  'spiked-heart-eyes', 'spiked-smiling-hearts', 'spiked-smiling-eyes',
  'spiked-melting', 'spiked-blowing-kiss', 'spiked-thinking', 'spiked-winking',
  'spiked-neutral', 'ponytail-tears-of-joy', 'ponytail-rofl', 'ponytail-heart-eyes',
  'ponytail-smiling-hearts', 'ponytail-smiling-eyes', 'ponytail-melting',
  'ponytail-grateful', 'ponytail-blowing-kiss', 'ponytail-thinking',
  'ponytail-winking', 'ponytail-neutral', 'spiked-silly-wink', 'ponytail-raised-eyebrow',
] as const;
export type PortraitId = typeof PORTRAIT_IDS[number];
export type BrandedHair = 'spiked' | 'ponytails';
export function isPortraitId(value: unknown): value is PortraitId {
  return typeof value === 'string' && (PORTRAIT_IDS as readonly string[]).includes(value);
}
export function portraitHair(id: PortraitId): BrandedHair {
  return id.startsWith('spiked-') || id === 'skeptical' ? 'spiked' : 'ponytails';
}
export interface MoodDefinition {
  emotion: string;
  portraits: Partial<Record<BrandedHair, PortraitId>>;
}
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
export const EMOJI_MOOD_KEYS: Readonly<Record<string, MoodKey>> = {
  '😆': 'laughing', '😂': 'tears_of_joy', '😭': 'crying', '🤣': 'rofl',
  '😍': 'heart_eyes', '🥰': 'affectionate', '🫠': 'melting', '🥹': 'grateful',
  '🤔': 'thinking', '😉': 'winking', '😐': 'neutral', '😊': 'smiling_eyes',
  '😃': 'delighted', '😁': 'grinning', '🙂': 'smiling', '😘': 'kissing',
  '😜': 'playful_wink', '🤨': 'skeptical',
};
export function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOOD_SPRITES, value);
}
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function messageMood(hair: BrandedHair, text: string) {
  let selected: { emoji: string; currentMood: MoodKey; portraitId: PortraitId } | undefined;
  for (const { segment } of segments.segment(text)) {
    const emoji = segment.replace(/[\uFE0E\uFE0F]/g, '');
    const currentMood = EMOJI_MOOD_KEYS[emoji];
    if (!currentMood) continue;
    const mood: MoodDefinition = MOOD_SPRITES[currentMood];
    const portraitId = mood.portraits[hair];
    if (portraitId) selected = { emoji, currentMood, portraitId };
  }
  return selected;
}