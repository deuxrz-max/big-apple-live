import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromoBackground } from '../../src/chat/PromoBackground';
import { TextChatRoom } from '../../src/chat/UniversityRoom';
import { BuyCreditsPage } from '../../src/social/BuyCreditsPage';
import { StorePage } from '../../src/store/StorePage';
import { GiftBag, GiftControl, OPEN_ROOM_GIFTS_EVENT } from '../../src/gifts';
import { GiftComboPlayer } from '../../src/gifts/GiftComboPlayer';
import { GiftArtwork } from '../../src/gifts/GiftArtwork';
import { RewardsPage } from '../../src/social/MoneyPages';
import '../../src/social/social.css';
import '../../src/index.css';
import '../../src/chat/chat.css';
import '../../src/theme.css';
import '../../src/components/bottom-navigation.css';

declare const __PROMO_REGRESSION__: boolean;
if (typeof __PROMO_REGRESSION__ === 'undefined' || !__PROMO_REGRESSION__)
  throw new Error('This harness may only run on the isolated promo regression server');

function PlayerFixture() {
  const [unavailable, setUnavailable] = useState(false);
  return <>
    <PromoBackground soundOn={false} onUnavailableChange={setUnavailable} />
    <output data-testid="fixture-unavailable">{String(unavailable)}</output>
  </>;
}

function GiftFixture() {
  const [open, setOpen] = useState(false);
  return <><GiftControl onClick={() => setOpen(true)} />
    {open && <GiftBag recipient={{ username: 'test-recipient', displayName: 'Test Recipient' }} onClose={() => setOpen(false)} />}</>;
}

function GiftCatalogFixture() {
  return <GiftBag
    recipient={{ username: 'fixture-recipient', displayName: 'Fixture Recipient' }}
    recipients={[{ username: 'fixture-recipient', displayName: 'Fixture Recipient' }]}
    roomId="gift-artwork-test-room"
    sessionId="gift-artwork-test-session"
    onClose={() => undefined}
  />;
}

function GiftArtworkFixture() {
  const gifts = [
    { id: 'good-vibes', name: 'Good vibes', iconUrl: null },
    { id: 'studio-no-icon-fixture', name: 'Studio sample', iconUrl: null },
    { id: 'heart', name: 'Heart', iconUrl: `${import.meta.env.BASE_URL}gift-icons/heart.svg` },
  ];
  return <div style={{ display: 'flex', gap: 12 }}>
    {gifts.map(gift => <div key={gift.id} data-testid={`artwork-${gift.id}`}><GiftArtwork gift={gift} size={64} /></div>)}
  </div>;
}

function GiftAnimationFixture() {
  const params = new URLSearchParams(location.search);
  return <GiftComboPlayer gift={{
    id: 'custom-gift-animation-fixture',
    giftId: params.get('giftId') ?? 'studio-11111111-1111-4111-8111-111111111111',
    giftName: params.get('giftName') ?? 'Custom car animation',
    senderName: 'Fixture',
    quantity: Number(params.get('quantity') ?? 99),
  }} waitingCount={0} onFinish={() => undefined} />;
}

// No Clerk, auth overrides or replaced hooks/components. Original room mounts
// against response-only fixtures on a private, loopback-only test server.
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('view') === 'player' ? <PlayerFixture /> :
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <main className="app-page">
        {new URLSearchParams(location.search).get('view') === 'credits'
          ? <BuyCreditsPage />
          : new URLSearchParams(location.search).get('view') === 'store' ? <StorePage />
          : new URLSearchParams(location.search).get('view') === 'gift-catalog' ? <GiftCatalogFixture />
          : new URLSearchParams(location.search).get('view') === 'gift-artwork' ? <GiftArtworkFixture />
          : new URLSearchParams(location.search).get('view') === 'gifts' ? <GiftFixture />
          : new URLSearchParams(location.search).get('view') === 'gift-animation' ? <GiftAnimationFixture />
          : new URLSearchParams(location.search).get('view') === 'badges' ? <RewardsPage />
          : <TextChatRoom roomId="promo-regression-room" userId="synthetic-browser-user" />}
      </main>
      {/* Layout-only nav shell uses the original app's navigation stylesheet. */}
      <nav className="app-bottom-nav" aria-label="Fixture bottom navigation">
        <div className="app-bottom-nav-inner">
          {['Home', 'Follow', 'Message', 'Me'].map(label =>
            <span key={label} className="app-bottom-link">{label}</span>)}
          {new URLSearchParams(location.search).get('view') !== 'gifts' && (
            <GiftControl onClick={() => window.dispatchEvent(new Event(OPEN_ROOM_GIFTS_EVENT))} label="Open room gifts" />
          )}
        </div>
      </nav>
    </QueryClientProvider>,
);
