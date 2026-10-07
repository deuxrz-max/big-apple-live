import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Wordmark } from '@/components/brand';
import NotFound from '@/pages/not-found';
import { clearAllCreds } from '@/lib/room-creds';
import { AdultGate, ChatDirectory, ChatProfile, PublicChatLanding, TextChatRoom } from '@/chat/ChatApp';
import { configureBeamAccount } from '@/beam/services/beamService';
import SocialApp from '@/social/SocialApp';

const queryClient = new QueryClient();

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}


const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(332 85% 52%)',
    colorForeground: 'hsl(255 38% 14%)',
    colorMutedForeground: 'hsl(255 16% 36%)',
    colorDanger: 'hsl(8 78% 46%)',
    colorBackground: 'hsl(42 70% 98%)',
    colorInput: 'hsl(40 62% 95%)',
    colorInputForeground: 'hsl(255 38% 14%)',
    colorNeutral: 'hsl(255 38% 14%)',
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: '0.7rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(42_70%_98%)] rounded-2xl w-[440px] max-w-full overflow-hidden border-2 border-[hsl(255_38%_14%)] shadow-[5px_5px_0_hsl(255_38%_14%)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: { fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, color: 'hsl(255 38% 14%)' },
    headerSubtitle: { color: 'hsl(255 16% 36%)' },
    socialButtonsBlockButtonText: { color: 'hsl(255 38% 14%)', fontWeight: 600 },
    formFieldLabel: { color: 'hsl(255 38% 14%)', fontWeight: 600 },
    footerActionLink: { color: 'hsl(332 85% 40%)', fontWeight: 700 },
    footerActionText: { color: 'hsl(255 16% 36%)' },
    dividerText: { color: 'hsl(255 16% 36%)' },
    identityPreviewEditButton: { color: 'hsl(332 85% 40%)' },
    formFieldSuccessText: { color: 'hsl(160 70% 28%)' },
    alertText: { color: 'hsl(8 78% 36%)' },
    logoBox: 'h-14 justify-center',
    logoImage: 'h-14 w-14 rounded-xl',
    socialButtonsBlockButton: 'border-2 border-[hsl(255_38%_14%)] bg-white/60',
    formButtonPrimary: 'border-2 border-[hsl(255_38%_14%)] shadow-[3px_3px_0_hsl(255_38%_14%)] font-bold',
    formFieldInput: 'border-2 border-[hsl(255_38%_14%)]',
    footerAction: '',
    dividerLine: 'bg-[hsl(255_38%_14%)]/30',
    alert: 'border-2 border-[hsl(8_78%_46%)]',
    otpCodeFieldInput: 'border-2 border-[hsl(255_38%_14%)]',
    formFieldRow: '',
    main: '',
  },
};

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-4 py-8">
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
  return (
    <AuthShell>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
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
      configureBeamAccount(userId);
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
      <Show when="signed-in">{user && <AdultGate><ChatDirectory key={user.id} /></AdultGate>}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function CommunityRoute() {
  const { user } = useUser();
  return (
    <>
      <Show when="signed-in">{user && <AdultGate><SocialApp key={user.id} userId={user.id} /></AdultGate>}</Show>
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
        {user && <AdultGate><TextChatRoom key={`${user.id}:${roomId}`} roomId={roomId} userId={user.id} /></AdultGate>}
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
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to get your face and name back' } },
        signUp: { start: { title: 'Get your name', subtitle: 'One account, one dedicated username' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <RoutedErrorBoundary>
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
        </RoutedErrorBoundary>
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
