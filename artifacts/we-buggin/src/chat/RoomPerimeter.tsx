import { useEffect, useRef } from 'react';
import { roomPerimeterMotionFrames, ROOM_PERIMETER_DURATION_MS } from './room-perimeter-motion';

/** One transform-only layer; no SVG repaint, motion-path repaint or JS frame loop. */
export function RoomPerimeter() {
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const rim = frame.current;
    const light = rim?.firstElementChild;
    if (!rim || !light) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | null = null;
    let previousSize = '';
    const update = () => {
      const size = `${rim.clientWidth}:${rim.clientHeight}:${reducedMotion.matches}`;
      if (size === previousSize) return;
      previousSize = size;
      const phase = Number(animation?.currentTime ?? 0) % ROOM_PERIMETER_DURATION_MS;
      animation?.cancel();
      animation = null;
      if (reducedMotion.matches || !rim.clientWidth || !rim.clientHeight) return;
      animation = light.animate(roomPerimeterMotionFrames(rim.clientWidth, rim.clientHeight), {
        duration: ROOM_PERIMETER_DURATION_MS, iterations: Infinity, easing: 'linear',
      });
      animation.currentTime = phase;
    };
    const observer = new ResizeObserver(update);
    observer.observe(rim);
    reducedMotion.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', update);
      animation?.cancel();
    };
  }, []);
  return (
    <span ref={frame} className="ur-perimeter-shine" aria-hidden="true">
      <span className="ur-perimeter-glint" />
    </span>
  );
}
