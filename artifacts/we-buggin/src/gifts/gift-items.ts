import type { SocialMe } from '@workspace/api-client-react';

export type OwnedGift = { id: string; name: string; quantity?: number };

/** Gift bag acquisitions can outlive a catalog rename or change; keep every held gift visible. */
export function ownedGiftItems(
  data: Pick<SocialMe, 'inventory' | 'gifts' | 'products' | 'giftQuantities' | 'giftBagLots'>,
  now = Date.now(),
): OwnedGift[] {
  const productIds = new Set(data.products.map((p) => p.id));
  const catalog = new Map(data.gifts.map((g) => [g.id, g.name] as const));
  const lots = (data.giftBagLots ?? []).filter(lot => !lot.expiresAt || Date.parse(lot.expiresAt) > now);
  const ids = new Set([...data.inventory, ...lots.map(lot => lot.giftId)]);
  const out: OwnedGift[] = [];
  for (const id of ids) {
    if (productIds.has(id)) continue;
    const quantity = data.giftBagLots !== undefined
      ? lots.filter(lot => lot.giftId === id).reduce((sum, lot) => sum + lot.quantity, 0)
      : data.giftQuantities?.[id] ?? 0;
    if (quantity <= 0) continue;
    out.push({ id, name: catalog.get(id) ?? id, quantity });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
