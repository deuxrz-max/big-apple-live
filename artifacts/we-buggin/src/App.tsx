import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { getGetSceneModelsQueryKey, useGetSceneModels, getGetSocialMeQueryKey, useGetSocialMe } from '@workspace/api-client-react';
import { ErrorBoundary, type ErrorFallbackProps } from '@/components/error-boundary';
import { APP_NAME, Wordmark } from '@/components/brand';
import { BottomNavigation } from '@/components/bottom-navigation';
import NotFound from '@/pages/not-found';
import { clearAllCreds } from '@/lib/room-creds';
import { AdultGate, ChatDirectory, ChatProfile, LiveProfileGate, ProfileGate, PublicChatLanding, TextChatRoom } from '@/chat/ChatApp';
import { LiveStreamsDirectory, StartLiveStreamPage, WatchLiveStreamPage } from '@/chat/LiveStreamPages';
import { endHostLiveSessionForRouteChange, leaveViewerLiveSession } from '@/chat/liveSessionController';
import { EmailSignUp } from '@/components/email-signup';
import '@/chat/chat.css';
import { OwnProfile } from '@/profile/OwnProfile';
import '@/profile/profile.css';
import { StorePage } from '@/store/StorePage';
import { ShinyName } from '@/components/ShinyName';
import SocialApp from '@/social/SocialApp';
import { SignInArtwork } from '@/components/sign-in-artwork';
import { reportSceneModelLoad } from '@/scene/modelLoadStatus';
import '@/theme.css';
import '@/white-theme.css';
import '@/dark-app-theme.css';
import '@/depth-ui.css';

const DevAudioHarnessPage = import.meta.env.DEV
  ? lazy(() => import('@/dev/AudioHarnessPage'))
  : null;

const queryClient = new QueryClient();

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const SceneBackdrop = lazy(() => import('@/scene/SceneBackdrop'));

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}


