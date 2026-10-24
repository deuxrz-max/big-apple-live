import { useState } from 'react';
import { Router, Route, Switch, useLocation, useParams } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { SocialPerson } from '@workspace/api-client-react';
import { QuickProfileProvider } from '../../src/profile/QuickProfile';
import { PersonCard } from '../../src/social/common';
import { FavoritesGallery } from '../../src/social/FavoritesGallery';
import { InboxPage } from '../../src/social/InboxPage';
import { PersonPage } from '../../src/social/PeoplePages';
import { PhotoCarousel } from '../../src/chess/ChessRoom';
import '../../src/profile/profile.css';

export const navigationPerson: SocialPerson = {
  username: 'navigation-fixture', displayName: 'Navigation Fixture', photoUrl: null,
  country: null, bio: 'Isolated profile navigation test', interests: [],
  followerCount: 3, followingCount: 2, receivedCredits: 0, sentCredits: 0,
  favorite: false, blocked: false, displayNameColor: '#FFFFFF', displayNameTierIndex: 11,
  identity: { emojiId: 'neutral', gender: 'Male', color: '#FFFFFF', hairColor: '#000000' },
  discoverable: true, badgeId: null, badgeName: null, badgeImage: null,
};

const memory = memoryLocation({ path: '/home' });
function FullProfile() {
  const { username = '' } = useParams<{ username: string }>();
  return <PersonPage username={username} />;
}
function NavigationSurface() {
  const [route] = useLocation();
  const [joins, setJoins] = useState(0);
  const [draft, setDraft] = useState('');
  return <div style={{ padding: 12 }}>
    <output data-testid="navigation-route">{route}</output>
    <Switch>
      <Route path="/community/people/:username" component={FullProfile} />
      <Route>
        <input aria-label="Preserved draft" value={draft} onChange={e => setDraft(e.target.value)} />
        <PersonCard p={navigationPerson} />
        <FavoritesGallery entries={[{ person: navigationPerson, room: { roomId: 'fixture', label: 'Fixture room' } }]}
          busyUsername={null} onSelect={() => setJoins(n => n + 1)} />
        <output data-testid="navigation-joins">{joins}</output>
        <section style={{ height: 170, position: 'relative', overflow: 'hidden' }}>
          <PhotoCarousel username={navigationPerson.username} name={navigationPerson.displayName || navigationPerson.username}
            urls={['/brand/deux-wild-icon-512.png', '/brand/deux-wild-icon-192.png']} />
        </section>
        <InboxPage />
      </Route>
    </Switch>
  </div>;
}
export function ProfileNavigationFixture() {
  return <Router hook={memory.hook}><QuickProfileProvider><NavigationSurface /></QuickProfileProvider></Router>;
}
