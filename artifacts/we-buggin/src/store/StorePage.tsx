import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Coins, Gift, ShoppingBag } from "lucide-react";
import { getGetSocialMeQueryKey, useGetSocialMe, usePurchaseSocialProduct } from "@workspace/api-client-react";
import { GiftBag } from "@/gifts";
import { GiftArtwork } from "@/gifts/GiftArtwork";
import { buyCoinsReturnState } from "@/social/buy-coins-navigation";
import { ErrorBox, Loading, Msg, errMsg } from "@/social/common";
import "./store-page.css";

function requestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function StorePage() {
  const queryClient = useQueryClient();
  const me = useGetSocialMe({ query: {
    queryKey: getGetSocialMeQueryKey(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 15_000,
  } });
  const purchase = usePurchaseSocialProduct();
  const [bagOpen, setBagOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const gifts = me.data?.gifts ?? [];

  const buy = (giftId: string, name: string) => {
    setMessage(null);
    purchase.mutate({ data: {
      itemId: giftId,
      idempotencyKey: requestId(),
      testMode: me.data?.wallet.unlimited === true,
    } }, {
      onSuccess: () => {
        setMessage({ ok: true, text: `${name} added to My Bag. Unsent purchased gifts expire after seven days.` });
        void queryClient.invalidateQueries({ queryKey: getGetSocialMeQueryKey() });
      },
      onError: error => setMessage({ ok: false, text: errMsg(error) }),
    });
  };

  return <main className="st-store" data-testid="page-store">
    <div className="st-store-shell">
      <header className="st-header">
        <Link href="/user-portal" className="st-header-back" aria-label="Back to profile"><ArrowLeft size={20} /></Link>
        <h1>Gift Store <small className="dw-store-balance-inline">
          {me.data?.wallet.unlimited ? "Unlimited test coins" : `${(me.data?.wallet.balance ?? 0).toLocaleString()} coins`}
        </small></h1>
        <button type="button" className="st-header-items" onClick={() => setBagOpen(true)} data-testid="button-my-items">
          <ShoppingBag size={16} /><span>My Bag</span>
        </button>
      </header>
      <section className="st-promo" aria-label="Gift collection">
        <span className="st-promo-label"><Gift size={13} /> GIFTS</span>
        <h2>Choose a gift for your next room.</h2>
        <p>Buying adds it to My Bag. Sending still happens in a room.</p>
      </section>
      {message && <div className="st-message" data-testid="status-store-message"><Msg ok={message.ok}>{message.text}</Msg></div>}
      {me.isLoading && !me.data && <div className="st-loading-card"><Loading /></div>}
      {me.isError && !me.data && <div className="st-error-card"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>}
      {me.data && <section className="st-category-section st-category-gifts" data-testid="section-store-gifts">
        <header className="st-category-heading">
          <div className="st-category-title"><span className="st-category-title-pill"><Gift size={15} />Gifts<small>{gifts.length}</small></span>
            <span className="st-overline">Collectibles for My Bag</span></div>
        </header>
        <p className="st-category-note"><ShoppingBag size={16} /> Unsent purchased gifts expire seven days after purchase. The remaining time is shown in My Bag.</p>
        {gifts.length ? <div className="st-item-grid" data-testid="grid-store-gifts">
          {gifts.map(gift => <article className="st-item-card" key={gift.id} data-testid={`card-store-gift-${gift.id}`}>
            <span className="st-card-art-wrap"><span className="st-art st-art-gift card"><GiftArtwork gift={gift} size={56} /></span>
              {(me.data?.giftQuantities?.[gift.id] ?? 0) > 0 && <span className="st-card-owned">IN BAG {me.data?.giftQuantities?.[gift.id] ?? 0}</span>}
            </span>
            <span className="st-card-copy"><strong>{gift.name}</strong>
              <span><Coins size={13} /> {gift.cost.toLocaleString()} coins</span>
            </span>
            <button type="button" className="st-card-buy" onClick={() => buy(gift.id, gift.name)}
              disabled={purchase.isPending} aria-label={`Add ${gift.name} to My Bag`}>
              {purchase.isPending ? "Adding…" : "Add to My Bag"}
            </button>
          </article>)}
        </div> : <div className="st-empty-state"><span><ShoppingBag size={24} /></span><strong>No gifts available</strong><p>The gift collection is temporarily unavailable.</p></div>}
        <Link href="/community/coins" state={buyCoinsReturnState()} className="bm-btn">Get more coins</Link>
      </section>}
      {bagOpen && <GiftBag onClose={() => setBagOpen(false)} />}
    </div>
  </main>;
}
