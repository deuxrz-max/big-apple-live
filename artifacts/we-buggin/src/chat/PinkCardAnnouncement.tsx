import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { getGetPinkCardRewardQueryKey, useGetPinkCardReward, type PinkCardWinner } from '@workspace/api-client-react';
import { PINK_CARD_MEDIA, PINK_CARD_POLL_MS, REVEAL_MS, SHUFFLE_MS, hasAnnounced, isAnnouncementRoute, isFreshDraw, markAnnounced, safeSession } from './pinkCardLogic';
import './pink-card.css';

function canPlayAlphaWebm(): boolean {
  try { return document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '' && !/^((?!chrome|android).)*safari/i.test(navigator.userAgent); } catch { return false; }
}

function Overlay({ winner, onDone }: { winner: PinkCardWinner; onDone: () => void }) {
  const [phase, setPhase] = useState<'shuffle' | 'reveal'>('shuffle');
  const [useFallback] = useState(() => !canPlayAlphaWebm());
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t1 = window.setTimeout(() => setPhase('reveal'), reduced ? 0 : SHUFFLE_MS);
    const t2 = window.setTimeout(() => onDoneRef.current(), (reduced ? 0 : SHUFFLE_MS) + REVEAL_MS);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play()?.catch(() => setPhase('reveal')); // autoplay blocked: reveal the name anyway
  }, []);
  return (
    <div className={`pc-ann is-${phase}`} aria-hidden={phase === 'shuffle'} data-testid="overlay-pink-card">
      {phase === 'shuffle' && (useFallback
        ? <img className="pc-ann-media" src={PINK_CARD_MEDIA.shuffleFallback} alt="" onError={() => setPhase('reveal')} />
        : <video ref={videoRef} className="pc-ann-media" src={PINK_CARD_MEDIA.shuffle} muted playsInline autoPlay preload="auto"
            onError={() => setPhase('reveal')} />)}
      {phase === 'reveal' && (
        <div className="pc-ann-reveal" role="status" aria-live="assertive">
          <small>Pink Card winner</small>
          <strong data-testid="text-pink-card-announce-name">{winner.name}</strong>
          <em>{winner.prizeName}</em>
        </div>
      )}
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
