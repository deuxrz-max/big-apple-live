import { and, eq } from 'drizzle-orm';
import { db, socialProfileCosmetics, socialSettings } from '@workspace/db';
import { RoomError } from '../room-store';

export type CosmeticKind = 'frame' | 'nameColor' | 'specialName';

export const PROFILE_COSMETICS = {
  frames: [
    { id: 'grey-starter', name: 'Grey Starter', priceCents: 0, available: true, image: 'battle-assets/cards/card_frame_grey_starter.png', tint: 'none' },
    { id: 'bronze', name: 'Bronze', priceCents: 250, available: false, image: 'battle-assets/cards/card_frame_bronze.png', tint: '#be7844' },
    { id: 'red', name: 'Red', priceCents: 350, available: false, image: 'battle-assets/cards/card_frame_red.png', tint: '#e95252' },
    { id: 'blue', name: 'Blue', priceCents: 350, available: false, image: 'battle-assets/cards/card_frame_blue.png', tint: '#4a8edf' },
    { id: 'green', name: 'Green', priceCents: 350, available: false, image: 'battle-assets/cards/card_frame_green.png', tint: '#3aa878' },
    { id: 'gold', name: 'Gold', priceCents: 500, available: false, image: 'battle-assets/cards/card_frame_gold.png', tint: '#d6ad4f' },
  ],
  nameColors: [
    { id: 'white', name: 'White', color: '#f5f4ef', priceCents: 0, available: true },
    { id: 'gold', name: 'Gold', color: '#edca70', priceCents: 100, available: false },
    { id: 'pink', name: 'Pink', color: '#ff6ad5', priceCents: 100, available: false },
    { id: 'blue', name: 'Blue', color: '#67aefb', priceCents: 100, available: false },
    { id: 'green', name: 'Green', color: '#61d69a', priceCents: 100, available: false },
    { id: 'red', name: 'Red', color: '#ff7373', priceCents: 100, available: false },
  ],
  specialNames: [
    { id: 'shimmer', name: 'Shimmer', priceCents: 250, available: false },
  ],
} as const;

const DEFAULT_OWNED = new Set(['frame:grey-starter', 'nameColor:white']);
const itemSets: Record<CosmeticKind, readonly { id: string }[]> = {
  frame: PROFILE_COSMETICS.frames,
  nameColor: PROFILE_COSMETICS.nameColors,
  specialName: PROFILE_COSMETICS.specialNames,
};
const settingColumn = {
  frame: socialSettings.equippedFrameId,
  nameColor: socialSettings.equippedNameColorId,
  specialName: socialSettings.equippedSpecialNameId,
} as const;

export async function getProfileCosmeticStyle(accountId: string) {
  await db.insert(socialSettings).values({ accountId }).onConflictDoNothing();
  const [settings] = await db.select({
    frameId: socialSettings.equippedFrameId,
    nameColorId: socialSettings.equippedNameColorId,
    specialNameId: socialSettings.equippedSpecialNameId,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId));
  const color = PROFILE_COSMETICS.nameColors.find(item => item.id === settings?.nameColorId)?.color ?? '#f5f4ef';
  return {
    frameId: settings?.frameId ?? 'grey-starter',
    nameColorId: settings?.nameColorId ?? 'white',
    specialNameId: settings?.specialNameId ?? null,
    displayNameColor: color,
    displayNameTierIndex: settings?.specialNameId === 'shimmer' ? 1 : 0,
  };
}

export async function getProfileCosmeticStore(accountId: string) {
  await db.insert(socialSettings).values({ accountId }).onConflictDoNothing();
  const [settings] = await db.select({
    frameId: socialSettings.equippedFrameId,
    nameColorId: socialSettings.equippedNameColorId,
    specialNameId: socialSettings.equippedSpecialNameId,
  }).from(socialSettings).where(eq(socialSettings.accountId, accountId));
  const ownedRows = await db.select({ cosmeticId: socialProfileCosmetics.cosmeticId })
    .from(socialProfileCosmetics).where(eq(socialProfileCosmetics.accountId, accountId));
  const owned = new Set([...DEFAULT_OWNED, ...ownedRows.map(row => row.cosmeticId)]);
  const equipped = {
    frame: settings?.frameId ?? 'grey-starter',
    nameColor: settings?.nameColorId ?? 'white',
    specialName: settings?.specialNameId ?? null,
  };
  return {
    sections: [
      { kind: 'frame' as const, title: 'Frames', items: PROFILE_COSMETICS.frames.map(item => ({
        ...item, owned: owned.has(`frame:${item.id}`), equipped: equipped.frame === item.id,
      })) },
      { kind: 'nameColor' as const, title: 'Name Colors', items: PROFILE_COSMETICS.nameColors.map(item => ({
        ...item, owned: owned.has(`nameColor:${item.id}`), equipped: equipped.nameColor === item.id,
      })) },
      { kind: 'specialName' as const, title: 'Special Names', items: PROFILE_COSMETICS.specialNames.map(item => ({
        ...item, owned: owned.has(`specialName:${item.id}`), equipped: equipped.specialName === item.id,
      })) },
    ],
    equipped,
  };
}

export async function equipProfileCosmetic(accountId: string, kind: CosmeticKind, itemId: string) {
  await db.insert(socialSettings).values({ accountId }).onConflictDoNothing();
  const items = itemSets[kind];
  if (!items || !items.some(item => item.id === itemId)) throw new RoomError(400, 'Choose a valid profile item.');
  const owned = DEFAULT_OWNED.has(`${kind}:${itemId}`) || (await db.select({ cosmeticId: socialProfileCosmetics.cosmeticId })
    .from(socialProfileCosmetics).where(and(
      eq(socialProfileCosmetics.accountId, accountId),
      eq(socialProfileCosmetics.cosmeticId, `${kind}:${itemId}`),
    )).limit(1)).length > 0;
  if (!owned) throw new RoomError(403, 'That item is not owned yet.');
  const column = settingColumn[kind];
  await db.update(socialSettings).set({ [column.name]: itemId, updatedAt: new Date() })
    .where(eq(socialSettings.accountId, accountId));
  return getProfileCosmeticStore(accountId);
}
