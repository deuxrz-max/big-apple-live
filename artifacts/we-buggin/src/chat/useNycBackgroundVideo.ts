import { useEffect, useState } from 'react';
import { loadNycBackgroundVideos, shuffleHomeBackgroundVideos } from './nyc-background-videos';

export function useHomeNycBackgroundVideo() {
  const [sources, setSources] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void loadNycBackgroundVideos(import.meta.env.BASE_URL).then(videos => {
      if (!active) return;
      setSources(shuffleHomeBackgroundVideos(videos));
    });
    return () => { active = false; };
  }, []);

  return sources;
}
