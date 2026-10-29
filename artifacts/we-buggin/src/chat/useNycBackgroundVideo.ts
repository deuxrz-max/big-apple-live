import { useEffect, useState } from 'react';
import { loadNycBackgroundVideos, pickRandomHomeBackground, pickRoomBackground } from './nyc-background-videos';

export function useHomeNycBackgroundVideo() {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadNycBackgroundVideos(import.meta.env.BASE_URL).then(videos => {
      if (!active) return;
      setSource(pickRandomHomeBackground(videos));
    });
    return () => { active = false; };
  }, []);

  return source;
}

export function useRoomNycBackgroundVideo(roomId: string, roomType: string | undefined) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (roomType !== 'social' || roomId.toUpperCase().startsWith('CHESS')) {
      setSource(null);
      return () => { active = false; };
    }
    void loadNycBackgroundVideos(import.meta.env.BASE_URL).then(videos => {
      if (active) setSource(pickRoomBackground(roomId, roomType, videos));
    });
    return () => { active = false; };
  }, [roomId, roomType]);

  return source;
}
