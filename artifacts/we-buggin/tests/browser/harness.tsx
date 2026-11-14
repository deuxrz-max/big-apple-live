import { useEffect, useRef, useState } from 'react';
import { RoomChannelsFixture } from './room-channels-fixture';
import { createRoot } from 'react-dom/client';
import { ChessRoom } from '../../src/chess/ChessRoom';
import { QuickProfileProvider } from '../../src/profile/QuickProfile';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromoBackground } from '../../src/chat/PromoBackground';
import { TextChatRoom } from '../../src/chat/UniversityRoom';
import { ShinyName } from '../../src/components/ShinyName';
import { RoomFeedFixture } from './room-feed-fixture';
import { LiveLayoutFixture } from './live-layout-fixture';
import { ProfileNavigationFixture } from './profile-navigation-fixture';
import { AccessErrorFixture } from './access-error-fixture';
import { AuditFixesFixture } from './audit-fixes-fixture';
import '../../src/chat/live-stream.css';
import { BeamTv, type BeamTvHandle } from '../../src/chat/BeamTv';
import { RoomPerimeter } from '../../src/chat/RoomPerimeter';
import { OwnProfile } from '../../src/profile/OwnProfile';
import { ChatProfile, ProfilePhotoReviewPage, HomeSections, DirectoryRoomCard, PublicChatLanding } from '../../src/chat/ChatApp';
import { MyProfilePage } from '../../src/social/PeoplePages';
import { StorePage } from '../../src/profile/StorePage';
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
import '../../src/mobile-shell.css';
import '../../src/app-shapes.css';
import '../../src/joker-finish.css';

declare const __PROMO_REGRESSION__: boolean;
if (typeof __PROMO_REGRESSION__ === 'undefined' || !__PROMO_REGRESSION__)
  throw new Error('This harness may only run on the isolated promo regression server');

const roomThemeFixture = !new URLSearchParams(location.search).get('view')
  || new URLSearchParams(location.search).get('view') === 'room-feed'
  || new URLSearchParams(location.search).get('view') === 'room-playback';
document.body.classList.toggle('streamtalk-beam-screen', roomThemeFixture);

function PlayerFixture() {
  const [unavailable, setUnavailable] = useState(false);
  return <>
    <PromoBackground soundOn={false} onUnavailableChange={setUnavailable} />
    <output data-testid="fixture-unavailable">{String(unavailable)}</output>
  </>;
}

function HomePolishFixture() {
  return <div className="st-directory st-home">
    <HomeSections />
    <section id="live-channels">
      <DirectoryRoomCard room={{ roomId: 'empty', label: 'Empty room', headcount: 0, nowPlayingVideoId: 'fixture' }} topic="Music" isFeatured={false} />
      <DirectoryRoomCard room={{ roomId: 'occupied', label: 'Occupied room', headcount: 2 }} topic="Music" isFeatured={true} />
    </section>
    <section id="st-dir-creators-title">Creators</section>
  </div>;
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
      <p data-testid="playback-fixture-chat"><ShinyName displayNameColor="#FFFFFF" displayNameTierIndex={3}>Fixture</ShinyName>: message {chat}</p>
    </div>
  </section>;
}

// No Clerk, auth overrides or replaced hooks/components. Original room mounts
// against response-only fixtures on a private, loopback-only test server.
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('view') === 'player' ? <PlayerFixture /> :
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <main className={`app-page${roomThemeFixture ? ' is-beam-screen' : ''}`}>
        {new URLSearchParams(location.search).get('view') === 'store' ? <StorePage />
          : new URLSearchParams(location.search).get('view') === 'public-channels' ? <PublicChatLanding />
          : new URLSearchParams(location.search).get('view') === 'room-channels' ? <RoomChannelsFixture />
          : new URLSearchParams(location.search).get('view') === 'room-feed' ? <RoomFeedFixture />
          : new URLSearchParams(location.search).get('view') === 'live-layout' ? <LiveLayoutFixture />
          : new URLSearchParams(location.search).get('view') === 'profile-navigation' ? <ProfileNavigationFixture />
          : new URLSearchParams(location.search).get('view') === 'access-error' ? <AccessErrorFixture />
          : new URLSearchParams(location.search).get('view') === 'audit-fixes' ? <AuditFixesFixture />
          : new URLSearchParams(location.search).get('view') === 'edit-profile' ? <ChatProfile />
          : new URLSearchParams(location.search).get('view') === 'home-polish' ? <HomePolishFixture />
          : new URLSearchParams(location.search).get('view') === 'chess-polish' ? <QuickProfileProvider><ChessRoom roomId="polish" accountKey="fixture" onExit={() => undefined} /></QuickProfileProvider>
          : new URLSearchParams(location.search).get('view') === 'edit-social-profile' ? <MyProfilePage />
          : new URLSearchParams(location.search).get('view') === 'photo-review' ? <ProfilePhotoReviewPage />
          : new URLSearchParams(location.search).get('view') === 'room-playback' ? <RoomPlaybackFixture />
          : <TextChatRoom roomId="promo-regression-room" userId="synthetic-browser-user" />}
      </main>
      {/* Layout-only nav shell uses the original app's navigation stylesheet. */}
      {new URLSearchParams(location.search).get('view') !== 'chess-polish' && <nav className="app-bottom-nav" aria-label="Fixture bottom navigation">
        <div className="app-bottom-nav-inner">
          {['Home', 'Follow', 'Message', 'Me'].map(label =>
            <span key={label} className="app-bottom-link">{label}</span>)}
        </div>
      </nav>}
    </QueryClientProvider>,
);
