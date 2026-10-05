import { Link } from 'wouter';

export function Landing() {
  return (
    <main className="bm-landing">
      <h1 className="bm-hero">
        Your beam.
        <br />
        Your people.
      </h1>
      <div className="bm-cta">
        <Link href="/beams/new" className="bm-btn bm-btn-primary bm-btn-lg" data-testid="link-start-beam">
          Start a beam
        </Link>
        <Link href="/beams/join" className="bm-link" data-testid="link-join-beam">
          Join a beam
        </Link>
        <div className="bm-account-links">
          <Link href="/sign-up" className="bm-link" data-testid="link-create-account">Create an account</Link>
          <span aria-hidden="true"> / </span>
          <Link href="/sign-in" className="bm-link" data-testid="link-sign-in">Sign in</Link>
        </div>
      </div>
      <p className="bm-demo-note">
        Chat with real people. Share your beam code with friends.
      </p>
    </main>
  );
}
