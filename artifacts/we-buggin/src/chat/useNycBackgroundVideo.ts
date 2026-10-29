import { useEffect, useState } from 'react';
import { loadNycBackgroundVideos, pickRandomHomeBackground } from './nyc-background-videos';

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
