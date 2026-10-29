import { useEffect, useRef, useState } from 'react';
import {
  NYC_LOOP_CROSSFADE_MS,
  shouldPreloadNycLoopStandby,
  shouldStartNycLoopCrossfade,
} from './nyc-loop-video-policy';
import { advanceHomeBackgroundPlaylist } from './nyc-background-videos';

type Props = {
  sources?: readonly string[];
  className: string;
  testId?: string;
};

export function NycLoopingVideo({ sources = [], className, testId }: Props) {
  const videosRef = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const activeRef = useRef(0);
  const incomingRef = useRef<number | null>(null);
  const warmedRef = useRef<number | null>(null);
  const preloadRequestedRef = useRef<number | null>(null);
  const sequenceRef = useRef<readonly string[]>([]);
  const bufferPositionsRef = useRef<[number, number]>([0, 1]);
  const transitionTimerRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null);
  const sourceKey = JSON.stringify(sources);

  useEffect(() => {
    const sequence = [...sources];
    sequenceRef.current = sequence;
    activeRef.current = 0;
    incomingRef.current = null;
    warmedRef.current = null;
    preloadRequestedRef.current = null;
    setActiveIndex(0);
    setIncomingIndex(null);
    bufferPositionsRef.current = [0, sequence.length > 1 ? 1 : 0];

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    for (const video of videosRef.current) {
      if (!video) continue;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    if (sequence.length === 6) {
      videosRef.current.forEach((video, index) => {
        if (!video) return;
        video.preload = 'auto';
        video.src = sequence[bufferPositionsRef.current[index]];
        video.load();
      });
      const first = videosRef.current[0];
      if (first) void first.play().catch(() => undefined);
    }

    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      for (const video of videosRef.current) video?.pause();
    };
  }, [sourceKey]);

  const finishCrossfade = (fromIndex: number, toIndex: number) => {
    if (activeRef.current !== fromIndex || incomingRef.current !== toIndex) return;
    const step = advanceHomeBackgroundPlaylist(sequenceRef.current, bufferPositionsRef.current[toIndex]);
    const sequence = step.videos;
    const outgoing = videosRef.current[fromIndex];
    const nextPosition = step.nextPosition;
    sequenceRef.current = sequence;
    bufferPositionsRef.current[toIndex] = step.activePosition;

    outgoing?.pause();
    if (outgoing) {
      outgoing.currentTime = 0;
      if (sequence[nextPosition]) {
        outgoing.preload = 'metadata';
        outgoing.src = sequence[nextPosition];
        outgoing.load();
      }
    }

    activeRef.current = toIndex;
    incomingRef.current = null;
    bufferPositionsRef.current[fromIndex] = nextPosition;
    setActiveIndex(toIndex);
    setIncomingIndex(null);
    warmedRef.current = null;
    preloadRequestedRef.current = null;
    transitionTimerRef.current = null;
  };

  const startCrossfadeIfReady = (fromIndex: number) => {
    if (fromIndex !== activeRef.current || incomingRef.current !== null || sequenceRef.current.length !== 6) return;
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
    const standbyIndex = 1 - index;
    const standby = videosRef.current[standbyIndex];
    if (!active || !standby) return;
    const remaining = active.duration - active.currentTime;

    if (shouldPreloadNycLoopStandby(remaining)
      && warmedRef.current !== standbyIndex
      && preloadRequestedRef.current !== standbyIndex) {
      preloadRequestedRef.current = standbyIndex;
      standby.preload = 'auto';
      standby.load();
    }
    startCrossfadeIfReady(index);
  };

  const handleCanPlay = (index: number) => {
    if (index !== activeRef.current) {
      warmedRef.current = index;
      preloadRequestedRef.current = null;
      startCrossfadeIfReady(activeRef.current);
    }
  };

  const handleEnded = (index: number) => {
    if (index !== activeRef.current || incomingRef.current !== null) return;
    startCrossfadeIfReady(index);
  };

  if (sources.length !== 6) return null;

  return (
    <>
      {[0, 1].map((index) => {
        const visible = index === activeIndex || index === incomingIndex;
        const incoming = index === incomingIndex;
        return (
          <video
            key={index}
            ref={(element) => { videosRef.current[index] = element; }}
            className={[
              'nyc-loop-video',
              className,
              visible ? 'is-visible' : '',
              incoming ? 'is-incoming' : '',
            ].filter(Boolean).join(' ')}
            data-testid={index === activeIndex ? testId : undefined}
            autoPlay={index === activeIndex}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            onTimeUpdate={() => handleTimeUpdate(index)}
            onCanPlay={() => handleCanPlay(index)}
            onEnded={() => handleEnded(index)}
            aria-hidden="true"
          />
        );
      })}
    </>
  );
}
