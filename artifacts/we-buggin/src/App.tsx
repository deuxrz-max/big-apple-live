import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Wordmark } from '@/components/brand';
import { BottomNavigation } from '@/components/bottom-navigation';
import NotFound from '@/pages/not-found';
import { clearAllCreds } from '@/lib/room-creds';
import { AdultGate, ChatDirectory, ChatProfile, ProfileGate, PublicChatLanding, TextChatRoom } from '@/chat/ChatApp';
import { EmailSignUp } from '@/components/email-signup';
import '@/chat/chat.css';
import { OwnProfile } from '@/profile/OwnProfile';
import '@/profile/profile.css';
import SocialApp from '@/social/SocialApp';
import { SignInArtwork } from '@/components/sign-in-artwork';
import '@/theme.css';
import '@/white-theme.css';

const DevAudioHarnessPage = import.meta.env.DEV
  ? lazy(() => import('@/dev/AudioHarnessPage'))
  : null;

const queryClient = new QueryClient();

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}


const INK = '#211e27';
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/streamtalk-shield-512.png`,
  },
  variables: {
    colorPrimary: '#9D1DFF',
    colorForeground: INK,
    colorMutedForeground: '#6e6976',
    colorDanger: '#c83255',
    colorBackground: '#ffffff',
    colorInput: '#ffffff',
    colorInputForeground: INK,
    colorNeutral: INK,
    fontFamily: "'Montserrat', system-ui, sans-serif",
    borderRadius: '12px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white w-[440px] max-w-full overflow-hidden border border-[#e5e1eb] shadow-sm',
    card: '!shadow-none !border-0 !bg-transparent !rounded-[16px]',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-[16px]',
    headerTitle: '!font-sans !font-extrabold !text-[#287b32]',
    headerSubtitle: { color: '#6e6976' },
    socialButtonsBlockButtonText: { color: INK, fontWeight: 700 },
    formFieldLabel: { color: INK, fontWeight: 700 },
    footerActionLink: { fontWeight: 800, color: '#FF268F', textDecoration: 'none' },
    footerActionText: { color: 'hsl(60 3% 62%)' },
    dividerText: { color: 'hsl(60 3% 62%)' },
    identityPreviewEditButton: { color: INK },
    formFieldSuccessText: { color: '#287b32' },
    alertText: { color: '#b42344' },
    logoBox: 'h-14 justify-center',
    logoImage: 'h-14 w-14',
    socialButtonsBlockButton: 'border border-[#ded9e5] bg-white rounded-[12px]',
    formButtonPrimary: {
      color: '#ffffff',
      background: 'linear-gradient(120deg,#9D1DFF,#5E00FF)',
      border: '0',
      borderRadius: '12px',
      fontWeight: 700,
    },
    formFieldInput: 'border border-[#ded9e5] bg-white rounded-[12px]',
    footerAction: '',
    dividerLine: 'bg-[#9D1DFF]/30',
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
  const isLightScreen = !isBeamRoomScreen && !isModerationScreen;
  useLayoutEffect(() => {
    document.body.classList.toggle('streamtalk-beam-screen', isBeamRoomScreen);
    document.body.classList.toggle('streamtalk-light-screen', isLightScreen);
    return () => {
      document.body.classList.remove('streamtalk-beam-screen', 'streamtalk-light-screen');
    };
  }, [isBeamRoomScreen, isLightScreen]);
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
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your Streamtalk account' } },
        signUp: { start: { title: 'Get your name', subtitle: 'One account, one dedicated username' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <div className={`app-page ${isBeamRoomScreen ? 'is-beam-screen' : isModerationScreen ? 'is-moderation-screen' : 'is-light-screen'}`}><RoutedErrorBoundary>
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
            <Route path="/community" component={CommunityRoute} />
            <Route path="/community/*?" component={CommunityRoute} />
            <Route path="/user-portal" component={OwnProfileRoute} />
            <Route path="/user-portal/edit" component={Portal} />
            <Route path="/rooms/:roomId" component={RoomRoute} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary></div>
        <BottomNavigation />
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
    const shareImage = new URL(`${basePath}/streamtalk-shield-512.png`, window.location.origin).href;
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
