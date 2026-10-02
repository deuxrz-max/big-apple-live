import { Link } from 'wouter';
import { resetDemo } from '../services/beamService';

export function Landing() {
  return (
    <main className="bm-landing">
      <h1 className="bm-hero">
        Twelve seats.
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
      </div>
      <p className="bm-demo-note">
        Frontend demo / simulated participants. Try code <b>LATEBG</b> (6 people) or <b>FULL12</b> (full).{' '}
        <button type="button" className="bm-link-btn" onClick={resetDemo} data-testid="button-reset-demo">
          Reset demo data
        </button>
      </p>
    </main>
  );
}
