import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Headphones, LogOut, Mic, MicOff, RefreshCw } from 'lucide-react';
import {
  getGetRoomQueryKey,
  useGetRoom,
  useJoinAccountRoom,
  type Participant,
} from '@workspace/api-client-react';
import { Attribution, Wordmark } from '@/components/brand';
import { useRoomSession } from '@/hooks/use-room-session';
import { IdentityAvatar, InitialsBadge, errMessage } from '@/lib/identity';
import { saveCreds } from '@/lib/room-creds';
import { RoomExpressionControl } from '@/components/room-expression-control';

const AUDIO_LABEL: Record<string, string> = {
  idle: 'Mic off',
  'requesting-microphone': 'Waiting for mic permission',
  ready: 'Mic on, nobody else yet',
  connecting: 'Connecting audio',
  connected: 'Audio connected',
  reconnecting: 'Reconnecting audio',
  error: 'Audio error',
  closed: 'Mic off',
};
const PRESENCE_LABEL = { connecting: 'Connecting', live: 'Live', reconnecting: 'Reconnecting', expired: 'Session ended', offline: 'Offline' } as const;

function Card({ p, self, isHost, onControl }: {
  p: Participant; self: boolean; isHost: boolean;
  onControl: (id: string, action: 'mute' | 'request-unmute') => void;
}) {
  return (
    <li className={`sticker flex flex-col items-center p-4 text-center ${self ? 'bg-secondary/60' : ''}`} data-testid={`card-participant-${p.participantId}`}>
      {p.identity ? <IdentityAvatar identity={p.identity} size={150} /> : <div className="grid h-[150px] place-items-center"><InitialsBadge name={p.displayName} /></div>}
      <p className="mt-2 font-display text-2xl font-extrabold" data-testid={`text-name-${p.participantId}`}>{p.displayName}</p>
      <p className="label-mono text-muted-foreground">{self ? 'You' : p.isRegistered ? 'Member' : 'Guest'}</p>
      <p className="label-mono" data-testid={`status-mic-${p.participantId}`}>{p.micEnabled ? 'Mic on' : p.hostMuted ? 'Muted by creator' : 'Mic off'}</p>
      {isHost && !self && (
        <button type="button" className="btn mt-2" onClick={() => onControl(p.participantId, p.micEnabled ? 'mute' : 'request-unmute')}
          data-testid={`button-control-mic-${p.participantId}`}>
          {p.micEnabled ? 'Mute mic' : p.unmuteRequested ? 'Unmute requested' : 'Request mic on'}
        </button>
      )}
    </li>
  );
}

