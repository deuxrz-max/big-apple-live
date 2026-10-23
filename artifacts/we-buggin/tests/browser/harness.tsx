import { useEffect, useRef, useState } from 'react';
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
import { ShinyName } from '../../src/components/ShinyName';
import { BeamTv, type BeamTvHandle } from '../../src/chat/BeamTv';
import { RoomPerimeter } from '../../src/chat/RoomPerimeter';
import { OwnProfile } from '../../src/profile/OwnProfile';
import { ProfilePhotoReviewPage } from '../../src/chat/ChatApp';
import type { UniversityVideoBeamTvState } from '@workspace/api-client-react';
import '../../src/social/social.css';
import '../../src/index.css';
import '../../src/chat/chat.css';
import '../../src/theme.css';
import '../../src/white-theme.css';
import '../../src/dark-app-theme.css';
import '../../src/depth-ui.css';
import '../../src/components/bottom-navigation.css';
import '../../src/chat/room-black-gold.css';

declare const __PROMO_REGRESSION__: boolean;
if (typeof __PROMO_REGRESSION__ === 'undefined' || !__PROMO_REGRESSION__)
  throw new Error('This harness may only run on the isolated promo regression server');

const roomThemeFixture = !new URLSearchParams(location.search).get('view')
  || new URLSearchParams(location.search).get('view') === 'room-playback';
document.body.classList.toggle('streamtalk-beam-screen', roomThemeFixture);

function PlayerFixture() {
  const [unavailable, setUnavailable] = useState(false);
  return <>
    <PromoBackground soundOn={false} onUnavailableChange={setUnavailable} />
    <output data-testid="fixture-unavailable">{String(unavailable)}</output>
  </>;
}

function GiftingLevelsFixture() {
  const levels = [0, 1, 10, 11, 30, 31, 60, 61, 90, 91, 100];
  return <section style={{ background: '#14100A', color: '#F6E6C0', padding: 20 }}>
    {levels.map(level => (
      <p key={level} data-testid={`gifting-level-${level}`}>
        <ShinyName displayNameColor="#FFFFFF" displayNameTierIndex={level}>VAMPSQUAD</ShinyName>
      </p>
    ))}
    <p data-testid="gifting-preserves-username">
      <ShinyName displayNameColor="#C0C0C0" displayNameTierIndex={40}>SilverUsername</ShinyName>
    </p>
  </section>;
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

const playbackSearch = async () => ({ videoIds: [] }) as never;
const playbackFailure = async () => {};
function RoomPlaybackFixture() {
  const player = useRef<BeamTvHandle>(null);
  const [startedAt] = useState(() => Date.now() - 60_000);
  const [serverNow, setServerNow] = useState(Date.now());
  const [present, setPresent] = useState(true);
  const [mic, setMic] = useState(false);
  const [chat, setChat] = useState(0);
  const [combos, setCombos] = useState<Array<{ id: number; quantity: number }>>([]);
  useEffect(() => {
    const timer = setInterval(() => setServerNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, []);
  const tv: UniversityVideoBeamTvState = {
    enabled: true, currentVideoId: 'fixtureVid1', playlistId: null,
    startedAtMs: startedAt, breakEndsAtMs: null, serverNowMs: serverNow,
    defaultSearch: 'Music', sourceType: 'search', sourceValue: 'Music',
    skipVotingEnabled: false, queue: ['fixtureVid1', 'fixtureVid2'],
    videoMetadata: [], searchAvailable: true, micLockedDuringVideo: false,
    skipVoteCount: 0, skipVoteTotal: 0, hasVotedToSkip: false, skipSequence: 0,
    seriesTitle: null, seriesDate: null, seriesEpisodeNumber: null,
  };
  return <section className="ch ur">
    <RoomPerimeter />
    {present && <BeamTv ref={player} roomName="Playback fixture" tv={tv} microphoneEnabled={mic}
      search={playbackSearch} reportPlaybackFailure={playbackFailure} />}
    <div style={{ position: 'relative', zIndex: 2 }}>
      <button onClick={() => setPresent(value => !value)}>{present ? 'Leave fixture room' : 'Join fixture room'}</button>
      <button onClick={() => { player.current?.setMicrophoneAudioMode(!mic); setMic(!mic); }}>Toggle fixture mic</button>
      <button onClick={() => setChat(value => value + 1)}>Add fixture chat</button>
      <button onClick={() => setCombos(value => [...value, { id: Date.now(), quantity: 10 }])}>Queue fixture gift x10</button>
      <button onClick={() => setCombos(value => [...value, { id: Date.now(), quantity: 1 }])}>Queue fixture gift x1</button>
      <p data-testid="playback-fixture-chat"><ShinyName displayNameColor="#FFFFFF" displayNameTierIndex={3}>Fixture</ShinyName>: message {chat}</p>
    </div>
    {combos[0] && <GiftComboPlayer key={combos[0].id} gift={{
      id: `playback-gift-${combos[0].id}`, giftId: 'studio-11111111-1111-4111-8111-111111111111',
      giftName: 'Playback fixture gift', senderName: 'Fixture', quantity: combos[0].quantity,
    }} waitingCount={combos.length - 1} onFinish={() => setCombos(value => value.slice(1))} />}
  </section>;
}

// No Clerk, auth overrides or replaced hooks/components. Original room mounts
// against response-only fixtures on a private, loopback-only test server.
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('view') === 'player' ? <PlayerFixture /> :
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <main className={`app-page${roomThemeFixture ? ' is-beam-screen' : ''}`}>
        {new URLSearchParams(location.search).get('view') === 'credits'
          ? <BuyCreditsPage />
          : new URLSearchParams(location.search).get('view') === 'store' ? <StorePage />
          : new URLSearchParams(location.search).get('view') === 'gift-catalog' ? <GiftCatalogFixture />
          : new URLSearchParams(location.search).get('view') === 'gift-artwork' ? <GiftArtworkFixture />
          : new URLSearchParams(location.search).get('view') === 'gifting-levels' ? <GiftingLevelsFixture />
          : new URLSearchParams(location.search).get('view') === 'profile-cleanup' ? <OwnProfile />
          : new URLSearchParams(location.search).get('view') === 'photo-review' ? <ProfilePhotoReviewPage />
          : new URLSearchParams(location.search).get('view') === 'room-playback' ? <RoomPlaybackFixture />
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
