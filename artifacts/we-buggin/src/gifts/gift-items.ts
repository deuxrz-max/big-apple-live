import type { SocialMe } from '@workspace/api-client-react';

export type OwnedGift = { id: string; name: string };

/** Saved inventory IDs that are gift catalog IDs, never badge products. Deduped, no quantities. */
export function ownedGiftItems(data: Pick<SocialMe, 'inventory' | 'gifts' | 'products'>): OwnedGift[] {
  const productIds = new Set(data.products.map((p) => p.id));
  const catalog = new Map(data.gifts.map((g) => [g.id, g.name] as const));
  const seen = new Set<string>();
  const out: OwnedGift[] = [];
  for (const id of data.inventory) {
    if (seen.has(id) || productIds.has(id) || !catalog.has(id)) continue;
    seen.add(id);
    out.push({ id, name: catalog.get(id) as string });
  }
  return out;
}