const INK = '#f7f4ff';
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/brand/deux-wild-icon-512.png`,
  },
  variables: {
    colorPrimary: '#9D1DFF',
    colorForeground: INK,
    colorMutedForeground: '#c2bbd7',
    colorDanger: '#c83255',
    colorBackground: '#151126',
    colorInput: '#100d21',
    colorInputForeground: INK,
    colorNeutral: INK,
    fontFamily: "'Nunito Sans', system-ui, sans-serif",
    borderRadius: '12px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'depth-auth-card bg-[#151126] w-[440px] max-w-full overflow-hidden border border-[#483765] shadow-sm',
    card: '!shadow-none !border-0 !bg-transparent !rounded-[16px]',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-[16px]',
    headerTitle: '!font-sans !font-extrabold !text-[#f7f4ff]',
    headerSubtitle: { color: '#c2bbd7' },
    socialButtonsBlockButtonText: { color: INK, fontWeight: 700 },
    formFieldLabel: { color: INK, fontWeight: 700 },
    footerActionLink: { fontWeight: 800, color: '#cf2876', textDecoration: 'none' },
    footerActionText: { color: '#c2bbd7' },
    dividerText: { color: '#c2bbd7' },
    identityPreviewEditButton: { color: INK },
    formFieldSuccessText: { color: '#267244' },
    alertText: { color: '#b42344' },
    logoBox: 'h-14 justify-center',
    logoImage: 'h-14 w-14',
    socialButtonsBlockButton: 'border border-[#483765] bg-[#1b1532] rounded-[12px]',
    formButtonPrimary: {
      color: '#ffffff',
      background: 'linear-gradient(110deg,#a522ed,#e63c9a)',
      border: '0',
      borderRadius: '12px',
      fontWeight: 700,
    },
    formFieldInput: 'border border-[#483765] bg-[#100d21] rounded-[12px]',
    footerAction: '',
    dividerLine: 'bg-[#a522ed]/30',
    alert: 'border-2 border-[#d84b63] rounded-[12px]',
    otpCodeFieldInput: 'border border-[#ded9e5] bg-white rounded-[12px]',
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
    <div className="st-name-tier-toast" role="status" aria-live="polite">
      <span>Your name just leveled up to {toast.tierName}!</span>
      <ShinyName displayNameColor={toast.color} displayNameTierIndex={toast.tierIndex}>
        {toast.displayName}
      </ShinyName>
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

function LiveStreamsRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <ProfileGate><LiveStreamsDirectory key={user.id} /></ProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function StartLiveStreamRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <LiveProfileGate><StartLiveStreamPage key={user.id} /></LiveProfileGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function WatchLiveStreamRoute() {
  const { user } = useUser();
  const { streamId = '' } = useParams<{ streamId: string }>();
  return (
    <>
      <Show when="signed-in">{user && <LiveProfileGate><WatchLiveStreamPage key={`${user.id}:${streamId}`} streamId={streamId} /></LiveProfileGate>}</Show>
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
  const isLiveScreen = stripBase(location) === '/live/start' || /^\/live\/[^/]+\/?$/.test(stripBase(location));
  return <ErrorBoundary resetKey={location}
    FallbackComponent={isLiveScreen ? LiveRouteErrorFallback : undefined}>{children}</ErrorBoundary>;
}

function SceneErrorFallback() {
  // The 3D canvas is decorative; WebGL failures must never take down the app UI.
  return null;
}

function canCreateWebGLContext() {
  try {
    const canvas = document.createElement("canvas");
    const attributes: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: false,
    };
    const context = canvas.getContext("webgl2", attributes)
      ?? canvas.getContext("webgl", attributes)
      ?? canvas.getContext("experimental-webgl", attributes);
    if (!context) return false;
    const loseContext = (context as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    loseContext?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function SharedSceneBackdrop() {
  const { isSignedIn } = useUser();
  const [idleReady, setIdleReady] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  const sceneModels = useGetSceneModels({
    query: {
      queryKey: getGetSceneModelsQueryKey(),
      enabled: Boolean(isSignedIn),
      retry: false,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    },
  });
  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const startWhenIdle = () => {
      setWebglAvailable(canCreateWebGLContext());
      setIdleReady(true);
    };
    const timeout = window.setTimeout(startWhenIdle, 1000);
    const idle = idleWindow.requestIdleCallback?.(startWhenIdle, { timeout: 1800 });
    return () => {
      window.clearTimeout(timeout);
      if (idle !== undefined) idleWindow.cancelIdleCallback?.(idle);
    };
  }, []);
  const models = isSignedIn
    ? (sceneModels.data?.models ?? []).map((model) => ({
      id: model.id,
      url: model.fileUrl,
      position: model.position as [number, number, number],
      rotation: model.rotation as [number, number, number],
      scale: model.scale,
    }))
    : [];
  if (!idleReady || webglAvailable !== true) return null;
  return (
    <ErrorBoundary FallbackComponent={SceneErrorFallback}>
      <Suspense fallback={null}>
        <SceneBackdrop models={models} onModelLoad={reportSceneModelLoad} />
      </Suspense>
    </ErrorBoundary>
  );
}

function LiveRouteErrorFallback({ resetError }: ErrorFallbackProps) {
  return (
    <main className="st-live-page st-live-host-page" style={{
      display: 'grid', placeItems: 'center', width: '100%', height: '100dvh', minHeight: '100dvh',
      margin: 0, padding: 24, border: 0, borderRadius: 0, background: '#000', color: '#fff',
    }}>
      <section style={{ display: 'grid', justifyItems: 'center', gap: 12, maxWidth: 320, textAlign: 'center' }}>
        <strong>Live could not load.</strong>
        <span>Try opening the live screen again.</span>
        <button type="button" className="st-live-start-button" onClick={resetError}>Try again</button>
        <Link className="st-live-start-button" href="/home">Back to Deux Wild</Link>
      </section>
    </main>
  );
}

function ClerkProviderWithRoutes() {
  const [location, setLocation] = useLocation();
  const currentPath = stripBase(location);
  const previousLiveRoute = useRef<string | null>(null);
  useEffect(() => {
    const viewerMatch = currentPath.match(/^\/live\/([^/]+)\/?$/);
    const nextLiveRoute = currentPath === "/live/start"
      ? "host"
      : viewerMatch ? `viewer:${decodeURIComponent(viewerMatch[1])}` : null;
    const previous = previousLiveRoute.current;
    if (previous && previous !== nextLiveRoute) {
      if (previous === "host") endHostLiveSessionForRouteChange();
      else if (previous.startsWith("viewer:")) leaveViewerLiveSession(previous.slice("viewer:".length));
    }
    previousLiveRoute.current = nextLiveRoute;
  }, [currentPath]);
  const isBeamRoomScreen = /^\/rooms\/[^/]+\/?$/.test(currentPath);
  const isLiveScreen = currentPath === '/live/start' || /^\/live\/[^/]+\/?$/.test(currentPath);
  const isModerationScreen = currentPath === '/community/moderation';
  const isDirectoryScreen = currentPath === '/home';
  const isGiftStudioScreen = currentPath === '/community/gift-studio';
  // Retained as a route-layout flag only; all app routes now share the dark theme.
  const isLightScreen = false;
  useLayoutEffect(() => {
    document.body.classList.toggle('streamtalk-beam-screen', isBeamRoomScreen);
    document.body.classList.toggle('streamtalk-light-screen', isLightScreen);
    document.body.classList.toggle('streamtalk-directory-screen', isDirectoryScreen);
    document.body.classList.toggle('streamtalk-live-screen', isLiveScreen);
    document.body.classList.toggle('streamtalk-gift-studio-screen', isGiftStudioScreen);
    return () => {
      document.body.classList.remove('streamtalk-beam-screen', 'streamtalk-light-screen', 'streamtalk-directory-screen', 'streamtalk-live-screen', 'streamtalk-gift-studio-screen');
    };
  }, [isBeamRoomScreen, isLightScreen, isDirectoryScreen, isLiveScreen, isGiftStudioScreen]);
  const clerkPubKey = publishableKeyFromHost(
    window.location.hostname,
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  );
  if (!clerkPubKey) throw new Error('Account universities require a configured Clerk publishable key.');
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
        <SharedSceneBackdrop />
        <ClerkQueryClientCacheInvalidator />
        <div className={`app-page ${isLightScreen ? 'is-light-screen' : ''} ${isLiveScreen ? 'is-live-screen' : ''} ${isBeamRoomScreen ? 'is-beam-screen' : ''} ${isModerationScreen ? 'is-moderation-screen' : ''} ${isDirectoryScreen ? 'is-directory-screen' : ''} ${isGiftStudioScreen ? 'is-gift-studio-screen' : ''}`}><RoutedErrorBoundary>
          <Switch>
            {DevAudioHarnessPage && (
              <Route path="/__dev/audio-harness">
                <Suspense fallback={<div className="app-page">Loading preview audio test lab…</div>}>
                  <DevAudioHarnessPage />
                </Suspense>
              </Route>
            )}
            <Route path="/" component={HomeRedirect} />
            <Route path="/beams">{() => <Redirect to="/home" />}</Route>
            <Route path="/beams/*?">{() => <Redirect to="/home" />}</Route>
            <Route path="/legacy" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/home" component={DiscoveryRoute} />
            <Route path="/live/start" component={StartLiveStreamRoute} />
            <Route path="/live" component={LiveStreamsRoute} />
            <Route path="/live/:streamId" component={WatchLiveStreamRoute} />
            <Route path="/community" component={CommunityRoute} />
            <Route path="/community/*?" component={CommunityRoute} />
            <Route path="/user-portal/store" component={StoreRoute} />
            <Route path="/user-portal" component={OwnProfileRoute} />
            <Route path="/user-portal/edit" component={Portal} />
            <Route path="/rooms/:roomId" component={RoomRoute} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary></div>
        <BottomNavigation />
        <NameColorLevelUpToast />
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
    const shareImage = new URL(`${basePath}/brand/deux-wild-icon-512.png`, window.location.origin).href;
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
