import type { Identity } from './types';
import { EMOJI_MOOD_KEYS, MOOD_SPRITES, type BrandedHair, type MoodDefinition } from './moodCatalog';

export const PORTRAITS = [
  { id: 'kiss', label: 'Kiss', file: 'kiss.webp', style: 'ponytails', emoji: '😘' },
  { id: 'skeptical', label: 'Skeptical', file: 'skeptical.webp', style: 'spiked', emoji: '🤨' },
  { id: 'wink', label: 'Wink', file: 'wink.webp', style: 'ponytails', emoji: '😜' },
  { id: 'laugh', label: 'Laugh', file: 'laugh.webp', style: 'ponytails', emoji: '😆' },
  { id: 'laugh-alternate', label: 'Laugh (alternate)', file: 'laugh-alternate.webp', style: 'ponytails', emoji: '😂' },
  { id: 'braided-tears', label: 'Tears of joy · braid', file: 'braided-tears.webp', style: 'ponytails', emoji: '😂' },
  { id: 'braided-laugh', label: 'Laugh · braids', file: 'braided-laugh.webp', style: 'ponytails', emoji: '😆' },
  { id: 'ponytail-soft-smile', label: 'Soft smile · ponytails', file: 'ponytail-soft-smile.webp', style: 'ponytails', emoji: '😊' },
  { id: 'ponytail-delighted', label: 'Delighted · ponytails', file: 'ponytail-delighted.webp', style: 'ponytails', emoji: '😃' },
  { id: 'ponytail-grin', label: 'Grin · ponytails', file: 'ponytail-grin.webp', style: 'ponytails', emoji: '😁' },
  { id: 'ponytail-smile', label: 'Smile · ponytails', file: 'ponytail-smile.webp', style: 'ponytails', emoji: '🙂' },
  { id: 'spiked-laugh-left', label: 'Laugh · spiked (left)', file: 'spiked-laugh-left.webp', style: 'spiked', emoji: '😆' },
  { id: 'spiked-laugh-right', label: 'Laugh · spiked (right)', file: 'spiked-laugh-right.webp', style: 'spiked', emoji: '😆' },
  { id: 'spiked-tears', label: 'Tears of joy · spiked', file: 'spiked-tears.webp', style: 'spiked', emoji: '😂' },
  { id: 'spiked-laugh', label: 'Laugh · spiked', file: 'spiked-laugh.webp', style: 'spiked', emoji: '😆' },
  { id: 'spiked-soft-smile', label: 'Soft smile · spiked', file: 'spiked-soft-smile.webp', style: 'spiked', emoji: '😊' },
  { id: 'spiked-delighted', label: 'Delighted · spiked', file: 'spiked-delighted.webp', style: 'spiked', emoji: '😃' },
  { id: 'spiked-grin', label: 'Grin · spiked', file: 'spiked-grin.webp', style: 'spiked', emoji: '😁' },
  { id: 'spiked-smile', label: 'Smile · spiked', file: 'spiked-smile.webp', style: 'spiked', emoji: '🙂' },
  { id: 'spiked-tears-of-joy', label: 'Tears of Joy · Spiky', file: 'spiked-tears-of-joy.webp', style: 'spiked', emoji: '😂' },
  { id: 'spiked-loudly-crying', label: 'Loudly Crying · Spiky', file: 'spiked-loudly-crying.webp', style: 'spiked', emoji: '😭' },
  { id: 'spiked-rofl', label: 'Rolling on the Floor Laughing · Spiky', file: 'spiked-rofl.webp', style: 'spiked', emoji: '🤣' },
  { id: 'spiked-heart-eyes', label: 'Heart-Eyes · Spiky', file: 'spiked-heart-eyes.webp', style: 'spiked', emoji: '😍' },
  { id: 'spiked-smiling-hearts', label: 'Smiling with Hearts · Spiky', file: 'spiked-smiling-hearts.webp', style: 'spiked', emoji: '🥰' },
  { id: 'spiked-smiling-eyes', label: 'Smiling Eyes · Spiky', file: 'spiked-smiling-eyes.webp', style: 'spiked', emoji: '😊' },
  { id: 'spiked-melting', label: 'Melting · Spiky', file: 'spiked-melting.webp', style: 'spiked', emoji: '🫠' },
  { id: 'spiked-blowing-kiss', label: 'Blowing a Kiss · Spiky', file: 'spiked-blowing-kiss.webp', style: 'spiked', emoji: '😘' },
  { id: 'spiked-thinking', label: 'Thinking · Spiky', file: 'spiked-thinking.webp', style: 'spiked', emoji: '🤔' },
  { id: 'spiked-winking', label: 'Winking · Spiky', file: 'spiked-winking.webp', style: 'spiked', emoji: '😉' },
  { id: 'spiked-neutral', label: 'Neutral · Spiky', file: 'spiked-neutral.webp', style: 'spiked', emoji: '😐' },
  { id: 'ponytail-tears-of-joy', label: 'Tears of Joy · Ponytail', file: 'ponytail-tears-of-joy.webp', style: 'ponytails', emoji: '😂' },
  { id: 'ponytail-rofl', label: 'Rolling on the Floor Laughing · Ponytail', file: 'ponytail-rofl.webp', style: 'ponytails', emoji: '🤣' },
  { id: 'ponytail-heart-eyes', label: 'Heart-Eyes · Ponytail', file: 'ponytail-heart-eyes.webp', style: 'ponytails', emoji: '😍' },
  { id: 'ponytail-smiling-hearts', label: 'Smiling with Hearts · Ponytail', file: 'ponytail-smiling-hearts.webp', style: 'ponytails', emoji: '🥰' },
  { id: 'ponytail-smiling-eyes', label: 'Smiling Eyes · Ponytail', file: 'ponytail-smiling-eyes.webp', style: 'ponytails', emoji: '😊' },
  { id: 'ponytail-melting', label: 'Melting · Ponytail', file: 'ponytail-melting.webp', style: 'ponytails', emoji: '🫠' },
  { id: 'ponytail-grateful', label: 'Grateful / Deeply Touched · Ponytail', file: 'ponytail-grateful.webp', style: 'ponytails', emoji: '🥹' },
  { id: 'ponytail-blowing-kiss', label: 'Blowing a Kiss · Ponytail', file: 'ponytail-blowing-kiss.webp', style: 'ponytails', emoji: '😘' },
  { id: 'ponytail-thinking', label: 'Thinking · Ponytail', file: 'ponytail-thinking.webp', style: 'ponytails', emoji: '🤔' },
  { id: 'ponytail-winking', label: 'Winking · Ponytail', file: 'ponytail-winking.webp', style: 'ponytails', emoji: '😉' },
  { id: 'ponytail-neutral', label: 'Neutral · Ponytail', file: 'ponytail-neutral.webp', style: 'ponytails', emoji: '😐' },
  { id: 'spiked-silly-wink', label: 'Silly Wink · Spiky', file: 'spiked-silly-wink.webp', style: 'spiked', emoji: '😜' },
  { id: 'ponytail-raised-eyebrow', label: 'Raised Eyebrow · Ponytail', file: 'ponytail-raised-eyebrow.webp', style: 'ponytails', emoji: '🤨' },
] as const;

