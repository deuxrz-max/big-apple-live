import { useState } from 'react';
import { Link } from 'wouter';
import { useGetChatAccess } from '@workspace/api-client-react';
import { CardHandFan } from '@/chat/CardHandFan';
import { canUsePremiumCardFinish } from '@/chat/card-surface-finish';
import '@/chat/owner-card-game-test.css';
import '@/chat/card-surface-finish.css';

/** Visual-only sample hand: never sent anywhere, never starts a game. */
const SAMPLE_HAND = ['7H', 'QS', 'joker-wild-1', '10D', 'AC'];

export default function CardFinishPreview() {
  const access = useGetChatAccess();
  const [premium, setPremium] = useState(true);
  const [count, setCount] = useState(5);
  if (access.isLoading || access.isFetching && !access.data) {
    return <main className="dw-cfp" aria-busy="true" data-testid="status-card-finish-loading"><div className="dw-cfp-skel" /></main>;
  }
  if (!canUsePremiumCardFinish(import.meta.env.DEV, access.data)) {
    return (
      <main className="dw-cfp" data-testid="status-card-finish-denied">
        <h1>Not available</h1>
        <p>This page isn’t available for your account.</p>
        <Link href="/user-portal" className="pf-btn" data-testid="link-card-finish-back">Back to Me</Link>
      </main>
    );
  }
  const cards = SAMPLE_HAND.slice(0, count);
  return (
    <main className="dw-cfp" data-testid="page-card-finish-preview">
      <span className="dw-cfp-tag">Owner · development preview</span>
      <h1>Card finish</h1>
      <p>Sample hand for looks only. Nothing here is saved, dealt or sent. Drag across a card to see the light move; tap to zoom.</p>
      <div className="dw-cfp-controls">
        <button type="button" aria-pressed={!premium} onClick={() => setPremium(false)} data-testid="button-finish-off">Current</button>
        <button type="button" aria-pressed={premium} onClick={() => setPremium(true)} data-testid="button-finish-on">Premium</button>
        <span style={{ flex: 1 }} />
        {[1, 2, 3, 4, 5].map(n => (
          <button type="button" key={n} aria-pressed={count === n} aria-label={`${n} card${n > 1 ? 's' : ''}`}
            onClick={() => setCount(n)} data-testid={`button-card-count-${n}`}>{n}</button>
        ))}
      </div>
      <div className="dw-cfp-stage">
        <CardHandFan key={`${premium}-${count}`} cards={cards} expanded premium={premium} />
      </div>
      <Link href="/user-portal" className="pf-btn" data-testid="link-card-finish-back">Back to Me</Link>
    </main>
  );
}
