import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RoomAudioClient, type AudioState, type RoomAudioError } from '@workspace/room-audio';
import { getGetRoomQueryKey, heartbeatParticipant, type RoomState } from '@workspace/api-client-react';
import { clearCreds, loadCreds, type RoomCreds } from '@/lib/room-creds';
import { errStatus } from '@/lib/identity';

export type Presence = 'connecting' | 'live' | 'reconnecting' | 'expired' | 'offline';

const HINTS: Record<string, string> = {
  'microphone-denied': 'Allow microphone access in your browser address bar, then press Start mic again.',
  'microphone-unavailable': 'No working microphone found. Plug one in or pick an input device, then press Start mic.',
  unsupported: 'This browser cannot do WebRTC audio. Use a current browser over HTTPS.',
  'session-in-use': 'Audio for this session opened in another tab. Use only one tab per session.',
  'signaling-unavailable': 'Lost the audio signal. Press Reconnect, or Start mic to begin again.',
  'peer-connection-failed': 'A peer link failed. Press Reconnect to rebuild audio connections.',
};

export function useRoomSession(roomId: string, userId: string) {
  const qc = useQueryClient();
  const [creds] = useState<RoomCreds | null>(() => loadCreds(userId, roomId));
  const [presence, setPresence] = useState<Presence>('connecting');
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const clientRef = useRef<RoomAudioClient | null>(null);
  const micEnabledRef = useRef(false);
  const leftRef = useRef(false);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!creds) return;
    leftRef.current = false;
    expiredRef.current = false;
    const sid = creds.participantSessionId;
    const markExpired = () => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      clearCreds(userId, roomId);
      setPresence('expired');
      es.close();
      clearInterval(timer);
      void clientRef.current?.stop().catch(() => undefined);
    };
    const client = new RoomAudioClient({
      roomId,
      participantSessionId: sid,
      baseUrl: '/api',
      onState: setAudioState,
      onError: (e: RoomAudioError) => {
        if (e.code === 'session-expired') return markExpired();
        if (e.code === 'playback-blocked') return setPlaybackBlocked(true);
        setAudioError(`${e.message}. ${HINTS[e.code] ?? ''}`.trim());
      },
    });
    clientRef.current = client;
    micEnabledRef.current = false;

    const es = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`);
    es.onopen = () => !expiredRef.current && setPresence('live');
    es.onerror = () => {
      if (expiredRef.current) return;
      setPresence(es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    };
    es.addEventListener('room.snapshot', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        const room: RoomState = parsed.room ?? parsed;
        const self = room.participants.find(p => p.participantId === creds.participantId);
        micEnabledRef.current = !!self?.micEnabled;
        client.setMicrophoneEnabled(micEnabledRef.current);
        for (const participant of room.participants) {
          if (participant.participantId !== creds.participantId)
            client.setPeerMicrophoneEnabled(participant.participantId, participant.micEnabled);
        }
        qc.setQueryData(getGetRoomQueryKey(roomId), room);
        setPresence('live');
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener('room.expired', markExpired);

    const beat = () =>
      heartbeatParticipant(roomId, sid).catch((e) => {
        if (errStatus(e) === 401 || errStatus(e) === 404) markExpired();
      });
    void beat();
    const timer = setInterval(beat, 30_000);

    return () => {
      es.close();
      clearInterval(timer);
      if (!leftRef.current && !expiredRef.current) {
        leftRef.current = true;
        void client.leave().catch(() => undefined);
        clearCreds(userId, roomId);
      }
      clientRef.current = null;
    };
  }, [creds, roomId, userId, qc]);

  const changeMic = useCallback(async (targetId: string, action: 'mute' | 'unmute' | 'request-unmute') => {
    if (!creds) throw new Error('Your room session ended; join again.');
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(targetId)}/microphone`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.participantSessionId}` },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? `Could not update the microphone (${res.status})`);
    }
    const room = await res.json() as RoomState;
    qc.setQueryData(getGetRoomQueryKey(roomId), room);
    const self = room.participants.find(p => p.participantId === creds.participantId);
    micEnabledRef.current = !!self?.micEnabled;
    clientRef.current?.setMicrophoneEnabled(micEnabledRef.current);
  }, [creds, roomId, qc]);

  const run = useCallback(async (fn: (c: RoomAudioClient) => Promise<void> | void) => {
    const c = clientRef.current;
    if (!c) return;
    setAudioError(null);
    try {
      await fn(c);
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Could not complete the audio action. Try again.');
    }
  }, []);

  return {
    creds,
    presence,
    audioState,
    audioError,
    playbackBlocked,
    startAudio: () => run(c => c.start()),
    enableAudio: () => run(() => changeMic(creds!.participantId, 'unmute')),
    stopAudio: () => run(async (c) => {
      c.setMicrophoneEnabled(false);
      setPlaybackBlocked(false);
      await c.stop();
    }),
    controlMic: (participantId: string, action: 'mute' | 'request-unmute') =>
      run(() => changeMic(participantId, action)),
    reconnect: () => run((c) => c.reconnect()),
    resume: () => run(async (c) => { await c.resumePlayback(); setPlaybackBlocked(false); }),
    leave: async () => {
      leftRef.current = true;
      try { await clientRef.current?.leave(); } catch { /* best effort */ }
      clearCreds(userId, roomId);
    },
    dismissExpired: () => clearCreds(userId, roomId),
  };
}