export type PortraitId = typeof PORTRAITS[number]['id'];
export const isPortraitId = (id: unknown): id is PortraitId => PORTRAITS.some(p => p.id === id);

/** Old saved demo identities keep their names, sessions, and history. */
export function getPortrait(identity: Identity) {
  if (isPortraitId(identity.portraitId)) return PORTRAITS.find(p => p.id === identity.portraitId)!;
  if (identity.style === 'spiked') return PORTRAITS[1];
  // Freeze the legacy mapping: adding pictures must not change existing faces.
  const alternatives = PORTRAITS.slice(0, 5).filter(p => p.style === 'ponytails');
  const hash = Array.from(identity.emoji).reduce((sum, c) => sum + (c.codePointAt(0) ?? 0), 0);
  return alternatives[hash % alternatives.length];
}

export function portraitIdentity(portraitId: PortraitId): Identity {
  const portrait = PORTRAITS.find(p => p.id === portraitId)!;
  return {
    portraitId,
    currentMood: EMOJI_MOOD_KEYS[portrait.emoji],
    emoji: portrait.emoji,
    style: portrait.style,
    hairColor: '#111111',
  };
}

export const AVATAR_CHOICES = [
  { style: 'spiked', label: 'Male / Spiky hair', portraitId: 'spiked-neutral' },
  { style: 'ponytails', label: 'Female / Ponytail', portraitId: 'ponytail-neutral' },
] as const;

/** Selecting the same type preserves its picture; switching keeps a supported mood. */
export function selectAvatarType(identity: Identity, style: BrandedHair): Identity {
  if (identity.style === style) return identity;
  const moodKey = identity.currentMood
    ?? EMOJI_MOOD_KEYS[getPortrait(identity).emoji]
    ?? 'neutral';
  const mood: MoodDefinition = MOOD_SPRITES[moodKey];
  const portraitId = mood.portraits[style] ?? MOOD_SPRITES.neutral.portraits[style];
  return { ...identity, ...portraitIdentity(portraitId), hairColor: identity.hairColor };
}