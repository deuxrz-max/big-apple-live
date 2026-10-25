import { UserPhoto } from '../../src/components/user-photo';
import { NeutralAvatar } from '../../src/components/neutral-avatar';
import '../../src/chess/chess.css';

/** No account, wallet or media writes; the same production avatar components and classes. */
export function VisualCleanupFixture() {
  const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"><rect x="1" y="1" width="78" height="158" fill="#171717" stroke="#d4b15f" stroke-width="2"/></svg>')}`;
  return <div>
    <header className="ch st-home">
      <details className="st-home-profile-menu">
        <summary className="st-dir-avatar st-home-avatar" data-testid="home-photo">
          <UserPhoto username="fixture" photoUrl={photo} size={36} />
        </summary>
      </details>
    </header>
    <div data-testid="no-photo"><UserPhoto displayName="No Photo" /></div>
    <div data-testid="neutral-photo"><NeutralAvatar name="No Photo" /></div>
    <div className="chess-photo" style={{ width: '100%', height: 180 }}>
      <div className="chess-photo-fallback" data-testid="chess-no-photo">
        <UserPhoto username="fixture" size={96} />
      </div>
    </div>
  </div>;
}