function Live({ roomId, userId }: { roomId: string; userId: string }) {
  const [, setLocation] = useLocation();
  const s = useRoomSession(roomId, userId);
  const roomQ = useGetRoom(roomId, { query: { enabled: !!s.creds, queryKey: getGetRoomQueryKey(roomId) } });
  const [copied, setCopied] = useState(false);
  const room = roomQ.data;
  const self = room?.participants.find((p) => p.participantId === s.creds?.participantId);
  const audioOn = !['idle', 'closed', 'error'].includes(s.audioState);
  const isHost = room?.hostParticipantId === s.creds?.participantId;

  const leave = async () => { await s.leave(); setLocation('/user-portal'); };
  const copy = async () => { await navigator.clipboard?.writeText(roomId).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-mono">Room code</p>
          <div className="flex items-center gap-2">
            <h1 className="break-all font-mono text-2xl font-bold" data-testid="text-room-code">{roomId}</h1>
            <button type="button" className="btn !p-2" onClick={copy} aria-label="Copy room code" data-testid="button-copy-code"><Copy className="size-4" /></button>
            {copied && <span role="status" className="text-sm font-bold">Copied</span>}
          </div>
        </div>
        <span className={`label-mono rounded-full px-3 py-1 sticker-sm ${s.presence === 'live' ? 'bg-accent' : 'bg-secondary'}`} role="status" data-testid="status-presence">{PRESENCE_LABEL[s.presence]}</span>
      </div>

      <section className="sticker mt-5 flex flex-wrap items-center gap-3 p-4" aria-label="Audio controls">
        <span className="label-mono mr-auto" role="status" data-testid="status-audio">{self?.hostMuted ? 'Muted by creator' : audioOn && !self?.micEnabled ? 'Mic off' : AUDIO_LABEL[s.audioState]}</span>
        {self?.unmuteRequested && <p className="w-full text-sm font-bold" role="status">The room creator requested your mic. Only you can turn it on.</p>}
        {!audioOn ? (
          <button type="button" className="btn btn-pink" onClick={s.startAudio} disabled={self?.hostMuted || s.audioState === 'requesting-microphone'} data-testid="button-start-audio"><Mic className="size-4" />{self?.unmuteRequested ? 'Accept and start mic' : 'Start mic'}</button>
        ) : (
          <>
            {!self?.micEnabled && !self?.hostMuted && <button type="button" className="btn btn-pink" onClick={s.enableAudio} data-testid="button-enable-audio">
              <Mic className="size-4" />{self?.unmuteRequested ? 'Accept and turn mic on' : 'Turn mic on'}
            </button>}
            <button type="button" className="btn" onClick={s.stopAudio} data-testid="button-stop-audio"><MicOff className="size-4" />Stop mic</button>
          </>
        )}
        <button type="button" className="btn" onClick={s.reconnect} disabled={!audioOn} data-testid="button-reconnect-audio"><RefreshCw className="size-4" />Reconnect</button>
        <button type="button" className={`btn ${s.playbackBlocked ? 'btn-yellow' : ''}`} onClick={s.resume} disabled={!audioOn} data-testid="button-resume-playback"><Headphones className="size-4" />Resume playback</button>
        <button type="button" className="btn btn-blue" onClick={leave} data-testid="button-leave-room"><LogOut className="size-4" />Leave</button>
        {s.playbackBlocked && <p className="w-full text-sm font-bold" role="alert">Your browser blocked sound. Press Resume playback to hear the room.</p>}
        {s.audioError && <p className="w-full text-sm font-bold text-destructive" role="alert" data-testid="text-audio-error">{s.audioError}</p>}
      </section>

      {self?.identity && <RoomExpressionControl
        roomId={roomId}
        participantId={self.participantId}
        identity={self.identity}
        disabled={s.presence === 'expired'}
      />}

      {s.presence === 'reconnecting' && <p className="mt-4 text-sm font-bold" role="status">Presence feed dropped. Reconnecting; heartbeats continue meanwhile.</p>}
      {s.presence === 'offline' && <p className="mt-4 text-sm font-bold text-destructive" role="alert">Presence feed closed. Reload to reconnect; you stay in the room while your heartbeat is valid.</p>}

      {roomQ.isLoading && <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <li key={i} className="sticker h-52 animate-pulse bg-muted" />)}</ul>}
      {roomQ.isError && !room && (
        <div className="sticker mt-6 p-5" role="alert">
          <p className="font-bold">{errMessage(roomQ.error, 'Could not load this room.')}</p>
          <button type="button" className="btn mt-3" onClick={() => roomQ.refetch()} data-testid="button-retry-room">Retry</button>
        </div>
      )}
      {room && (
        <>
          <p className="label-mono mt-6">{room.participants.length} here</p>
          <ul className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-3" data-testid="list-participants">
            {room.participants.map((p) => <Card key={p.participantId} p={p} self={p.participantId === s.creds?.participantId} isHost={!!isHost} onControl={s.controlMic} />)}
          </ul>
        </>
      )}

      {s.presence === 'expired' && <Expired roomId={roomId} userId={userId} />}
    </>
  );
}

function Expired({ roomId, userId, onRejoined }: { roomId: string; userId: string; onRejoined?: () => void }) {
  const qc = useQueryClient();
  const join = useJoinAccountRoom();
  return (
    <div className="sticker fixed inset-x-4 bottom-4 z-10 mx-auto max-w-md bg-card p-5" role="alertdialog" aria-label="Session ended" data-testid="dialog-expired">
      <p className="font-display text-2xl font-extrabold">You dropped out of this room.</p>
      <p className="mt-1 text-sm">Your session expired or the room closed. Rejoining is your call; nothing reconnects automatically.</p>
      {join.error && <p className="mt-2 text-sm font-bold text-destructive" role="alert">{errMessage(join.error)}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="btn btn-pink"
          disabled={join.isPending}
          onClick={() => join.mutate({ roomId }, {
            onSuccess: (r) => {
              saveCreds(userId, roomId, { participantSessionId: r.participantSessionId, participantId: r.participantId });
              qc.setQueryData(getGetRoomQueryKey(roomId), r.room);
              (onRejoined ?? (() => window.location.reload()))();
            },
          })}
          data-testid="button-rejoin"
        >{join.isPending ? 'Joining...' : 'Rejoin room'}</button>
        <Link href="/user-portal" className="btn" data-testid="link-back-portal">Back to portal</Link>
      </div>
    </div>
  );
}

export default function RoomPage({ roomId, userId, hasCreds }: { roomId: string; userId: string; hasCreds: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [joined, setJoined] = useState(hasCreds);
  return (
    <div className="min-h-[100dvh]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Wordmark href="/user-portal" />
        <Link href="/user-portal" className="btn" data-testid="link-portal">Portal</Link>
      </header>
      <main className="mx-auto max-w-5xl px-5">
        {joined ? (
          <Live key={`${roomId}-${nonce}`} roomId={roomId} userId={userId} />
        ) : (
          <div className="relative min-h-64">
            <h1 className="font-display text-4xl font-extrabold">Not in this room</h1>
            <p className="mt-2">This tab has no live session for room <span className="font-mono">{roomId}</span>. Join to hear and be seen.</p>
            <Expired roomId={roomId} userId={userId} onRejoined={() => { setJoined(true); setNonce((n) => n + 1); }} />
          </div>
        )}
      </main>
      <Attribution />
    </div>
  );
}
