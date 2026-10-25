import { useState } from 'react';
import { Link } from 'wouter';

/** Recovery actions must not depend on the unavailable access response. */
export function AccessCheckError({ retry, goBack, signOut }: {
  retry: () => void;
  goBack: () => void;
  signOut: () => Promise<unknown>;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  return (
    <section aria-labelledby="access-error-title" data-testid="access-check-error">
      <h1 id="access-error-title">Could not check access.</h1>
      <p role="alert">Try again, or use the bottom tabs to leave this screen. You can also go back or sign out.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="bm-btn" onClick={retry}>Retry</button>
        <button type="button" className="bm-btn" onClick={goBack}>Back</button>
        <button type="button" className="bm-btn" disabled={signingOut} onClick={async () => {
          setSigningOut(true);
          setSignOutFailed(false);
          try { await signOut(); }
          catch { setSignOutFailed(true); }
          finally { setSigningOut(false); }
        }}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
      <nav aria-label="Access error navigation" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <Link href="/community/favorites" className="bm-btn">Following</Link>
        <Link href="/community/messages" className="bm-btn">Messages</Link>
        <Link href="/user-portal" className="bm-btn">Me</Link>
      </nav>
      {signOutFailed && <p role="alert">Could not sign out. Try again, or use Back or the bottom tabs.</p>}
    </section>
  );
}
