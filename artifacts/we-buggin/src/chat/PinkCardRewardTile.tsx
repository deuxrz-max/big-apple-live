import { useState } from 'react';
import { createPortal } from 'react-dom';
import { getGetPinkCardEntryQueryKey, getGetPinkCardRewardQueryKey, useGetPinkCardEntry, useGetPinkCardReward, useUpdatePinkCardEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { PINK_CARD_MEDIA, PINK_CARD_POLL_MS } from './pinkCardLogic';
import './pink-card.css';

function EntrySheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const entry = useGetPinkCardEntry({ query: { queryKey: getGetPinkCardEntryQueryKey() } });
  const update = useUpdatePinkCardEntry();
  const optedOut = entry.data?.optedOut ?? false;
  const toggle = () => update.mutate({ data: { optedOut: !optedOut } }, {
    onSuccess: (d) => qc.setQueryData(getGetPinkCardEntryQueryKey(), d),
  });
  return (
    <div className="pc-sheet" role="dialog" aria-modal="false" aria-labelledby="pc-sheet-title" data-testid="sheet-pink-card">
      <strong id="pc-sheet-title">Pink Card draw</strong>
      <p>Claim 25 daily coins to enter. Six random draws per daily cycle; one winner per draw. You can win once in any 24 hours.</p>
      <p>Entries reset at 3 AM Eastern. Opting back in applies to your next daily coin claim.</p>
      {entry.isLoading ? <span className="pc-skel" aria-busy="true" /> : entry.isError ? (
        <button type="button" className="pc-btn" onClick={() => entry.refetch()} data-testid="button-pink-card-retry">Retry</button>
      ) : (
        <>
          <span className="pc-status" data-testid="status-pink-card-entry">
            {optedOut ? 'You opted out' : entry.data?.entered ? 'Entered this draw' : 'Not entered yet'}
          </span>
          <button type="button" className="pc-btn" role="switch" aria-checked={!optedOut} disabled={update.isPending}
            onClick={toggle} data-testid="toggle-pink-card-optout">
            {update.isPending ? 'Saving…' : optedOut ? 'Opt back in' : 'Opt out of draws'}
          </button>
          {update.isError && <span className="pc-err" role="alert">Could not save. Try again.</span>}
        </>
      )}
      <button type="button" className="pc-btn pc-btn-ghost" onClick={onClose} data-testid="button-pink-card-close">Close</button>
    </div>
  );
}

export function PinkCardRewardTile({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const reward = useGetPinkCardReward({ query: { queryKey: getGetPinkCardRewardQueryKey(), refetchInterval: PINK_CARD_POLL_MS, retry: 2 } });
  const winner = reward.data?.winner ?? null;
  return (
    <div className="rc-tile pc-tile" role="group" aria-label="Pink Card reward" data-testid="tile-pink-card">
      <div className="pc-art">
        <img src={PINK_CARD_MEDIA.card} alt="" className="pc-art-img" draggable={false} />
        <div className="pc-name" aria-live="polite" data-testid="text-pink-card-winner">
          {reward.isLoading ? <span className="pc-skel" aria-busy="true" /> : reward.isError ? (
            <><small className="pc-await">Draw status unavailable</small><button type="button" className="pc-btn" onClick={() => reward.refetch()}>Retry</button></>
          ) : winner ? (
            <><small>Latest winner</small><strong>{winner.name}</strong><em>{winner.prizeName}</em></>
          ) : <small className="pc-await">Awaiting first draw</small>}
        </div>
      </div>
      {signedIn && (
        <button type="button" className="pc-info" aria-expanded={open} aria-label="Pink Card draw details"
          onClick={() => setOpen((o) => !o)} data-testid="button-pink-card-details">i</button>
      )}
      {open && signedIn && createPortal(<EntrySheet onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
