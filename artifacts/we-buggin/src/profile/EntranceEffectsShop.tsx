import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetEntranceEffectShopQueryKey,
  getGetSocialMeQueryKey,
  useEquipEntranceEffect,
  useGetEntranceEffectShop,
  useGetSocialMe,
  usePurchaseEntranceEffect,
  useUpdateMyEntranceEffectSettings,
  type EntranceEffectShopItem,
} from '@workspace/api-client-react';
import { CoinAmount, ErrorBox, Loading, Msg, errMsg } from '@/social/common';
import { GiftIcon } from '@/social/common';
import { giftStudioMediaUrl } from '@/gifts/GiftAnimationPlayer';
import './entrance-effects-shop.css';

export function EntranceEffectsShop() {
  const queryClient = useQueryClient();
  const shop = useGetEntranceEffectShop({ query: {
    queryKey: getGetEntranceEffectShopQueryKey(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  } });
  const me = useGetSocialMe({ query: {
    queryKey: getGetSocialMeQueryKey(),
    refetchInterval: 15000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  } });
  const purchase = usePurchaseEntranceEffect();
  const equip = useEquipEntranceEffect();
  const updateSettings = useUpdateMyEntranceEffectSettings();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetEntranceEffectShopQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
  ]);
  const buy = (item: EntranceEffectShopItem) => {
    setNotice(null);
    let requestId: string;
    try {
      requestId = createRequestId();
    } catch {
      setNotice({ ok: false, text: 'This browser could not create a secure purchase request. Please try again in Chrome.' });
      return;
    }
    purchase.mutate({ effectId: item.id, data: { requestId } }, {
      onSuccess: async () => {
        setNotice({ ok: true, text: `Added ${item.name} to your effects.` });
        await refresh();
      },
      onError: (error) => setNotice({ ok: false, text: errMsg(error) }),
    });
  };
  const equipItem = (effectId: string | null) => {
    setNotice(null);
    equip.mutate({ data: { effectId } }, {
      onSuccess: async () => {
        setNotice({ ok: true, text: effectId ? 'Entrance effect equipped.' : 'Entrance effect unequipped.' });
        await refresh();
      },
      onError: (error) => setNotice({ ok: false, text: errMsg(error) }),
    });
  };

  const settings = me.data?.entranceEffects;
  const canToggleEffects = Boolean(settings?.eligible || settings?.ownerTest);
  const toggleEffects = (enabled: boolean) => {
    setNotice(null);
    updateSettings.mutate({ data: { enabled } }, {
      onSuccess: async () => {
        setNotice({ ok: true, text: `Entrance effects ${enabled ? 'enabled' : 'turned off'}.` });
        await refresh();
      },
      onError: (error) => setNotice({ ok: false, text: errMsg(error) }),
    });
  };

  const items = shop.data?.items ?? [];
  const visibleItems = items.filter((item) => item.availableForPurchase || item.owned);
  const busy = purchase.isPending || equip.isPending;
  const useAnimatedImage = typeof navigator !== 'undefined' && (
    /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent))
  );

  return (
    <section className="ees-panel" aria-labelledby="ees-title">
      <div className="ees-heading">
        <div>
          <p className="ees-kicker">Arrive with a little presence</p>
          <h2 id="ees-title">Entrance effects</h2>
          <p className="ees-lede">Choose an effect to play when you enter a room.</p>
        </div>
      </div>

      {settings && (
        <label className="ees-preference">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!canToggleEffects || updateSettings.isPending}
            onChange={(event) => toggleEffects(event.target.checked)}
            data-testid="toggle-profile-entrance-effects"
          />
          <span><strong>Play my entrance effect</strong><small>{canToggleEffects ? 'Turn this off to keep your equipped effect silent.' : 'An eligible entrance effect is needed before playback can be enabled.'}</small></span>
        </label>
      )}
      {notice && <Msg ok={notice.ok}>{notice.text}</Msg>}
      {shop.isLoading && <div className="ees-loading"><Loading /></div>}
      {shop.isError && <ErrorBox error={shop.error} retry={() => void shop.refetch()} />}
      {shop.data && (visibleItems.length === 0
        ? <div className="ees-empty"><strong>No entrance effects yet</strong><p>New effects will appear here when they are available.</p></div>
        : <div className="ees-list" data-testid="list-entrance-effects">
          {visibleItems.map((item) => (
            <article className={`ees-item${item.equipped ? ' is-equipped' : ''}`} key={item.id} data-testid={`card-entrance-effect-${item.id}`}>
              <div className="ees-media">
                {item.media
                  ? useAnimatedImage
                    ? <img src={giftStudioMediaUrl(item.media.safariUrl)} alt="" aria-label={`${item.name} entrance effect preview`} />
                    : <video src={giftStudioMediaUrl(item.media.webmUrl)} muted playsInline loop autoPlay preload="metadata" aria-label={`${item.name} entrance effect preview`} />
                  : <span className="ees-static-preview" aria-label={`${item.name} gift animation`}><GiftIcon id={item.id} size={46} /></span>}
              </div>
              <div className="ees-item-copy">
                <div className="ees-name-line"><h3>{item.name}</h3>{item.equipped && <span className="ees-equipped">Equipped</span>}</div>
                <p><CoinAmount>{item.cost.toLocaleString()} coins</CoinAmount>{item.owned ? ' · Owned' : ''}</p>
              </div>
              <div className="ees-actions">
                {!item.owned && item.availableForPurchase
                  ? <button type="button" className="ees-button ees-buy" disabled={busy} onClick={() => buy(item)} data-testid={`button-buy-entrance-effect-${item.id}`}>{purchase.isPending ? 'Buying…' : <>Buy · <CoinAmount>{item.cost.toLocaleString()} coins</CoinAmount></>}</button>
                  : item.owned
                    ? <button type="button" className="ees-button" disabled={busy} onClick={() => equipItem(item.equipped ? null : item.id)} data-testid={`button-equip-entrance-effect-${item.id}`}>{equip.isPending ? 'Saving…' : item.equipped ? 'Unequip' : 'Equip'}</button>
                    : <span className="ees-unavailable">Not available</span>}
              </div>
            </article>
          ))}
        </div>)}
    </section>
  );
}

function createRequestId() {
  if (typeof crypto === 'undefined') throw new Error('Secure randomness is unavailable.');
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
