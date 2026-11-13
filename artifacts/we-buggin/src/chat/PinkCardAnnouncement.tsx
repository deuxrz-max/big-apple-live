import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { getGetPinkCardRewardQueryKey, useGetPinkCardReward, type PinkCardWinner } from '@workspace/api-client-react';
import { PINK_CARD_MEDIA, PINK_CARD_POLL_MS, REVEAL_MS, SHUFFLE_MS, hasAnnounced, isAnnouncementRoute, isFreshDraw, markAnnounced, safeSession } from './pinkCardLogic';
import './pink-card.css';

function Overlay({ winner, onDone }: { winner: PinkCardWinner; onDone: () => void }) {
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="pc-ann is-reveal" data-testid="overlay-pink-card">
      <img className="pc-ann-media" src={PINK_CARD_MEDIA.card} alt="" aria-hidden="true" />
      <div className="pc-ann-reveal" role="status" aria-live="assertive">
        <small>Pink Card winner</small>
        <strong data-testid="text-pink-card-announce-name">{winner.name}</strong>
        <em>{winner.prizeName}</em>
      </div>
    </div>
  );
}

export function PinkCardAnnouncement({ path }: { path: string }) {
  const { isSignedIn } = useUser();
  const active = Boolean(isSignedIn) && isAnnouncementRoute(path);
  const reward = useGetPinkCardReward({ query: { queryKey: getGetPinkCardRewardQueryKey(), enabled: active, refetchInterval: active ? PINK_CARD_POLL_MS : false } });
  const [showing, setShowing] = useState<PinkCardWinner | null>(null);
  const winner = reward.data?.winner;
  useEffect(() => {
    if (!active || !winner || showing) return;
    const store = safeSession();
    if (hasAnnounced(store, winner.id) || !isFreshDraw(winner.drawnAt, Date.parse(reward.data!.serverTime))) return;
    if (markAnnounced(store, winner.id)) setShowing(winner);
  }, [active, winner, showing, reward.data?.serverTime]);
  if (!active || !showing) return null;
  return <Overlay key={showing.id} winner={showing} onDone={() => setShowing(null)} />;
}
