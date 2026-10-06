import { useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { Show, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMyProfileQueryKey } from '@workspace/api-client-react';
import './beam.css';
import { useBeamRoom, useBeamState } from './hooks/useBeam';
import { configureBeamAccount, getPersistenceNotice, restoreBeam, subscribe, getProfileSnapshot } from './services/beamService';
import { EntryPage } from './pages/EntryPage';
import { Landing } from './pages/Landing';
import { RoomPage } from './pages/RoomPage';

function Missing() {
  return (
    <main className="bm-entry">
      <h1 className="bm-h1">Nothing here</h1>
      <p className="bm-lede">That beam was not found.</p>
      <Link href="/" className="bm-btn bm-btn-primary">
        Home
      </Link>
    </main>
  );
}

function BeamRoute({ notice, setNotice }: { notice: string | null; setNotice: (n: string | null) => void }) {
  const { code } = useParams<{ code: string }>();
  const { room, self } = useBeamRoom(code);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    restoreBeam(code ?? '').catch(e => { if (mounted) setError(e instanceof Error ? e.message : 'Could not load beam.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [code]);
  if (loading) return <main className="bm-entry"><p role="status">Loading beam…</p></main>;
  if (error) return <main className="bm-entry"><p className="bm-error" role="alert">{error}</p><Link href="/beams/join">Rejoin a beam</Link></main>;
  if (!room) return <Missing />;
  if (!self) return <EntryPage mode="join" initialCode={room.code} onEntered={setNotice} />;
  return <RoomPage room={room} self={self} notice={notice} onNotice={setNotice} />;
}

function BeamApp() {
  const { user, isLoaded } = useUser();
  const qc = useQueryClient();
  const [readyAccount, setReadyAccount] = useState<string | null>(null);
  useEffect(() => {
    configureBeamAccount(user?.id ?? null);
    setReadyAccount(user?.id ?? null);
    const unsubscribe = subscribe(() => {
      const profile = getProfileSnapshot();
      if (profile) qc.setQueryData(getGetMyProfileQueryKey(), { profile });
    });
    return unsubscribe;
  }, [user?.id, qc]);
  const [notice, setNotice] = useState<string | null>(null);
  const [path] = useLocation();
  const { rooms } = useBeamState();
  const roomName = rooms[path.split('/')[2]?.toUpperCase()]?.name;
  const title = path === '/beams/new' ? 'Start a beam' : path === '/beams/join' ? 'Join a beam' : roomName;
  useEffect(() => {
    document.title = title ? `${title} — We Buggin` : 'We Buggin — Your beam. Your people.';
    return () => { document.title = 'We Buggin'; };
  }, [title]);
  const storageNotice = getPersistenceNotice();
  return (
    <div className="beam-app">
      <div className="bm-bg" aria-hidden="true"><i /><i /><i /></div>
      <nav className="bm-nav">
        <Link href="/beams" className="bm-logo" data-testid="link-logo">
          <span aria-hidden>🐞</span> WE BUGGIN
        </Link>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>
          <Link href="/community" className="bm-tag">People</Link>
          <Link href="/community/rewards" className="bm-tag">Rewards</Link>
          <Link href="/user-portal" className="bm-tag">My account</Link>
        </span>
      </nav>
      {storageNotice && <p className="bm-demo-note" role="status" style={{ padding: '0 20px 16px' }}>{storageNotice}</p>}
      <Show when="signed-out">
        {path === '/' || path === '/beams' ? <Landing /> :
          <main className="bm-entry"><h1 className="bm-h1">Sign in to Beam</h1><Link href="/sign-in">Sign in</Link> · <Link href="/sign-up">Create an account</Link></main>}
      </Show>
      <Show when="signed-in">
      {isLoaded && user?.id === readyAccount ? <Switch>
        <Route path="/beams" component={Landing} />
        <Route path="/beams/new">
          <EntryPage mode="create" onEntered={setNotice} />
        </Route>
        <Route path="/beams/join">
          <EntryPage mode="join" onEntered={setNotice} />
        </Route>
        <Route path="/beams/:code">
          <BeamRoute notice={notice} setNotice={setNotice} />
        </Route>
        <Route component={Missing} />
      </Switch> : <p role="status">Loading your account…</p>}
      </Show>
    </div>
  );
}

export default BeamApp;
