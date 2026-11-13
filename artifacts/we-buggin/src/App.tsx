import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { getGetSocialMeQueryKey, useGetSocialMe } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { APP_NAME, Wordmark } from '@/components/brand';
import { BottomNavigation } from '@/components/bottom-navigation';
import { PinkCardAnnouncement } from '@/chat/PinkCardAnnouncement';
import NotFound from '@/pages/not-found';
import { clearAllCreds } from '@/lib/room-creds';
import { AdultGate, ChatDirectory, ChatProfile, ProfileGate, ProfilePhotoReviewPage, PublicChatLanding, TextChatRoom } from '@/chat/ChatApp';
import { EmailSignUp } from '@/components/email-signup';
import '@/chat/chat.css';
import { OwnProfile } from '@/profile/OwnProfile';
import { QuickProfileProvider } from '@/profile/QuickProfile';
import '@/profile/profile.css';
import { StorePage } from '@/store/StorePage';
import { giftingTier } from '@workspace/beam-identity';
import { ShinyName } from '@/components/ShinyName';
import SocialApp from '@/social/SocialApp';
import { TransactionHistoryPage } from '@/social/MoneyPages';
import { SignInArtwork } from '@/components/sign-in-artwork';
import '@/theme.css';
import '@/white-theme.css';
import '@/dark-app-theme.css';
import '@/depth-ui.css';
import '@/chat/room-black-gold.css';
import '@/mobile-shell.css';
import '@/app-shapes.css';

const DevAudioHarnessPage = import.meta.env.DEV
  ? lazy(() => import('@/dev/AudioHarnessPage'))
  : null;
const BattlePrototypePage = lazy(() => import('@/battle/BattlePrototype').then((module) => ({ default: module.BattlePrototype })));

const queryClient = new QueryClient();

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}


const INK = '#f2f2ee';
const GOLD = '#d4b15f';
const MUTED = '#b9b2a2';
const LINE = '#3a3426';
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/brand/big-apple-live-approved.jpg`,
  },
  variables: {
    colorPrimary: GOLD,
    colorPrimaryForeground: '#0b0b0b',
    colorForeground: INK,
    colorMutedForeground: MUTED,
    colorDanger: '#d9534f',
    colorBackground: '#0b0b0b',
    colorInput: '#141414',
    colorInputForeground: INK,
    colorNeutral: INK,
    colorRing: GOLD,
    fontFamily: "'Nunito Sans', system-ui, sans-serif",
    borderRadius: '4px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'depth-auth-card dw-auth-card bg-[#0b0b0b] w-[440px] max-w-full overflow-hidden border border-[#3a3426] !rounded-[6px] shadow-sm',
    card: '!shadow-none !border-0 !bg-transparent !rounded-[6px]',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-[6px]',
    headerTitle: '!font-sans !font-extrabold !text-[#f2f2ee]',
    headerSubtitle: { color: MUTED },
    socialButtonsBlockButtonText: { color: INK, fontWeight: 700 },
    formFieldLabel: { color: INK, fontWeight: 700 },
    footerActionLink: { fontWeight: 800, color: GOLD, textDecoration: 'none' },
    footerActionText: { color: MUTED },
    dividerText: { color: MUTED },
    identityPreviewEditButton: { color: GOLD },
    formFieldSuccessText: { color: '#7fbf7f' },
    alertText: { color: '#f0a7a3' },
    logoBox: 'h-10 justify-center',
    logoImage: 'h-10 w-10 !rounded-[4px]',
    socialButtonsBlockButton: `border border-[${LINE}] bg-[#141414] !rounded-[4px]`,
    formButtonPrimary: {
      color: '#0b0b0b',
      background: `linear-gradient(180deg,#e6c878,${GOLD} 55%,#a8843a)`,
      border: '1px solid #8a6d2f',
      borderRadius: '4px',
      fontWeight: 800,
      boxShadow: 'none',
    },
    formFieldInput: 'border border-[#3a3426] bg-[#141414] !rounded-[4px]',
    footerAction: '',
    dividerLine: 'bg-[#d4b15f]/30',
    alert: 'border border-[#d9534f] !rounded-[4px] bg-[#1a0f0f]',
    otpCodeFieldInput: 'border border-[#3a3426] bg-[#141414] !rounded-[4px] text-[#f2f2ee]',
    formFieldRow: '',
    main: '',
  },
};

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="ch ch-auth">
      <Wordmark />
      {children}
    </div>
  );
}

