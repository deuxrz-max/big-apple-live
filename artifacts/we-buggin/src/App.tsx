import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import SocialApp from '@/social/SocialApp';

const queryClient = new QueryClient();

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}


const INK = 'hsl(60 10% 95%)';
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/streamtalk-logo.webp`,
  },
  variables: {
    colorPrimary: 'hsl(60 10% 95%)',
    colorForeground: INK,
    colorMutedForeground: 'hsl(60 3% 62%)',
    colorDanger: 'hsl(0 85% 66%)',
    colorBackground: 'hsl(0 0% 4%)',
    colorInput: 'hsl(0 0% 8%)',
    colorInputForeground: INK,
    colorNeutral: INK,
    fontFamily: "'Barlow', system-ui, sans-serif",
    borderRadius: '0rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(0_0%_4%)] w-[440px] max-w-full overflow-hidden border-2 border-[hsl(60_10%_95%)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, textTransform: 'uppercase', color: INK },
    headerSubtitle: { color: 'hsl(60 3% 62%)' },
    socialButtonsBlockButtonText: { color: INK, fontWeight: 700 },
    formFieldLabel: { color: INK, fontWeight: 700 },
    footerActionLink: { color: INK, fontWeight: 800, textDecoration: 'underline' },
    footerActionText: { color: 'hsl(60 3% 62%)' },
    dividerText: { color: 'hsl(60 3% 62%)' },
    identityPreviewEditButton: { color: INK },
    formFieldSuccessText: { color: 'hsl(140 60% 60%)' },
    alertText: { color: 'hsl(0 85% 72%)' },
    logoBox: 'h-14 justify-center',
    logoImage: 'h-14 w-14',
    socialButtonsBlockButton: 'border-2 border-[hsl(60_10%_95%)] bg-transparent rounded-none',
    formButtonPrimary: 'border-2 border-[hsl(60_10%_95%)] bg-[hsl(60_10%_95%)] text-[hsl(0_0%_4%)] rounded-none font-extrabold uppercase',
    formFieldInput: 'border-2 border-[hsl(60_10%_95%)] rounded-none',
    footerAction: '',
    dividerLine: 'bg-[hsl(60_10%_95%)]/30',
    alert: 'border-2 border-[hsl(0_85%_66%)] rounded-none',
    otpCodeFieldInput: 'border-2 border-[hsl(60_10%_95%)] rounded-none',
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
    <AuthShell>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthShell>
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
  const [, setLocation] = useLocation();
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
        <div className="app-page"><RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/beams">{() => <Redirect to="/home" />}</Route>
            <Route path="/beams/*?">{() => <Redirect to="/home" />}</Route>
            <Route path="/legacy" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/home" component={DiscoveryRoute} />
            <Route path="/community" component={CommunityRoute} />
            <Route path="/community/*?" component={CommunityRoute} />
            <Route path="/user-portal" component={Portal} />
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
  return (
    <WouterRouter base={basePath}>
      <RoutedErrorBoundary><AppRoutes /></RoutedErrorBoundary>
    </WouterRouter>
  );
}

export default App;
