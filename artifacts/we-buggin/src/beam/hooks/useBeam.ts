import { useCallback, useState, useSyncExternalStore } from 'react';
import { getState, subscribe } from '../services/beamService';
import type { BeamRoom, Participant } from '../types';

export function useBeamState() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useBeamRoom(code: string | undefined): {
  room: BeamRoom | null;
  self: Participant | null;
} {
  const s = useBeamState();
  const room = code ? s.rooms[code.toUpperCase()] ?? null : null;
  const self = room && s.session?.code === room.code ? room.participants.find((p) => p.id === s.session?.selfId) ?? null : null;
  return { room, self };
}

/** Wraps a service action; surfaces BeamError messages as state. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(<T,>(fn: () => T): T | undefined => {
    try {
      setError(null);
      return fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return undefined;
    }
  }, []);
  return { error, setError, run };
}

export function useCopy() {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copy = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('unavailable');
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
    window.setTimeout(() => setState('idle'), 3500);
  }, []);
  return { state, copy };
}