function SignInPage() {
  return (
    <SignInArtwork>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </SignInArtwork>
  );
}

function SignUpPage() {
  const [path] = useLocation();
  const [mode, setMode] = useState<'social' | 'email'>('email');
  const sub = path !== '/sign-up';
  const showEmail = !sub && mode === 'email';
  return (
    <AuthShell>
      {!sub && (
        <div role="tablist" aria-label="Sign up method" className="flex gap-2">
          <button type="button" role="tab" aria-selected={mode === 'social'} className={`bm-btn ${mode === 'social' ? 'bm-btn-primary' : ''}`} onClick={() => setMode('social')}>Social or other</button>
          <button type="button" role="tab" aria-selected={mode === 'email'} className={`bm-btn ${mode === 'email' ? 'bm-btn-primary' : ''}`} onClick={() => setMode('email')} data-testid="tab-email-signup">Email and password</button>
        </div>
      )}
      {!sub && mode === 'email' ? <EmailSignUp onContinue={() => setMode('social')} /> :
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}
    </AuthShell>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
        clearAllCreds();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function NameColorLevelUpToast() {
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = user?.id ?? null;
  const me = useGetSocialMe({
    query: {
      queryKey: getGetSocialMeQueryKey(),
      enabled: isLoaded && Boolean(isSignedIn),
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
    },
  });
  const lastTier = useRef<{ userId: string; tierIndex: number } | null>(null);
  const [toast, setToast] = useState<{
    displayName: string;
    color: string;
    tierIndex: number;
    tierName: string;
  } | null>(null);

  useEffect(() => {
    if (!userId || !me.data) {
      lastTier.current = null;
      return;
    }
    const tierIndex = me.data.nameColorProgress.tierIndex;
    if (lastTier.current?.userId === userId && tierIndex > lastTier.current.tierIndex) {
      setToast({
        displayName: me.data.profile.displayName || me.data.profile.username,
        color: me.data.profile.displayNameColor ?? "#FFFFFF",
        tierIndex,
        tierName: me.data.nameColorProgress.tierName,
      });
    }
    lastTier.current = { userId, tierIndex };
  }, [userId, me.data]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className={`st-name-tier-toast gifting-levelup-toast gifting-levelup-toast--${giftingTier(toast.tierIndex).key}`} role="status" aria-live="polite"
      data-testid="toast-gifting-level-up" onClick={() => setToast(null)}>
      <span>
        <small>Gifting level up</small>
        <strong>{giftingTier(toast.tierIndex).name} · Level {toast.tierIndex}</strong>
        <ShinyName displayNameColor={toast.color} displayNameTierIndex={toast.tierIndex}>
          {toast.displayName}
        </ShinyName>
      </span>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/home" /></Show>
      <Show when="signed-out"><PublicChatLanding /></Show>
    </>
  );
}

function Portal() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <AdultGate><ChatProfile key={user.id} /></AdultGate>}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function OwnProfileRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><OwnProfile key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function TransactionHistoryRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><TransactionHistoryPage key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in?redirect_url=%2Fuser-portal%2Ftransactions" /></Show>
    </>
  );
}

function ProfilePhotoReviewsRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><ProfilePhotoReviewPage key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in?redirect_url=%2Fuser-portal%2Fphoto-reviews" /></Show>
    </>
  );
}

function StoreRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><StorePage key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in?redirect_url=%2Fuser-portal" /></Show>
    </>
  );
}

function DiscoveryRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><ChatDirectory key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function CommunityRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><SocialApp key={user.id} userId={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function RoomRoute() {
  const { user } = useUser();
  const { roomId = '' } = useParams<{ roomId: string }>();
  return (
    <>
      <Show when="signed-in">
        {user && <ProfileGate><TextChatRoom key={`${user.id}:${roomId}`} roomId={roomId} userId={user.id} /></ProfileGate>}
      </Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [location, setLocation] = useLocation();
  const currentPath = stripBase(location);
  const isBeamRoomScreen = /^\/rooms\/[^/]+\/?$/.test(currentPath);
  const isModerationScreen = currentPath === '/community/moderation';
  const isDirectoryScreen = currentPath === '/home';
  const isBattleScreen = currentPath === '/battle';
  useLayoutEffect(() => {
    // New screens start at their header, not at the previous screen's scroll.
    // This never touches the independently scrolling chat or media elements.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [currentPath]);
  // Retained as a route-layout flag only; all app routes now share the dark theme.
  const isLightScreen = false;
  useLayoutEffect(() => {
    document.body.classList.toggle('streamtalk-beam-screen', isBeamRoomScreen);
    document.body.classList.toggle('streamtalk-light-screen', isLightScreen);
    document.body.classList.toggle('streamtalk-directory-screen', isDirectoryScreen);
    document.body.classList.toggle('streamtalk-battle-screen', isBattleScreen);
    return () => {
      document.body.classList.remove('streamtalk-beam-screen', 'streamtalk-light-screen', 'streamtalk-directory-screen', 'streamtalk-battle-screen');
    };
  }, [isBeamRoomScreen, isLightScreen, isDirectoryScreen, isBattleScreen]);
  const clerkPubKey = publishableKeyFromHost(
    window.location.hostname,
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  );
  if (!clerkPubKey) throw new Error('Account rooms require a configured Clerk publishable key.');
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/home`}
      signUpFallbackRedirectUrl={`${basePath}/home`}
      signUpForceRedirectUrl={`${basePath}/home`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: `Sign in to your ${APP_NAME} account` } },
        signUp: { start: { title: 'Get your name', subtitle: 'One account, one dedicated username' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <QuickProfileProvider>
        <div className={`app-page ${isLightScreen ? 'is-light-screen' : ''} ${isBeamRoomScreen ? 'is-beam-screen' : ''} ${isModerationScreen ? 'is-moderation-screen' : ''} ${isDirectoryScreen ? 'is-directory-screen' : ''} ${isBattleScreen ? 'is-battle-screen' : ''}`}><RoutedErrorBoundary>
          <Switch>
            {DevAudioHarnessPage && (
              <Route path="/__dev/audio-harness">
                <Suspense fallback={<div className="app-page">Loading preview audio test lab…</div>}>
                  <DevAudioHarnessPage />
                </Suspense>
              </Route>
            )}
            <Route path="/" component={HomeRedirect} />
            <Route path="/battle">
              <Suspense fallback={<div className="battle-loading" role="status">Loading battle prototype…</div>}>
                <BattlePrototypePage />
              </Suspense>
            </Route>
            <Route path="/beams">{() => <Redirect to="/home" />}</Route>
            <Route path="/beams/*?">{() => <Redirect to="/home" />}</Route>
            <Route path="/legacy" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/home" component={DiscoveryRoute} />
            <Route path="/community" component={CommunityRoute} />
            <Route path="/community/*?" component={CommunityRoute} />
            <Route path="/user-portal/transactions" component={TransactionHistoryRoute} />
            <Route path="/user-portal/photo-reviews" component={ProfilePhotoReviewsRoute} />
            <Route path="/user-portal/store" component={StoreRoute} />
            <Route path="/user-portal" component={OwnProfileRoute} />
            <Route path="/user-portal/edit" component={Portal} />
            <Route path="/rooms/:roomId" component={RoomRoute} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary></div>
        <BottomNavigation />
        <PinkCardAnnouncement path={currentPath} />
        <NameColorLevelUpToast />
        </QuickProfileProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function AppRoutes() {
  // Keep Clerk mounted on every route, including root auth handshakes.
  return <ClerkProviderWithRoutes />;
}

function App() {
  useEffect(() => {
    const shareImage = new URL(`${basePath}/brand/big-apple-live-approved.jpg`, window.location.origin).href;
    document.querySelector('meta[property="og:image"]')?.setAttribute('content', shareImage);
    document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', shareImage);
  }, []);
  return (
    <WouterRouter base={basePath}>
      <RoutedErrorBoundary><AppRoutes /></RoutedErrorBoundary>
    </WouterRouter>
  );
}

export default App;
