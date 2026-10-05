import { useState } from 'react';
import { useLocation } from 'wouter';
import { BeamRoomLayout } from '../components/BeamRoomLayout';
import { EmojiPicker } from '../components/EmojiPicker';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { ParticipantEmojiBadge } from '../components/ParticipantEmojiBadge';
import { useAction, useCopy } from '../hooks/useBeam';
import { leaveBeam, sendMessage, updateIdentity } from '../services/beamService';
import type { BeamRoom, Identity, Participant } from '../types';
import { getPortrait } from '../portraits';
import { capacityColumns } from '../types';

interface Props {
  room: BeamRoom;
  self: Participant;
  notice: string | null;
  onNotice: (n: string | null) => void;
}

export function RoomPage({ room, self, notice, onNotice }: Props) {
  const [, navigate] = useLocation();
  const [changing, setChanging] = useState(false);
  const send = useAction();
  const slots = Array.from({ length: room.capacity }, (_, i) => room.participants[i] ?? null);

  const leave = async () => {
    const ok = await send.run(async () => { await leaveBeam(room.code, self.id); return true; });
    if (!ok) return;
    onNotice(null);
    navigate('/beams/join');
  };

  const change = async (handle: string, identity: Identity) => {
    try {
      await updateIdentity(room.code, self.id, handle, identity);
      onNotice(`You are now ${handle} · ${getPortrait(identity).label}`);
      setChanging(false);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not update.';
    }
  };

  return (
    <>
      <BeamRoomLayout
        name={room.name}
        actions={
          <>
            <button type="button" className="bm-btn" onClick={() => setChanging(true)} data-testid="button-change-identity">
              Change picture
            </button>
            <button type="button" className="bm-btn" onClick={leave} data-testid="button-leave">
              Leave
            </button>
          </>
        }
        notice={
          notice && (
            <div className="bm-notice" role="status" data-testid="text-identity-confirmation">
              <span>{notice}</span>
              <button type="button" className="bm-icon-btn" onClick={() => onNotice(null)} aria-label="Dismiss">
                ✕
              </button>
            </div>
          )
        }
        roster={
          <div className="bm-roster" style={{ gridTemplateColumns: `repeat(${capacityColumns(room.capacity)}, minmax(0, 1fr))` }} data-testid="grid-roster">
            {slots.map((p, i) =>
              p ? (
                <div key={p.id} className={`bm-tile ${p.id === self.id ? 'is-self' : ''}`}>
                  <ParticipantEmojiBadge handle={p.handle} identity={p.identity} size="lg" simulated={p.simulated} showHandle />
                </div>
              ) : (
                <div key={`e${i}`} className="bm-tile bm-tile-empty" aria-hidden>
                  <span>{i + 1}</span>
                </div>
              ),
            )}
          </div>
        }
        demo={<p className="bm-demo-note">Shared room · messages and moods are saved to your account.</p>}
        stream={<MessageList messages={room.messages} participants={room.participants} selfId={self.id} />}
        composer={
          <MessageInput
            error={send.error}
            onSend={async (t) => await send.run(async () => { await sendMessage(room.code, self.id, 'text', t); return true; }) === true}
            onReact={(r) => send.run(() => sendMessage(room.code, self.id, 'reaction', r))}
          />
        }
      />
      {changing && <EmojiPicker title="Change profile picture" lockHandle initialHandle={self.handle} initialIdentity={self.identity} confirmLabel="Confirm" onConfirm={change} onCancel={() => setChanging(false)} />}
    </>
  );
}
