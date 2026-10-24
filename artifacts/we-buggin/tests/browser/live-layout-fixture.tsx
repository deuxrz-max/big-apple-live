import { useEffect, useState } from 'react';
import { LiveSurface } from '../../src/chat/GoLiveScreens';
import type { HostLiveSnapshot } from '../../src/chat/liveSessionController';

// Synthetic media only. No camera permission, LiveKit connection or real stream.
export function LiveLayoutFixture() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    document.body.classList.add('streamtalk-live-screen');
    const canvas = document.createElement('canvas');
    canvas.width = 390; canvas.height = 844;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#393d45'; ctx.fillRect(0, 0, 390, 844);
    const media = canvas.captureStream(1);
    setStream(media);
    return () => {
      media.getTracks().forEach(track => track.stop());
      document.body.classList.remove('streamtalk-live-screen');
    };
  }, []);
  const state: HostLiveSnapshot = {
    phase: 'live', localStream: stream, localTracks: [], videoTrack: null, room: null,
    viewerCount: 0, chatReady: true, microphoneEnabled: true, cameraFacing: 'user',
    error: '', conflictStreamId: null, joinNotice: 'Fixture viewer',
    session: {
      streamId: 'layout-fixture', username: 'fixture', displayName: '👑 VAMPSQUAD',
      url: '', token: '', displayNameColor: '#fff', displayNameTierIndex: 96,
    },
  };
  return <LiveSurface streamId="layout-fixture" hostMode hostState={state} ownUsername="fixture" />;
}
