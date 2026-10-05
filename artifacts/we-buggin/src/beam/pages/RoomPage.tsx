import { useState } from 'react';
import { useLocation } from 'wouter';
import { BeamRoomLayout } from '../components/BeamRoomLayout';
import { EmojiPicker } from '../components/EmojiPicker';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { ParticipantEmojiBadge } from '../components/ParticipantEmojiBadge';
import { useAction } from '../hooks/useBeam';
import { useBeamAudio } from '../hooks/useBeamAudio';
import { BeamMicrophoneMenu } from '../components/BeamMicrophoneMenu';
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
  const audio = useBeamAudio(room.code, self.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isCreator = room.hostParticipantId === self.id;
  const selected = room.participants.find(p => p.id === selectedId && (isCreator || p.id === self.id));
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
                <button key={p.id} type="button" className={`bm-tile bm-mic-tile ${p.id === self.id ? 'is-self' : ''}`}
                  disabled={!isCreator && p.id !== self.id}
                  aria-label={`${p.handle}: ${p.micEnabled ? 'mic on' : 'mic off'}${isCreator || p.id === self.id ? '. Open microphone controls' : ''}`}
                  aria-haspopup={isCreator || p.id === self.id ? 'dialog' : undefined}
                  onClick={() => setSelectedId(p.id)} data-testid={`button-mic-tile-${p.id}`}>
                  <ParticipantEmojiBadge handle={p.handle} identity={p.identity} size="lg" simulated={p.simulated} showHandle />
                  <span className="bm-mic-status">{p.micEnabled ? 'Mic on' : p.hostMuted ? 'Muted' : p.unmuteRequested ? 'Mic requested' : 'Mic off'}</span>
                </button>
              ) : (
                <div key={`e${i}`} className="bm-tile bm-tile-empty" aria-hidden>
                  <span>{i + 1}</span>
                </div>
              ),
            )}
          </div>
        }
        demo={
          <div className="bm-beam-audio">
            {self.unmuteRequested && <div className="bm-mic-request" role="status">
              <p>The creator is asking you to turn on your microphone.</p>
              <button type="button" className="bm-btn bm-btn-sm" disabled={audio.busy} onClick={audio.turnOn} data-testid="button-accept-beam-mic">Accept and turn on</button>
              <button type="button" className="bm-link-btn" disabled={audio.busy} onClick={audio.turnOff} data-testid="button-decline-beam-mic">Keep mic off</button>
            </div>}
            {audio.error && !selected && <p className="bm-error" role="alert">{audio.error}</p>}
            {audio.playbackBlocked && <button type="button" className="bm-btn bm-btn-sm" onClick={audio.resume}>Enable sound</button>}
            {audio.state === 'reconnecting' && <p className="bm-label" role="status">Reconnecting audio…</p>}
            <p className="bm-demo-note">{isCreator ? 'Tap a participant to control their microphone.' : 'Tap your picture to control your microphone.'}</p>
          </div>
        }
        stream={<MessageList messages={room.messages} participants={room.participants} selfId={self.id} />}
        composer={
          <MessageInput
            error={send.error}
            onSend={async (t) => await send.run(async () => { await sendMessage(room.code, self.id, 'text', t); return true; }) === true}
            onReact={(r) => send.run(() => sendMessage(room.code, self.id, 'reaction', r))}
          />
        }
      />
      <BeamMicrophoneMenu participant={selected} selfId={self.id} busy={audio.busy} error={audio.error}
        onClose={() => setSelectedId(null)}
        onMute={() => selected?.id === self.id ? audio.turnOff() : audio.control(selected!.id, 'mute')}
        onUnmute={() => selected?.id === self.id ? audio.turnOn() : audio.control(selected!.id, 'request-unmute')} />
      {changing && <EmojiPicker title="Change profile picture" lockHandle initialHandle={self.handle} initialIdentity={self.identity} confirmLabel="Confirm" onConfirm={change} onCancel={() => setChanging(false)} />}
    </>
  );
}
