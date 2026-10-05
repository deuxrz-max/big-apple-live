import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomAudioClient, type AudioState } from '@workspace/room-audio';
import { controlBeamMicrophone, getBeamAudioCredentials } from '../services/beamService';

export function useBeamAudio(code: string, selfId: string) {
  const clientRef = useRef<RoomAudioClient | null>(null);
  const [state, setState] = useState<AudioState>('idle');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const credentials = getBeamAudioCredentials(code, selfId);
    const client = new RoomAudioClient({
      roomId: code, participantSessionId: credentials.participantSessionId, baseUrl: '/api',
      onState: setState,
      onError: e => {
        if (e.code === 'playback-blocked') setPlaybackBlocked(true);
        else setError(e.message);
      },
    });
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      // The Beam service owns membership. Audio cleanup never leaves the Beam.
      void client.stop().catch(() => undefined);
    };
  }, [code, selfId]);

  const run = useCallback(async (action: (client: RoomAudioClient) => Promise<void>) => {
    const client = clientRef.current;
    if (!client || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action(client);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the microphone. Try again.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const turnOn = () => run(async client => {
    if (!client.getDiagnostics().microphoneActive) await client.start();
    if (clientRef.current !== client || !client.getDiagnostics().microphoneActive)
      throw new Error('Audio was closed. Open the microphone menu to try again.');
    await controlBeamMicrophone(code, selfId, selfId, 'unmute');
  });
  const turnOff = () => run(async client => {
    client.setMicrophoneEnabled(false);
    // Muting keeps playback connected so you can still hear everyone else.
    await controlBeamMicrophone(code, selfId, selfId, 'mute');
  });

  return {
    state, busy, error, playbackBlocked, turnOn, turnOff,
    control: (targetId: string, action: 'mute' | 'request-unmute') =>
      run(() => controlBeamMicrophone(code, selfId, targetId, action)),
    resume: () => run(async client => { await client.resumePlayback(); setPlaybackBlocked(false); }),
    reconnect: () => run(async client => { client.reconnect(); }),
  };
}
