import { useEffect, useRef } from 'react';
import {
  roomPerimeterMotionFrames,
  ROOM_PERIMETER_DURATION_MS,
  ROOM_PERIMETER_LIGHT_SIZE,
  type RoomPerimeterEdge,
} from './room-perimeter-motion';

const EDGES: RoomPerimeterEdge[] = ['top', 'right', 'bottom', 'left'];

/** Four small edge-local highlights; no viewport-sized mask or JavaScript frame loop. */
export function RoomPerimeter() {
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const rim = frame.current;
    if (!rim) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    let previousSize = '';
    const update = () => {
      const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
      const size = `${width}:${height}:${reducedMotion.matches}`;
      if (size === previousSize) return;
      previousSize = size;
      const phase = Number(animations[0]?.currentTime ?? 0) % ROOM_PERIMETER_DURATION_MS;
      animations.forEach(animation => animation.cancel());
      animations = [];
      if (reducedMotion.matches || !width || !height) return;
      animations = EDGES.flatMap(edge => {
        const light = rim.querySelector<HTMLElement>(`[data-room-edge="${edge}"]`);
        if (!light) return [];
        const horizontal = edge === 'top' || edge === 'bottom';
        const length = Math.min(ROOM_PERIMETER_LIGHT_SIZE, horizontal ? width : height);
        light.style.width = `${horizontal ? length : 2}px`;
        light.style.height = `${horizontal ? 2 : length}px`;
        light.style.left = edge === 'right' ? `${width - 2}px` : '0px';
        light.style.top = edge === 'bottom' ? `${height - 2}px` : '0px';
        const animation = light.animate(roomPerimeterMotionFrames(width, height, edge), {
          duration: ROOM_PERIMETER_DURATION_MS, iterations: Infinity, easing: 'linear',
        });
        animation.currentTime = phase;
        return [animation];
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    const viewport = window.visualViewport;
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    reducedMotion.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      reducedMotion.removeEventListener('change', update);
      animations.forEach(animation => animation.cancel());
    };
  }, []);
  return (
    <span ref={frame} className="ur-perimeter-shine" aria-hidden="true">
      {EDGES.map(edge => (
        <span
          key={edge}
          className={`ur-perimeter-glint ur-perimeter-glint--${edge}`}
          data-room-edge={edge}
        />
      ))}
    </span>
  );
}
