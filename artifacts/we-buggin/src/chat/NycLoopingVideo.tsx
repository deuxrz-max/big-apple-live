import { useEffect, useRef, useState } from 'react';
import {
  NYC_LOOP_CROSSFADE_MS,
  shouldPreloadNycLoopStandby,
  shouldStartNycLoopCrossfade,
} from './nyc-loop-video-policy';

type Props = {
  src?: string | null;
  className: string;
  testId?: string;
};

export function NycLoopingVideo({ src, className, testId }: Props) {
  const videosRef = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const activeRef = useRef(0);
  const incomingRef = useRef<number | null>(null);
  const warmedRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null);
  const [warmedIndex, setWarmedIndex] = useState<number | null>(null);

  useEffect(() => {
    activeRef.current = 0;
    incomingRef.current = null;
    warmedRef.current = null;
    setActiveIndex(0);
    setIncomingIndex(null);
    setWarmedIndex(null);

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    for (const video of videosRef.current) {
      if (!video) continue;
      video.pause();
      video.currentTime = 0;
      video.load();
    }
    const first = videosRef.current[0];
    if (src && first) void first.play().catch(() => undefined);

    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      for (const video of videosRef.current) video?.pause();
    };
  }, [src]);

  if (!src) return null;

  const finishCrossfade = (fromIndex: number, toIndex: number) => {
    if (activeRef.current !== fromIndex || incomingRef.current !== toIndex) return;
    const outgoing = videosRef.current[fromIndex];
    outgoing?.pause();
    if (outgoing) outgoing.currentTime = 0;
    activeRef.current = toIndex;
    incomingRef.current = null;
    setActiveIndex(toIndex);
    setIncomingIndex(null);
    warmedRef.current = fromIndex;
    setWarmedIndex(fromIndex);
    transitionTimerRef.current = null;
  };

  const startCrossfadeIfReady = (fromIndex: number) => {
    if (fromIndex !== activeRef.current || incomingRef.current !== null) return;
    const outgoing = videosRef.current[fromIndex];
    const incoming = videosRef.current[1 - fromIndex];
    if (!outgoing || !incoming) return;
    const remaining = outgoing.duration - outgoing.currentTime;
    if (!shouldStartNycLoopCrossfade(remaining, incoming.readyState)) return;

    const toIndex = 1 - fromIndex;
    incomingRef.current = toIndex;
    setIncomingIndex(toIndex);
    try {
      incoming.currentTime = 0;
    } catch {
      incomingRef.current = null;
      setIncomingIndex(null);
      return;
    }

    void incoming.play().then(() => {
      if (activeRef.current !== fromIndex || incomingRef.current !== toIndex) return;
      transitionTimerRef.current = window.setTimeout(
        () => finishCrossfade(fromIndex, toIndex),
        NYC_LOOP_CROSSFADE_MS,
      );
    }).catch(() => {
      incomingRef.current = null;
      setIncomingIndex(null);
      if (outgoing.ended) {
        outgoing.currentTime = 0;
        void outgoing.play().catch(() => undefined);
      }
    });
  };

  const handleTimeUpdate = (index: number) => {
    if (index !== activeRef.current || incomingRef.current !== null) return;
    const active = videosRef.current[index];
    const standby = videosRef.current[1 - index];
    if (!active || !standby) return;
    const remaining = active.duration - active.currentTime;

    if (shouldPreloadNycLoopStandby(remaining) && warmedRef.current !== 1 - index) {
      warmedRef.current = 1 - index;
      setWarmedIndex(1 - index);
      standby.preload = 'auto';
      standby.load();
    }
    startCrossfadeIfReady(index);
  };

  const handleEnded = (index: number) => {
    if (index !== activeRef.current || incomingRef.current !== null) return;
    const standby = videosRef.current[1 - index];
    if (!standby) return;
    if (standby.preload !== 'auto') {
      standby.preload = 'auto';
      standby.load();
    }
    startCrossfadeIfReady(index);
  };

  return (
    <>
      {[0, 1].map((index) => {
        const visible = index === activeIndex || index === incomingIndex;
        const incoming = index === incomingIndex;
        return (
          <video
            key={`${src}-${index}`}
            ref={(element) => { videosRef.current[index] = element; }}
            className={[
              'nyc-loop-video',
              className,
              visible ? 'is-visible' : '',
              incoming ? 'is-incoming' : '',
            ].filter(Boolean).join(' ')}
            src={src}
            data-testid={index === 0 ? testId : undefined}
            autoPlay={index === activeIndex}
            muted
            playsInline
            preload={index === activeIndex || index === warmedIndex ? 'auto' : 'metadata'}
            tabIndex={-1}
            onTimeUpdate={() => handleTimeUpdate(index)}
            onCanPlay={() => startCrossfadeIfReady(activeRef.current)}
            onEnded={() => handleEnded(index)}
            aria-hidden="true"
          />
        );
      })}
    </>
  );
}
