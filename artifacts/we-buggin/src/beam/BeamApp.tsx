import { useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import './beam.css';
import { useBeamRoom, useBeamState } from './hooks/useBeam';
import { getPersistenceNotice } from './services/beamService';
import { EntryPage } from './pages/EntryPage';
import { Landing } from './pages/Landing';
import { RoomPage } from './pages/RoomPage';

function Missing() {
  return (
    <main className="bm-entry">
      <h1 className="bm-h1">Nothing here</h1>
      <p className="bm-lede">That beam doesn't exist in this demo.</p>
      <Link href="/" className="bm-btn bm-btn-primary">
        Home
      </Link>
    </main>
  );
}

function BeamRoute({ notice, setNotice }: { notice: string | null; setNotice: (n: string | null) => void }) {
  const { code } = useParams<{ code: string }>();
  const { room, self } = useBeamRoom(code);
  if (!room) return <Missing />;
  if (!self) return <EntryPage mode="join" initialCode={room.code} onEntered={setNotice} />;
  return <RoomPage room={room} self={self} notice={notice} onNotice={setNotice} />;
}

function BeamApp() {
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
        <Link href="/" className="bm-logo" data-testid="link-logo">
          <span aria-hidden>🐞</span> WE BUGGIN
        </Link>
        <span className="bm-tag">Demo</span>
      </nav>
      {storageNotice && <p className="bm-demo-note" role="status" style={{ padding: '0 20px 16px' }}>{storageNotice}</p>}
      <Switch>
        <Route path="/" component={Landing} />
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
      </Switch>
    </div>
  );
}

export default BeamApp;
