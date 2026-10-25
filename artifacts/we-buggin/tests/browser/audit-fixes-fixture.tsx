import { useState } from 'react';
import { BottomNavigationContent } from '../../src/components/bottom-navigation';
import { UserPhoto } from '../../src/components/user-photo';
import '../../src/profile/profile.css';
import '../../src/social/favorites-gallery.css';

const portrait = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"><rect width="80" height="160" fill="white"/><rect x="1" y="1" width="78" height="158" fill="none" stroke="red" stroke-width="4"/><text x="8" y="80">WHOLE</text></svg>')}`;
const wrappers = ['pf-slide', 'bc-ph-tap', 'fg-photo', 'ur-slot-photo-fill', 'st-live-avatar', 'st-live-creator-avatar', 'st-live-gifter-avatar', 'gift-panel-avatar'];

export function AuditFixesFixture() {
  const [path, setPath] = useState('/home');
  const [unread, setUnread] = useState(3);
  const [signedIn, setSignedIn] = useState(true);
  return <div style={{ padding: 12, paddingBottom: 120 }}>
    <label>Fixture route<input aria-label="Fixture route" value={path} onChange={e => setPath(e.target.value)} /></label>
    <label>Fixture unread<input aria-label="Fixture unread" type="number" value={unread} onChange={e => setUnread(Number(e.target.value))} /></label>
    <button onClick={() => setSignedIn(v => !v)}>Toggle fixture sign-in</button>
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 90px)', gap: 12 }}>
      <div data-testid="shared-photo"><UserPhoto username="fixture" photoUrl={portrait} size={80} /></div>
      {wrappers.map(name => name === 'ur-slot-photo-fill'
        ? <img key={name} data-testid={name} className={name} src={portrait} style={{ width: 80, height: 80, position: 'static' }} />
        : <div key={name} className={name} data-testid={name} style={{ width: 80, height: 80, minHeight: 80 }}><img src={portrait} alt={name} style={{ width: '100%', height: '100%' }} /></div>)}
    </section>
    <BottomNavigationContent path={path} isSignedIn={signedIn} unreadCount={unread} />
  </div>;
}
